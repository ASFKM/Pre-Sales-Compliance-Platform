-- AlterTable: platform_settings - real OpenAI/Anthropic key storage, alongside the existing
-- Gemini-only ai_api_key_encrypted, so document_analysis_provider/critical_extraction_provider/
-- web_grounding_provider/proposal_generation_provider can each actually be honored instead of
-- always falling back to Gemini (see src/aiOrchestrator.ts).
ALTER TABLE "platform_settings" ADD COLUMN "openai_api_key_encrypted" TEXT;
ALTER TABLE "platform_settings" ADD COLUMN "anthropic_api_key_encrypted" TEXT;
