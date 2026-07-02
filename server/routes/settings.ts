import express, { Request, Response, NextFunction } from "express";
import { dbStore } from "../../src/dbStore";
import { requireAuth, requirePermission } from "./auth";

const router = express.Router();

function auditSettingsChange(req: Request, action: string, entityType: string, entityId: string, updates: any) {
  const userId = (req.headers["x-user-id"] as string) || "u1";
  dbStore.addAuditLog({
    user_id: userId,
    action,
    entity_type: entityType,
    entity_id: entityId,
    ip_address: req.ip || "127.0.0.1",
    user_agent: req.headers["user-agent"] || "unknown",
    metadata: JSON.stringify(updates)
  });
}

router.get("/settings", requireAuth, (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(dbStore.getSettings());
  } catch (err) {
    next(err);
  }
});

router.put("/settings", requirePermission("admin:settings"), (req: Request, res: Response, next: NextFunction) => {
  try {
    const updates = req.body || {};
    const settings = dbStore.updateSettings(updates);

    auditSettingsChange(req, "Update Global Platform Settings", "PlatformSettings", "global", updates);

    res.json(settings);
  } catch (err) {
    next(err);
  }
});

router.put("/settings/ai", requirePermission("ai:settings"), (req: Request, res: Response, next: NextFunction) => {
  try {
    const allowedFields = [
      "ai_provider",
      "default_model",
      "document_analysis_model",
      "proposal_generation_model",
      "summarization_model",
      "risk_analysis_model",
      "default_language",
      "default_log_level"
    ];

    const updates = Object.fromEntries(
      Object.entries(req.body || {}).filter(([key]) => allowedFields.includes(key))
    );

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, message: "No valid AI/settings fields provided." });
    }

    const settings = dbStore.updateSettings(updates);

    auditSettingsChange(req, "Update AI Platform Settings", "PlatformSettings", "global-ai", updates);

    res.json(settings);
  } catch (err) {
    next(err);
  }
});

function updateStorageSettings(req: Request, res: Response, next: NextFunction) {
  try {
    const allowedFields = [
      "storage_mode",
      "local_storage_path",
      "s3_bucket",
      "gcs_bucket"
    ];

    const updates = Object.fromEntries(
      Object.entries(req.body || {}).filter(([key]) => allowedFields.includes(key))
    );

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, message: "No valid storage fields provided." });
    }

    const settings = dbStore.updateSettings(updates);

    auditSettingsChange(req, "Change Storage Provider Settings", "PlatformSettings", "global-storage", updates);

    res.json(settings);
  } catch (err) {
    next(err);
  }
}

router.post("/settings/storage", requirePermission("storage:manage"), updateStorageSettings);
router.put("/settings/storage", requirePermission("storage:manage"), updateStorageSettings);

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

    auditSettingsChange(req, "Update AI Prompt Template", "PromptTemplate", req.params.id, updates);

    res.json(prompt);
  } catch (err) {
    next(err);
  }
});

export default router;
