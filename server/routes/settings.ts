import express, { Request, Response, NextFunction } from "express";
import fs from "fs";
import path from "path";
import { dbStore } from "../../src/dbStore";
import { requireAuth, requirePermission } from "./auth";
import { encryptSecret, decryptSecret, maskSecret } from "../utils/security";

const router = express.Router();

function getSafePlatformSettings() {
  const settings = dbStore.getSettings() as any;
  const { ai_api_key_encrypted, ...safeSettings } = settings;

  let aiApiKeyMasked = "";
  if (ai_api_key_encrypted) {
    try {
      aiApiKeyMasked = maskSecret(decryptSecret(ai_api_key_encrypted));
    } catch {
      aiApiKeyMasked = "********";
    }
  }

  return {
    ...safeSettings,
    ai_api_key_configured: Boolean(ai_api_key_encrypted),
    ai_api_key_masked: aiApiKeyMasked
  };
}

function sanitizeSettingsAudit(updates: any) {
  const safe = { ...updates };
  if (safe.ai_api_key) {
    safe.ai_api_key = "[secret-updated]";
  }
  if (safe.ai_api_key_encrypted) {
    safe.ai_api_key_encrypted = "[encrypted-secret]";
  }
  return safe;
}


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
    res.json(getSafePlatformSettings());
  } catch (err) {
    next(err);
  }
});

router.put("/settings", requirePermission("admin:settings"), (req: Request, res: Response, next: NextFunction) => {
  try {
    const updates = req.body || {};
    const settings = dbStore.updateSettings(updates);

    auditSettingsChange(req, "Update Global Platform Settings", "PlatformSettings", "global", updates);

    res.json(getSafePlatformSettings());
  } catch (err) {
    next(err);
  }
});

router.get("/branding", requireAuth, (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(dbStore.getBranding());
  } catch (err) {
    next(err);
  }
});

router.put("/branding", requirePermission("branding:manage"), (req: Request, res: Response, next: NextFunction) => {
  try {
    const allowedFields = [
      "company_name",
      "company_logo_path",
      "login_logo_path",
      "sidebar_logo_path",
      "report_logo_path",
      "favicon_path",
      "primary_color",
      "secondary_color",
      "accent_color",
      "background_color",
      "text_color",
      "font_family",
      "border_radius",
      "button_style",
      "default_theme",
      "custom_css_variables",
      "footer_text",
      "support_contact",
      "legal_text"
    ];

    const updates = Object.fromEntries(
      Object.entries(req.body || {}).filter(([key]) => allowedFields.includes(key))
    );

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, message: "No valid branding fields provided." });
    }

    const branding = dbStore.updateBranding(updates);

    const auditSafeUpdates = Object.fromEntries(
      Object.entries(updates).map(([key, value]) => {
        if (typeof value === "string" && value.startsWith("data:image/")) {
          return [key, `[image-data-url:${value.length} chars]`];
        }
        return [key, value];
      })
    );

    auditSettingsChange(req, "Update Branding Settings", "BrandingSettings", "branding-global", auditSafeUpdates);

    res.json(branding);
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

    const updates: any = Object.fromEntries(
      Object.entries(req.body || {}).filter(([key]) => allowedFields.includes(key))
    );

    if (typeof req.body?.ai_api_key === "string" && req.body.ai_api_key.trim()) {
      updates.ai_api_key_encrypted = encryptSecret(req.body.ai_api_key.trim());
    }

    if (req.body?.clear_ai_api_key === true) {
      updates.ai_api_key_encrypted = "";
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, message: "No valid AI/settings fields provided." });
    }

    dbStore.updateSettings(updates);

    auditSettingsChange(req, "Update AI Platform Settings", "PlatformSettings", "global-ai", sanitizeSettingsAudit({
      ...updates,
      ai_api_key: req.body?.ai_api_key ? "[secret-updated]" : undefined
    }));

    res.json(getSafePlatformSettings());
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
    ) as any;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, message: "No valid storage fields provided." });
    }

    if (updates.storage_mode && !["local", "s3", "gcs"].includes(updates.storage_mode)) {
      return res.status(400).json({ success: false, message: "Invalid storage mode." });
    }

    for (const key of ["local_storage_path", "s3_bucket", "gcs_bucket"]) {
      if (updates[key] !== undefined && !String(updates[key]).trim()) {
        return res.status(400).json({ success: false, message: `${key} cannot be empty.` });
      }
    }

    const settings = dbStore.updateSettings(updates);

    auditSettingsChange(req, "Change Storage Provider Settings", "PlatformSettings", "global-storage", updates);

    res.json(getSafePlatformSettings());
  } catch (err) {
    next(err);
  }
}

router.get("/settings/storage/status", requirePermission("storage:manage"), (req: Request, res: Response, next: NextFunction) => {
  try {
    const settings = dbStore.getSettings();
    const mode = settings.storage_mode || "local";

    if (mode === "local") {
      const configuredPath = settings.local_storage_path || "./uploads";
      const targetPath = path.isAbsolute(configuredPath)
        ? configuredPath
        : path.resolve(process.cwd(), configuredPath);

      fs.mkdirSync(targetPath, { recursive: true });

      const probeFile = path.join(targetPath, ".storage-health-check");
      fs.writeFileSync(probeFile, `ok ${new Date().toISOString()}`, "utf8");
      fs.unlinkSync(probeFile);

      return res.json({
        success: true,
        mode,
        target: targetPath,
        writable: true,
        scaffolded: false,
        message: "Local storage path is available and writable."
      });
    }

    if (mode === "s3") {
      return res.json({
        success: true,
        mode,
        target: settings.s3_bucket,
        writable: true,
        scaffolded: true,
        message: "S3 adapter is configured in scaffold mode."
      });
    }

    return res.json({
      success: true,
      mode,
      target: settings.gcs_bucket,
      writable: true,
      scaffolded: true,
      message: "GCS adapter is configured in scaffold mode."
    });
  } catch (err) {
    next(err);
  }
});

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
