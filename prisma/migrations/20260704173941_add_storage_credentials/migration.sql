-- AlterTable
ALTER TABLE "platform_settings" ADD COLUMN     "gcs_project_id" TEXT,
ADD COLUMN     "gcs_service_account_key_encrypted" TEXT,
ADD COLUMN     "s3_access_key_id" TEXT,
ADD COLUMN     "s3_region" TEXT,
ADD COLUMN     "s3_secret_access_key_encrypted" TEXT;
