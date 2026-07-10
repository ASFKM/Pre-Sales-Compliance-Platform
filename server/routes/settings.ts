import express, { Response, NextFunction } from "express";
import type { Request } from "../types/express";
import fs from "fs";
import path from "path";
import { dbStore } from "../../src/dbStore";
import { requirePermission } from "./auth";
import { encryptSecret, decryptSecret, maskSecret } from "../utils/security";
import { requireUserId } from "../middleware/security";
import { createStorageAdapter } from "../utils/storage";
import { getFleetLicenseStatus } from "../utils/fleetLicense";
import { getCurrentTenantId } from "../../src/tenantContext";
import { FACTORY_DEFAULT_CLASSIFICATION_PROMPT, FACTORY_DEFAULT_ANALYSIS_PROMPT } from "../utils/promptDefaults";
import { getCurrentMonthSpendUsd, getCurrentMonthSpendByTaskTypeAndProvider } from "../../src/aiOrchestrator";

const router = express.Router();

async function getSafePlatformSettings() {
  const settings = await dbStore.getSettings() as any;
  const {
    ai_api_key_encrypted,
    openai_api_key_encrypted,
    anthropic_api_key_encrypted,
    s3_secret_access_key_encrypted,
    gcs_service_account_key_encrypted,
    fleet_manager_api_key_encrypted,
    ...safeSettings
  } = settings;

  const maskOrFallback = (encrypted?: string) => {
    if (!encrypted) return "";
    try {
      return maskSecret(decryptSecret(encrypted));
    } catch {
      return "********";
    }
  };

  return {
    ...safeSettings,
    ai_api_key_configured: Boolean(ai_api_key_encrypted),
    ai_api_key_masked: maskOrFallback(ai_api_key_encrypted),
    openai_api_key_configured: Boolean(openai_api_key_encrypted),
    openai_api_key_masked: maskOrFallback(openai_api_key_encrypted),
    anthropic_api_key_configured: Boolean(anthropic_api_key_encrypted),
    anthropic_api_key_masked: maskOrFallback(anthropic_api_key_encrypted),
    s3_secret_access_key_configured: Boolean(s3_secret_access_key_encrypted),
    s3_secret_access_key_masked: maskOrFallback(s3_secret_access_key_encrypted),
    gcs_service_account_key_configured: Boolean(gcs_service_account_key_encrypted),
    fleet_manager_api_key_configured: Boolean(fleet_manager_api_key_encrypted),
    fleet_manager_api_key_masked: maskOrFallback(fleet_manager_api_key_encrypted)
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
  if (safe.openai_api_key) {
    safe.openai_api_key = "[secret-updated]";
  }
  if (safe.openai_api_key_encrypted) {
    safe.openai_api_key_encrypted = "[encrypted-secret]";
  }
  if (safe.anthropic_api_key) {
    safe.anthropic_api_key = "[secret-updated]";
  }
  if (safe.anthropic_api_key_encrypted) {
    safe.anthropic_api_key_encrypted = "[encrypted-secret]";
  }
  if (safe.fleet_manager_api_key) {
    safe.fleet_manager_api_key = "[secret-updated]";
  }
  if (safe.fleet_manager_api_key_encrypted) {
    safe.fleet_manager_api_key_encrypted = "[encrypted-secret]";
  }
  return safe;
}


async function auditSettingsChange(req: Request, action: string, entityType: string, entityId: string, updates: any) {
  const userId = requireUserId(req);
  await dbStore.addAuditLog({
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

router.get("/settings/ai-cost-summary", requirePermission("ai:settings"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getCurrentTenantId()!;
    const spendUsd = await getCurrentMonthSpendUsd(tenantId);
    const spendByTaskTypeAndProvider = await getCurrentMonthSpendByTaskTypeAndProvider(tenantId);
    res.json({ spend_usd: spendUsd, spend_by_task_type_and_provider: spendByTaskTypeAndProvider });
  } catch (err) {
    next(err);
  }
});

router.get("/settings", requirePermission("admin:settings"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await getSafePlatformSettings());
  } catch (err) {
    next(err);
  }
});

router.get("/settings/fleet-license-status", requirePermission("admin:settings"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getCurrentTenantId();
    if (!tenantId) {
      return res.status(400).json({ success: false, message: "No tenant context." });
    }
    res.json(await getFleetLicenseStatus(tenantId));
  } catch (err) {
    next(err);
  }
});

