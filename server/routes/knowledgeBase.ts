import express, { Request, Response, NextFunction } from "express";
import multer from "multer";
import { z } from "zod";
import { dbStore } from "../../src/dbStore";
import { requirePermission } from "./auth";
import { createStorageAdapter, validateUploadedFile } from "../utils/storage";
import { generateJsonWithProvider, generateTextWithProvider, ConnectedProvider, ProviderFileInput } from "../utils/aiProviders";
import { resolveProvider } from "../../src/aiOrchestrator";
import { createTask, updateTaskProgress, completeTask, failTask } from "../../src/backgroundTasks";
import { runWithTenant } from "../../src/tenantContext";

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const VISION_MIME_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);

// ─────────────────────────────────────────────────────────────────────────
// Entries: list, edit-before-approving, approve, reject
// ─────────────────────────────────────────────────────────────────────────

router.get("/knowledge-base/entries", requirePermission("knowledge_base:read"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const category = typeof req.query.category === "string" ? req.query.category : undefined;
    const entries = await dbStore.getKnowledgeBaseEntries({ status, category });
    res.json(entries);
  } catch (err) {
    next(err);
  }
});

const UpdateEntrySchema = z.object({
  trigger: z.string().optional(),
  knowledge: z.string().optional(),
  status: z.enum(["pending", "approved", "rejected"]).optional(),
});

