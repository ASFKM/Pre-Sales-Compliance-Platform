-- AlterTable
ALTER TABLE "platform_settings" ADD COLUMN "document_classification_model" TEXT NOT NULL DEFAULT 'gemini-3.5-flash';
ALTER TABLE "platform_settings" ADD COLUMN "document_classification_provider" TEXT NOT NULL DEFAULT 'gemini';

-- AlterTable
ALTER TABLE "ai_provider_configs" ADD COLUMN "supports_vision" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ai_provider_configs" ADD COLUMN "supports_web_search" BOOLEAN NOT NULL DEFAULT false;
