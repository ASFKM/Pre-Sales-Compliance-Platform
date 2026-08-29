import { describe, expect, it } from "vitest";
import { PROPOSAL_TYPE_EDITABLE_FIELDS, isFieldEditableForType } from "./proposalEditableFields";

// Mirror of server/utils/proposalTypes.test.ts's coverage, for the client-side copy this editor
// actually reads to decide which inputs to render (src/components/Proposals.tsx's openEditor and
// the pricing-table/text-details conditionals). The server is the real enforcement; this only
// proves the client copy hasn't drifted from what it's documented to mirror.
describe("PreSales F7 — client PROPOSAL_TYPE_EDITABLE_FIELDS mirror", () => {
  it("um relatório de riscos não mostra input de pricing", () => {
    expect(isFieldEditableForType("risk_report", "manual_pricing_table")).toBe(false);
  });

  it("proposta comercial mostra pricing e todos os termos", () => {
    expect(isFieldEditableForType("commercial", "manual_pricing_table")).toBe(true);
    expect(isFieldEditableForType("commercial", "payment_terms")).toBe(true);
  });

  it("proposta técnica não mostra payment_terms nem pricing", () => {
    expect(isFieldEditableForType("technical", "payment_terms")).toBe(false);
    expect(isFieldEditableForType("technical", "manual_pricing_table")).toBe(false);
    expect(isFieldEditableForType("technical", "exclusions")).toBe(true);
  });

  it("todos os 7 tipos têm uma entrada definida", () => {
    expect(Object.keys(PROPOSAL_TYPE_EDITABLE_FIELDS)).toHaveLength(7);
  });
});
