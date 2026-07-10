import express, { Response, NextFunction } from "express";
import type { Request } from "../types/express";
import { z } from "zod";
import { dbStore } from "../../src/dbStore";
import { requireAuth, requirePermission } from "./auth";

const router = express.Router();

router.get("/verticals", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await dbStore.getVerticals());
  } catch (err) {
    next(err);
  }
});

const VerticalSchema = z.object({
  name: z.string().min(2, "Vertical name must be at least 2 characters long"),
});

router.post("/verticals", requirePermission("admin:settings"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = VerticalSchema.parse(req.body);
    const vertical = await dbStore.createVertical(validated.name);
    res.status(201).json(vertical);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.issues[0].message });
    }
    if ((err as any)?.code === "P2002") {
      return res.status(400).json({ success: false, message: "Já existe uma vertical com esse nome." });
    }
    next(err);
  }
});

router.put("/verticals/:id", requirePermission("admin:settings"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const updates: { name?: string; is_active?: boolean } = {};
    if (typeof req.body?.name === "string") updates.name = req.body.name;
    if (typeof req.body?.is_active === "boolean") updates.is_active = req.body.is_active;

    const vertical = await dbStore.updateVertical(req.params.id, updates);
    if (!vertical) {
      return res.status(404).json({ success: false, message: "Vertical not found." });
    }
    res.json(vertical);
  } catch (err) {
    next(err);
  }
});

router.delete("/verticals/:id", requirePermission("admin:settings"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const deleted = await dbStore.deleteVertical(req.params.id);
    if (!deleted) {
      return res.status(400).json({ success: false, message: "Não é possível excluir - vertical em uso por um ou mais projetos, ou não encontrada." });
    }
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
