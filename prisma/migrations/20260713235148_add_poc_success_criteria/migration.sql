-- CreateTable
CREATE TABLE "poc_success_criteria" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "poc_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "poc_success_criteria_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "poc_success_criteria_tenant_id_idx" ON "poc_success_criteria"("tenant_id");

-- CreateIndex
CREATE INDEX "poc_success_criteria_poc_id_idx" ON "poc_success_criteria"("poc_id");

-- AddForeignKey
ALTER TABLE "poc_success_criteria" ADD CONSTRAINT "poc_success_criteria_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "poc_success_criteria" ADD CONSTRAINT "poc_success_criteria_poc_id_fkey" FOREIGN KEY ("poc_id") REFERENCES "pocs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

