// Fase 6 (add-on): Gestão de POC. Every route below runs behind requirePermission("poc:read" |
// "poc:manage") AND requireModule("poc") - the module only exists for tenants whose Fleet
// Manager ModuleEntitlement includes "poc" (see server/utils/fleetLicense.ts /
// getFleetLicenseStatus), independent of RBAC permissions.
import express, { Response, NextFunction } from "express";
import type { Request } from "../types/express";
import { z } from "zod";
import multer from "multer";
import { dbStore } from "../../src/dbStore";
import { requirePermission, requireModule } from "./auth";
import { requireUserId } from "../middleware/security";
import { createStorageAdapter, validateUploadedFile } from "../utils/storage";
import { runWithTenant } from "../../src/tenantContext";
import { resolveProvider, checkCostCap, recordProviderFallback, recordAiUsage } from "../../src/aiOrchestrator";
import { generateJsonWithProvider } from "../utils/aiProviders";
import { estimateCostUsd } from "../utils/aiPricing";
import { prisma } from "../../src/prisma";
import { FACTORY_DEFAULT_POC_TEST_GENERATION_PROMPT } from "../utils/promptDefaults";
import { extractKnowledgeBaseKeywords } from "./analysis";
import { triggerKnowledgeBaseAnalysis } from "./knowledgeBase";

const router = express.Router();

// Same memory-storage config as documents.ts - a 10MB limit comfortably covers a scanned NF PDF.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// Fase G: same keyword-extraction + IDF-weighted search already proven for BOM enrichment
// (server/routes/analysis.ts) - minLength 3 on purpose, equipment specs in this domain are full
// of short, highly-distinguishing acronyms (PTZ, DAI, DVR) a longer floor would drop. Only
// counts approved entries (dbStore.searchApprovedKnowledgeBase's own WHERE clause) - a pending,
// not-yet-reviewed datasheet extraction doesn't count as "we have knowledge" yet.
async function countKnowledgeBaseMatches(name: string, manufacturer?: string): Promise<number> {
  const keywords = extractKnowledgeBaseKeywords([name, manufacturer].filter(Boolean).join(" "), 25, 3);
  if (keywords.length === 0) return 0;
  const matches = await dbStore.searchApprovedKnowledgeBase(keywords, 10);
  return matches.length;
}

const PocStatusEnum = z.enum(["planned", "in_progress", "blocked", "completed_won", "completed_lost"]);

// Kept as a plain ZodObject (no .refine() here) specifically so .partial() stays available for
// the PUT handler below - Zod can't call .partial() on a schema once .refine() wraps it in a
// ZodEffects. The cross-field "must have project_id or standalone_customer_name" rule only makes
// sense at creation time anyway, so it's applied separately via PocCreateSchema.
const PocBaseSchema = z.object({
  project_id: z.string().optional(),
  standalone_customer_name: z.string().optional(),
  standalone_contact_name: z.string().optional(),
  standalone_contact_email: z.string().email().optional().or(z.literal("")),
  standalone_contact_phone: z.string().optional(),
  name: z.string().min(2, "Name must be at least 2 characters"),
  objective: z.string().min(5, "Objective is required"),
  // Deliberately no .default() here: Zod applies .default() whenever a field is undefined,
  // .partial() or not - so on PUT (partial update), an unrelated field-only patch (e.g. just
  // customer_contact_name) would silently reset status back to "planned" every time. The
  // "planned" default for creation is applied explicitly in the POST handler below instead.
  status: PocStatusEnum.optional(),
  start_date: z.string().min(5, "Start date is required"),
  end_date: z.string().min(5, "End date is required"),
  customer_contact_name: z.string().min(2, "Customer contact name is required"),
  customer_contact_role: z.string().min(2, "Customer contact role is required"),
});

// A POC either hangs off an existing Project (inheriting its customer/vertical) or stands alone
// with its own minimal customer record - at least one of the two must be present.
export const PocCreateSchema = PocBaseSchema.refine(
  (data) => Boolean(data.project_id) || Boolean(data.standalone_customer_name),
  {
    message: "A POC must be linked to a project or have a standalone customer name.",
    path: ["project_id"],
  }
);

