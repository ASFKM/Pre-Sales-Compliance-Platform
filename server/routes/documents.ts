import express, { Request, Response, NextFunction } from "express";
import multer from "multer";
import { dbStore } from "../../src/dbStore";
import { requireAuth, requirePermission } from "./auth";
import { createStorageAdapter, validateUploadedFile } from "../utils/storage";
import { extractTextFromDocument } from "../utils/extraction";
import { logDebugMessage } from "../middleware/security";

const router = express.Router();

// Multer memory storage configuration
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});


// Get documents for a project
router.get("/projects/:projectId/documents", requireAuth, (req: Request, res: Response, next: NextFunction) => {
  try {
    const docs = dbStore.getDocuments(req.params.projectId);
    res.json(docs);
  } catch (err) {
    next(err);
  }
});

// Real multipart file upload endpoint
router.post(
  "/projects/:projectId/documents",
  requirePermission("document:upload"),
  upload.single("file"),
  async (req: Request, res: Response, next: NextFunction) => {
    const correlationId = (req.headers["x-correlation-id"] as string) || "corr-doc";
    const startTime = Date.now();
    const projectId = req.params.projectId;

    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({ success: false, message: "No file was uploaded." });
      }

      // 1. Perform Secure File Validations (MIME, Extension, Size)
      const validation = validateUploadedFile(file.originalname, file.mimetype, file.size);
      if (!validation.valid) {
        logDebugMessage({
          operation: "Document Validation",
          message: `Document validation failed for: ${file.originalname}: ${validation.error}`,
          status: "WARN",
          durationMs: Date.now() - startTime,
          correlationId,
          projectId
        });
        return res.status(400).json({ success: false, message: validation.error });
      }

      // 2. Store via selected Storage Adapter
      const platformSettings = dbStore.getSettings();
      const storageAdapter = createStorageAdapter(platformSettings);
      const storagePath = await storageAdapter.uploadFile(
        projectId,
        file.buffer,
        file.originalname,
        file.mimetype
      );

      // 3. Extract text content through Text Extraction Pipelines
      const extraction = await extractTextFromDocument(file.buffer, file.originalname, file.mimetype);

      // 4. Save to Database
      const userId = (req.headers["x-user-id"] as string) || "u1";
      const docRecord = dbStore.addDocument({
        project_id: projectId,
        filename: file.originalname,
        original_filename: file.originalname,
        mime_type: file.mimetype,
        file_size: file.size,
        storage_provider: platformSettings.storage_mode,
        storage_path: storagePath,
        detected_document_type: file.mimetype.includes("pdf") ? "RFP / Bid Document" : "Contract/SLA",
        manual_document_type: undefined,
        ai_classification_confidence: 0.92,
        version: 1,
        language: "Portuguese",
        uploaded_by: userId
      });

      // Save extracted text to in-memory store so it is persistent for Gemini analysis
      // We extend the global dbData in dbStore.ts to hold document content index securely
      const dataStore = dbStore.getData();
      if (!dataStore.document_contents) {
        dataStore.document_contents = {};
      }
      dataStore.document_contents[docRecord.id] = extraction.text;

      logDebugMessage({
        operation: "Document Upload & Extraction",
        message: `Successfully processed, stored, and extracted ${file.originalname}. Size: ${file.size} bytes.`,
        status: "SUCCESS",
        durationMs: Date.now() - startTime,
        correlationId,
        projectId,
        documentId: docRecord.id
      });

      // Audit Log
      dbStore.addAuditLog({
        user_id: userId,
        action: "Upload Document",
        entity_type: "Document",
        entity_id: docRecord.id,
        project_id: projectId,
        ip_address: req.ip || "127.0.0.1",
        user_agent: req.headers["user-agent"] || "unknown",
        metadata: JSON.stringify({ filename: docRecord.filename, path: storagePath, status: extraction.metadata.extractionStatus })
      });

      res.status(211).json(docRecord);
    } catch (err) {
      next(err);
    }
  }
);

// Delete document
router.delete("/documents/:id", requirePermission("document:delete"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const docId = req.params.id;
    const doc = dbStore.getData().documents.find(d => d.id === docId);
    
    if (!doc) {
      return res.status(404).json({ success: false, message: "Document not found." });
    }

    // Remove from physical storage using the provider recorded on the document
    const storageAdapter = createStorageAdapter({
      ...dbStore.getSettings(),
      storage_mode: doc.storage_provider
    });
    await storageAdapter.deleteFile(doc.storage_path);

    // Remove from DB
    dbStore.deleteDocument(docId);

    // Remove text index
    const dataStore = dbStore.getData();
    if (dataStore.document_contents && dataStore.document_contents[docId]) {
      delete dataStore.document_contents[docId];
    }

    const userId = (req.headers["x-user-id"] as string) || "u1";
    dbStore.addAuditLog({
      user_id: userId,
      action: "Delete Document",
      entity_type: "Document",
      entity_id: docId,
      project_id: doc.project_id,
      ip_address: req.ip || "127.0.0.1",
      user_agent: req.headers["user-agent"] || "unknown",
      metadata: JSON.stringify({ filename: doc.filename })
    });

    res.json({ success: true, message: "Document deleted successfully." });
  } catch (err) {
    next(err);
  }
});

// Reclassify document manually
router.post("/documents/:id/reclassify", requirePermission("document:upload"), (req: Request, res: Response, next: NextFunction) => {
  try {
    const { document_type } = req.body;
    const doc = dbStore.getData().documents.find(d => d.id === req.params.id);

    if (!doc) {
      return res.status(404).json({ success: false, message: "Document not found" });
    }

    doc.manual_document_type = document_type;
    doc.detected_document_type = document_type; // also update active type

    const userId = (req.headers["x-user-id"] as string) || "u1";
    dbStore.addAuditLog({
      user_id: userId,
      action: "Reclassify Document",
      entity_type: "Document",
      entity_id: req.params.id,
      project_id: doc.project_id,
      ip_address: req.ip || "127.0.0.1",
      user_agent: req.headers["user-agent"] || "unknown",
      metadata: JSON.stringify({ manual_type: document_type })
    });

    res.json(doc);
  } catch (err) {
    next(err);
  }
});

export default router;
