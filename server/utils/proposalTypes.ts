// Single source of truth for the 7 proposal/template types - kept manually in sync with the
// Prisma enums ProposalTemplateType and ProposalType (see prisma/schema.prisma and migration
// 20260713060000_add_technical_commercial_proposal_type). Used by both the template upload form
// validation (templates.ts) and the proposal generation route (proposals.ts) so the two can never
// drift out of sync with each other.
export const PROPOSAL_TYPES = [
  "technical",
  "commercial",
  "technical_commercial",
  "executive_summary",
  "risk_report",
  "bom_report",
  "questions_report",
] as const;

export type ProposalTypeValue = (typeof PROPOSAL_TYPES)[number];

export const PROPOSAL_TYPE_LABELS: Record<ProposalTypeValue, string> = {
  technical: "Proposta Técnica",
  commercial: "Proposta Comercial",
  technical_commercial: "Proposta Técnico-Comercial",
  executive_summary: "Resumo Executivo",
  risk_report: "Relatório de Riscos",
  bom_report: "Relatório de BOM",
  questions_report: "Relatório de Perguntas de Esclarecimento",
};

// Proposal-owned fields a human can actually edit post-generation - everything else that ends up
// in the document (resumo executivo, BOM, riscos, requisitos, cronograma, matriz técnica,
// perguntas) comes from AnalysisResult and is read-only here, same as it always was; there was
// never a structured way to edit those, only to rewrite the whole flat blob that `editable_content`
// used to be.
export const PROPOSAL_EDITABLE_FIELDS = [
  "manual_pricing_table",
  "payment_terms",
  "delivery_terms",
  "proposal_validity",
  "commercial_assumptions",
  "exclusions",
] as const;

export type ProposalEditableField = (typeof PROPOSAL_EDITABLE_FIELDS)[number];

// Which of PROPOSAL_EDITABLE_FIELDS actually apply to each proposal/report type - a risk report or
// BOM report has no commercial terms, and a purely technical proposal has no pricing/payment/
// delivery. Root-cause fix for the old editor: it let ANY type edit ANY field via one flat text
// blob, silently discarding the uploaded template's real letterhead on every save (see
// server/routes/proposals.ts's PUT /proposals/:id) because that blob only carried the generic
// (no-template) layout. The editor now edits exactly this per-type field set, and saving
// regenerates through the SAME template-merge path generation used (renderDocxFromTemplate when
// the proposal's template has a real file), so the letterhead survives an edit. Shared by the PUT
// route (enforced field allowlist) and the AI opinion-panel's suggested_field validator (proposals.ts) -
// the AI must never suggest a field this proposal's type can't actually take.
export const PROPOSAL_TYPE_EDITABLE_FIELDS: Record<ProposalTypeValue, readonly ProposalEditableField[]> = {
  technical: ["proposal_validity", "exclusions"],
  commercial: ["manual_pricing_table", "payment_terms", "delivery_terms", "proposal_validity", "commercial_assumptions", "exclusions"],
  technical_commercial: ["manual_pricing_table", "payment_terms", "delivery_terms", "proposal_validity", "commercial_assumptions", "exclusions"],
  executive_summary: [],
  risk_report: [],
  bom_report: [],
  questions_report: [],
};

// Which of `submittedFields` this proposal type does NOT own - empty array means every submitted
// field is allowed. Pure/no-DB so it's unit-testable on its own (see proposalTypes.test.ts);
// server/routes/proposals.ts's PUT handler is what actually enforces this against a request.
export function getRejectedEditableFields(
  proposalType: ProposalTypeValue,
  submittedFields: readonly ProposalEditableField[]
): ProposalEditableField[] {
  const allowed = PROPOSAL_TYPE_EDITABLE_FIELDS[proposalType];
  return submittedFields.filter((f) => !allowed.includes(f));
}
