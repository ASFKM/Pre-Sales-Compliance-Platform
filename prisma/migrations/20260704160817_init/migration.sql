-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'PENDING');

-- CreateEnum
CREATE TYPE "Language" AS ENUM ('Portuguese', 'English', 'Spanish');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('draft', 'analysis_in_progress', 'waiting_customer', 'waiting_internal', 'completed', 'canceled');

-- CreateEnum
CREATE TYPE "StorageProvider" AS ENUM ('local', 's3', 'gcs');

-- CreateEnum
CREATE TYPE "AnalysisJobStatus" AS ENUM ('idle', 'running', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('pending', 'reviewed', 'approved');

-- CreateEnum
CREATE TYPE "ConversationRole" AS ENUM ('user', 'model');

-- CreateEnum
CREATE TYPE "LogLevel" AS ENUM ('TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL');

-- CreateEnum
CREATE TYPE "ProposalTemplateType" AS ENUM ('technical', 'commercial', 'executive_summary', 'risk_report', 'bom_report', 'questions_report');

-- CreateEnum
CREATE TYPE "ProposalFileType" AS ENUM ('docx', 'doc', 'pdf');

-- CreateEnum
CREATE TYPE "ProposalType" AS ENUM ('technical', 'commercial');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('draft', 'submitted', 'approved', 'rejected', 'released');

-- CreateEnum
CREATE TYPE "ApproverType" AS ENUM ('user', 'role');

-- CreateEnum
CREATE TYPE "ApprovalDecisionType" AS ENUM ('approved', 'rejected');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('open', 'in_progress', 'waiting_customer', 'waiting_internal', 'completed', 'canceled');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('high', 'medium', 'low');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('connected', 'disconnected', 'error');

-- CreateEnum
CREATE TYPE "Theme" AS ENUM ('light', 'dark');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT,
    "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "mfa_totp_secret" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "role_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_login_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "permissions" TEXT[],

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "customer_name" TEXT NOT NULL,
    "opportunity_name" TEXT NOT NULL,
    "vertical" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "ProjectStatus" NOT NULL,
    "deadline" TIMESTAMP(3) NOT NULL,
    "proposal_validity_date" TIMESTAMP(3) NOT NULL,
    "owner_user_id" TEXT NOT NULL,
    "output_language" "Language" NOT NULL,
    "proposal_language" "Language" NOT NULL,
    "ai_orientation_mode" TEXT NOT NULL,
    "ai_orientation_text" TEXT NOT NULL,
    "selected_approval_workflow_id" TEXT,
    "procurement_modality" TEXT,
    "procurement_subtype" TEXT,
    "custom_modality" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "original_filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "storage_provider" "StorageProvider" NOT NULL,
    "storage_path" TEXT NOT NULL,
    "detected_document_type" TEXT NOT NULL,
    "manual_document_type" TEXT,
    "ai_classification_confidence" DOUBLE PRECISION NOT NULL,
    "version" INTEGER NOT NULL,
    "language" TEXT NOT NULL,
    "uploaded_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_contents" (
    "document_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,

    CONSTRAINT "document_contents_pkey" PRIMARY KEY ("document_id")
);

-- CreateTable
CREATE TABLE "analysis_jobs" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "status" "AnalysisJobStatus" NOT NULL,
    "ai_provider" TEXT NOT NULL,
    "ai_model" TEXT NOT NULL,
    "prompt_template_version" TEXT NOT NULL,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "error_message" TEXT,
    "token_input" INTEGER,
    "token_output" INTEGER,
    "estimated_cost" DOUBLE PRECISION,
    "created_by" TEXT NOT NULL,
    "correlation_id" TEXT NOT NULL,

    CONSTRAINT "analysis_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analysis_results" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "executive_summary" JSONB NOT NULL,
    "critical_requirements" JSONB NOT NULL,
    "risks" JSONB NOT NULL,
    "opportunities" JSONB NOT NULL,
    "bom" JSONB NOT NULL,
    "point_to_point_table" JSONB NOT NULL,
    "preliminary_schedule" JSONB NOT NULL,
    "clarification_questions" JSONB NOT NULL,
    "technical_proposal_draft" TEXT NOT NULL,
    "commercial_proposal_draft" TEXT NOT NULL,
    "review_status" "ReviewStatus" NOT NULL DEFAULT 'pending',
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "analysis_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_messages" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "ConversationRole" NOT NULL,
    "message" TEXT NOT NULL,
    "ai_provider" TEXT NOT NULL,
    "ai_model" TEXT NOT NULL,
    "prompt_template_version" TEXT NOT NULL,
    "input_summary" TEXT NOT NULL,
    "output_summary" TEXT NOT NULL,
    "token_input" INTEGER NOT NULL,
    "token_output" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "project_id" TEXT,
    "ip_address" TEXT NOT NULL,
    "user_agent" TEXT NOT NULL,
    "metadata" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "debug_logs" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "log_level" "LogLevel" NOT NULL,
    "service_name" TEXT NOT NULL,
    "module_name" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "user_id" TEXT,
    "project_id" TEXT,
    "document_id" TEXT,
    "analysis_job_id" TEXT,
    "proposal_id" TEXT,
    "operation" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "error_code" TEXT,
    "error_message" TEXT,
    "safe_metadata" TEXT NOT NULL,

    CONSTRAINT "debug_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "ai_provider" TEXT NOT NULL,
    "default_model" TEXT NOT NULL,
    "document_analysis_model" TEXT NOT NULL,
    "proposal_generation_model" TEXT NOT NULL,
    "summarization_model" TEXT NOT NULL,
    "risk_analysis_model" TEXT NOT NULL,
    "ai_api_key_encrypted" TEXT,
    "storage_mode" "StorageProvider" NOT NULL DEFAULT 'local',
    "local_storage_path" TEXT NOT NULL,
    "s3_bucket" TEXT NOT NULL,
    "gcs_bucket" TEXT NOT NULL,
    "default_language" "Language" NOT NULL,
    "default_log_level" "LogLevel" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "language" "Language" NOT NULL,
    "version" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prompt_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposal_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "template_type" "ProposalTemplateType" NOT NULL,
    "language" "Language" NOT NULL,
    "file_type" "ProposalFileType" NOT NULL,
    "file_path" TEXT NOT NULL,
    "variables_schema" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "default_template" BOOLEAN NOT NULL DEFAULT false,
    "uploaded_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "proposal_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposals" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "proposal_type" "ProposalType" NOT NULL,
    "template_id" TEXT NOT NULL,
    "template_version" TEXT NOT NULL,
    "status" "ProposalStatus" NOT NULL DEFAULT 'draft',
    "language" "Language" NOT NULL,
    "docx_file_path" TEXT NOT NULL,
    "pdf_file_path" TEXT NOT NULL,
    "generated_by" TEXT NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL,
    "approval_workflow_id" TEXT NOT NULL,
    "manual_pricing_table" JSONB,
    "payment_terms" TEXT,
    "delivery_terms" TEXT,
    "proposal_validity" TEXT,
    "commercial_assumptions" TEXT,
    "exclusions" TEXT,

    CONSTRAINT "proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_workflows" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "applies_to" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_workflows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_stages" (
    "id" TEXT NOT NULL,
    "workflow_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "approver_type" "ApproverType" NOT NULL,
    "approver_user_id" TEXT,
    "approver_role_id" TEXT,
    "mandatory" BOOLEAN NOT NULL DEFAULT true,
    "conditions" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_decisions" (
    "id" TEXT NOT NULL,
    "proposal_id" TEXT NOT NULL,
    "stage_id" TEXT NOT NULL,
    "approver_user_id" TEXT NOT NULL,
    "decision" "ApprovalDecisionType" NOT NULL,
    "comments" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "owner_user_id" TEXT NOT NULL,
    "due_date" TIMESTAMP(3) NOT NULL,
    "status" "TaskStatus" NOT NULL,
    "priority" "Priority" NOT NULL,
    "related_analysis_item" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branding_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "company_name" TEXT NOT NULL,
    "company_logo_path" TEXT NOT NULL,
    "login_logo_path" TEXT NOT NULL,
    "sidebar_logo_path" TEXT NOT NULL,
    "report_logo_path" TEXT NOT NULL,
    "favicon_path" TEXT NOT NULL,
    "primary_color" TEXT NOT NULL,
    "secondary_color" TEXT NOT NULL,
    "accent_color" TEXT NOT NULL,
    "background_color" TEXT NOT NULL,
    "text_color" TEXT NOT NULL,
    "font_family" TEXT NOT NULL,
    "border_radius" TEXT NOT NULL,
    "button_style" TEXT NOT NULL,
    "default_theme" "Theme" NOT NULL DEFAULT 'light',
    "custom_css_variables" TEXT NOT NULL,
    "footer_text" TEXT NOT NULL,
    "support_contact" TEXT NOT NULL,
    "legal_text" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branding_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_connectors" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" "IntegrationStatus" NOT NULL,
    "configuration" TEXT NOT NULL,
    "last_sync_status" TEXT NOT NULL,
    "last_sync_date" TIMESTAMP(3),
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_connectors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "analysis_results_project_id_key" ON "analysis_results"("project_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "debug_logs_timestamp_idx" ON "debug_logs"("timestamp");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_contents" ADD CONSTRAINT "document_contents_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_jobs" ADD CONSTRAINT "analysis_jobs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_results" ADD CONSTRAINT "analysis_results_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_results" ADD CONSTRAINT "analysis_results_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "analysis_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "proposal_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_approval_workflow_id_fkey" FOREIGN KEY ("approval_workflow_id") REFERENCES "approval_workflows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_stages" ADD CONSTRAINT "approval_stages_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "approval_workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "approval_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
