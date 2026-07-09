-- CreateEnum
CREATE TYPE "KnowledgeBaseEntryCategory" AS ENUM ('bom_part_number', 'engineering_note', 'compliance_status', 'datasheet');

-- CreateEnum
CREATE TYPE "KnowledgeBaseEntryStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "KnowledgeBaseEntrySource" AS ENUM ('reactive_edit', 'uploaded_document');

-- CreateTable
CREATE TABLE "knowledge_base_documents" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "original_filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "storage_provider" "StorageProvider" NOT NULL,
    "storage_path" TEXT NOT NULL,
    "uploaded_by" TEXT NOT NULL,
    "analyzed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_base_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_base_entries" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "category" "KnowledgeBaseEntryCategory" NOT NULL,
    "trigger" TEXT NOT NULL,
    "knowledge" TEXT NOT NULL,
    "status" "KnowledgeBaseEntryStatus" NOT NULL DEFAULT 'pending',
    "source" "KnowledgeBaseEntrySource" NOT NULL,
    "source_project_id" TEXT,
    "source_project_name" TEXT,
    "source_document_id" TEXT,
    "source_document_name" TEXT,
    "created_by" TEXT NOT NULL,
    "reviewed_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMP(3),

    CONSTRAINT "knowledge_base_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "knowledge_base_documents_tenant_id_idx" ON "knowledge_base_documents"("tenant_id");

-- CreateIndex
CREATE INDEX "knowledge_base_entries_tenant_id_idx" ON "knowledge_base_entries"("tenant_id");

-- CreateIndex
CREATE INDEX "knowledge_base_entries_status_idx" ON "knowledge_base_entries"("status");

-- AddForeignKey
ALTER TABLE "knowledge_base_documents" ADD CONSTRAINT "knowledge_base_documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_base_entries" ADD CONSTRAINT "knowledge_base_entries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