router.get("/", requirePermission("poc:read"), requireModule("poc"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const pocs = await dbStore.getPocs();
    res.json(pocs);
  } catch (err) {
    next(err);
  }
});

router.get("/:id", requirePermission("poc:read"), requireModule("poc"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const poc = await dbStore.getPoc(req.params.id);
    if (!poc) {
      return res.status(404).json({ success: false, message: "POC not found" });
    }
    res.json(poc);
  } catch (err) {
    next(err);
  }
});

router.post("/", requirePermission("poc:manage"), requireModule("poc"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = PocCreateSchema.parse(req.body);
    const userId = requireUserId(req);

    if (validated.project_id) {
      const project = await dbStore.getProject(validated.project_id);
      if (!project) {
        return res.status(400).json({ success: false, message: "Linked project not found." });
      }
    }

    const poc = await dbStore.createPoc({
      ...validated,
      status: validated.status || "planned",
      standalone_contact_email: validated.standalone_contact_email || undefined,
      owner_user_id: userId,
    });

    await dbStore.addAuditLog({
      user_id: userId,
      action: "Create Poc",
      entity_type: "Poc",
      entity_id: poc.id,
      ip_address: req.ip || "127.0.0.1",
      user_agent: req.headers["user-agent"] || "unknown",
      metadata: JSON.stringify(validated)
    });

    res.status(201).json(poc);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.issues[0].message });
    }
    next(err);
  }
});

router.put("/:id", requirePermission("poc:manage"), requireModule("poc"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = PocBaseSchema.partial().parse(req.body);
    const poc = await dbStore.updatePoc(req.params.id, validated);
    if (!poc) {
      return res.status(404).json({ success: false, message: "POC not found" });
    }

    const userId = requireUserId(req);
    await dbStore.addAuditLog({
      user_id: userId,
      action: "Update Poc",
      entity_type: "Poc",
      entity_id: req.params.id,
      ip_address: req.ip || "127.0.0.1",
      user_agent: req.headers["user-agent"] || "unknown",
      metadata: JSON.stringify(validated)
    });

    res.json(poc);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.issues[0].message });
    }
    next(err);
  }
});

router.delete("/:id", requirePermission("poc:manage"), requireModule("poc"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const deleted = await dbStore.deletePoc(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: "POC not found" });
    }

    const userId = requireUserId(req);
    await dbStore.addAuditLog({
      user_id: userId,
      action: "Delete Poc",
      entity_type: "Poc",
      entity_id: req.params.id,
      ip_address: req.ip || "127.0.0.1",
      user_agent: req.headers["user-agent"] || "unknown",
      metadata: JSON.stringify({ deleted_poc_id: req.params.id })
    });

    res.json({ success: true, message: "POC deleted successfully" });
  } catch (err) {
    next(err);
  }
});

// Success criteria (Fase B) - a short checklist agreed upfront with the customer.
router.get("/:id/success-criteria", requirePermission("poc:read"), requireModule("poc"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const poc = await dbStore.getPoc(req.params.id);
    if (!poc) {
      return res.status(404).json({ success: false, message: "POC not found" });
    }
    const criteria = await dbStore.getPocSuccessCriteria(req.params.id);
    res.json(criteria);
  } catch (err) {
    next(err);
  }
});

router.post("/:id/success-criteria", requirePermission("poc:manage"), requireModule("poc"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { description } = z.object({ description: z.string().min(2, "Description is required") }).parse(req.body);

    const poc = await dbStore.getPoc(req.params.id);
    if (!poc) {
      return res.status(404).json({ success: false, message: "POC not found" });
    }

    const criterion = await dbStore.createPocSuccessCriterion(req.params.id, description);
    res.status(201).json(criterion);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.issues[0].message });
    }
    next(err);
  }
});

router.put("/:id/success-criteria/:criterionId", requirePermission("poc:manage"), requireModule("poc"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = z.object({ description: z.string().min(2).optional(), done: z.boolean().optional() }).parse(req.body);

    const criteria = await dbStore.getPocSuccessCriteria(req.params.id);
    const target = criteria.find((c) => c.id === req.params.criterionId);
    if (!target) {
      return res.status(404).json({ success: false, message: "Success criterion not found for this POC." });
    }

    const updated = await dbStore.updatePocSuccessCriterion(req.params.criterionId, validated);
    res.json(updated);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.issues[0].message });
    }
    next(err);
  }
});

