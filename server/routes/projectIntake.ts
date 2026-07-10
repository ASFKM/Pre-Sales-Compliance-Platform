import express, { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { dbStore } from "../../src/dbStore";
import { requireAuth, requirePermission } from "./auth";
import { extractTextFromDocument } from "../utils/extraction";
import { validateUploadedFile, createStorageAdapter } from "../utils/storage";
import { createTask, updateTaskProgress, completeTask, failTask } from "../../src/backgroundTasks";
import * as staging from "../../src/projectIntakeStaging";
import { ProjectSchema } from "./projects";
import { resolveProvider, checkCostCap, recordProviderFallback, recordAiUsage } from "../../src/aiOrchestrator";
import { generateJsonWithProvider, ConnectedProvider } from "../utils/aiProviders";
import { estimateCostUsd } from "../utils/aiPricing";
import { classifyDocument } from "../utils/documentClassification";
import { runWithTenant } from "../../src/tenantContext";
import multer from "multer";

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const SuggestedFieldsSchema = z.object({
  name: z.string(),
  customer_name: z.string(),
  opportunity_name: z.string(),
  vertical: z.string(),
  description: z.string(),
  deadline: z.string(),
  proposal_validity_date: z.string(),
  ai_orientation_mode: z.enum(["Vendor-neutral", "Preferred manufacturer", "Mandatory manufacturer", "Existing customer standard", "Free AI recommendation"]),
  ai_orientation_text: z.string(),
  procurement_modality: z.string(),
  procurement_subtype: z.string(),
});

function sanitizeSession(session: staging.StagingSession) {
  return {
    id: session.id,
    files: session.files.map((f) => ({ id: f.id, filename: f.filename, mime_type: f.mimeType, size: f.size })),
    suggested_fields: session.suggestedFields,
  };
}

// A staging session id isn't secret-strength, and staging is otherwise unscoped by tenant (it
// intentionally has no Project/tenant FK yet) - this is the one place enforcing that a session
// started in one tenant can't be read or written from another.
async function getOwnedSession(sessionId: string, tenantId: string): Promise<staging.StagingSession | undefined> {
  const session = await staging.getSession(sessionId);
  if (!session || session.tenantId !== tenantId) {
    return undefined;
  }
  return session;
}

// 1. Start a staging session - no Project exists yet.
router.post("/project-intake", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.headers["x-tenant-id"] as string;
    const userId = req.headers["x-user-id"] as string;
    const session = await staging.createSession(tenantId, userId);
    res.json({ success: true, session: sanitizeSession(session) });
  } catch (err) {
    next(err);
  }
});

// 2. Upload a document into staging (same validation/extraction as the real document upload
// route - just no project_id to attach to yet).
router.post("/project-intake/:sessionId/documents", requireAuth, upload.single("file"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ success: false, message: "No file was uploaded." });
    }

    const validation = validateUploadedFile(file.originalname, file.mimetype, file.size);
    if (!validation.valid) {
      return res.status(400).json({ success: false, message: validation.error });
    }

    const owned = await getOwnedSession(req.params.sessionId, req.headers["x-tenant-id"] as string);
    if (!owned) {
      return res.status(404).json({ success: false, message: "Upload session not found or expired. Please start again." });
    }

    const extraction = await extractTextFromDocument(file.buffer, file.originalname, file.mimetype);

    const session = await staging.addFile(req.params.sessionId, {
      filename: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      buffer: file.buffer,
      extractedText: extraction.text,
    });

    res.json({ success: true, session: sanitizeSession(session) });
  } catch (err: any) {
    if (err.message?.includes("not found or expired")) {
      return res.status(404).json({ success: false, message: "Upload session not found or expired. Please start again." });
    }
    next(err);
  }
});

router.delete("/project-intake/:sessionId/documents/:fileId", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const owned = await getOwnedSession(req.params.sessionId, req.headers["x-tenant-id"] as string);
    if (!owned) {
      return res.status(404).json({ success: false, message: "Upload session not found or expired." });
    }

    const session = await staging.removeFile(req.params.sessionId, req.params.fileId);
    res.json({ success: true, session: sanitizeSession(session!) });
  } catch (err) {
    next(err);
  }
});

router.get("/project-intake/:sessionId", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = await getOwnedSession(req.params.sessionId, req.headers["x-tenant-id"] as string);
    if (!session) {
      return res.status(404).json({ success: false, message: "Upload session not found or expired." });
    }
    res.json({ success: true, session: sanitizeSession(session) });
  } catch (err) {
    next(err);
  }
});

