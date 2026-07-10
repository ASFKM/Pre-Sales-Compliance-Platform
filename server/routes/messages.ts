import express, { Response, NextFunction } from "express";
import type { Request } from "../types/express";
import { z } from "zod";
import { prisma } from "../../src/prisma";
import { dbStore } from "../../src/dbStore";
import { requireAuth, requirePermission } from "./auth";
import { requireUserId } from "../middleware/security";
import { getCurrentTenantId } from "../../src/tenantContext";
import { randomId } from "../../src/idGenerator";

const router = express.Router();

// Recent messages only - a maintenance notice from last month isn't useful forever.
const MESSAGE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

router.get("/messages", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getCurrentTenantId()!;
    const roleId = req.headers["x-role-id"] as string;
    const role = await dbStore.getRoleById(roleId);
    const canSeeAdminOnly = role?.permissions.includes("admin:settings") ?? false;

    const messages = await prisma.systemMessage.findMany({
      where: {
        tenantId,
        createdAt: { gte: new Date(Date.now() - MESSAGE_WINDOW_MS) },
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        ...(canSeeAdminOnly ? {} : { audience: { not: "admin_only" } }),
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    res.json(
      messages.map((m) => ({
        id: m.id,
        source: m.source,
        audience: m.audience,
        body: m.body,
        created_by: m.createdBy,
        created_at: m.createdAt,
        expires_at: m.expiresAt,
      }))
    );
  } catch (err) {
    next(err);
  }
});

// null = never expires. Otherwise, minutes from now until the message stops being shown.
const SendMessageSchema = z.object({
  audience: z.enum(["admin_only", "all_users"]),
  body: z.string().min(1),
  expires_in_minutes: z.number().int().positive().nullable().optional(),
});

router.post("/messages", requirePermission("admin:settings"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = SendMessageSchema.parse(req.body);
    const tenantId = getCurrentTenantId()!;
    const userId = requireUserId(req);
    const expiresAt = validated.expires_in_minutes ? new Date(Date.now() + validated.expires_in_minutes * 60_000) : null;

    const message = await prisma.systemMessage.create({
      data: {
        id: randomId("sysmsg"),
        tenantId,
        source: "local",
        audience: validated.audience,
        body: validated.body,
        createdBy: userId,
        expiresAt,
      },
    });
    res.status(201).json({ id: message.id });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.issues[0].message });
    }
    next(err);
  }
});

export default router;
