import express, { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { dbStore } from "../../src/dbStore";
import { requirePermission } from "./auth";

const router = express.Router();

const RoleSchema = z.object({
  name: z.string().min(2, "Role name must be at least 2 characters long"),
  description: z.string().optional().default(""),
  permissions: z.array(z.string()).min(1, "At least one permission is required"),
});

const UpdateRoleSchema = z.object({
  name: z.string().min(2).optional(),
  description: z.string().optional(),
  permissions: z.array(z.string()).min(1).optional(),
});

router.get("/", requirePermission("admin:roles"), (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(dbStore.getRoles());
  } catch (err) {
    next(err);
  }
});

router.post("/", requirePermission("admin:roles"), (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = RoleSchema.parse(req.body);

    const duplicated = dbStore.getRoles().some((r) => r.name.toLowerCase() === validated.name.toLowerCase());
    if (duplicated) {
      return res.status(409).json({ success: false, message: "Role already exists." });
    }

    const role = dbStore.createRole({
      name: validated.name.trim(),
      description: validated.description || "",
      permissions: Array.from(new Set(validated.permissions)),
    });

    dbStore.addAuditLog({
      user_id: "System Admin",
      action: "Create Role",
      entity_type: "Role",
      entity_id: role.id,
      ip_address: req.ip || "127.0.0.1",
      user_agent: req.headers["user-agent"] || "unknown",
      metadata: JSON.stringify({ name: role.name, permissions_count: role.permissions.length })
    });

    res.status(201).json(role);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.issues[0].message });
    }
    next(err);
  }
});

router.put("/:id", requirePermission("admin:roles"), (req: Request, res: Response, next: NextFunction) => {
  try {
    const protectedRoles = ["r1", "r2", "r3"];
    if (protectedRoles.includes(req.params.id)) {
      return res.status(403).json({ success: false, message: "Built-in roles cannot be edited." });
    }

    const validated = UpdateRoleSchema.parse(req.body);
    const role = dbStore.updateRole(req.params.id, {
      ...validated,
      permissions: validated.permissions ? Array.from(new Set(validated.permissions)) : undefined,
    });

    if (!role) {
      return res.status(404).json({ success: false, message: "Role not found." });
    }

    dbStore.addAuditLog({
      user_id: "System Admin",
      action: "Update Role",
      entity_type: "Role",
      entity_id: role.id,
      ip_address: req.ip || "127.0.0.1",
      user_agent: req.headers["user-agent"] || "unknown",
      metadata: JSON.stringify(validated)
    });

    res.json(role);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.issues[0].message });
    }
    next(err);
  }
});

router.delete("/:id", requirePermission("admin:roles"), (req: Request, res: Response, next: NextFunction) => {
  try {
    const deleted = dbStore.deleteRole(req.params.id);
    if (!deleted) {
      return res.status(400).json({
        success: false,
        message: "Role cannot be deleted. It may be built-in, in use, or not found."
      });
    }

    dbStore.addAuditLog({
      user_id: "System Admin",
      action: "Delete Role",
      entity_type: "Role",
      entity_id: req.params.id,
      ip_address: req.ip || "127.0.0.1",
      user_agent: req.headers["user-agent"] || "unknown",
      metadata: JSON.stringify({ deleted_role_id: req.params.id })
    });

    res.json({ success: true, message: "Role deleted successfully." });
  } catch (err) {
    next(err);
  }
});

export default router;
