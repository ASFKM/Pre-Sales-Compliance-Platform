-- CreateEnum
CREATE TYPE "PocAcceptanceDecision" AS ENUM ('pending', 'won', 'lost');

-- CreateTable
CREATE TABLE "poc_acceptances" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "poc_id" TEXT NOT NULL,
    "decision" "PocAcceptanceDecision" NOT NULL DEFAULT 'pending',
    "signed_document_storage_provider" "StorageProvider",
    "signed_document_storage_path" TEXT,
    "signed_document_original_filename" TEXT,
    "signed_by" TEXT,
    "signed_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "poc_acceptances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "poc_acceptances_poc_id_key" ON "poc_acceptances"("poc_id");

-- CreateIndex
CREATE INDEX "poc_acceptances_tenant_id_idx" ON "poc_acceptances"("tenant_id");

-- AddForeignKey
ALTER TABLE "poc_acceptances" ADD CONSTRAINT "poc_acceptances_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "poc_acceptances" ADD CONSTRAINT "poc_acceptances_poc_id_fkey" FOREIGN KEY ("poc_id") REFERENCES "pocs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

