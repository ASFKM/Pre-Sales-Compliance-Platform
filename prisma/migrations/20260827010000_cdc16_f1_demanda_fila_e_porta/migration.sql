-- CreateEnum
CREATE TYPE "DemandStatus" AS ENUM ('queued', 'assigned', 'in_analysis', 'returned', 'cancelled', 'completed');

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "crm_company_id" TEXT,
ADD COLUMN     "crm_opportunity_id" TEXT;

-- CreateTable
CREATE TABLE "demands" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "demand_ref" TEXT NOT NULL,
    "sequence" INTEGER DEFAULT 1,
    "status" "DemandStatus" NOT NULL DEFAULT 'queued',
    "crm_company_id" TEXT NOT NULL,
    "company_name" TEXT NOT NULL,
    "company_legal_name" TEXT,
    "company_tax_id" TEXT,
    "company_cnpj_root" TEXT,
    "company_sector" TEXT,
    "company_segment" TEXT,
    "company_type" TEXT,
    "crm_opportunity_id" TEXT NOT NULL,
    "opportunity_name" TEXT NOT NULL,
    "deal_type" TEXT,
    "stage" TEXT,
    "value" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "probability" INTEGER,
    "margin_percent" DOUBLE PRECISION,
    "expected_close_date" TIMESTAMP(3),
    "risks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "origin" TEXT,
    "title" TEXT NOT NULL,
    "vertical" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "deadline" TIMESTAMP(3) NOT NULL,
    "proposal_validity_date" TIMESTAMP(3) NOT NULL,
    "output_language" "Language" NOT NULL DEFAULT 'Portuguese',
    "proposal_language" "Language" NOT NULL DEFAULT 'Portuguese',
    "ai_orientation_mode" TEXT NOT NULL,
    "ai_orientation_text" TEXT NOT NULL DEFAULT '',
    "procurement_modality" TEXT,
    "procurement_subtype" TEXT,
    "objective" TEXT,
    "sent_by_crm_user_id" TEXT NOT NULL,
    "sent_by_name" TEXT NOT NULL,
    "sent_by_email" TEXT,
    "sent_at" TIMESTAMP(3) NOT NULL,
    "crm_callback_base_url" TEXT,
    "pair_crm_installation_id" TEXT NOT NULL,
    "pair_cross_environment" BOOLEAN NOT NULL DEFAULT false,
    "queued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assigned_at" TIMESTAMP(3),
    "analysis_started_at" TIMESTAMP(3),
    "returned_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "assigned_user_id" TEXT,
    "returned_reason" TEXT,
    "project_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "demands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "demand_documents" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "demand_id" TEXT NOT NULL,
    "document_ref" TEXT NOT NULL,
    "crm_document_id" TEXT,
    "filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "extracted_text" TEXT,
    "storage_provider" "StorageProvider",
    "storage_path" TEXT,
    "content_received_at" TIMESTAMP(3),
    "document_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "demand_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response_status" INTEGER NOT NULL,
    "response_body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "demands_project_id_key" ON "demands"("project_id");

-- CreateIndex
CREATE INDEX "demands_tenant_id_status_idx" ON "demands"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "demands_tenant_id_demand_ref_key" ON "demands"("tenant_id", "demand_ref");

-- CreateIndex
CREATE UNIQUE INDEX "demand_documents_document_id_key" ON "demand_documents"("document_id");

-- CreateIndex
CREATE INDEX "demand_documents_tenant_id_idx" ON "demand_documents"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "demand_documents_tenant_id_demand_id_document_ref_key" ON "demand_documents"("tenant_id", "demand_id", "document_ref");

-- CreateIndex
CREATE INDEX "idempotency_records_tenant_id_idx" ON "idempotency_records"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_tenant_id_scope_key_key" ON "idempotency_records"("tenant_id", "scope", "key");

-- AddForeignKey
ALTER TABLE "demands" ADD CONSTRAINT "demands_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "demands" ADD CONSTRAINT "demands_assigned_user_id_fkey" FOREIGN KEY ("assigned_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "demands" ADD CONSTRAINT "demands_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "demand_documents" ADD CONSTRAINT "demand_documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "demand_documents" ADD CONSTRAINT "demand_documents_demand_id_fkey" FOREIGN KEY ("demand_id") REFERENCES "demands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "demand_documents" ADD CONSTRAINT "demand_documents_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- CDC 16 F1 — as duas permissoes da fila, reconciliadas para papeis ja existentes.
--
-- prisma/seed.ts so toca os ids fixos r1/r2/r3. Papeis criados pelo assistente de
-- instalacao real tem outros ids e nunca receberiam a permissao nova - foi
-- exatamente o buraco que a migration 20260728120000 teve de tapar quando o
-- modulo de Precificacao nasceu. Aqui o criterio e "quem ja pode criar projeto",
-- que e o marcador pratico de quem faz parte da equipe de pre-vendas: a fila e
-- unica e visivel para toda a equipe (D15).
--
-- Idempotente: depois que o papel tem demand:read, o WHERE deixa de casar.
UPDATE "roles"
SET "permissions" = (
  SELECT ARRAY(SELECT DISTINCT unnest("permissions" || ARRAY['demand:read', 'demand:assume']))
)
WHERE 'project:create' = ANY("permissions")
  AND NOT ('demand:read' = ANY("permissions"));