router.put("/settings", requirePermission("admin:settings"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const allowedFields = ["default_language", "default_log_level", "fleet_manager_url", "fleet_manager_enabled"];
    const updates: any = Object.fromEntries(
      Object.entries(req.body || {}).filter(([key]) => allowedFields.includes(key))
    );

    if (typeof req.body?.fleet_manager_api_key === "string" && req.body.fleet_manager_api_key.trim()) {
      updates.fleet_manager_api_key_encrypted = encryptSecret(req.body.fleet_manager_api_key.trim());
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, message: "No valid global settings fields provided." });
    }

    const settingsValidation = validateAISettingsUpdates(updates);
    if (!settingsValidation.valid) {
      return res.status(400).json({ success: false, message: settingsValidation.message });
    }

    await dbStore.updateSettings(updates);

    await auditSettingsChange(req, "Update Global Platform Settings", "PlatformSettings", "global", sanitizeSettingsAudit(updates));

    res.json(await getSafePlatformSettings());
  } catch (err) {
    next(err);
  }
});

router.get("/branding", requirePermission("branding:manage"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await dbStore.getBranding());
  } catch (err) {
    next(err);
  }
});

router.put("/branding", requirePermission("branding:manage"), async (req: Request, res: Response, next: NextFunction) => {
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

    const branding = await dbStore.updateBranding(updates);

    const auditSafeUpdates = Object.fromEntries(
      Object.entries(updates).map(([key, value]) => {
        if (typeof value === "string" && value.startsWith("data:image/")) {
          return [key, `[image-data-url:${value.length} chars]`];
        }
        return [key, value];
      })
    );

    await auditSettingsChange(req, "Update Branding Settings", "BrandingSettings", "branding-global", auditSafeUpdates);

    res.json(branding);
  } catch (err) {
    next(err);
  }
});




const KNOWN_PROVIDERS = ["gemini", "anthropic", "openai", "deepseek"];

