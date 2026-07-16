ALTER TABLE "platform_settings" ADD COLUMN "proposal_opinion_panel_model" TEXT NOT NULL DEFAULT 'gemini-3.5-flash';
ALTER TABLE "platform_settings" ADD COLUMN "proposal_opinion_panel_provider" TEXT NOT NULL DEFAULT 'gemini';