router.put("/knowledge-base/entries/:id", requirePermission("knowledge_base:write"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = UpdateEntrySchema.parse(req.body);
    const userId = (req.headers["x-user-id"] as string) || "u1";
    const isReviewDecision = validated.status === "approved" || validated.status === "rejected";

    const entry = await dbStore.updateKnowledgeBaseEntry(req.params.id, {
      ...validated,
      ...(isReviewDecision ? { reviewed_by: userId, reviewed_at: new Date().toISOString() } : {}),
    });

    if (!entry) {
      return res.status(404).json({ success: false, message: "Knowledge base entry not found." });
    }

    await dbStore.addAuditLog({
      user_id: userId,
      action: isReviewDecision ? `Knowledge Base Entry ${validated.status === "approved" ? "Approved" : "Rejected"}` : "Knowledge Base Entry Edited",
      entity_type: "KnowledgeBaseEntry",
      entity_id: entry.id,
      ip_address: req.ip || "127.0.0.1",
      user_agent: req.headers["user-agent"] || "unknown",
      metadata: JSON.stringify(validated),
    });

    res.json(entry);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.issues[0].message });
    }
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Reactive capture: a human correction (BOM field, engineering note, compliance
// status) becomes a pending suggestion. Fired on blur, not on every keystroke -
// see the frontend wiring for where this is called from.
// ─────────────────────────────────────────────────────────────────────────

const SuggestSchema = z.object({
  category: z.enum(["bom_part_number", "engineering_note", "compliance_status"]),
  field_label: z.string(),
  old_value: z.string(),
  new_value: z.string(),
  item_context: z.string(),
  project_id: z.string(),
  project_name: z.string(),
});

router.post("/knowledge-base/suggest", requirePermission("knowledge_base:write"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = SuggestSchema.parse(req.body);
    // A no-op edit (e.g. focused then blurred without changing anything) has nothing worth
    // capturing - never worth an AI call.
    if (validated.old_value.trim() === validated.new_value.trim()) {
      return res.json({ success: true, entry: null });
    }

    const platformSettings = await dbStore.getSettings();
    const providerResolution = resolveProvider("spec_copilot", platformSettings);

    const prompt = `A pre-sales engineer just corrected a value in a tender analysis. Turn this single correction into a
reusable trigger/knowledge pair for a technical knowledge base, so a *future* analysis of a
*different* tender can recognize a similar situation and apply the same correction automatically.

FIELD: ${validated.field_label}
ITEM CONTEXT (the requirement/BOM item this correction was made on): ${validated.item_context}
PREVIOUS VALUE: ${validated.old_value || "(vazio)"}
CORRECTED VALUE: ${validated.new_value}

Write in Portuguese. "trigger" must describe the general technical situation (equipment type and
key specs, not this specific project's item ID) where this knowledge applies - specific enough to
be useful, general enough to match similar future cases. "knowledge" is the correction itself,
stated as a fact/instruction. If this correction is too specific to this one project to ever be
reusable (e.g. a one-off administrative note), respond with reusable: false instead.

Respond with ONLY a JSON object: { "reusable": true, "trigger": "...", "knowledge": "..." }`;

    const { text } = await generateTextWithProvider(providerResolution.provider as ConnectedProvider, providerResolution.model, prompt);
    const jsonMatch = text.match(/```json\s*([\s\S]*?)```/) || [null, text.slice(text.indexOf("{"))];
    const parsed = JSON.parse((jsonMatch[1] || text).trim());

    if (!parsed.reusable) {
      return res.json({ success: true, entry: null });
    }

    const userId = (req.headers["x-user-id"] as string) || "u1";
    const entry = await dbStore.createKnowledgeBaseEntry({
      category: validated.category,
      trigger: parsed.trigger,
      knowledge: parsed.knowledge,
      status: "pending",
      source: "reactive_edit",
      source_project_id: validated.project_id,
      source_project_name: validated.project_name,
      created_by: userId,
    });

    res.json({ success: true, entry });
  } catch (err: any) {
    // A failed suggestion should never surface as an error to the user mid-edit - the edit
    // itself already saved successfully via the normal analysis-result save path; this is a
    // best-effort enrichment on top of it.
    console.error("Knowledge base suggestion generation failed:", err.message);
    res.json({ success: true, entry: null });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Proactive capture: upload reference documents (datasheets/catalogs), then
// explicitly trigger an AI pass that reads them and proposes entries.
// ─────────────────────────────────────────────────────────────────────────

router.get("/knowledge-base/documents", requirePermission("knowledge_base:read"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const docs = await dbStore.getKnowledgeBaseDocuments();
    res.json(docs);
  } catch (err) {
    next(err);
  }
});

router.post(
  "/knowledge-base/documents",
  requirePermission("knowledge_base:write"),
  upload.single("file"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({ success: false, message: "No file was uploaded." });
      }

      const validation = validateUploadedFile(file.originalname, file.mimetype, file.size);
      if (!validation.valid) {
        return res.status(400).json({ success: false, message: validation.error });
      }

      const platformSettings = await dbStore.getSettings();
      const storageAdapter = createStorageAdapter(platformSettings);
      // Reuses the project-scoped storage layout with a fixed pseudo-project id - these
      // documents have no real project of origin.
      const storagePath = await storageAdapter.uploadFile("knowledge-base", file.buffer, file.originalname, file.mimetype);

      const userId = (req.headers["x-user-id"] as string) || "u1";
      const doc = await dbStore.createKnowledgeBaseDocument({
        filename: file.originalname,
        original_filename: file.originalname,
        mime_type: file.mimetype,
        file_size: file.size,
        storage_provider: platformSettings.storage_mode,
        storage_path: storagePath,
        uploaded_by: userId,
      });

      res.status(201).json(doc);
    } catch (err) {
      next(err);
    }
  }
);

