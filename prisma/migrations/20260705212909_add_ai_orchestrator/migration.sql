-- AlterTable: platform_settings - Phase 5 AI orchestrator (task->provider map + cost cap).
-- summarization_model/risk_analysis_model were configurable in the data model but never
-- actually read anywhere in the app (verified via full-codebase grep) - dropped rather than
-- kept alongside the new canonical 4-task fields, which would just be confusing dead config.
ALTER TABLE "platform_settings" DROP COLUMN "summarization_model";
ALTER TABLE "platform_settings" DROP COLUMN "risk_analysis_model";

ALTER TABLE "platform_settings" ADD COLUMN "document_analysis_provider" TEXT NOT NULL DEFAULT 'gemini';
ALTER TABLE "platform_settings" ADD COLUMN "critical_extraction_model" TEXT NOT NULL DEFAULT 'gemini-3.5-flash';
ALTER TABLE "platform_settings" ADD COLUMN "critical_extraction_provider" TEXT NOT NULL DEFAULT 'anthropic';
ALTER TABLE "platform_settings" ADD COLUMN "web_grounding_model" TEXT NOT NULL DEFAULT 'gemini-3.5-flash';
ALTER TABLE "platform_settings" ADD COLUMN "web_grounding_provider" TEXT NOT NULL DEFAULT 'gemini';
ALTER TABLE "platform_settings" ADD COLUMN "proposal_generation_provider" TEXT NOT NULL DEFAULT 'anthropic';
ALTER TABLE "platform_settings" ADD COLUMN "monthly_cost_cap_usd" DOUBLE PRECISION;

-- AlterTable: background_tasks - Phase 5 cost/provider bookkeeping, nullable since only the
-- AI-calling task types (document_analysis, project_intake_analysis) populate these.
ALTER TABLE "background_tasks" ADD COLUMN "estimated_cost_usd" DOUBLE PRECISION;
ALTER TABLE "background_tasks" ADD COLUMN "ai_provider" TEXT;
ALTER TABLE "background_tasks" ADD COLUMN "intended_provider" TEXT;
ALTER TABLE "background_tasks" ADD COLUMN "is_provider_fallback" BOOLEAN NOT NULL DEFAULT false;
