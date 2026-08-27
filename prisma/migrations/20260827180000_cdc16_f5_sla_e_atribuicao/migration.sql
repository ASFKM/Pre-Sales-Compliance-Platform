-- CDC 16 — Fase 5: SLA por etapa, politica de atribuicao e alerta de prazo vencido.
--
-- ADITIVA por inteiro: dois tipos novos, duas tabelas novas e oito colunas
-- ANULAVEIS em `demands`. Nenhum UPDATE, nenhum DEFAULT que reescreva linha
-- existente, e — de proposito — NENHUMA reconciliacao de papeis.
--
-- A ausencia da reconciliacao e a decisao que mais importa aqui, e o contrario
-- do que a F1 fez com `demand:read`/`demand:assume`. A permissao nova desta
-- fase (`demand:manage`) e o papel de GERENTE DE PRE-VENDAS, e a D17 diz que o
-- gerente aprova a devolucao "quando houver gerente". Distribuir a permissao
-- para os papeis que ja existem transformaria todo mundo em gerente e faria
-- toda devolucao de toda instalacao no ar passar a exigir aprovacao — uma
-- mudanca de comportamento que ninguem pediu, na primeira reinicializacao
-- depois do deploy. Sem gerente nomeado, esta fase nao muda nada: a devolucao
-- continua direta, e o alerta de prazo vai para a equipe.
--
-- Pelo mesmo motivo `demand_sla_settings` nasce vazia. A AUSENCIA da linha e o
-- estado de toda instalacao que existe hoje, e significa exatamente o que a F1
-- entregou: sem prazo, sem alerta, auto-servico.
-- CreateEnum
CREATE TYPE "DemandAssignmentPolicy" AS ENUM ('auto_servico', 'direcionamento', 'automatico');

-- CreateEnum
CREATE TYPE "DemandSlaStage" AS ENUM ('assume', 'analysis', 'proposal');

-- AlterTable
ALTER TABLE "demands" ADD COLUMN     "assigned_by_user_id" TEXT,
ADD COLUMN     "assignment_source" TEXT,
ADD COLUMN     "return_decided_at" TIMESTAMP(3),
ADD COLUMN     "return_decided_by_user_id" TEXT,
ADD COLUMN     "return_rejection_reason" TEXT,
ADD COLUMN     "return_request_reason" TEXT,
ADD COLUMN     "return_requested_at" TIMESTAMP(3),
ADD COLUMN     "return_requested_by_user_id" TEXT;

-- CreateTable
CREATE TABLE "demand_sla_settings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "assume_hours" INTEGER NOT NULL DEFAULT 8,
    "analysis_hours" INTEGER NOT NULL DEFAULT 24,
    "proposal_hours" INTEGER NOT NULL DEFAULT 120,
    "assignment_policy" "DemandAssignmentPolicy" NOT NULL DEFAULT 'auto_servico',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "demand_sla_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "demand_sla_breaches" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "demand_id" TEXT NOT NULL,
    "stage" "DemandSlaStage" NOT NULL,
    "due_at" TIMESTAMP(3) NOT NULL,
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recipient_kind" TEXT NOT NULL,
    "recipient_user_ids" TEXT[],
    "acknowledged_at" TIMESTAMP(3),
    "acknowledged_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "demand_sla_breaches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "demand_sla_settings_tenant_id_key" ON "demand_sla_settings"("tenant_id");

-- CreateIndex
CREATE INDEX "demand_sla_breaches_tenant_id_acknowledged_at_idx" ON "demand_sla_breaches"("tenant_id", "acknowledged_at");

-- CreateIndex
CREATE UNIQUE INDEX "demand_sla_breaches_tenant_id_demand_id_stage_key" ON "demand_sla_breaches"("tenant_id", "demand_id", "stage");

-- AddForeignKey
ALTER TABLE "demands" ADD CONSTRAINT "demands_assigned_by_user_id_fkey" FOREIGN KEY ("assigned_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "demands" ADD CONSTRAINT "demands_return_requested_by_user_id_fkey" FOREIGN KEY ("return_requested_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "demands" ADD CONSTRAINT "demands_return_decided_by_user_id_fkey" FOREIGN KEY ("return_decided_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "demand_sla_settings" ADD CONSTRAINT "demand_sla_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "demand_sla_breaches" ADD CONSTRAINT "demand_sla_breaches_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "demand_sla_breaches" ADD CONSTRAINT "demand_sla_breaches_demand_id_fkey" FOREIGN KEY ("demand_id") REFERENCES "demands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

