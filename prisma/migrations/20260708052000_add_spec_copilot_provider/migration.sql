-- Adds the spec_copilot task's configurable provider/model, so the Workspace chat can use
-- whichever AI provider the admin configures (previously always hardcoded to Gemini).
ALTER TABLE "platform_settings" ADD COLUMN IF NOT EXISTS "spec_copilot_model" TEXT NOT NULL DEFAULT 'gemini-3.5-flash';
ALTER TABLE "platform_settings" ADD COLUMN IF NOT EXISTS "spec_copilot_provider" TEXT NOT NULL DEFAULT 'gemini';
