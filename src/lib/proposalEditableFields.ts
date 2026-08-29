import { Proposal } from "../types";

// Client-side mirror of server/utils/proposalTypes.ts's PROPOSAL_TYPE_EDITABLE_FIELDS - kept
// manually in sync with it (same pattern the server file already documents for the 7 proposal
// types themselves: server and client don't share a package here, so this is the one place on the
// client that needs to track a server-side source of truth by hand). The server is the real
// enforcement (PUT /proposals/:id rejects anything outside this set with a 400) - this copy only
// drives which inputs the editor shows, so a drift here produces a form field that the server would
// reject, not a security gap.
export const PROPOSAL_EDITABLE_FIELDS = [
  "manual_pricing_table",
  "payment_terms",
  "delivery_terms",
  "proposal_validity",
  "commercial_assumptions",
  "exclusions",
] as const;

export type ProposalEditableField = (typeof PROPOSAL_EDITABLE_FIELDS)[number];

export const PROPOSAL_TYPE_EDITABLE_FIELDS: Record<Proposal["proposal_type"], readonly ProposalEditableField[]> = {
  technical: ["proposal_validity", "exclusions"],
  commercial: ["manual_pricing_table", "payment_terms", "delivery_terms", "proposal_validity", "commercial_assumptions", "exclusions"],
  technical_commercial: ["manual_pricing_table", "payment_terms", "delivery_terms", "proposal_validity", "commercial_assumptions", "exclusions"],
  executive_summary: [],
  risk_report: [],
  bom_report: [],
  questions_report: [],
};

export function isFieldEditableForType(proposalType: Proposal["proposal_type"], field: ProposalEditableField): boolean {
  return PROPOSAL_TYPE_EDITABLE_FIELDS[proposalType].includes(field);
}

export const PROPOSAL_TYPE_LABEL: Record<Proposal["proposal_type"], { pt: string; en: string }> = {
  technical: { pt: "Técnica", en: "Technical" },
  commercial: { pt: "Comercial", en: "Commercial" },
  technical_commercial: { pt: "Técnico-Comercial", en: "Technical-Commercial" },
  executive_summary: { pt: "Resumo Executivo", en: "Executive Summary" },
  risk_report: { pt: "Relatório de Riscos", en: "Risk Report" },
  bom_report: { pt: "Relatório de BOM", en: "BOM Report" },
  questions_report: { pt: "Relatório de Perguntas", en: "Questions Report" },
};

// Short badge text (header chip) - 4 letters max keeps the fixed-size square badge legible for all
// 7 types, not just the TECH/COMM the badge used to hardcode.
export const PROPOSAL_TYPE_BADGE: Record<Proposal["proposal_type"], string> = {
  technical: "TECH",
  commercial: "COMM",
  technical_commercial: "T+C",
  executive_summary: "EXEC",
  risk_report: "RISK",
  bom_report: "BOM",
  questions_report: "Q&A",
};

export const PROPOSAL_FIELD_LABEL: Record<Exclude<ProposalEditableField, "manual_pricing_table">, { pt: string; en: string }> = {
  payment_terms: { pt: "Termos de Pagamento e Crédito", en: "Payment & Credit Terms" },
  delivery_terms: { pt: "Condições de Entrega Incoterms", en: "Incoterms Delivery Conditions" },
  proposal_validity: { pt: "Data de Validade da Proposta", en: "Proposal Validity Date" },
  commercial_assumptions: { pt: "Premissas Comerciais", en: "Commercial Assumptions" },
  exclusions: { pt: "Exclusões Comerciais", en: "Commercial Exclusions" },
};
