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

function validateBrandingUpdates(updates: any) {
  const colorFields = ["primary_color", "secondary_color", "accent_color", "background_color", "text_color"];
  const pathFields = ["company_logo_path", "login_logo_path", "sidebar_logo_path", "report_logo_path", "favicon_path"];
  const hexColor = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

  if (updates.company_name !== undefined && !String(updates.company_name).trim()) {
    return { valid: false, message: "Company name cannot be empty." };
  }

  for (const field of colorFields) {
    if (updates[field] !== undefined && !hexColor.test(String(updates[field]).trim())) {
      return { valid: false, message: `${field} must be a valid HEX color.` };
    }
  }

  if (updates.default_theme !== undefined && !["light", "dark"].includes(String(updates.default_theme))) {
    return { valid: false, message: "Invalid default theme." };
  }

  for (const field of pathFields) {
    if (updates[field] === undefined || updates[field] === "") {
      continue;
    }

    const value = String(updates[field]).trim();

    if (value.startsWith("data:image/")) {
      continue;
    }

    const lower = value.toLowerCase();
    if (lower.startsWith("javascript:") || lower.startsWith("http://") || lower.startsWith("https://") || value.includes("..")) {
      return { valid: false, message: `${field} must be a safe local asset path or image data URL.` };
    }
  }

  return { valid: true, message: "" };
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

    const brandingValidation = validateBrandingUpdates(updates);
    if (!brandingValidation.valid) {
      return res.status(400).json({ success: false, message: brandingValidation.message });
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





function validateAISettingsUpdates(updates: any) {
  const modelFields = [
    "default_model",
    "document_analysis_model",
    "proposal_generation_model",
    "summarization_model",
    "risk_analysis_model"
  ];
  const allowedLanguages = ["Portuguese", "English", "Spanish"];
  const allowedLogLevels = ["DEBUG", "INFO", "WARN", "ERROR"];

  if (updates.ai_provider !== undefined && !String(updates.ai_provider).trim()) {
    return { valid: false, message: "AI provider cannot be empty." };
  }

  for (const field of modelFields) {
    if (updates[field] !== undefined && !String(updates[field]).trim()) {
      return { valid: false, message: `${field} cannot be empty.` };
    }
  }

  if (updates.default_language !== undefined && !allowedLanguages.includes(String(updates.default_language))) {
    return { valid: false, message: "Invalid default language." };
  }

  if (updates.default_log_level !== undefined && !allowedLogLevels.includes(String(updates.default_log_level))) {
    return { valid: false, message: "Invalid default log level." };
  }

  return { valid: true, message: "" };
}

function validatePromptUpdates(updates: any) {
  const allowedLanguages = ["Portuguese", "English", "Spanish"];

  for (const field of ["name", "type", "content", "version"]) {
    if (updates[field] !== undefined && !String(updates[field]).trim()) {
      return { valid: false, message: `${field} cannot be empty.` };
    }
  }

  if (updates.language !== undefined && !allowedLanguages.includes(String(updates.language))) {
    return { valid: false, message: "Invalid prompt language." };
  }

  if (updates.is_active !== undefined && typeof updates.is_active !== "boolean") {
    return { valid: false, message: "is_active must be boolean." };
  }

  return { valid: true, message: "" };
}

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

    const aiValidation = validateAISettingsUpdates(updates);
    if (!aiValidation.valid) {
      return res.status(400).json({ success: false, message: aiValidation.message });
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

function validateStorageSettings(updates: any, currentSettings: any) {
  const effectiveMode = updates.storage_mode || currentSettings.storage_mode || "local";
  const effectiveLocalPath = updates.local_storage_path || currentSettings.local_storage_path;
  const effectiveS3Bucket = updates.s3_bucket || currentSettings.s3_bucket;
  const effectiveGcsBucket = updates.gcs_bucket || currentSettings.gcs_bucket;

  if (!["local", "s3", "gcs"].includes(effectiveMode)) {
    return { valid: false, message: "Invalid storage mode." };
  }

  if (updates.local_storage_path !== undefined) {
    const localPath = String(updates.local_storage_path);
    if (!localPath.trim() || localPath.includes("\0") || localPath.trim() === "/" || localPath.trim() === ".") {
      return { valid: false, message: "Invalid local storage path." };
    }
  }

  for (const key of ["s3_bucket", "gcs_bucket"]) {
    if (updates[key] !== undefined) {
      const bucket = String(updates[key]).trim();
      if (!bucket || bucket.includes("://") || bucket.includes("/") || /\s/.test(bucket)) {
        return { valid: false, message: `${key} must be a bucket name, not a URL or path.` };
      }
    }
  }

  if (effectiveMode === "local" && !String(effectiveLocalPath || "").trim()) {
    return { valid: false, message: "Local storage mode requires local_storage_path." };
  }

  if (effectiveMode === "s3" && !String(effectiveS3Bucket || "").trim()) {
    return { valid: false, message: "S3 storage mode requires s3_bucket." };
  }

  if (effectiveMode === "gcs" && !String(effectiveGcsBucket || "").trim()) {
    return { valid: false, message: "GCS storage mode requires gcs_bucket." };
  }

  return { valid: true, message: "" };
}

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

    const storageValidation = validateStorageSettings(updates, dbStore.getSettings());
    if (!storageValidation.valid) {
      return res.status(400).json({ success: false, message: storageValidation.message });
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
    const allowedFields = ["name", "type", "content", "language", "version", "is_active"];
    const updates = Object.fromEntries(
      Object.entries(req.body || {}).filter(([key]) => allowedFields.includes(key))
    );

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, message: "No valid prompt fields provided." });
    }

    const promptValidation = validatePromptUpdates(updates);
    if (!promptValidation.valid) {
      return res.status(400).json({ success: false, message: promptValidation.message });
    }

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
