-- DropForeignKey
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_project_id_fkey";

-- AlterTable
ALTER TABLE "tasks" ALTER COLUMN "project_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "tasks_owner_user_id_idx" ON "tasks"("owner_user_id");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
