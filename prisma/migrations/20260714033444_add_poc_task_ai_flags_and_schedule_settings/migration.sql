-- AlterTable
ALTER TABLE "platform_settings" ADD COLUMN     "poc_schedule_generation_model" TEXT NOT NULL DEFAULT 'gemini-3.5-flash',
ADD COLUMN     "poc_schedule_generation_provider" TEXT NOT NULL DEFAULT 'gemini';

-- AlterTable
ALTER TABLE "poc_tasks" ADD COLUMN     "edited_manually" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "generated_by_ai" BOOLEAN NOT NULL DEFAULT false;

