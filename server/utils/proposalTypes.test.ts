import { describe, expect, it } from "vitest";
import { PROPOSAL_TYPES, PROPOSAL_TYPE_EDITABLE_FIELDS, PROPOSAL_EDITABLE_FIELDS, getRejectedEditableFields } from "./proposalTypes";

// PreSales F7 (editor estruturado por tipo) - PROPOSAL_TYPE_EDITABLE_FIELDS é a raiz do fix: antes
// dela, TODO tipo aceitava editar QUALQUER campo comercial via o blob livre `editable_content`,
// mesmo tipos que o template nunca usa (um risk_report não tem payment_terms). Provado sem banco -
// o resto do fluxo (regeneração real do DOCX/PDF, o preview batendo com o export, aplicar sugestão
// de parecer) é provado por execução real contra o servidor de dev, não aqui.
describe("PreSales F7 — PROPOSAL_TYPE_EDITABLE_FIELDS", () => {
  it("cobre exatamente os 7 tipos, sem nenhum a mais nem a menos", () => {
    expect(Object.keys(PROPOSAL_TYPE_EDITABLE_FIELDS).sort()).toEqual([...PROPOSAL_TYPES].sort());
  });

  it("os 4 tipos de relatório não têm nenhum campo comercial editável", () => {
    for (const reportType of ["executive_summary", "risk_report", "bom_report", "questions_report"] as const) {
      expect(PROPOSAL_TYPE_EDITABLE_FIELDS[reportType]).toEqual([]);
    }
  });

  it("proposta técnica não tem pricing nem termos comerciais - só validade e exclusões", () => {
    expect([...PROPOSAL_TYPE_EDITABLE_FIELDS.technical].sort()).toEqual(["exclusions", "proposal_validity"]);
  });

  it("commercial e technical_commercial têm o conjunto comercial completo", () => {
    for (const type of ["commercial", "technical_commercial"] as const) {
      expect([...PROPOSAL_TYPE_EDITABLE_FIELDS[type]].sort()).toEqual([...PROPOSAL_EDITABLE_FIELDS].sort());
    }
  });

  it("nunca referencia um campo fora de PROPOSAL_EDITABLE_FIELDS (drift entre as duas listas)", () => {
    for (const type of PROPOSAL_TYPES) {
      for (const field of PROPOSAL_TYPE_EDITABLE_FIELDS[type]) {
        expect(PROPOSAL_EDITABLE_FIELDS).toContain(field);
      }
    }
  });
});

describe("PreSales F7 — getRejectedEditableFields (enforcement da PUT /proposals/:id)", () => {
  it("rejeita payment_terms num relatório de riscos", () => {
    expect(getRejectedEditableFields("risk_report", ["payment_terms"])).toEqual(["payment_terms"]);
  });

  it("rejeita manual_pricing_table numa proposta técnica", () => {
    expect(getRejectedEditableFields("technical", ["manual_pricing_table", "exclusions"])).toEqual(["manual_pricing_table"]);
  });

  it("aceita o conjunto comercial inteiro numa proposta comercial", () => {
    expect(getRejectedEditableFields("commercial", [...PROPOSAL_EDITABLE_FIELDS])).toEqual([]);
  });

  it("lista vazia de campos enviados nunca é rejeitada, mesmo num tipo sem campos", () => {
    expect(getRejectedEditableFields("bom_report", [])).toEqual([]);
  });
});