router.delete("/:id/success-criteria/:criterionId", requirePermission("poc:manage"), requireModule("poc"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const criteria = await dbStore.getPocSuccessCriteria(req.params.id);
    const target = criteria.find((c) => c.id === req.params.criterionId);
    if (!target) {
      return res.status(404).json({ success: false, message: "Success criterion not found for this POC." });
    }

    await dbStore.deletePocSuccessCriterion(req.params.criterionId);
    res.json({ success: true, message: "Success criterion deleted successfully" });
  } catch (err) {
    next(err);
  }
});

// Equipment (Fase C) - physical hardware loaned to the customer for the POC.
router.get("/:id/equipment", requirePermission("poc:read"), requireModule("poc"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const poc = await dbStore.getPoc(req.params.id);
    if (!poc) {
      return res.status(404).json({ success: false, message: "POC not found" });
    }
    const items = await dbStore.getPocEquipmentItems(req.params.id);
    res.json(items);
  } catch (err) {
    next(err);
  }
});

router.post("/:id/equipment", requirePermission("poc:manage"), requireModule("poc"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = z
      .object({
        name: z.string().min(2, "Name is required"),
        serial_number: z.string().optional(),
        manufacturer: z.string().optional(),
        part_number: z.string().optional(),
      })
      .parse(req.body);

    const poc = await dbStore.getPoc(req.params.id);
    if (!poc) {
      return res.status(404).json({ success: false, message: "POC not found" });
    }

    const kbMatchCount = await countKnowledgeBaseMatches(validated.name, validated.manufacturer);
    const item = await dbStore.createPocEquipmentItem(req.params.id, { ...validated, kb_match_count: kbMatchCount });
    res.status(201).json(item);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.issues[0].message });
    }
    next(err);
  }
});

// Fase G: BOM items from the linked Project not yet imported as equipment for this POC.
router.get("/:id/equipment/bom-candidates", requirePermission("poc:read"), requireModule("poc"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const poc = await dbStore.getPoc(req.params.id);
    if (!poc) {
      return res.status(404).json({ success: false, message: "POC not found" });
    }
    const candidates = await dbStore.getPocBomCandidates(req.params.id);
    res.json(candidates);
  } catch (err) {
    next(err);
  }
});

router.post("/:id/equipment/from-bom", requirePermission("poc:manage"), requireModule("poc"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { bom_item_id } = z.object({ bom_item_id: z.string().min(1) }).parse(req.body);

    const poc = await dbStore.getPoc(req.params.id);
    if (!poc) {
      return res.status(404).json({ success: false, message: "POC not found" });
    }

    const candidates = await dbStore.getPocBomCandidates(req.params.id);
    const candidate = candidates.find((c) => c.bom_item_id === bom_item_id);
    if (!candidate) {
      return res.status(400).json({ success: false, message: "This BOM item was not found or has already been imported." });
    }

    const kbMatchCount = await countKnowledgeBaseMatches(candidate.equipment_name, candidate.manufacturer);
    const item = await dbStore.createPocEquipmentItem(req.params.id, {
      name: candidate.equipment_name,
      manufacturer: candidate.manufacturer || undefined,
      part_number: candidate.part_number || undefined,
      source_bom_item_id: candidate.bom_item_id,
      kb_match_count: kbMatchCount,
    });
    res.status(201).json(item);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.issues[0].message });
    }
    next(err);
  }
});

router.put("/:id/equipment/:itemId", requirePermission("poc:manage"), requireModule("poc"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = z
      .object({
        name: z.string().min(2).optional(),
        serial_number: z.string().optional(),
        status: z.enum(["shipped", "at_customer", "returned"]).optional(),
      })
      .parse(req.body);

    const items = await dbStore.getPocEquipmentItems(req.params.id);
    if (!items.some((i) => i.id === req.params.itemId)) {
      return res.status(404).json({ success: false, message: "Equipment item not found for this POC." });
    }

    const updated = await dbStore.updatePocEquipmentItem(req.params.itemId, validated);
    res.json(updated);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.issues[0].message });
    }
    next(err);
  }
});

