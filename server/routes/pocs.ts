// Fase 6 (add-on): Gestão de POC. Every route below runs behind requirePermission("poc:read" |
// "poc:manage") AND requireModule("poc") - the module only exists for tenants whose Fleet
// Manager ModuleEntitlement includes "poc" (see server/utils/fleetLicense.ts /
// getFleetLicenseStatus), independent of RBAC permissions.
import express, { Response, NextFunction } from "express";
import type { Request } from "../types/express";
import { z } from "zod";
import { dbStore } from "../../src/dbStore";
import { requirePermission, requireModule } from "./auth";
import { requireUserId } from "../middleware/security";

const router = express.Router();

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

export default router;
