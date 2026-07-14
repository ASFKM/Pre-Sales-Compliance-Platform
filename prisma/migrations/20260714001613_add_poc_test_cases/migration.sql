-- CreateEnum
CREATE TYPE "PocTestCaseStatus" AS ENUM ('pending', 'in_progress', 'approved', 'failed');

-- AlterTable
ALTER TABLE "platform_settings" ADD COLUMN     "poc_test_generation_model" TEXT NOT NULL DEFAULT 'gemini-3.5-flash',
ADD COLUMN     "poc_test_generation_provider" TEXT NOT NULL DEFAULT 'gemini';

-- CreateTable
CREATE TABLE "poc_test_cases" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "poc_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "steps" TEXT NOT NULL,
    "expected_result" TEXT NOT NULL,
    "status" "PocTestCaseStatus" NOT NULL DEFAULT 'pending',
    "generated_by_ai" BOOLEAN NOT NULL DEFAULT false,
    "edited_manually" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "poc_test_cases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "poc_test_cases_tenant_id_idx" ON "poc_test_cases"("tenant_id");

-- CreateIndex
CREATE INDEX "poc_test_cases_poc_id_idx" ON "poc_test_cases"("poc_id");

-- AddForeignKey
ALTER TABLE "poc_test_cases" ADD CONSTRAINT "poc_test_cases_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "poc_test_cases" ADD CONSTRAINT "poc_test_cases_poc_id_fkey" FOREIGN KEY ("poc_id") REFERENCES "pocs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

