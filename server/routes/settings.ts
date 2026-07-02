import express, { Request, Response, NextFunction } from "express";
import { dbStore } from "../../src/dbStore";
import { requireAuth, requirePermission } from "./auth";

const router = express.Router();

router.get("/settings", requireAuth, (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(dbStore.getSettings());
  } catch (err) {
    next(err);
  }
});

router.post("/settings/storage", requirePermission("storage:manage"), (req: Request, res: Response, next: NextFunction) => {
  try {
    const updates = req.body;
    const settings = dbStore.updateSettings(updates);

    const userId = (req.headers["x-user-id"] as string) || "u1";
    dbStore.addAuditLog({
      user_id: userId,
      action: "Change Storage Provider Settings",
      entity_type: "PlatformSettings",
      entity_id: "global",
      ip_address: req.ip || "127.0.0.1",
      user_agent: req.headers["user-agent"] || "unknown",
      metadata: JSON.stringify(updates)
    });

    res.json(settings);
  } catch (err) {
    next(err);
  }
});

router.get("/settings/prompts", requireAuth, (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(dbStore.getPrompts());
  } catch (err) {
    next(err);
  }
});

router.put("/settings/prompts/:id", requirePermission("ai:settings"), (req: Request, res: Response, next: NextFunction) => {
  try {
    const updates = req.body;
    const prompt = dbStore.updatePrompt(req.params.id, updates);

    if (!prompt) {
      return res.status(404).json({ success: false, message: "Prompt not found" });
    }

    const userId = (req.headers["x-user-id"] as string) || "u1";
    dbStore.addAuditLog({
      user_id: userId,
      action: "Update AI Prompt Template",
      entity_type: "PromptTemplate",
      entity_id: req.params.id,
      ip_address: req.ip || "127.0.0.1",
      user_agent: req.headers["user-agent"] || "unknown",
      metadata: JSON.stringify(updates)
    });

    res.json(prompt);
  } catch (err) {
    next(err);
  }
});

export default router;
