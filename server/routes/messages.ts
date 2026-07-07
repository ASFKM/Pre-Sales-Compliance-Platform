import express, { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { prisma } from "../../src/prisma";
import { requireAuth, requirePermission } from "./auth";
import { getCurrentTenantId } from "../../src/tenantContext";

const router = express.Router();

// Recent messages only - a maintenance notice from last month isn't useful forever.
const MESSAGE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

router.get("/messages", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getCurrentTenantId()!;
    const messages = await prisma.systemMessage.findMany({
      where: {
        tenantId,
        createdAt: { gte: new Date(Date.now() - MESSAGE_WINDOW_MS) },
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
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
    const userId = (req.headers["x-user-id"] as string) || "u1";
    const expiresAt = validated.expires_in_minutes ? new Date(Date.now() + validated.expires_in_minutes * 60_000) : null;

    const message = await prisma.systemMessage.create({
      data: {
        id: `sysmsg_${Math.random().toString(36).substring(2, 11)}`,
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
