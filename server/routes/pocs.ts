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

const router = express.Router();

// Same memory-storage config as documents.ts - a 10MB limit comfortably covers a scanned NF PDF.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

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
    const validated = z.object({ name: z.string().min(2, "Name is required"), serial_number: z.string().optional() }).parse(req.body);

    const poc = await dbStore.getPoc(req.params.id);
    if (!poc) {
      return res.status(404).json({ success: false, message: "POC not found" });
    }

    const item = await dbStore.createPocEquipmentItem(req.params.id, validated);
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

export default router;
