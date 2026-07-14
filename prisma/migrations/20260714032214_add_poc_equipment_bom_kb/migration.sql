
-- AlterTable
ALTER TABLE "poc_equipment_items" ADD COLUMN     "datasheet_knowledge_base_document_id" TEXT,
ADD COLUMN     "kb_match_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "manufacturer" TEXT,
ADD COLUMN     "part_number" TEXT,
ADD COLUMN     "source_bom_item_id" TEXT;

-- CreateIndex
CREATE INDEX "poc_equipment_items_datasheet_knowledge_base_document_id_idx" ON "poc_equipment_items"("datasheet_knowledge_base_document_id");

-- AddForeignKey
ALTER TABLE "poc_equipment_items" ADD CONSTRAINT "poc_equipment_items_datasheet_knowledge_base_document_id_fkey" FOREIGN KEY ("datasheet_knowledge_base_document_id") REFERENCES "knowledge_base_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

