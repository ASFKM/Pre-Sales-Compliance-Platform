-- AlterTable
ALTER TABLE "proposal_opinion_findings" ADD COLUMN     "approval_decision_item_id" TEXT,
ADD COLUMN     "origem" TEXT NOT NULL DEFAULT 'ia';

-- AlterTable
ALTER TABLE "proposal_opinion_runs" ADD COLUMN     "origem" TEXT NOT NULL DEFAULT 'ia';

-- CreateTable
CREATE TABLE "approval_decision_items" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "decision_id" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "target_kind" TEXT NOT NULL,
    "target_key" TEXT,
    "comment" TEXT NOT NULL,
    "section_snapshot" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_decision_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "approval_decision_items_tenant_id_idx" ON "approval_decision_items"("tenant_id");

-- CreateIndex
CREATE INDEX "approval_decision_items_decision_id_idx" ON "approval_decision_items"("decision_id");

-- CreateIndex
CREATE UNIQUE INDEX "proposal_opinion_findings_approval_decision_item_id_key" ON "proposal_opinion_findings"("approval_decision_item_id");

-- AddForeignKey
ALTER TABLE "proposal_opinion_findings" ADD CONSTRAINT "proposal_opinion_findings_approval_decision_item_id_fkey" FOREIGN KEY ("approval_decision_item_id") REFERENCES "approval_decision_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_decision_items" ADD CONSTRAINT "approval_decision_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_decision_items" ADD CONSTRAINT "approval_decision_items_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "approval_decisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

