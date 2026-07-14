-- AlterTable
ALTER TABLE "poc_equipment_items" ADD COLUMN     "tracking_carrier_status" TEXT,
ADD COLUMN     "tracking_code" TEXT,
ADD COLUMN     "tracking_last_checked_at" TIMESTAMP(3);

