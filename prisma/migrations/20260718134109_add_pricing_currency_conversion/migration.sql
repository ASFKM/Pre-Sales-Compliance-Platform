-- AlterTable
ALTER TABLE "price_catalog_items" ADD COLUMN     "current_list_price_usd" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "price_history_entries" ADD COLUMN     "list_price_usd" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "tenant_pricing_settings" ADD COLUMN     "usd_brl_exchange_rate" DOUBLE PRECISION NOT NULL DEFAULT 5.0;
