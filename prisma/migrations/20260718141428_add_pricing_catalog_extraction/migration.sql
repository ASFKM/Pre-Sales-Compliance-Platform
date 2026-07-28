-- CreateEnum
CREATE TYPE "PriceUpdateSource" AS ENUM ('spreadsheet', 'supplier_quote');

-- CreateEnum
CREATE TYPE "PriceCatalogExtractionDraftStatus" AS ENUM ('pending', 'edited', 'confirmed', 'rejected');

-- AlterEnum
ALTER TYPE "PriceListUploadStatus" ADD VALUE 'pending_review';

-- AlterTable
ALTER TABLE "platform_settings" ADD COLUMN     "pricing_catalog_extraction_model" TEXT NOT NULL DEFAULT 'gemini-3.5-flash',
ADD COLUMN     "pricing_catalog_extraction_provider" TEXT NOT NULL DEFAULT 'gemini';

-- AlterTable
ALTER TABLE "price_catalog_items" ADD COLUMN     "last_update_source" "PriceUpdateSource" NOT NULL DEFAULT 'spreadsheet',
ADD COLUMN     "last_update_supplier_name" TEXT;

-- AlterTable
ALTER TABLE "price_history_entries" ADD COLUMN     "supplier_name" TEXT,
ADD COLUMN     "update_source" "PriceUpdateSource" NOT NULL DEFAULT 'spreadsheet';

-- CreateTable
CREATE TABLE "price_catalog_extraction_drafts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "price_list_upload_id" TEXT NOT NULL,
    "row_index_in_file" INTEGER NOT NULL,
    "item_code" TEXT,
    "category" TEXT,
    "pn" TEXT NOT NULL,
    "erp_code" TEXT,
    "description" TEXT NOT NULL,
    "list_price_brl" DOUBLE PRECISION,
    "list_price_usd" DOUBLE PRECISION,
    "source_currency" TEXT NOT NULL,
    "markup_min" DOUBLE PRECISION,
    "markup_max" DOUBLE PRECISION,
    "supplier_name" TEXT,
    "confidence_note" TEXT,
    "status" "PriceCatalogExtractionDraftStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "price_catalog_extraction_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "price_catalog_extraction_drafts_tenant_id_idx" ON "price_catalog_extraction_drafts"("tenant_id");

-- CreateIndex
CREATE INDEX "price_catalog_extraction_drafts_price_list_upload_id_idx" ON "price_catalog_extraction_drafts"("price_list_upload_id");

-- AddForeignKey
ALTER TABLE "price_catalog_extraction_drafts" ADD CONSTRAINT "price_catalog_extraction_drafts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_catalog_extraction_drafts" ADD CONSTRAINT "price_catalog_extraction_drafts_price_list_upload_id_fkey" FOREIGN KEY ("price_list_upload_id") REFERENCES "price_list_uploads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
