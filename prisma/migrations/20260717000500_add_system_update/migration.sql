ALTER TYPE "BackgroundTaskType" ADD VALUE 'system_update';

ALTER TABLE "background_tasks" ALTER COLUMN "user_id" DROP NOT NULL;

CREATE TYPE "SystemUpdateAttemptStatus" AS ENUM ('none', 'in_progress', 'success', 'failed', 'rolled_back');
CREATE TYPE "SystemUpdateTrigger" AS ENUM ('scheduled', 'manual', 'remote_command');

CREATE TABLE "system_update_state" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "current_version" TEXT,
    "current_git_sha" TEXT,
    "last_checked_at" TIMESTAMP(3),
    "latest_release_id" TEXT,
    "latest_release_version" TEXT,
    "latest_release_channel" TEXT,
    "latest_release_code_ref" TEXT,
    "latest_release_published_at" TIMESTAMP(3),
    "latest_release_notes_md" TEXT,
    "scheduled_update_at" TIMESTAMP(3),
    "scheduled_release_id" TEXT,
    "scheduled_code_ref" TEXT,
    "last_attempt_status" "SystemUpdateAttemptStatus" NOT NULL DEFAULT 'none',
    "last_attempt_started_at" TIMESTAMP(3),
    "last_attempt_finished_at" TIMESTAMP(3),
    "last_attempt_from_version" TEXT,
    "last_attempt_to_version" TEXT,
    "last_attempt_error_log" TEXT,
    "last_attempt_error_reported_at" TIMESTAMP(3),
    "backup_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_update_state_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "system_update_state_tenant_id_key" ON "system_update_state"("tenant_id");

ALTER TABLE "system_update_state" ADD CONSTRAINT "system_update_state_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "system_update_history" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "from_version" TEXT,
    "to_version" TEXT NOT NULL,
    "from_code_ref" TEXT,
    "to_code_ref" TEXT NOT NULL,
    "release_id" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL,
    "finished_at" TIMESTAMP(3),
    "status" "SystemUpdateAttemptStatus" NOT NULL,
    "triggered_by" "SystemUpdateTrigger" NOT NULL,
    "error_log" TEXT,
    "backup_ref" TEXT,
    "background_task_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_update_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "system_update_history_tenant_id_created_at_idx" ON "system_update_history"("tenant_id", "created_at");

ALTER TABLE "system_update_history" ADD CONSTRAINT "system_update_history_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