router.delete("/:id/equipment/:itemId", requirePermission("poc:manage"), requireModule("poc"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const items = await dbStore.getPocEquipmentItems(req.params.id);
    if (!items.some((i) => i.id === req.params.itemId)) {
      return res.status(404).json({ success: false, message: "Equipment item not found for this POC." });
    }

    // Remove any attached invoice files from physical storage first (same order as
    // documents.ts's delete route) so deleting the record never orphans a file behind.
    const settings = await dbStore.getSettings();
    for (const which of ["shipping", "return"] as const) {
      const file = await dbStore.getPocEquipmentInvoiceFile(req.params.itemId, which);
      if (file) {
        const storageAdapter = createStorageAdapter({ ...settings, storage_mode: file.storage_provider });
        await storageAdapter.deleteFile(file.storage_path);
      }
    }

    await dbStore.deletePocEquipmentItem(req.params.itemId);
    res.json({ success: true, message: "Equipment item deleted successfully" });
  } catch (err) {
    next(err);
  }
});

// Invoice upload (NF de envio/devolução) - multer's memory storage means the AsyncLocalStorage
// tenant context set by requireAuth doesn't reliably reach this handler (same footgun documented
// in documents.ts), so it's rebuilt from the x-tenant-id header requireAuth already stashed.
function uploadInvoiceHandler(which: "shipping" | "return") {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({ success: false, message: "No file was uploaded." });
      }

      const validation = validateUploadedFile(file.originalname, file.mimetype, file.size);
      if (!validation.valid) {
        return res.status(400).json({ success: false, message: validation.error });
      }

      const tenantId = req.headers["x-tenant-id"] as string;

      const result = await runWithTenant({ tenantId }, async () => {
        const items = await dbStore.getPocEquipmentItems(req.params.id);
        if (!items.some((i) => i.id === req.params.itemId)) {
          return null;
        }

        const settings = await dbStore.getSettings();
        const storageAdapter = createStorageAdapter(settings);

        // Re-attaching (replacing an already-uploaded invoice) must not orphan the previous
        // file on disk/S3/GCS - delete it first, same cleanup discipline as the item-delete route.
        const previous = await dbStore.getPocEquipmentInvoiceFile(req.params.itemId, which);
        if (previous) {
          const previousAdapter = createStorageAdapter({ ...settings, storage_mode: previous.storage_provider });
          await previousAdapter.deleteFile(previous.storage_path);
        }

        const storagePath = await storageAdapter.uploadFile(req.params.id, file.buffer, file.originalname, file.mimetype);

        return dbStore.attachPocEquipmentInvoice(req.params.itemId, which, {
          storage_provider: settings.storage_mode,
          storage_path: storagePath,
          original_filename: file.originalname,
        });
      });

      if (!result) {
        return res.status(404).json({ success: false, message: "Equipment item not found for this POC." });
      }

      res.json(result);
    } catch (err) {
      next(err);
    }
  };
}

router.post(
  "/:id/equipment/:itemId/shipping-invoice",
  requirePermission("poc:manage"),
  requireModule("poc"),
  upload.single("file"),
  uploadInvoiceHandler("shipping")
);

router.post(
  "/:id/equipment/:itemId/return-invoice",
  requirePermission("poc:manage"),
  requireModule("poc"),
  upload.single("file"),
  uploadInvoiceHandler("return")
);

