-- AlterTable
ALTER TABLE "integration_connectors" ADD COLUMN     "api_key_encrypted" TEXT,
ADD COLUMN     "webhook_secret_encrypted" TEXT;
