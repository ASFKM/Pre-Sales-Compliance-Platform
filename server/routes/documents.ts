import express, { Request, Response, NextFunction } from "express";
import multer from "multer";
import { dbStore } from "../../src/dbStore";
import { requireAuth, requirePermission } from "./auth";
import { createStorageAdapter, validateUploadedFile } from "../utils/storage";
import { extractTextFromDocument } from "../utils/extraction";
import { classifyDocument } from "../utils/documentClassification";
import { logDebugMessage } from "../middleware/security";
import { runWithTenant } from "../../src/tenantContext";

const router = express.Router();

// Multer memory storage configuration
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});


// Get documents for a project
router.get("/projects/:projectId/documents", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const docs = await dbStore.getDocuments(req.params.projectId);
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

      // AsyncLocalStorage context set by requireAuth's middleware isn't reliably reaching this
      // handler through multer's upload.single() (confirmed: even capturing it as the very first
      // line here was already undefined) - rebuilt directly from the tenant id requireAuth also
      // stashes on the request headers, which is a plain object property, not dependent on any
      // async-context propagation.
      const tenantId = req.headers["x-tenant-id"] as string;
      const tenantContext = { tenantId };

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
      const platformSettings = await dbStore.getSettings();
      const storageAdapter = createStorageAdapter(platformSettings);
      const storagePath = await storageAdapter.uploadFile(
        projectId,
        file.buffer,
        file.originalname,
        file.mimetype
      );

      // 3. Extract text content through Text Extraction Pipelines
      const extraction = await extractTextFromDocument(file.buffer, file.originalname, file.mimetype);

      // 3b. Real AI classification (Admin > IA, Prompts e Custos > "Document Classification
      // Prompt") - replaces what used to be a hardcoded mimetype guess with a fixed fake
      // confidence.
      const classification = await classifyDocument(file.originalname, extraction.text);

      await runWithTenant(tenantContext, async () => {
        // 4. Save to Database
        const userId = (req.headers["x-user-id"] as string) || "u1";
        const docRecord = await dbStore.addDocument({
          project_id: projectId,
          filename: file.originalname,
          original_filename: file.originalname,
          mime_type: file.mimetype,
          file_size: file.size,
          storage_provider: platformSettings.storage_mode,
          storage_path: storagePath,
          detected_document_type: classification.document_type,
          manual_document_type: undefined,
          ai_classification_confidence: classification.confidence,
          version: 1,
          language: "Portuguese",
          uploaded_by: userId
        });

        // Save extracted text so it is persistent for Gemini analysis
        await dbStore.setDocumentContent(docRecord.id, extraction.text);

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
        await dbStore.addAuditLog({
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
      });
    } catch (err) {
      next(err);
    }
  }
);

// Get extracted document content preview
router.get("/documents/:id/content", requirePermission("document:read"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const docId = req.params.id;
    const doc = await dbStore.getDocument(docId);

    if (!doc) {
      return res.status(404).json({ success: false, message: "Document not found." });
    }

    const content = await dbStore.getDocumentContent(docId);

    res.json({
      success: true,
      document: doc,
      content,
      content_preview: content.slice(0, 12000),
      content_length: content.length,
      truncated: content.length > 12000
    });
  } catch (err) {
    next(err);
  }
});

// Delete document
router.delete("/documents/:id", requirePermission("document:delete"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const docId = req.params.id;
    const doc = await dbStore.getDocument(docId);

    if (!doc) {
      return res.status(404).json({ success: false, message: "Document not found." });
    }

    // Remove from physical storage using the provider recorded on the document
    const settings = await dbStore.getSettings();
    const storageAdapter = createStorageAdapter({
      ...settings,
      storage_mode: doc.storage_provider
    });
    await storageAdapter.deleteFile(doc.storage_path);

    // Remove from DB (document_contents row cascades automatically)
    await dbStore.deleteDocument(docId);

    const userId = (req.headers["x-user-id"] as string) || "u1";
    await dbStore.addAuditLog({
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
router.post("/documents/:id/reclassify", requirePermission("document:upload"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const document_type = req.body.document_type || req.body.manual_document_type;
    const doc = await dbStore.getDocument(req.params.id);

    if (!doc) {
      return res.status(404).json({ success: false, message: "Document not found" });
    }

    if (!document_type || !String(document_type).trim()) {
      return res.status(400).json({ success: false, message: "Document type is required." });
    }

    const updatedDoc = await dbStore.updateDocument(req.params.id, {
      manual_document_type: document_type,
      detected_document_type: document_type, // also update active type
    });

    const userId = (req.headers["x-user-id"] as string) || "u1";
    await dbStore.addAuditLog({
      user_id: userId,
      action: "Reclassify Document",
      entity_type: "Document",
      entity_id: req.params.id,
      project_id: doc.project_id,
      ip_address: req.ip || "127.0.0.1",
      user_agent: req.headers["user-agent"] || "unknown",
      metadata: JSON.stringify({ manual_type: document_type })
    });

    res.json(updatedDoc);
  } catch (err) {
    next(err);
  }
});

// Rename document display name
router.put("/documents/:id/rename", requirePermission("document:upload"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const newName = String(req.body?.original_filename || "").trim();
    const doc = await dbStore.getDocument(req.params.id);

    if (!doc) {
      return res.status(404).json({ success: false, message: "Document not found" });
    }

    if (!newName) {
      return res.status(400).json({ success: false, message: "A non-empty name is required." });
    }

    const updatedDoc = await dbStore.updateDocument(req.params.id, { original_filename: newName });

    const userId = (req.headers["x-user-id"] as string) || "u1";
    await dbStore.addAuditLog({
      user_id: userId,
      action: "Rename Document",
      entity_type: "Document",
      entity_id: req.params.id,
      project_id: doc.project_id,
      ip_address: req.ip || "127.0.0.1",
      user_agent: req.headers["user-agent"] || "unknown",
      metadata: JSON.stringify({ previous_name: doc.original_filename, new_name: newName })
    });

    res.json(updatedDoc);
  } catch (err) {
    next(err);
  }
});

export default router;
