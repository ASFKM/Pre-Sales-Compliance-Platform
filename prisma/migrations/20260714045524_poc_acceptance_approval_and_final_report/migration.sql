-- AlterTable
ALTER TABLE "platform_settings" ADD COLUMN     "poc_final_report_generation_model" TEXT NOT NULL DEFAULT 'gemini-3.5-flash',
ADD COLUMN     "poc_final_report_generation_provider" TEXT NOT NULL DEFAULT 'gemini';

-- AlterTable
ALTER TABLE "poc_acceptances" ADD COLUMN     "approved_at" TIMESTAMP(3),
ADD COLUMN     "approved_by_user_id" TEXT,
ADD COLUMN     "pending_approval" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "poc_final_report_questions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "poc_id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "generated_by_ai" BOOLEAN NOT NULL DEFAULT false,
    "edited_manually" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "poc_final_report_questions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "poc_final_report_questions_tenant_id_idx" ON "poc_final_report_questions"("tenant_id");

-- CreateIndex
CREATE INDEX "poc_final_report_questions_poc_id_idx" ON "poc_final_report_questions"("poc_id");

-- AddForeignKey
ALTER TABLE "poc_final_report_questions" ADD CONSTRAINT "poc_final_report_questions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "poc_final_report_questions" ADD CONSTRAINT "poc_final_report_questions_poc_id_fkey" FOREIGN KEY ("poc_id") REFERENCES "pocs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