function validateAISettingsUpdates(updates: any) {
  const modelFields = [
    "default_model",
    "document_analysis_model",
    "proposal_generation_model",
    "critical_extraction_model",
    "web_grounding_model",
    "spec_copilot_model"
  ];
  const providerFields = [
    "document_analysis_provider",
    "critical_extraction_provider",
    "web_grounding_provider",
    "proposal_generation_provider",
    "spec_copilot_provider"
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

  for (const field of providerFields) {
    if (updates[field] !== undefined && !KNOWN_PROVIDERS.includes(String(updates[field]))) {
      return { valid: false, message: `${field} must be one of: ${KNOWN_PROVIDERS.join(", ")}.` };
    }
  }

  if (updates.monthly_cost_cap_usd !== undefined && updates.monthly_cost_cap_usd !== null) {
    const cap = Number(updates.monthly_cost_cap_usd);
    if (!Number.isFinite(cap) || cap <= 0) {
      return { valid: false, message: "Monthly cost cap must be a positive number, or null for uncapped." };
    }
  }

  if (updates.default_language !== undefined && !allowedLanguages.includes(String(updates.default_language))) {
    return { valid: false, message: "Invalid default language." };
  }

  if (updates.default_log_level !== undefined && !allowedLogLevels.includes(String(updates.default_log_level))) {
    return { valid: false, message: "Invalid default log level." };
  }

  if (updates.fleet_manager_url !== undefined && updates.fleet_manager_url !== "" && !/^https?:\/\//.test(String(updates.fleet_manager_url))) {
    return { valid: false, message: "Fleet Manager URL must start with http:// or https://." };
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

router.put("/settings/ai", requirePermission("ai:settings"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const allowedFields = [
      "ai_provider",
      "default_model",
      "document_analysis_model",
      "proposal_generation_model",
      "document_analysis_provider",
      "critical_extraction_model",
      "critical_extraction_provider",
      "web_grounding_model",
      "web_grounding_provider",
      "proposal_generation_provider",
      "spec_copilot_model",
      "spec_copilot_provider",
      "monthly_cost_cap_usd",
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

    if (typeof req.body?.openai_api_key === "string" && req.body.openai_api_key.trim()) {
      updates.openai_api_key_encrypted = encryptSecret(req.body.openai_api_key.trim());
    }
    if (req.body?.clear_openai_api_key === true) {
      updates.openai_api_key_encrypted = "";
    }

    if (typeof req.body?.anthropic_api_key === "string" && req.body.anthropic_api_key.trim()) {
      updates.anthropic_api_key_encrypted = encryptSecret(req.body.anthropic_api_key.trim());
    }
    if (req.body?.clear_anthropic_api_key === true) {
      updates.anthropic_api_key_encrypted = "";
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, message: "No valid AI/settings fields provided." });
    }

    const aiValidation = validateAISettingsUpdates(updates);
    if (!aiValidation.valid) {
      return res.status(400).json({ success: false, message: aiValidation.message });
    }

    await dbStore.updateSettings(updates);

    await auditSettingsChange(req, "Update AI Platform Settings", "PlatformSettings", "global-ai", sanitizeSettingsAudit({
      ...updates,
      ai_api_key: req.body?.ai_api_key ? "[secret-updated]" : undefined
    }));

    res.json(await getSafePlatformSettings());
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

  if (updates.gcs_service_account_key !== undefined && updates.gcs_service_account_key !== "") {
    try {
      JSON.parse(updates.gcs_service_account_key);
    } catch {
      return { valid: false, message: "gcs_service_account_key must be valid JSON (the service account key file content)." };
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

async function updateStorageSettings(req: Request, res: Response, next: NextFunction) {
  try {
    const allowedFields = [
      "storage_mode",
      "local_storage_path",
      "s3_bucket",
      "s3_region",
      "s3_access_key_id",
      "gcs_bucket",
      "gcs_project_id"
    ];

    const updates: any = Object.fromEntries(
      Object.entries(req.body || {}).filter(([key]) => allowedFields.includes(key))
    );

    if (typeof req.body?.s3_secret_access_key === "string" && req.body.s3_secret_access_key.trim()) {
      updates.s3_secret_access_key_encrypted = encryptSecret(req.body.s3_secret_access_key.trim());
    }
    if (req.body?.clear_s3_secret_access_key === true) {
      updates.s3_secret_access_key_encrypted = "";
    }

    if (typeof req.body?.gcs_service_account_key === "string" && req.body.gcs_service_account_key.trim()) {
      updates.gcs_service_account_key_encrypted = encryptSecret(req.body.gcs_service_account_key.trim());
    }
    if (req.body?.clear_gcs_service_account_key === true) {
      updates.gcs_service_account_key_encrypted = "";
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, message: "No valid storage fields provided." });
    }

    const currentSettings = await dbStore.getSettings();
    const storageValidation = validateStorageSettings(
      { ...updates, gcs_service_account_key: req.body?.gcs_service_account_key },
      currentSettings
    );
    if (!storageValidation.valid) {
      return res.status(400).json({ success: false, message: storageValidation.message });
    }

    await dbStore.updateSettings(updates);

    await auditSettingsChange(req, "Change Storage Provider Settings", "PlatformSettings", "global-storage", sanitizeSettingsAudit({
      ...updates,
      s3_secret_access_key: req.body?.s3_secret_access_key ? "[secret-updated]" : undefined,
      gcs_service_account_key: req.body?.gcs_service_account_key ? "[secret-updated]" : undefined
    }));

    res.json(await getSafePlatformSettings());
  } catch (err) {
    next(err);
  }
}

router.get("/settings/storage/status", requirePermission("storage:manage"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const settings = await dbStore.getSettings();
    const mode = settings.storage_mode || "local";

    if (mode === "local") {
      const configuredPath = settings.local_storage_path || "./uploads";
      const targetPath = path.isAbsolute(configuredPath)
        ? configuredPath
        : path.resolve(process.cwd(), configuredPath);

      await fs.promises.mkdir(targetPath, { recursive: true });

      const probeFile = path.join(targetPath, ".storage-health-check");
      await fs.promises.writeFile(probeFile, `ok ${new Date().toISOString()}`, "utf8");
      await fs.promises.unlink(probeFile);

      return res.json({
        success: true,
        mode,
        target: targetPath,
        writable: true,
        message: "Local storage path is available and writable."
      });
    }

    // For s3/gcs, actually probe the bucket instead of assuming it's reachable.
    const adapter = createStorageAdapter(settings);
    const probeKey = `__storage_health_check_${Date.now()}.txt`;

    try {
      const storagePath = await adapter.uploadFile("__health", Buffer.from("ok"), probeKey, "text/plain");
      await adapter.deleteFile(storagePath);

      return res.json({
        success: true,
        mode,
        target: mode === "s3" ? settings.s3_bucket : settings.gcs_bucket,
        writable: true,
        message: `${mode.toUpperCase()} bucket is reachable and writable.`
      });
    } catch (probeErr: any) {
      return res.json({
        success: false,
        mode,
        target: mode === "s3" ? settings.s3_bucket : settings.gcs_bucket,
        writable: false,
        message: `${mode.toUpperCase()} bucket is not reachable: ${probeErr.message || "unknown error"}`
      });
    }
  } catch (err) {
    next(err);
  }
});

router.post("/settings/storage", requirePermission("storage:manage"), updateStorageSettings);
router.put("/settings/storage", requirePermission("storage:manage"), updateStorageSettings);

router.get("/settings/prompts", requirePermission("ai:settings"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const prompts = await dbStore.getPrompts();
    res.json(
      prompts.map((p) => ({
        ...p,
        factory_default: p.type === "classification" ? FACTORY_DEFAULT_CLASSIFICATION_PROMPT : p.type === "analysis" ? FACTORY_DEFAULT_ANALYSIS_PROMPT : "",
      }))
    );
  } catch (err) {
    next(err);
  }
});

router.put("/settings/prompts/:id", requirePermission("ai:settings"), async (req: Request, res: Response, next: NextFunction) => {
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

    const prompt = await dbStore.updatePrompt(req.params.id, updates);

    if (!prompt) {
      return res.status(404).json({ success: false, message: "Prompt not found" });
    }

    await auditSettingsChange(req, "Update AI Prompt Template", "PromptTemplate", req.params.id, updates);

    res.json(prompt);
  } catch (err) {
    next(err);
  }
});

// Real versioning: a "new version" is a new row, never activated automatically - the live
// analysis/classification pipeline keeps using whichever version is currently isActive until
// someone explicitly promotes this one via /activate below. Distinct from PUT above, which edits
// the content of one existing version in place.
router.post("/settings/prompts", requirePermission("ai:settings"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, type, content, language, version } = req.body || {};
    const promptValidation = validatePromptUpdates({ name, type, content, language, version });
    if (!promptValidation.valid) {
      return res.status(400).json({ success: false, message: promptValidation.message });
    }

    const userId = requireUserId(req);
    const prompt = await dbStore.createPromptVersion({ name, type, content, language, version, created_by: userId });

    await auditSettingsChange(req, "Create AI Prompt Template Version", "PromptTemplate", prompt.id, { type, version });

    res.status(201).json(prompt);
  } catch (err: any) {
    if (err?.code === "P2002") {
      return res.status(409).json({ success: false, message: "This version already exists for this prompt type." });
    }
    next(err);
  }
});