function downloadInvoiceHandler(which: "shipping" | "return") {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const file = await dbStore.getPocEquipmentInvoiceFile(req.params.itemId, which);
      if (!file) {
        return res.status(404).json({ success: false, message: "No invoice attached yet." });
      }

      const settings = await dbStore.getSettings();
      const adapter = createStorageAdapter({ ...settings, storage_mode: file.storage_provider });

      let buffer: Buffer;
      try {
        buffer = await adapter.readFile(file.storage_path);
      } catch {
        return res.status(404).json({ success: false, message: "Physical invoice file not found." });
      }

      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="${file.original_filename}"`);
      res.send(buffer);
    } catch (err) {
      next(err);
    }
  };
}

router.get("/:id/equipment/:itemId/shipping-invoice", requirePermission("poc:read"), requireModule("poc"), downloadInvoiceHandler("shipping"));
router.get("/:id/equipment/:itemId/return-invoice", requirePermission("poc:read"), requireModule("poc"), downloadInvoiceHandler("return"));

// Fase G: datasheet upload. Unlike the NF (a private per-item fiscal document), a datasheet is
// reusable knowledge - it's stored via the exact same pipeline as a normal Knowledge Base upload
// (createStorageAdapter + dbStore.createKnowledgeBaseDocument), only additionally linked back onto
// the equipment item so the UI can show "datasheet enviado", and immediately queued into the same
// AI analysis background task the Base de Conhecimento screen uses - the extracted entries land as
// "pending" like any other upload, subject to the same admin approval gate, not auto-approved just
// because they came in through the POC screen.
router.post(
  "/:id/equipment/:itemId/datasheet",
  requirePermission("poc:manage"),
  requireModule("poc"),
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

      const tenantId = req.headers["x-tenant-id"] as string;
      const userId = requireUserId(req);

      const updated = await runWithTenant({ tenantId }, async () => {
        const items = await dbStore.getPocEquipmentItems(req.params.id);
        if (!items.some((i) => i.id === req.params.itemId)) {
          return null;
        }

        const settings = await dbStore.getSettings();
        const storageAdapter = createStorageAdapter(settings);
        const storagePath = await storageAdapter.uploadFile("knowledge-base", file.buffer, file.originalname, file.mimetype);

        const doc = await dbStore.createKnowledgeBaseDocument({
          filename: file.originalname,
          original_filename: file.originalname,
          mime_type: file.mimetype,
          file_size: file.size,
          storage_provider: settings.storage_mode,
          storage_path: storagePath,
          uploaded_by: userId,
        });

        return dbStore.updatePocEquipmentItem(req.params.itemId, { datasheet_knowledge_base_document_id: doc.id });
      });

      if (!updated) {
        return res.status(404).json({ success: false, message: "Equipment item not found for this POC." });
      }

      // Best-effort: a datasheet that fails to queue for analysis (e.g. cost cap reached) still
      // got uploaded and linked above - the admin can always retry from the Base de Conhecimento
      // screen's own "Analisar documentos" action, so this isn't surfaced as a failure of the
      // upload itself.
      try {
        await triggerKnowledgeBaseAnalysis(tenantId, userId, req.log);
      } catch (analysisErr) {
        req.log?.warn({ err: analysisErr }, "Failed to auto-queue datasheet for Knowledge Base analysis");
      }

      res.json(updated);
    } catch (err) {
      next(err);
    }
  }
);

// Cronograma (Fase D) - tasks with a single-predecessor finish-to-start dependency chain. Dates
// stay simple ISO day strings (like everywhere else in this file); the Gantt itself does all the
// day-grid/critical-path math on the frontend.
const PocTaskSchema = z.object({
  name: z.string().min(2, "Name is required"),
  start_date: z.string().min(5, "Start date is required"),
  duration_days: z.number().int().min(1, "Duration must be at least 1 day"),
  depends_on_task_id: z.string().optional(),
});

router.get("/:id/tasks", requirePermission("poc:read"), requireModule("poc"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const poc = await dbStore.getPoc(req.params.id);
    if (!poc) {
      return res.status(404).json({ success: false, message: "POC not found" });
    }
    const tasks = await dbStore.getPocTasks(req.params.id);
    res.json(tasks);
  } catch (err) {
    next(err);
  }
});

router.post("/:id/tasks", requirePermission("poc:manage"), requireModule("poc"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = PocTaskSchema.parse(req.body);

    const poc = await dbStore.getPoc(req.params.id);
    if (!poc) {
      return res.status(404).json({ success: false, message: "POC not found" });
    }

    if (validated.depends_on_task_id) {
      const existingTasks = await dbStore.getPocTasks(req.params.id);
      if (!existingTasks.some((t) => t.id === validated.depends_on_task_id)) {
        return res.status(400).json({ success: false, message: "depends_on_task_id must belong to the same POC." });
      }
    }

    const task = await dbStore.createPocTask(req.params.id, validated);
    res.status(201).json(task);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.issues[0].message });
    }
    next(err);
  }
});

router.put("/:id/tasks/:taskId", requirePermission("poc:manage"), requireModule("poc"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = z
      .object({
        name: z.string().min(2).optional(),
        start_date: z.string().min(5).optional(),
        duration_days: z.number().int().min(1).optional(),
        status: z.enum(["planned", "in_progress", "done"]).optional(),
        depends_on_task_id: z.string().nullable().optional(),
      })
      .parse(req.body);

    const existingTasks = await dbStore.getPocTasks(req.params.id);
    if (!existingTasks.some((t) => t.id === req.params.taskId)) {
      return res.status(404).json({ success: false, message: "Task not found for this POC." });
    }

    if (validated.depends_on_task_id) {
      if (validated.depends_on_task_id === req.params.taskId) {
        return res.status(400).json({ success: false, message: "A task cannot depend on itself." });
      }
      if (!existingTasks.some((t) => t.id === validated.depends_on_task_id)) {
        return res.status(400).json({ success: false, message: "depends_on_task_id must belong to the same POC." });
      }
    }

    const updated = await dbStore.updatePocTask(req.params.taskId, validated);
    res.json(updated);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.issues[0].message });
    }
    next(err);
  }
});

router.delete("/:id/tasks/:taskId", requirePermission("poc:manage"), requireModule("poc"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const existingTasks = await dbStore.getPocTasks(req.params.id);
    if (!existingTasks.some((t) => t.id === req.params.taskId)) {
      return res.status(404).json({ success: false, message: "Task not found for this POC." });
    }

    await dbStore.deletePocTask(req.params.taskId);
    res.json({ success: true, message: "Task deleted successfully" });
  } catch (err) {
    next(err);
  }
});

// Cadernos de Teste (Fase E) - test cases generated from the POC's objective/success criteria via
// the AI orchestrator, "IA rascunha, humano valida" (same pattern as Proposal Studio): regenerable
// and editable, editing a field marks edited_manually=true so a future regenerate never clobbers it.
function nextTestCaseCodes(existingCodes: string[], count: number): string[] {
  let max = 0;
  for (const code of existingCodes) {
    const match = /^TC-(\d+)$/.exec(code);
    if (match) max = Math.max(max, parseInt(match[1], 10));
  }
  return Array.from({ length: count }, (_, i) => `TC-${String(max + i + 1).padStart(2, "0")}`);
}

router.get("/:id/test-cases", requirePermission("poc:read"), requireModule("poc"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const poc = await dbStore.getPoc(req.params.id);
    if (!poc) {
      return res.status(404).json({ success: false, message: "POC not found" });
    }
    const cases = await dbStore.getPocTestCases(req.params.id);
    res.json(cases);
  } catch (err) {
    next(err);
  }
});

router.post("/:id/test-cases", requirePermission("poc:manage"), requireModule("poc"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = z
      .object({
        title: z.string().min(2, "Title is required"),
        objective: z.string().min(2, "Objective is required"),
        steps: z.string().min(2, "Steps are required"),
        expected_result: z.string().min(2, "Expected result is required"),
      })
      .parse(req.body);

    const poc = await dbStore.getPoc(req.params.id);
    if (!poc) {
      return res.status(404).json({ success: false, message: "POC not found" });
    }

    const existing = await dbStore.getPocTestCases(req.params.id);
    const [code] = nextTestCaseCodes(existing.map((c) => c.code), 1);

    const testCase = await dbStore.createPocTestCase(req.params.id, { ...validated, code, generated_by_ai: false });
    res.status(201).json(testCase);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.issues[0].message });
    }
    next(err);
  }
});

router.put("/:id/test-cases/:caseId", requirePermission("poc:manage"), requireModule("poc"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = z
      .object({
        title: z.string().min(2).optional(),
        objective: z.string().min(2).optional(),
        steps: z.string().min(2).optional(),
        expected_result: z.string().min(2).optional(),
        status: z.enum(["pending", "in_progress", "approved", "failed"]).optional(),
      })
      .parse(req.body);

    const existing = await dbStore.getPocTestCases(req.params.id);
    if (!existing.some((c) => c.id === req.params.caseId)) {
      return res.status(404).json({ success: false, message: "Test case not found for this POC." });
    }

    // Editing content (not just a status/test-run update) means a human has taken ownership of
    // this case - it should never be silently overwritten by a future "Regenerar com IA".
    const contentChanged = validated.title !== undefined || validated.objective !== undefined || validated.steps !== undefined || validated.expected_result !== undefined;

    const updated = await dbStore.updatePocTestCase(req.params.caseId, {
      ...validated,
      edited_manually: contentChanged ? true : undefined,
    });
    res.json(updated);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.issues[0].message });
    }
    next(err);
  }
});

router.delete("/:id/test-cases/:caseId", requirePermission("poc:manage"), requireModule("poc"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const existing = await dbStore.getPocTestCases(req.params.id);
    if (!existing.some((c) => c.id === req.params.caseId)) {
      return res.status(404).json({ success: false, message: "Test case not found for this POC." });
    }

    await dbStore.deletePocTestCase(req.params.caseId);
    res.json({ success: true, message: "Test case deleted successfully" });
  } catch (err) {
    next(err);
  }
});

router.post("/:id/test-cases/generate", requirePermission("poc:manage"), requireModule("poc"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.headers["x-tenant-id"] as string;

    const poc = await dbStore.getPoc(req.params.id);
    if (!poc) {
      return res.status(404).json({ success: false, message: "POC not found" });
    }

    const settings = await dbStore.getSettings();

    const costCap = await checkCostCap(tenantId, settings.monthly_cost_cap_usd ?? null);
    if (costCap.blocked) {
      return res.status(402).json({
        success: false,
        message: `Monthly AI cost cap reached ($${costCap.currentSpendUsd.toFixed(2)} of $${costCap.capUsd?.toFixed(2)}). Generation blocked until next month or the cap is raised in Admin > IA, Prompts e Custos.`
      });
    }

    const successCriteria = await dbStore.getPocSuccessCriteria(req.params.id);
    const criteriaList = successCriteria.length
      ? successCriteria.map((c) => `- ${c.description}`).join("\n")
      : "(nenhum critério de sucesso definido ainda)";

    // Only the persona/instruction framing is admin-editable (Admin > IA, Prompts e Custos) -
    // same rule as classification/analysis: the JSON response schema below stays fixed in code
    // so an admin can tune tone/emphasis without being able to break parsing.
    const promptRow = await prisma.promptTemplate.findFirst({ where: { type: "poc_test_generation", isActive: true } });
    const instructions = promptRow?.content?.trim() || FACTORY_DEFAULT_POC_TEST_GENERATION_PROMPT;

    const prompt = `${instructions} Gere de 3 a 6 casos de teste.

OBJETIVO DA POC:
${poc.objective}

CRITÉRIOS DE SUCESSO:
${criteriaList}

Responda em português do Brasil. Responda APENAS com um objeto JSON (não um array na raiz - alguns
provedores exigem um objeto no nível superior), sem markdown, sem texto extra, no formato:
{
  "test_cases": [
    { "title": "título curto do caso de teste", "objective": "o que este teste valida", "steps": "passo a passo, uma linha por passo", "expected_result": "resultado esperado, mensurável quando possível" }
  ]
}`;

    const resolution = await resolveProvider("poc_test_generation", settings as any);
    if (resolution.isFallback) {
      await recordProviderFallback({ tenantId, taskType: "poc_test_generation", intendedProvider: resolution.intendedProvider, userId: requireUserId(req) });
    }

    const { text, inputTokens, outputTokens } = await generateJsonWithProvider(resolution.provider, resolution.model, prompt);

    await recordAiUsage({
      tenantId,
      taskType: "poc_test_generation",
      provider: resolution.provider,
      model: resolution.model,
      estimatedCostUsd: estimateCostUsd(resolution.model, inputTokens, outputTokens),
    });

    let parsed: any[];
    try {
      const parsedObj = JSON.parse(text.trim());
      parsed = Array.isArray(parsedObj) ? parsedObj : parsedObj?.test_cases;
      if (!Array.isArray(parsed)) throw new Error("not an array");
    } catch {
      return res.status(502).json({ success: false, message: "A IA retornou uma resposta em formato inesperado. Tente novamente." });
    }

    // Regenerating only replaces drafts nobody has touched yet - anything a human wrote from
    // scratch or edited survives.
    await dbStore.deleteUneditedAiPocTestCases(req.params.id);

    const remaining = await dbStore.getPocTestCases(req.params.id);
    const codes = nextTestCaseCodes(remaining.map((c) => c.code), parsed.length);

    const created = [];
    for (let i = 0; i < parsed.length; i++) {
      const item = parsed[i];
      if (!item?.title || !item?.objective || !item?.steps || !item?.expected_result) continue;
      created.push(
        await dbStore.createPocTestCase(req.params.id, {
          code: codes[i],
          title: String(item.title),
          objective: String(item.objective),
          steps: String(item.steps),
          expected_result: String(item.expected_result),
          generated_by_ai: true,
        })
      );
    }

    res.json(await dbStore.getPocTestCases(req.params.id));
  } catch (err) {
    next(err);
  }
});

// Aceite do Cliente (Fase F) - final decision record. The signed document is a manual upload
// placeholder deliberately, not a real e-signature integration (product decision, 2026-07-13,
// left open for a future session) - reuses the same storage adapter as equipment invoices.
router.get("/:id/acceptance", requirePermission("poc:read"), requireModule("poc"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const poc = await dbStore.getPoc(req.params.id);
    if (!poc) {
      return res.status(404).json({ success: false, message: "POC not found" });
    }
    const acceptance = await dbStore.getPocAcceptance(req.params.id);
    res.json(acceptance || { poc_id: req.params.id, decision: "pending" });
  } catch (err) {
    next(err);
  }
});

router.put("/:id/acceptance", requirePermission("poc:manage"), requireModule("poc"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = z
      .object({
        decision: z.enum(["pending", "won", "lost"]).optional(),
        signed_by: z.string().optional(),
        signed_at: z.string().optional(),
        notes: z.string().optional(),
      })
      .parse(req.body);

    const poc = await dbStore.getPoc(req.params.id);
    if (!poc) {
      return res.status(404).json({ success: false, message: "POC not found" });
    }

    const acceptance = await dbStore.upsertPocAcceptance(req.params.id, validated);
    res.json(acceptance);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.issues[0].message });
    }
    next(err);
  }
});

router.post(
  "/:id/acceptance/signed-document",
  requirePermission("poc:manage"),
  requireModule("poc"),
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

      const tenantId = req.headers["x-tenant-id"] as string;

      const result = await runWithTenant({ tenantId }, async () => {
        const poc = await dbStore.getPoc(req.params.id);
        if (!poc) return null;

        const settings = await dbStore.getSettings();

        // Replacing an already-uploaded signed document must not orphan the previous file.
        const previous = await dbStore.getPocAcceptanceDocumentFile(req.params.id);
        if (previous) {
          const previousAdapter = createStorageAdapter({ ...settings, storage_mode: previous.storage_provider });
          await previousAdapter.deleteFile(previous.storage_path);
        }

        const storageAdapter = createStorageAdapter(settings);
        const storagePath = await storageAdapter.uploadFile(req.params.id, file.buffer, file.originalname, file.mimetype);

        return dbStore.attachPocAcceptanceDocument(req.params.id, {
          storage_provider: settings.storage_mode,
          storage_path: storagePath,
          original_filename: file.originalname,
        });
      });

      if (!result) {
        return res.status(404).json({ success: false, message: "POC not found" });
      }

      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

router.get("/:id/acceptance/signed-document", requirePermission("poc:read"), requireModule("poc"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const file = await dbStore.getPocAcceptanceDocumentFile(req.params.id);
    if (!file) {
      return res.status(404).json({ success: false, message: "No signed document attached yet." });
    }

    const settings = await dbStore.getSettings();
    const adapter = createStorageAdapter({ ...settings, storage_mode: file.storage_provider });

    let buffer: Buffer;
    try {
      buffer = await adapter.readFile(file.storage_path);
    } catch {
      return res.status(404).json({ success: false, message: "Physical document file not found." });
    }

    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${file.original_filename}"`);
    res.send(buffer);
  } catch (err) {
    next(err);
  }
});

export default router;
