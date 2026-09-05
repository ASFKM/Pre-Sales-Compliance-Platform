-- AlterTable
ALTER TABLE "platform_settings" ADD COLUMN     "proposal_finding_remediation_model" TEXT NOT NULL DEFAULT 'gemini-3.5-flash',
ADD COLUMN     "proposal_finding_remediation_provider" TEXT NOT NULL DEFAULT 'gemini',
ADD COLUMN     "proposal_grammar_check_model" TEXT NOT NULL DEFAULT 'gemini-3.5-flash',
ADD COLUMN     "proposal_grammar_check_provider" TEXT NOT NULL DEFAULT 'gemini',
ADD COLUMN     "proposal_section_coherence_model" TEXT NOT NULL DEFAULT 'gemini-3.5-flash',
ADD COLUMN     "proposal_section_coherence_provider" TEXT NOT NULL DEFAULT 'gemini';

-- AlterTable
ALTER TABLE "proposal_opinion_findings" ADD COLUMN     "previous_finding_id" TEXT,
ADD COLUMN     "remediation_checked_at" TIMESTAMP(3),
ADD COLUMN     "remediation_note" TEXT,
ADD COLUMN     "remediation_verdict" TEXT;

-- CreateIndex
CREATE INDEX "proposal_opinion_findings_previous_finding_id_idx" ON "proposal_opinion_findings"("previous_finding_id");

-- AddForeignKey
ALTER TABLE "proposal_opinion_findings" ADD CONSTRAINT "proposal_opinion_findings_previous_finding_id_fkey" FOREIGN KEY ("previous_finding_id") REFERENCES "proposal_opinion_findings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

