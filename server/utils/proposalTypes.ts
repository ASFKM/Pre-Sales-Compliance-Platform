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