// 3. Analyze the staged documents and suggest project fields - runs as a Phase 1 background
// task, same async-response pattern as document analysis and proposal generation.
router.post("/project-intake/:sessionId/analyze", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = await getOwnedSession(req.params.sessionId, req.headers["x-tenant-id"] as string);
    if (!session) {
      return res.status(404).json({ success: false, message: "Upload session not found or expired." });
    }
    if (!session.files.length) {
      return res.status(400).json({ success: false, message: "Upload at least one document before analyzing." });
    }

    const platformSettings = await dbStore.getSettings();
    const tenantId = req.headers["x-tenant-id"] as string;
    const costCap = await checkCostCap(tenantId, platformSettings.monthly_cost_cap_usd ?? null);
    if (costCap.blocked) {
      return res.status(402).json({
        success: false,
        message: `Monthly AI cost cap reached ($${costCap.currentSpendUsd.toFixed(2)} of $${costCap.capUsd?.toFixed(2)}). Try again next month or raise the cap in Admin > AI, Prompts e Custos.`
      });
    }

    const userId = req.headers["x-user-id"] as string;
    const task = await createTask({ userId, type: "project_intake_analysis", currentStep: "Iniciando análise..." });
    res.status(202).json({ success: true, task_id: task.id });

    // Wrapped in runWithTenant like every other detached background block in this codebase -
    // BackgroundTask became tenant-scoped in the tenant-isolation fix, so updateTaskProgress/
    // completeTask/failTask below need real context, not just an implicit pass-through.
    void runWithTenant({ tenantId }, async () => {
      try {
        await updateTaskProgress(task.id, { status: "running", currentStep: "Lendo documentos", progressPct: 20 });

        // Project-intake extraction reuses the document_analysis task-type mapping - it's the
        // same kind of "read documents, extract structured data" work, just lighter-weight, and
        // doesn't have its own slot in the 4-task roadmap framework.
        const providerResolution = await resolveProvider("document_analysis", platformSettings);
        if (providerResolution.isFallback) {
          await recordProviderFallback({
            tenantId,
            taskType: "document_analysis",
            intendedProvider: providerResolution.intendedProvider,
            userId,
          });
        }

        let combinedText = "";
        for (let idx = 0; idx < session.files.length; idx++) {
          const f = session.files[idx];
          combinedText += `\n--- START DOCUMENT ${idx + 1}: ${f.filename} ---\n`;
          combinedText += f.extractedText.substring(0, 10000);
          combinedText += `\n--- END DOCUMENT ${idx + 1} ---\n`;
        }

        await updateTaskProgress(task.id, { currentStep: "Extraindo dados do projeto com IA", progressPct: 50 });

        const today = new Date().toISOString().slice(0, 10);
        const prompt = `You are a pre-sales assistant that reads bid/RFP documents and extracts basic project metadata to pre-fill a new project intake form. Today's date is ${today}.

DOCUMENT TEXTS:
${combinedText}

Extract the following fields. If a field can't be confidently determined from the documents, make a reasonable placeholder guess (e.g. a deadline 30 days from today, a proposal validity 90 days from today) rather than leaving it empty - the user will review and correct everything before it's saved.
CRITICAL: every free-text field below MUST be written in Brazilian Portuguese. The two fields
marked "fixed English value" are internal enum codes, not prose - return them exactly as one of
the listed English options, never translated.
Respond with ONLY a strictly parsable JSON object, no markdown, matching this shape:
{
  "name": "Short project/bid title, in Portuguese",
  "customer_name": "Customer or client name",
  "opportunity_name": "Opportunity code or reference",
  "vertical": "Short industry vertical name, in Portuguese (e.g. Infraestrutura, Cidades Inteligentes, Varejo, Financeiro) - free text, not a fixed list",
  "description": "One paragraph describing the tender scope, in Portuguese",
  "deadline": "YYYY-MM-DD tender submission deadline",
  "proposal_validity_date": "YYYY-MM-DD proposal validity date",
  "ai_orientation_mode": "fixed English value - one of: Vendor-neutral, Preferred manufacturer, Mandatory manufacturer, Existing customer standard, Free AI recommendation",
  "ai_orientation_text": "One sentence of brand/technical orientation guidance, in Portuguese",
  "procurement_modality": "fixed English value - one of: Licitação, Leilão, Outra modalidade",
  "procurement_subtype": "A subtype consistent with the chosen modality, in Portuguese"
}`;

        const { text: rawText, inputTokens, outputTokens } = await generateJsonWithProvider(providerResolution.provider as ConnectedProvider, providerResolution.model, prompt);
        const realEstimatedCostUsd = estimateCostUsd(providerResolution.model, inputTokens, outputTokens);

        const parsed = JSON.parse(rawText.trim());
        const validated = SuggestedFieldsSchema.parse(parsed);

        await updateTaskProgress(task.id, { currentStep: "Salvando sugestões", progressPct: 90 });
        await staging.setSuggestedFields(req.params.sessionId, validated);

        await completeTask(task.id, {
          resultType: "project_intake_session",
          resultId: req.params.sessionId,
          estimatedCostUsd: realEstimatedCostUsd,
          aiProvider: providerResolution.provider,
          intendedProvider: providerResolution.intendedProvider,
          isProviderFallback: providerResolution.isFallback,
        });
        await recordAiUsage({
          tenantId,
          taskType: "project_intake_analysis",
          provider: providerResolution.provider,
          model: providerResolution.model,
          estimatedCostUsd: realEstimatedCostUsd,
          backgroundTaskId: task.id,
        });
      } catch (err: any) {
        console.error("Project intake analysis failed:", err);
        await failTask(task.id, err.message || "Unknown error during project intake analysis");
      }
    });
  } catch (err) {
    next(err);
  }
});