router.delete("/knowledge-base/documents/:id", requirePermission("knowledge_base:write"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const deleted = await dbStore.deleteKnowledgeBaseDocument(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: "Document not found." });
    }
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// Reads every not-yet-analyzed uploaded document (vision for PDF/image, same reasoning as the
// main analysis route - some real datasheets have no extractable text layer) and asks the AI to
// propose multiple knowledge base entries per document. Runs as a background task since a batch
// of real datasheets can take a while, same pattern as document_analysis.
router.post("/knowledge-base/documents/analyze", requirePermission("knowledge_base:write"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.headers["x-tenant-id"] as string;
    const tenantContext = { tenantId };
    const userId = (req.headers["x-user-id"] as string) || "u1";

    const allDocs = await dbStore.getKnowledgeBaseDocuments();
    const pendingDocs = allDocs.filter((d) => !d.analyzed_at);
    if (pendingDocs.length === 0) {
      return res.status(400).json({ success: false, message: "Nenhum documento novo para analisar." });
    }

    const task = await createTask({ userId, type: "knowledge_base_analysis", currentStep: "Iniciando análise da Base de Conhecimento..." });
    res.status(202).json({ success: true, task_id: task.id });

    void runWithTenant(tenantContext, async () => {
      try {
        const platformSettings = await dbStore.getSettings();
        const providerResolution = resolveProvider("document_analysis", platformSettings);
        const storageAdapter = createStorageAdapter(platformSettings);
        let createdCount = 0;

        for (let i = 0; i < pendingDocs.length; i++) {
          const doc = pendingDocs[i];
          await updateTaskProgress(task.id, {
            status: "running",
            currentStep: `Analisando ${doc.original_filename} (${i + 1}/${pendingDocs.length})`,
            progressPct: Math.round(((i + 0.5) / pendingDocs.length) * 90),
          });

          const files: ProviderFileInput[] = [];
          let combinedText = "";
          if (VISION_MIME_TYPES.has(doc.mime_type)) {
            const buffer = await storageAdapter.readFile(doc.storage_path);
            files.push({ mimeType: doc.mime_type, base64Data: buffer.toString("base64") });
          } else {
            const buffer = await storageAdapter.readFile(doc.storage_path);
            combinedText = buffer.toString("utf-8").slice(0, 40000);
          }

          const prompt = `You are extracting reusable technical knowledge from a reference document (manufacturer
datasheet, technical catalog, compliance standard, price list, etc.) to seed a knowledge base
that future tender analyses can draw on.

${combinedText ? `DOCUMENT TEXT:\n${combinedText}` : "The document is attached below - read it directly."}

Extract every genuinely distinct, reusable piece of knowledge (e.g. one entry per equipment
model/spec combination in a catalog). Never invent specs the document doesn't state. Write in
Portuguese. "trigger" describes the general technical situation where this knowledge applies
(equipment type + key specs - general enough to match future similar cases, specific enough to be
useful). "knowledge" is the fact/recommendation itself.

Respond with ONLY a JSON array (no markdown, no extra text):
[{ "category": "bom_part_number" | "engineering_note", "trigger": "...", "knowledge": "..." }]`;

          try {
            const { text } = await generateJsonWithProvider(providerResolution.provider as ConnectedProvider, providerResolution.model, prompt, files);
            const fenceMatch = text.match(/```json\s*([\s\S]*?)```/);
            const rawJson = fenceMatch ? fenceMatch[1] : text.slice(text.indexOf("["));
            const proposals: Array<{ category: string; trigger: string; knowledge: string }> = JSON.parse(rawJson.trim());

            for (const p of proposals) {
              await dbStore.createKnowledgeBaseEntry({
                category: (p.category === "bom_part_number" ? "bom_part_number" : "datasheet") as any,
                trigger: p.trigger,
                knowledge: p.knowledge,
                status: "pending",
                source: "uploaded_document",
                source_document_id: doc.id,
                source_document_name: doc.original_filename,
                created_by: userId,
              });
              createdCount++;
            }
          } catch (docErr: any) {
            // One unreadable/unparsable document shouldn't abort the whole batch.
            console.error(`Knowledge base analysis failed for document ${doc.id}:`, docErr.message);
          }

          await dbStore.markKnowledgeBaseDocumentAnalyzed(doc.id);
        }

        await completeTask(task.id, { resultType: "knowledge_base", resultId: `created_${createdCount}` });
      } catch (err: any) {
        console.error("Knowledge base document analysis failed:", err);
        await failTask(task.id, err.message || "Erro desconhecido ao analisar documentos.");
      }
    });
  } catch (err) {
    next(err);
  }
});

export default router;
