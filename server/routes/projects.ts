import express, { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { dbStore } from "../../src/dbStore";
import { requireAuth, requirePermission } from "./auth";

const router = express.Router();

const ProjectSchema = z.object({
  name: z.string().min(3, "Name must be at least 3 characters"),
  customer_name: z.string().min(2, "Customer name is required"),
  opportunity_name: z.string().min(2, "Opportunity name is required"),
  vertical: z.string().min(2, "Vertical is required"),
  description: z.string().optional().default(""),
  status: z.enum(["draft", "analysis_in_progress", "waiting_customer", "waiting_internal", "completed", "canceled"]).optional().default("draft"),
  deadline: z.string().min(5, "Deadline is required"),
  proposal_validity_date: z.string().min(5, "Proposal validity date is required"),
  output_language: z.enum(["Portuguese", "English", "Spanish"]).optional().default("Portuguese"),
  proposal_language: z.enum(["Portuguese", "English", "Spanish"]).optional().default("Portuguese"),
  ai_orientation_mode: z.enum(["Vendor-neutral", "Preferred manufacturer", "Mandatory manufacturer", "Existing customer standard", "Free AI recommendation", "Custom instruction"]).optional().default("Vendor-neutral"),
  ai_orientation_text: z.string().optional().default(""),
  selected_approval_workflow_id: z.string().optional().default("w1"),
  procurement_modality: z.string().optional(),
  procurement_subtype: z.string().optional(),
  custom_modality: z.string().optional()
});

router.get("/", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const projects = await dbStore.getProjects();
    res.json(projects);
  } catch (err) {
    next(err);
  }
});

router.get("/:id", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const project = await dbStore.getProject(req.params.id);
    if (!project) {
      return res.status(404).json({ success: false, message: "Project not found" });
    }
    res.json(project);
  } catch (err) {
    next(err);
  }
});

router.post("/", requirePermission("project:create"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = ProjectSchema.parse(req.body);
    const userId = (req.headers["x-user-id"] as string) || "u1";

    const project = await dbStore.createProject({
      ...validated,
      owner_user_id: userId
    });

    await dbStore.addAuditLog({
      user_id: userId,
      action: "Create Project",
      entity_type: "Project",
      entity_id: project.id,
      ip_address: req.ip || "127.0.0.1",
      user_agent: req.headers["user-agent"] || "unknown",
      metadata: JSON.stringify(validated)
    });

    res.status(211).json(project);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.issues[0].message });
    }
    next(err);
  }
});

router.put("/:id", requirePermission("project:update"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = ProjectSchema.partial().parse(req.body);
    const project = await dbStore.updateProject(req.params.id, validated);
    if (!project) {
      return res.status(404).json({ success: false, message: "Project not found" });
    }

    const userId = (req.headers["x-user-id"] as string) || "u1";
    await dbStore.addAuditLog({
      user_id: userId,
      action: "Update Project",
      entity_type: "Project",
      entity_id: req.params.id,
      ip_address: req.ip || "127.0.0.1",
      user_agent: req.headers["user-agent"] || "unknown",
      metadata: JSON.stringify(validated)
    });

    res.json(project);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.issues[0].message });
    }
    next(err);
  }
});

router.delete("/:id", requirePermission("project:delete"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const deleted = await dbStore.deleteProject(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: "Project not found" });
    }

    const userId = (req.headers["x-user-id"] as string) || "u1";
    await dbStore.addAuditLog({
      user_id: userId,
      action: "Delete Project",
      entity_type: "Project",
      entity_id: req.params.id,
      ip_address: req.ip || "127.0.0.1",
      user_agent: req.headers["user-agent"] || "unknown",
      metadata: JSON.stringify({ deleted_project_id: req.params.id })
    });

    res.json({ success: true, message: "Project deleted successfully" });
  } catch (err) {
    next(err);
  }
});

export default router;
