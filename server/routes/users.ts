import express, { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { dbStore } from "../../src/dbStore";
import { requirePermission } from "./auth";
import { UserStatus } from "../../src/types";

const router = express.Router();

// Define Zod schemas for validation
const CreateUserSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters long"),
  email: z.string().email("Invalid email format"),
  role_id: z.string().min(1, "Role ID is required"),
});

const UpdateUserSchema = z.object({
  name: z.string().min(2).optional(),
  email: z.string().email().optional(),
  role_id: z.string().optional(),
  status: z.nativeEnum(UserStatus).optional(),
  mfa_enabled: z.boolean().optional(),
});

// Protect with users admin permissions
router.get("/", requirePermission("admin:users"), (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(dbStore.getData().users);
  } catch (err) {
    next(err);
  }
});

router.post("/", requirePermission("admin:users"), (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = CreateUserSchema.parse(req.body);
    const userId = "u_" + Math.random().toString(36).substring(2, 11);
    
    const newUser = {
      id: userId,
      name: validated.name,
      email: validated.email.toLowerCase().trim(),
      mfa_enabled: false,
      status: UserStatus.ACTIVE,
      role_id: validated.role_id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    dbStore.getData().users.push(newUser);

    // Audit Log
    dbStore.addAuditLog({
      user_id: "System Admin",
      action: "Create User",
      entity_type: "User",
      entity_id: newUser.id,
      ip_address: req.ip || "127.0.0.1",
      user_agent: req.headers["user-agent"] || "unknown",
      metadata: JSON.stringify({ email: newUser.email, role_id: newUser.role_id })
    });

    res.status(211).json(newUser);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.issues[0].message });
    }
    next(err);
  }
});

router.put("/:id", requirePermission("admin:users"), (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = UpdateUserSchema.parse(req.body);
    const user = dbStore.getData().users.find(u => u.id === req.params.id);

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    Object.assign(user, validated, { updated_at: new Date().toISOString() });

    dbStore.addAuditLog({
      user_id: "System Admin",
      action: "Update User Record",
      entity_type: "User",
      entity_id: req.params.id,
      ip_address: req.ip || "127.0.0.1",
      user_agent: req.headers["user-agent"] || "unknown",
      metadata: JSON.stringify(validated)
    });

    res.json(user);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.issues[0].message });
    }
    next(err);
  }
});

router.delete("/:id", requirePermission("admin:users"), (req: Request, res: Response, next: NextFunction) => {
  try {
    dbStore.getData().users = dbStore.getData().users.filter(u => u.id !== req.params.id);

    dbStore.addAuditLog({
      user_id: "System Admin",
      action: "Delete User Account",
      entity_type: "User",
      entity_id: req.params.id,
      ip_address: req.ip || "127.0.0.1",
      user_agent: req.headers["user-agent"] || "unknown",
      metadata: JSON.stringify({ deleted_user_id: req.params.id })
    });

    res.json({ success: true, message: "User deleted successfully." });
  } catch (err) {
    next(err);
  }
});

export default router;
