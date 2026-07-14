-- CreateTable
CREATE TABLE "iakb_task_configs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "task_type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "iakb_task_configs_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE UNIQUE INDEX "iakb_task_configs_tenant_id_task_type_key" ON "iakb_task_configs"("tenant_id", "task_type");
-- AddForeignKey
ALTER TABLE "iakb_task_configs" ADD CONSTRAINT "iakb_task_configs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
