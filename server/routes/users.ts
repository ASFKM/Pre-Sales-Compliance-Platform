import express, { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { dbStore } from "../../src/dbStore";
import { requirePermission } from "./auth";
import { UserStatus } from "../../src/types";
import { hashPassword } from "../utils/security";

const router = express.Router();

const sanitizeUser = (user: any) => {
  if (!user) return user;
  const { password, password_hash, token, session, ...safeUser } = user;
  return safeUser;
};

// Define Zod schemas for validation
const CreateUserSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters long"),
  email: z.string().email("Invalid email format"),
  role_id: z.string().min(1, "Role ID is required"),
  initial_password: z.string().min(8, "Initial password must be at least 8 characters long").optional(),
});

const UpdateUserSchema = z.object({
  name: z.string().min(2).optional(),
  email: z.string().email().optional(),
  role_id: z.string().optional(),
  status: z.nativeEnum(UserStatus).optional(),
  mfa_enabled: z.boolean().optional(),
  password: z.string().min(8, "Password must be at least 8 characters long").optional(),
});

// Protect with users admin permissions
router.get("/", requirePermission("admin:users"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const users = await dbStore.getUsers();
    res.json(users.map(sanitizeUser));
  } catch (err) {
    next(err);
  }
});

router.post("/", requirePermission("admin:users"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = CreateUserSchema.parse(req.body);
    const normalizedEmail = validated.email.toLowerCase().trim();

    const roleExists = await dbStore.getRoleById(validated.role_id);
    if (!roleExists) {
      return res.status(400).json({ success: false, message: "Role does not exist." });
    }

    const duplicatedEmail = await dbStore.getUserByEmail(normalizedEmail);
    if (duplicatedEmail) {
      return res.status(409).json({ success: false, message: "User email already exists." });
    }

    const newUser = await dbStore.createUser({
      name: validated.name,
      email: normalizedEmail,
      role_id: validated.role_id,
      password_hash: hashPassword(validated.initial_password || "ChangeMe123!"),
    });

    // Audit Log
    await dbStore.addAuditLog({
      user_id: (req.headers["x-user-id"] as string) || "u1",
      action: "Create User",
      entity_type: "User",
      entity_id: newUser.id,
      ip_address: req.ip || "127.0.0.1",
      user_agent: req.headers["user-agent"] || "unknown",
      metadata: JSON.stringify({ email: newUser.email, role_id: newUser.role_id })
    });

    res.status(201).json(sanitizeUser(newUser));
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.issues[0].message });
    }
    next(err);
  }
});

router.put("/:id", requirePermission("admin:users"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = UpdateUserSchema.parse(req.body);
    const user = await dbStore.getUserById(req.params.id);

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    if (validated.role_id) {
      const roleExists = await dbStore.getRoleById(validated.role_id);
      if (!roleExists) {
        return res.status(400).json({ success: false, message: "Role does not exist." });
      }
    }

    let normalizedEmail: string | undefined;
    if (validated.email) {
      normalizedEmail = validated.email.toLowerCase().trim();
      const duplicatedEmail = await dbStore.getUserByEmail(normalizedEmail);

      if (duplicatedEmail && duplicatedEmail.id !== req.params.id) {
        return res.status(409).json({ success: false, message: "User email already exists." });
      }
    }

    const { password, ...safeUpdates } = validated;
    const updatedUser = await dbStore.updateUser(req.params.id, {
      ...safeUpdates,
      email: normalizedEmail,
      ...(password ? { password_hash: hashPassword(password) } : {}),
    });

    const auditMetadata = { ...validated } as any;
    if (auditMetadata.password) {
      auditMetadata.password = "[password-updated]";
    }

    await dbStore.addAuditLog({
      user_id: (req.headers["x-user-id"] as string) || "u1",
      action: "Update User Record",
      entity_type: "User",
      entity_id: req.params.id,
      ip_address: req.ip || "127.0.0.1",
      user_agent: req.headers["user-agent"] || "unknown",
      metadata: JSON.stringify(auditMetadata)
    });

    res.json(sanitizeUser(updatedUser));
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.issues[0].message });
    }
    next(err);
  }
});

router.delete("/:id", requirePermission("admin:users"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actorUserId = (req.headers["x-user-id"] as string) || "u1";
    const user = await dbStore.getUserById(req.params.id);

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    if (actorUserId === req.params.id) {
      return res.status(400).json({ success: false, message: "Current authenticated user cannot delete own account." });
    }

    await dbStore.deleteUser(req.params.id);

    await dbStore.addAuditLog({
      user_id: actorUserId,
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
