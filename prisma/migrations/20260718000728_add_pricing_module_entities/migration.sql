-- CreateEnum
CREATE TYPE "PriceItemType" AS ENUM ('merchandise', 'service');

-- CreateEnum
CREATE TYPE "PriceListUploadStatus" AS ENUM ('processing', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "PricingMatchStatus" AS ENUM ('matched', 'manual', 'unmatched');

-- CreateEnum
CREATE TYPE "PricingSheetStatus" AS ENUM ('draft', 'finalized');

-- CreateTable
CREATE TABLE "price_catalog_items" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "item_code" TEXT NOT NULL,
    "erp_code" TEXT,
    "ncm_code" TEXT,
    "item_type" "PriceItemType",
    "category" TEXT NOT NULL,
    "pn" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "current_list_price" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "markup_min" DOUBLE PRECISION NOT NULL,
    "markup_max" DOUBLE PRECISION NOT NULL,
    "ipi_rate_percent" DOUBLE PRECISION,
    "iss_rate_percent" DOUBLE PRECISION,
    "st_applicable" BOOLEAN NOT NULL DEFAULT false,
    "vendor" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "price_catalog_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_list_uploads" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "uploaded_by_user_id" TEXT NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "file_name" TEXT NOT NULL,
    "effective_date" TIMESTAMP(3) NOT NULL,
    "status" "PriceListUploadStatus" NOT NULL DEFAULT 'processing',
    "source_label" TEXT,

    CONSTRAINT "price_list_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_history_entries" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "price_list_upload_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "list_price" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL,
    "markup_min" DOUBLE PRECISION NOT NULL,
    "markup_max" DOUBLE PRECISION NOT NULL,
    "effective_date" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_history_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_alias_mappings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "raw_pn" TEXT NOT NULL,
    "raw_description" TEXT,
    "resolved_item_id" TEXT,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL,
    "times_seen" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "item_alias_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_pricing_sheets" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "source_analysis_result_id" TEXT NOT NULL,
    "target_budget" DOUBLE PRECISION,
    "target_budget_basis" TEXT,
    "destination_uf" TEXT,
    "destination_taxpayer_type" TEXT,
    "status" "PricingSheetStatus" NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_pricing_sheets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_pricing_lines" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "pricing_sheet_id" TEXT NOT NULL,
    "bom_item_id" TEXT NOT NULL,
    "raw_part_number" TEXT,
    "raw_description" TEXT,
    "matched_item_id" TEXT,
    "match_status" "PricingMatchStatus" NOT NULL DEFAULT 'unmatched',
    "quantity" DOUBLE PRECISION NOT NULL,
    "list_price_snapshot" DOUBLE PRECISION,
    "discount_percent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "final_unit_price" DOUBLE PRECISION,
    "margin_percent" DOUBLE PRECISION,
    "icms_rate_percent" DOUBLE PRECISION,
    "ipi_rate_percent" DOUBLE PRECISION,
    "pis_cofins_rate_percent" DOUBLE PRECISION,
    "iss_rate_percent" DOUBLE PRECISION,
    "st_flag" BOOLEAN NOT NULL DEFAULT false,
    "total_tax_percent" DOUBLE PRECISION,
    "final_price_with_tax" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_pricing_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_optimization_runs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "pricing_sheet_id" TEXT NOT NULL,
    "target_budget" DOUBLE PRECISION NOT NULL,
    "strategy" TEXT NOT NULL,
    "requested_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "result_summary" JSONB NOT NULL,

    CONSTRAINT "budget_optimization_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_pricing_settings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "tax_calculation_enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_pricing_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "price_catalog_items_tenant_id_idx" ON "price_catalog_items"("tenant_id");

-- CreateIndex
CREATE INDEX "price_catalog_items_tenant_id_pn_idx" ON "price_catalog_items"("tenant_id", "pn");

-- CreateIndex
CREATE UNIQUE INDEX "price_catalog_items_tenant_id_item_code_key" ON "price_catalog_items"("tenant_id", "item_code");

-- CreateIndex
CREATE INDEX "price_list_uploads_tenant_id_idx" ON "price_list_uploads"("tenant_id");

-- CreateIndex
CREATE INDEX "price_history_entries_tenant_id_idx" ON "price_history_entries"("tenant_id");

-- CreateIndex
CREATE INDEX "price_history_entries_item_id_idx" ON "price_history_entries"("item_id");

-- CreateIndex
CREATE INDEX "item_alias_mappings_tenant_id_idx" ON "item_alias_mappings"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "item_alias_mappings_tenant_id_raw_pn_key" ON "item_alias_mappings"("tenant_id", "raw_pn");

-- CreateIndex
CREATE INDEX "project_pricing_sheets_tenant_id_idx" ON "project_pricing_sheets"("tenant_id");

-- CreateIndex
CREATE INDEX "project_pricing_sheets_project_id_idx" ON "project_pricing_sheets"("project_id");

-- CreateIndex
CREATE INDEX "project_pricing_lines_tenant_id_idx" ON "project_pricing_lines"("tenant_id");

-- CreateIndex
CREATE INDEX "project_pricing_lines_pricing_sheet_id_idx" ON "project_pricing_lines"("pricing_sheet_id");

-- CreateIndex
CREATE INDEX "budget_optimization_runs_tenant_id_idx" ON "budget_optimization_runs"("tenant_id");

-- CreateIndex
CREATE INDEX "budget_optimization_runs_pricing_sheet_id_idx" ON "budget_optimization_runs"("pricing_sheet_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_pricing_settings_tenant_id_key" ON "tenant_pricing_settings"("tenant_id");

-- AddForeignKey
ALTER TABLE "price_catalog_items" ADD CONSTRAINT "price_catalog_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_list_uploads" ADD CONSTRAINT "price_list_uploads_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_list_uploads" ADD CONSTRAINT "price_list_uploads_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_history_entries" ADD CONSTRAINT "price_history_entries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_history_entries" ADD CONSTRAINT "price_history_entries_price_list_upload_id_fkey" FOREIGN KEY ("price_list_upload_id") REFERENCES "price_list_uploads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_history_entries" ADD CONSTRAINT "price_history_entries_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "price_catalog_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_alias_mappings" ADD CONSTRAINT "item_alias_mappings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_alias_mappings" ADD CONSTRAINT "item_alias_mappings_resolved_item_id_fkey" FOREIGN KEY ("resolved_item_id") REFERENCES "price_catalog_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_pricing_sheets" ADD CONSTRAINT "project_pricing_sheets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_pricing_sheets" ADD CONSTRAINT "project_pricing_sheets_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_pricing_sheets" ADD CONSTRAINT "project_pricing_sheets_source_analysis_result_id_fkey" FOREIGN KEY ("source_analysis_result_id") REFERENCES "analysis_results"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_pricing_lines" ADD CONSTRAINT "project_pricing_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_pricing_lines" ADD CONSTRAINT "project_pricing_lines_pricing_sheet_id_fkey" FOREIGN KEY ("pricing_sheet_id") REFERENCES "project_pricing_sheets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_pricing_lines" ADD CONSTRAINT "project_pricing_lines_matched_item_id_fkey" FOREIGN KEY ("matched_item_id") REFERENCES "price_catalog_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_optimization_runs" ADD CONSTRAINT "budget_optimization_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_optimization_runs" ADD CONSTRAINT "budget_optimization_runs_pricing_sheet_id_fkey" FOREIGN KEY ("pricing_sheet_id") REFERENCES "project_pricing_sheets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_optimization_runs" ADD CONSTRAINT "budget_optimization_runs_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_pricing_settings" ADD CONSTRAINT "tenant_pricing_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
