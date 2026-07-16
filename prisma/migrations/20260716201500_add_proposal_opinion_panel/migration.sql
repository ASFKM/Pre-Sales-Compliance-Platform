-- Item 3: Pareceres de IA Multi-Perspectiva em Propostas

ALTER TYPE "BackgroundTaskType" ADD VALUE 'proposal_opinion_panel';

ALTER TABLE "proposals" ADD COLUMN "latest_opinion_run_id" TEXT;

CREATE TABLE "proposal_opinion_runs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "proposal_id" TEXT NOT NULL,
    "background_task_id" TEXT,
    "status" TEXT NOT NULL,
    "requested_by_user_id" TEXT NOT NULL,
    "logic_version" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "proposal_opinion_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "proposal_ai_opinion_items" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "perspective" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "severity" TEXT,
    "summary" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "raw" JSONB,
    "provider_used" TEXT,
    "model_used" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proposal_ai_opinion_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "proposal_opinion_runs_tenant_id_idx" ON "proposal_opinion_runs"("tenant_id");
CREATE INDEX "proposal_opinion_runs_proposal_id_idx" ON "proposal_opinion_runs"("proposal_id");
CREATE INDEX "proposal_ai_opinion_items_tenant_id_idx" ON "proposal_ai_opinion_items"("tenant_id");
CREATE UNIQUE INDEX "proposal_ai_opinion_items_run_id_perspective_key" ON "proposal_ai_opinion_items"("run_id", "perspective");

ALTER TABLE "proposal_opinion_runs" ADD CONSTRAINT "proposal_opinion_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "proposal_opinion_runs" ADD CONSTRAINT "proposal_opinion_runs_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "proposal_ai_opinion_items" ADD CONSTRAINT "proposal_ai_opinion_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "proposal_ai_opinion_items" ADD CONSTRAINT "proposal_ai_opinion_items_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "proposal_opinion_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
