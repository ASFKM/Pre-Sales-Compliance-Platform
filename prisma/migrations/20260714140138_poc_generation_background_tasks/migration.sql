-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.
ALTER TYPE "BackgroundTaskType" ADD VALUE 'poc_test_generation';
ALTER TYPE "BackgroundTaskType" ADD VALUE 'poc_schedule_generation';
-- AlterTable
ALTER TABLE "background_tasks" ADD COLUMN     "warning_message" TEXT;
