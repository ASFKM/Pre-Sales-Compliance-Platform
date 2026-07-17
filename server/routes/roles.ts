import express, { Response, NextFunction } from "express";
import type { Request } from "../types/express";
import { z } from "zod";
import { dbStore } from "../../src/dbStore";
import { requirePermission } from "./auth";
import { requireUserId } from "../middleware/security";

const router = express.Router();

const ALLOWED_PERMISSIONS = new Set<string>([
  "project:create", "project:read", "project:update", "project:delete",
  "document:upload", "document:read", "document:delete",
  "analysis:run", "analysis:read", "analysis:edit", "analysis:approve",
  "proposal:generate", "proposal:edit", "proposal:approve", "proposal:export",
  "template:manage",
  "approval:manage",
  "knowledge_base:read", "knowledge_base:write",
  "admin:users", "admin:roles", "admin:settings", "admin:audit", "admin:debug", "admin:diagnostics",
  // Sistema de Atualização de Produção: available to every installation (not gated behind a
  // module entitlement, per the customer's own decision), so it's a plain admin permission like
  // the others above, not paired with a requireModule check the way poc:read/poc:manage are.
  "admin:system_updates",
  "ai:settings",
  "branding:manage",
  "storage:manage",
  "integrations:manage",
  // Add-on (Fase 6) - only actually usable when the tenant also has the "poc" module
  // entitlement (checked separately by requireModule); this is just the RBAC half.
  "poc:read", "poc:manage"
]);

function validatePermissions(permissions: string[]) {
  const normalized = Array.from(new Set(
    permissions.map(permission => String(permission).trim()).filter(Boolean)
  ));
  const invalid = normalized.filter(permission => !ALLOWED_PERMISSIONS.has(permission));

  return {
    valid: invalid.length === 0,
    permissions: normalized,
    invalid
  };
}

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

router.get("/", requirePermission("admin:roles"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await dbStore.getRoles());
  } catch (err) {
    next(err);
  }
});

router.post("/", requirePermission("admin:roles"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = RoleSchema.parse(req.body);
    const permissionValidation = validatePermissions(validated.permissions);

    if (!permissionValidation.valid) {
      return res.status(400).json({
        success: false,
        message: "Role contains invalid permissions.",
        invalid_permissions: permissionValidation.invalid
      });
    }

    const roles = await dbStore.getRoles();
    const duplicated = roles.some((r) => r.name.toLowerCase() === validated.name.toLowerCase());
    if (duplicated) {
      return res.status(409).json({ success: false, message: "Role already exists." });
    }

    const role = await dbStore.createRole({
      name: validated.name.trim(),
      description: validated.description || "",
      permissions: permissionValidation.permissions,
    });

    await dbStore.addAuditLog({
      user_id: requireUserId(req),
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

router.put("/:id", requirePermission("admin:roles"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const protectedRoles = ["r1", "r2", "r3"];
    if (protectedRoles.includes(req.params.id)) {
      return res.status(403).json({ success: false, message: "Built-in roles cannot be edited." });
    }

    const validated = UpdateRoleSchema.parse(req.body);

    const permissionValidation = validated.permissions
      ? validatePermissions(validated.permissions)
      : undefined;

    if (permissionValidation && !permissionValidation.valid) {
      return res.status(400).json({
        success: false,
        message: "Role contains invalid permissions.",
        invalid_permissions: permissionValidation.invalid
      });
    }

    const role = await dbStore.updateRole(req.params.id, {
      ...validated,
      permissions: permissionValidation ? permissionValidation.permissions : undefined,
    });

    if (!role) {
      return res.status(404).json({ success: false, message: "Role not found." });
    }

    await dbStore.addAuditLog({
      user_id: requireUserId(req),
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

router.delete("/:id", requirePermission("admin:roles"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const deleted = await dbStore.deleteRole(req.params.id);
    if (!deleted) {
      return res.status(400).json({
        success: false,
        message: "Role cannot be deleted. It may be built-in, in use, or not found."
      });
    }

    await dbStore.addAuditLog({
      user_id: requireUserId(req),
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
