-- CreateEnum
CREATE TYPE "BackgroundTaskType" AS ENUM ('document_analysis', 'proposal_generation', 'project_intake_analysis');

-- CreateEnum
CREATE TYPE "BackgroundTaskStatus" AS ENUM ('queued', 'running', 'completed', 'failed');

-- AlterTable
ALTER TABLE "branding_settings" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "platform_settings" ALTER COLUMN "id" DROP DEFAULT;

-- CreateTable
CREATE TABLE "background_tasks" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "BackgroundTaskType" NOT NULL,
    "status" "BackgroundTaskStatus" NOT NULL DEFAULT 'queued',
    "current_step" TEXT NOT NULL,
    "progress_pct" INTEGER,
    "error_message" TEXT,
    "result_type" TEXT,
    "result_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "background_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "background_tasks_tenant_id_idx" ON "background_tasks"("tenant_id");

-- CreateIndex
CREATE INDEX "background_tasks_user_id_idx" ON "background_tasks"("user_id");

-- AddForeignKey
ALTER TABLE "background_tasks" ADD CONSTRAINT "background_tasks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
