-- CreateEnum
CREATE TYPE "DeploymentMode" AS ENUM ('saas', 'onprem');
CREATE TYPE "TenantStatus" AS ENUM ('active', 'suspended');

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "deployment_mode" "DeploymentMode" NOT NULL DEFAULT 'onprem',
    "status" "TenantStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- Seed the single default tenant every existing row backfills to. This is the same
-- tenant_default row prisma/seed.ts creates on a fresh database, so seeding stays
-- idempotent whether it runs before or after this migration.
INSERT INTO "tenants" ("id", "name", "deployment_mode", "status", "created_at", "updated_at")
VALUES ('tenant_default', 'AI Pre-Sales Solutions LLC', 'onprem', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- AlterTable: roles
ALTER TABLE "roles" ADD COLUMN "tenant_id" TEXT;
UPDATE "roles" SET "tenant_id" = 'tenant_default';
ALTER TABLE "roles" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "roles_tenant_id_idx" ON "roles"("tenant_id");

-- AlterTable: users
ALTER TABLE "users" ADD COLUMN "tenant_id" TEXT;
UPDATE "users" SET "tenant_id" = 'tenant_default';
ALTER TABLE "users" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "users_tenant_id_idx" ON "users"("tenant_id");

-- AlterTable: projects
ALTER TABLE "projects" ADD COLUMN "tenant_id" TEXT;
UPDATE "projects" SET "tenant_id" = 'tenant_default';
ALTER TABLE "projects" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "projects" ADD CONSTRAINT "projects_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "projects_tenant_id_idx" ON "projects"("tenant_id");

-- AlterTable: documents
ALTER TABLE "documents" ADD COLUMN "tenant_id" TEXT;
UPDATE "documents" SET "tenant_id" = 'tenant_default';
ALTER TABLE "documents" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "documents_tenant_id_idx" ON "documents"("tenant_id");

-- AlterTable: document_contents
ALTER TABLE "document_contents" ADD COLUMN "tenant_id" TEXT;
UPDATE "document_contents" SET "tenant_id" = 'tenant_default';
ALTER TABLE "document_contents" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "document_contents" ADD CONSTRAINT "document_contents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "document_contents_tenant_id_idx" ON "document_contents"("tenant_id");

-- AlterTable: analysis_jobs
ALTER TABLE "analysis_jobs" ADD COLUMN "tenant_id" TEXT;
UPDATE "analysis_jobs" SET "tenant_id" = 'tenant_default';
ALTER TABLE "analysis_jobs" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "analysis_jobs" ADD CONSTRAINT "analysis_jobs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "analysis_jobs_tenant_id_idx" ON "analysis_jobs"("tenant_id");

-- AlterTable: analysis_results
ALTER TABLE "analysis_results" ADD COLUMN "tenant_id" TEXT;
UPDATE "analysis_results" SET "tenant_id" = 'tenant_default';
ALTER TABLE "analysis_results" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "analysis_results" ADD CONSTRAINT "analysis_results_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "analysis_results_tenant_id_idx" ON "analysis_results"("tenant_id");

-- AlterTable: conversation_messages
ALTER TABLE "conversation_messages" ADD COLUMN "tenant_id" TEXT;
UPDATE "conversation_messages" SET "tenant_id" = 'tenant_default';
ALTER TABLE "conversation_messages" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "conversation_messages_tenant_id_idx" ON "conversation_messages"("tenant_id");

-- AlterTable: audit_logs
ALTER TABLE "audit_logs" ADD COLUMN "tenant_id" TEXT;
UPDATE "audit_logs" SET "tenant_id" = 'tenant_default';
ALTER TABLE "audit_logs" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "audit_logs_tenant_id_idx" ON "audit_logs"("tenant_id");

-- AlterTable: debug_logs (nullable - some diagnostic events genuinely have no tenant yet)
ALTER TABLE "debug_logs" ADD COLUMN "tenant_id" TEXT;
UPDATE "debug_logs" SET "tenant_id" = 'tenant_default';
ALTER TABLE "debug_logs" ADD CONSTRAINT "debug_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "debug_logs_tenant_id_idx" ON "debug_logs"("tenant_id");

-- AlterTable: platform_settings (was a fixed "singleton" row, now one row per tenant)
ALTER TABLE "platform_settings" ADD COLUMN "tenant_id" TEXT;
UPDATE "platform_settings" SET "tenant_id" = 'tenant_default';
ALTER TABLE "platform_settings" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "platform_settings_tenant_id_key" ON "platform_settings"("tenant_id");

-- AlterTable: prompt_templates
ALTER TABLE "prompt_templates" ADD COLUMN "tenant_id" TEXT;
UPDATE "prompt_templates" SET "tenant_id" = 'tenant_default';
ALTER TABLE "prompt_templates" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "prompt_templates" ADD CONSTRAINT "prompt_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "prompt_templates_tenant_id_idx" ON "prompt_templates"("tenant_id");

-- AlterTable: proposal_templates
ALTER TABLE "proposal_templates" ADD COLUMN "tenant_id" TEXT;
UPDATE "proposal_templates" SET "tenant_id" = 'tenant_default';
ALTER TABLE "proposal_templates" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "proposal_templates" ADD CONSTRAINT "proposal_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "proposal_templates_tenant_id_idx" ON "proposal_templates"("tenant_id");

-- AlterTable: proposals
ALTER TABLE "proposals" ADD COLUMN "tenant_id" TEXT;
UPDATE "proposals" SET "tenant_id" = 'tenant_default';
ALTER TABLE "proposals" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "proposals_tenant_id_idx" ON "proposals"("tenant_id");

-- AlterTable: approval_workflows
ALTER TABLE "approval_workflows" ADD COLUMN "tenant_id" TEXT;
UPDATE "approval_workflows" SET "tenant_id" = 'tenant_default';
ALTER TABLE "approval_workflows" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "approval_workflows" ADD CONSTRAINT "approval_workflows_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "approval_workflows_tenant_id_idx" ON "approval_workflows"("tenant_id");

-- AlterTable: approval_stages
ALTER TABLE "approval_stages" ADD COLUMN "tenant_id" TEXT;
UPDATE "approval_stages" SET "tenant_id" = 'tenant_default';
ALTER TABLE "approval_stages" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "approval_stages" ADD CONSTRAINT "approval_stages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "approval_stages_tenant_id_idx" ON "approval_stages"("tenant_id");

-- AlterTable: approval_decisions
ALTER TABLE "approval_decisions" ADD COLUMN "tenant_id" TEXT;
UPDATE "approval_decisions" SET "tenant_id" = 'tenant_default';
ALTER TABLE "approval_decisions" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "approval_decisions_tenant_id_idx" ON "approval_decisions"("tenant_id");

-- AlterTable: tasks
ALTER TABLE "tasks" ADD COLUMN "tenant_id" TEXT;
UPDATE "tasks" SET "tenant_id" = 'tenant_default';
ALTER TABLE "tasks" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "tasks_tenant_id_idx" ON "tasks"("tenant_id");

-- AlterTable: branding_settings (was a fixed "singleton" row, now one row per tenant)
ALTER TABLE "branding_settings" ADD COLUMN "tenant_id" TEXT;
UPDATE "branding_settings" SET "tenant_id" = 'tenant_default';
ALTER TABLE "branding_settings" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "branding_settings" ADD CONSTRAINT "branding_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "branding_settings_tenant_id_key" ON "branding_settings"("tenant_id");

-- AlterTable: integration_connectors
ALTER TABLE "integration_connectors" ADD COLUMN "tenant_id" TEXT;
UPDATE "integration_connectors" SET "tenant_id" = 'tenant_default';
ALTER TABLE "integration_connectors" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "integration_connectors" ADD CONSTRAINT "integration_connectors_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "integration_connectors_tenant_id_idx" ON "integration_connectors"("tenant_id");