// 4. Confirm - this is the real trigger: creates the Project and its Documents for good,
// migrating each staged file from Redis to permanent storage. Whatever the user edited in the
// validation step (even AI-filled fields) wins - the request body, not session.suggestedFields.
router.post("/project-intake/:sessionId/confirm", requirePermission("project:create"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    // AsyncLocalStorage context set by requireAuth's middleware isn't reliably reaching route
    // handlers on this server (confirmed on the sibling document upload route) - rebuilt directly
    // from the tenant id requireAuth also stashes on the request headers, a plain object property
    // not dependent on any async-context propagation.
    const tenantId = req.headers["x-tenant-id"] as string;
    const tenantContext = { tenantId };

    const session = await getOwnedSession(req.params.sessionId, tenantId);
    if (!session) {
      return res.status(404).json({ success: false, message: "Upload session not found or expired. Please start again." });
    }

    const validated = ProjectSchema.parse(req.body);
    const userId = req.headers["x-user-id"] as string;

    const project = await dbStore.createProject({ ...validated, owner_user_id: userId });

    await dbStore.addAuditLog({
      user_id: userId,
      action: "Create Project (upload-first intake)",
      entity_type: "Project",
      entity_id: project.id,
      ip_address: req.ip || "127.0.0.1",
      user_agent: req.headers["user-agent"] || "unknown",
      metadata: JSON.stringify({ ...validated, staged_files: session.files.length }),
    });

    const platformSettings = await dbStore.getSettings();
    const storageAdapter = createStorageAdapter(platformSettings);

    for (const f of session.files) {
      const buffer = await staging.getFileBuffer(req.params.sessionId, f.id);
      if (!buffer) continue;

      const storagePath = await storageAdapter.uploadFile(project.id, buffer, f.filename, f.mimeType);
      const classification = await classifyDocument(f.filename, f.extractedText, tenantId);

      await runWithTenant(tenantContext, async () => {
        const docRecord = await dbStore.addDocument({
          project_id: project.id,
          filename: f.filename,
          original_filename: f.filename,
          mime_type: f.mimeType,
          file_size: f.size,
          storage_provider: platformSettings.storage_mode,
          storage_path: storagePath,
          detected_document_type: classification.document_type,
          manual_document_type: undefined,
          ai_classification_confidence: classification.confidence,
          version: 1,
          language: "Portuguese",
          uploaded_by: userId,
        });
        await dbStore.setDocumentContent(docRecord.id, f.extractedText);

        await dbStore.addAuditLog({
          user_id: userId,
          action: "Upload Document",
          entity_type: "Document",
          entity_id: docRecord.id,
          project_id: project.id,
          ip_address: req.ip || "127.0.0.1",
          user_agent: req.headers["user-agent"] || "unknown",
          metadata: JSON.stringify({ filename: f.filename, path: storagePath, source: "upload-first intake" }),
        });
      });
    }

    await staging.deleteSession(req.params.sessionId);

    res.status(201).json(project);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.issues[0].message });
    }
    next(err);
  }
});

// Explicit cleanup when the user cancels the wizard mid-flow - staging.deleteSession was already
// used on the success path (after confirm migrates files to permanent storage) but nothing called
// it on cancel. Redis TTL already expires an abandoned session within 2h regardless, so this isn't
// a real leak, just makes cleanup immediate instead of waiting out the TTL.
router.delete("/project-intake/:sessionId", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.headers["x-tenant-id"] as string;
    const session = await getOwnedSession(req.params.sessionId, tenantId);
    if (!session) {
      return res.status(404).json({ success: false, message: "Upload session not found or expired." });
    }
    await staging.deleteSession(req.params.sessionId);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
