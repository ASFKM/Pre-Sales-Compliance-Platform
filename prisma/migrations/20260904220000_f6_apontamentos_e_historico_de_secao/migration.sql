-- AlterTable
ALTER TABLE "password_policies" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "platform_settings" ADD COLUMN     "proposal_section_rewrite_model" TEXT NOT NULL DEFAULT 'gemini-3.5-flash',
ADD COLUMN     "proposal_section_rewrite_provider" TEXT NOT NULL DEFAULT 'gemini';

-- CreateTable
CREATE TABLE "proposal_opinion_findings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "opinion_id" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "target_kind" TEXT NOT NULL,
    "target_key" TEXT,
    "suggested_value" TEXT,
    "status" TEXT NOT NULL DEFAULT 'aberto',
    "resolution_note" TEXT,
    "resolved_by_user_id" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "proposal_opinion_findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposal_section_edits" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "proposal_id" TEXT NOT NULL,
    "target_kind" TEXT NOT NULL,
    "target_key" TEXT NOT NULL,
    "previous_value" TEXT,
    "new_value" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "finding_id" TEXT,
    "author_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proposal_section_edits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "proposal_opinion_findings_tenant_id_idx" ON "proposal_opinion_findings"("tenant_id");

-- CreateIndex
CREATE INDEX "proposal_opinion_findings_opinion_id_idx" ON "proposal_opinion_findings"("opinion_id");

-- CreateIndex
CREATE INDEX "proposal_section_edits_tenant_id_idx" ON "proposal_section_edits"("tenant_id");

-- CreateIndex
CREATE INDEX "proposal_section_edits_proposal_id_idx" ON "proposal_section_edits"("proposal_id");

-- AddForeignKey
ALTER TABLE "proposal_opinion_findings" ADD CONSTRAINT "proposal_opinion_findings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_opinion_findings" ADD CONSTRAINT "proposal_opinion_findings_opinion_id_fkey" FOREIGN KEY ("opinion_id") REFERENCES "proposal_ai_opinion_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_section_edits" ADD CONSTRAINT "proposal_section_edits_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_section_edits" ADD CONSTRAINT "proposal_section_edits_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_section_edits" ADD CONSTRAINT "proposal_section_edits_finding_id_fkey" FOREIGN KEY ("finding_id") REFERENCES "proposal_opinion_findings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

