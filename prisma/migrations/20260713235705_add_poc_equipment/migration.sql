-- CreateEnum
CREATE TYPE "PocEquipmentStatus" AS ENUM ('shipped', 'at_customer', 'returned');

-- CreateTable
CREATE TABLE "poc_equipment_items" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "poc_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "serial_number" TEXT,
    "status" "PocEquipmentStatus" NOT NULL DEFAULT 'shipped',
    "shipping_invoice_storage_provider" "StorageProvider",
    "shipping_invoice_storage_path" TEXT,
    "shipping_invoice_original_filename" TEXT,
    "return_invoice_storage_provider" "StorageProvider",
    "return_invoice_storage_path" TEXT,
    "return_invoice_original_filename" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "poc_equipment_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "poc_equipment_items_tenant_id_idx" ON "poc_equipment_items"("tenant_id");

-- CreateIndex
CREATE INDEX "poc_equipment_items_poc_id_idx" ON "poc_equipment_items"("poc_id");

-- AddForeignKey
ALTER TABLE "poc_equipment_items" ADD CONSTRAINT "poc_equipment_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "poc_equipment_items" ADD CONSTRAINT "poc_equipment_items_poc_id_fkey" FOREIGN KEY ("poc_id") REFERENCES "pocs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

