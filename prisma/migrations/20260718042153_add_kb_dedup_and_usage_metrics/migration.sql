-- AlterTable
ALTER TABLE "knowledge_base_documents" ADD COLUMN     "content_hash" TEXT;

-- AlterTable
ALTER TABLE "knowledge_base_entries" ADD COLUMN     "last_matched_at" TIMESTAMP(3),
ADD COLUMN     "match_count" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "knowledge_base_documents_tenant_id_content_hash_idx" ON "knowledge_base_documents"("tenant_id", "content_hash");
