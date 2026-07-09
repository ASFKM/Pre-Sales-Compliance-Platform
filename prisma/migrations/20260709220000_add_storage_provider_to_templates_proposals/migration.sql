-- AlterTable
ALTER TABLE "proposal_templates" ADD COLUMN     "storage_provider" "StorageProvider" NOT NULL DEFAULT 'local';

-- AlterTable
ALTER TABLE "proposals" ADD COLUMN     "storage_provider" "StorageProvider" NOT NULL DEFAULT 'local';
