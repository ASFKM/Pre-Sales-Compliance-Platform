-- AlterTable: platform_settings - Phase 7 (fleet/license management). Each tenant registers
-- with the vendor's fleet manager independently (an on-prem tenant is its own "customer" there;
-- a SaaS tenant is too, even though many share the same physical deployment - modules like
-- POC/CRM are purchased per customer, not per shared infrastructure).
ALTER TABLE "platform_settings" ADD COLUMN "fleet_manager_url" TEXT;
ALTER TABLE "platform_settings" ADD COLUMN "fleet_manager_api_key_encrypted" TEXT;
ALTER TABLE "platform_settings" ADD COLUMN "fleet_manager_enabled" BOOLEAN NOT NULL DEFAULT false;
