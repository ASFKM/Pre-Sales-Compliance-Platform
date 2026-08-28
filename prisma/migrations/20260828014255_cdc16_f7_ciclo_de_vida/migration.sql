-- CDC 16 — Fase 7. O CICLO DE VIDA: cancelamento (D18), atualização pós-envio (D27), oportunidade
-- perdida (D29) e expurgo em cascata (D35).
--
-- Aditiva por inteiro, e é o que permite publicar com o serviço no ar: dois enums novos, duas
-- tabelas novas e SETE colunas anuláveis em `demands`. Nenhum UPDATE, nenhum DEFAULT que reescreva
-- linha existente, nenhum NOT NULL novo. O bundle antigo continua respondendo entre a migration e
-- o restart, porque nada do que ele escreve mudou de forma.
--
-- ## `demand_updates` — a atualização que NÃO sobrescreve
--
-- A D27 diz que mudança no CRM depois do envio "chega como atualização visível, sem sobrescrever
-- o que o pré-vendas já editou". A divisão que torna isso possível já existia no produto e só
-- precisou ser dita em voz alta: a DEMANDA é o que o CRM diz, o PROJETO é o que o pré-vendas faz.
-- O PATCH atualiza a demanda na hora — ela existe para espelhar o CRM, e uma demanda que mente
-- sobre o prazo do edital é pior do que uma demanda que muda — e não encosta no projeto. Esta
-- tabela é o convite a levar a mudança para lá, com o antes e o depois à vista.
--
-- Guarda o corpo do PATCH congelado (`payload`) e o diff calculado na chegada (`changes`). Os dois,
-- e não só um: o diff é o que a tela mostra e é caro de recalcular depois (exigiria o estado da
-- demanda no instante da chegada, que já não existe); o payload é o que permite conferir o diff
-- contra o que de fato chegou, no dia em que alguém duvidar dele.
--
-- ## `crm_purge_executions` — o registro, e por que ele não tem FK para a demanda
--
-- "Sem o registro, apagar de um lado só é conformidade de mentira." Um `demand_id` com
-- `ON DELETE CASCADE` aqui faria o expurgo apagar a prova de que ele aconteceu — o registro
-- morreria junto com o que ele registra, e no dia da auditoria não teria sobrado nada. Por isso
-- esta tabela não referencia `demands` nem `demand_documents`: ela guarda os identificadores do
-- CRM, que sobrevivem a qualquer apagamento deste lado.
--
-- E ela NÃO guarda nome de arquivo nem texto extraído, de propósito. Quando o motivo é
-- `data_subject_request`, o nome do arquivo pode ser exatamente o dado que se pediu para apagar, e
-- um registro de expurgo que reproduz o dado apagado é o contrário de conformidade. O `sha256`
-- identifica o arquivo sem reproduzi-lo, e é o mesmo identificador que o CRM já conhece.
--
-- ## As sete colunas do cancelamento
--
-- `cancelled` e `cancelled_at` já existiam desde a F1 — o enum não muda. O que faltava era o
-- PEDIDO: uma demanda já assumida não é cancelada na hora (alguém está trabalhando nela), então o
-- cancelamento aprovado pelo líder vira pedido de encerramento, e quem assumiu decide quando parar.
-- `cancellation_outcome` guarda como o pedido terminou — `cancelled` se foi encerrado, `completed`
-- se quem assumiu preferiu concluir mesmo assim, que a D29 nomeia como escolha legítima.

-- CreateEnum
CREATE TYPE "DemandUpdateStatus" AS ENUM ('pending', 'incorporated', 'dismissed');

-- CreateEnum
CREATE TYPE "CrmPurgeReason" AS ENUM ('retention', 'data_subject_request');

-- AlterTable
ALTER TABLE "demands" ADD COLUMN     "cancellation_approved_by_crm_user_id" TEXT,
ADD COLUMN     "cancellation_approved_by_name" TEXT,
ADD COLUMN     "cancellation_closed_at" TIMESTAMP(3),
ADD COLUMN     "cancellation_closed_by_user_id" TEXT,
ADD COLUMN     "cancellation_justification" TEXT,
ADD COLUMN     "cancellation_outcome" TEXT,
ADD COLUMN     "cancellation_requested_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "demand_updates" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "demand_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "changes" JSONB NOT NULL,
    "kind" TEXT NOT NULL,
    "note" TEXT,
    "changed_by_crm_user_id" TEXT,
    "changed_by_name" TEXT,
    "changed_at" TIMESTAMP(3) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "DemandUpdateStatus" NOT NULL DEFAULT 'pending',
    "decided_at" TIMESTAMP(3),
    "decided_by_user_id" TEXT,
    "decision_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "demand_updates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_purge_executions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "reason" "CrmPurgeReason" NOT NULL,
    "crm_installation_id" TEXT NOT NULL,
    "targets" JSONB NOT NULL,
    "results" JSONB NOT NULL,
    "documents_deleted" INTEGER NOT NULL DEFAULT 0,
    "demands_deleted" INTEGER NOT NULL DEFAULT 0,
    "files_deleted" INTEGER NOT NULL DEFAULT 0,
    "projects_unlinked" INTEGER NOT NULL DEFAULT 0,
    "executed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_purge_executions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "demand_updates_tenant_id_demand_id_idx" ON "demand_updates"("tenant_id", "demand_id");

-- CreateIndex
CREATE INDEX "demand_updates_tenant_id_status_idx" ON "demand_updates"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "crm_purge_executions_tenant_id_executed_at_idx" ON "crm_purge_executions"("tenant_id", "executed_at");

-- AddForeignKey
ALTER TABLE "demands" ADD CONSTRAINT "demands_cancellation_closed_by_user_id_fkey" FOREIGN KEY ("cancellation_closed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "demand_updates" ADD CONSTRAINT "demand_updates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "demand_updates" ADD CONSTRAINT "demand_updates_demand_id_fkey" FOREIGN KEY ("demand_id") REFERENCES "demands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "demand_updates" ADD CONSTRAINT "demand_updates_decided_by_user_id_fkey" FOREIGN KEY ("decided_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_purge_executions" ADD CONSTRAINT "crm_purge_executions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

