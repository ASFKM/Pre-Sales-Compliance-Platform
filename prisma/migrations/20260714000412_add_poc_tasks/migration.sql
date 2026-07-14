-- CreateEnum
CREATE TYPE "PocTaskStatus" AS ENUM ('planned', 'in_progress', 'done');

-- CreateTable
CREATE TABLE "poc_tasks" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "poc_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "duration_days" INTEGER NOT NULL DEFAULT 1,
    "status" "PocTaskStatus" NOT NULL DEFAULT 'planned',
    "depends_on_task_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "poc_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "poc_tasks_tenant_id_idx" ON "poc_tasks"("tenant_id");

-- CreateIndex
CREATE INDEX "poc_tasks_poc_id_idx" ON "poc_tasks"("poc_id");

-- AddForeignKey
ALTER TABLE "poc_tasks" ADD CONSTRAINT "poc_tasks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "poc_tasks" ADD CONSTRAINT "poc_tasks_poc_id_fkey" FOREIGN KEY ("poc_id") REFERENCES "pocs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "poc_tasks" ADD CONSTRAINT "poc_tasks_depends_on_task_id_fkey" FOREIGN KEY ("depends_on_task_id") REFERENCES "poc_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

