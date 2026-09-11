-- AlterTable
ALTER TABLE "platform_settings" ADD COLUMN     "proposal_approver_briefing_model" TEXT NOT NULL DEFAULT 'gemini-3.5-flash',
ADD COLUMN     "proposal_approver_briefing_provider" TEXT NOT NULL DEFAULT 'gemini';

-- CreateTable
CREATE TABLE "proposal_approver_briefings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "proposal_id" TEXT NOT NULL,
    "proposal_version" INTEGER NOT NULL,
    "pontos" JSONB NOT NULL,
    "panorama" TEXT NOT NULL,
    "input_fingerprint" TEXT NOT NULL,
    "logic_version" INTEGER NOT NULL,
    "provider_used" TEXT NOT NULL,
    "model_used" TEXT NOT NULL,
    "generated_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "proposal_approver_briefings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "proposal_approver_briefings_proposal_id_key" ON "proposal_approver_briefings"("proposal_id");

-- CreateIndex
CREATE INDEX "proposal_approver_briefings_tenant_id_idx" ON "proposal_approver_briefings"("tenant_id");

-- AddForeignKey
ALTER TABLE "proposal_approver_briefings" ADD CONSTRAINT "proposal_approver_briefings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_approver_briefings" ADD CONSTRAINT "proposal_approver_briefings_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

