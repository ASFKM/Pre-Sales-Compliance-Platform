-- AlterTable
ALTER TABLE "platform_settings" ADD COLUMN     "pricing_budget_optimization_model" TEXT NOT NULL DEFAULT 'gemini-3.5-flash',
ADD COLUMN     "pricing_budget_optimization_provider" TEXT NOT NULL DEFAULT 'gemini';
