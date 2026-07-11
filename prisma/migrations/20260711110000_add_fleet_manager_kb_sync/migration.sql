-- AlterEnum
ALTER TYPE "KnowledgeBaseEntrySource" ADD VALUE 'fleet_manager_global';

-- AlterTable
ALTER TABLE "knowledge_base_entries" ADD COLUMN "fleet_global_entry_id" TEXT;
ALTER TABLE "knowledge_base_entries" ADD COLUMN "synced_to_fleet_at" TIMESTAMP(3);