router.post("/settings/prompts/:id/activate", requirePermission("ai:settings"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const prompt = await dbStore.setActivePromptVersion(req.params.id);
    if (!prompt) {
      return res.status(404).json({ success: false, message: "Prompt not found" });
    }

    await auditSettingsChange(req, "Activate AI Prompt Template Version", "PromptTemplate", prompt.id, { type: prompt.type, version: prompt.version });

    res.json(prompt);
  } catch (err) {
    next(err);
  }
});

// Custom AI providers - any OpenAI-compatible endpoint (Grok/xAI, DeepSeek, Mistral AI, Groq,
// Together AI, Fireworks, OpenRouter, etc.) can be added here with no code change; provider_key
// is the value that shows up in the *_provider task-routing dropdowns once added.
const PROVIDER_KEY_PATTERN = /^[a-z0-9_-]{2,40}$/;

router.get("/settings/ai-providers", requirePermission("ai:settings"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const providers = await dbStore.getAiProviderConfigs();
    res.json(providers.map(({ api_key_encrypted, ...safe }) => ({
      ...safe,
      api_key_masked: (() => {
        try {
          return maskSecret(decryptSecret(api_key_encrypted));
        } catch {
          return "********";
        }
      })(),
    })));
  } catch (err) {
    next(err);
  }
});

router.post("/settings/ai-providers", requirePermission("ai:settings"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { provider_key, display_name, base_url, api_key, default_model } = req.body || {};

    if (!PROVIDER_KEY_PATTERN.test(String(provider_key || ""))) {
      return res.status(400).json({ success: false, message: "provider_key must be 2-40 lowercase letters, numbers, hyphens or underscores (e.g. 'grok', 'deepseek', 'mistral')." });
    }
    if (!String(display_name || "").trim()) {
      return res.status(400).json({ success: false, message: "display_name is required." });
    }
    if (!String(default_model || "").trim()) {
      return res.status(400).json({ success: false, message: "default_model is required." });
    }
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(String(base_url || ""));
    } catch {
      return res.status(400).json({ success: false, message: "base_url must be a valid URL (e.g. https://api.x.ai/v1)." });
    }
    if (parsedUrl.protocol !== "https:") {
      return res.status(400).json({ success: false, message: "base_url must use https." });
    }
    if (!String(api_key || "").trim()) {
      return res.status(400).json({ success: false, message: "api_key is required." });
    }

    const provider = await dbStore.createAiProviderConfig({
      provider_key: String(provider_key).trim(),
      display_name: String(display_name).trim(),
      base_url: parsedUrl.toString(),
      api_key_encrypted: encryptSecret(String(api_key).trim()),
      default_model: String(default_model).trim(),
    });

    await auditSettingsChange(req, "Add Custom AI Provider", "AiProviderConfig", provider.id, { provider_key: provider.provider_key, base_url: provider.base_url });

    res.status(201).json(provider);
  } catch (err: any) {
    if (err?.code === "P2002") {
      return res.status(409).json({ success: false, message: "A provider with this key is already configured for this tenant." });
    }
    next(err);
  }
});

router.delete("/settings/ai-providers/:id", requirePermission("ai:settings"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    await dbStore.deleteAiProviderConfig(req.params.id);
    await auditSettingsChange(req, "Remove Custom AI Provider", "AiProviderConfig", req.params.id, {});
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
