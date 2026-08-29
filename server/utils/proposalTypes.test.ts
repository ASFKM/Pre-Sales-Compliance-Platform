import { describe, expect, it } from "vitest";
import {
  PROPOSAL_TYPES,
  PROPOSAL_TYPE_EDITABLE_FIELDS,
  PROPOSAL_EDITABLE_FIELDS,
  getRejectedEditableFields,
  ANALYSIS_SECTION_BY_REPORT_TYPE,
  REPORT_ONLY_PROPOSAL_TYPES,
  isReportOnlyProposalType,
  getReopenRegenerationSection,
} from "./proposalTypes";

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

// F8b (item 2) - decisão do dono: reabrir uma proposta que é RELATÓRIO PURO regenera o conteúdo do
// relatório do zero via IA; os tipos com campo editável continuam clonando a v1. A decisão de QUAL
// caminho cada tipo toma mora inteira nestas funções puras, e é por isso que ela dá para provar
// aqui, sem banco e sem provedor de IA: a rota (POST /proposals/:id/reopen) só consulta o que este
// arquivo responde. Que a regeração de fato ACONTECE - chamada real ao provedor, seção nova gravada
// no AnalysisResult, documento da v2 saindo dela - é provado por execução real
// (scripts/f8b-provar-regeneracao.ts), não aqui.
describe("PreSales F8b — reabertura de proposta-relatório regenera via IA", () => {
  it("os tipos que regeneram são EXATAMENTE os que não têm campo editável (as duas listas não podem divergir)", () => {
    const semCampoEditavel = PROPOSAL_TYPES.filter((t) => PROPOSAL_TYPE_EDITABLE_FIELDS[t].length === 0);
    expect([...REPORT_ONLY_PROPOSAL_TYPES].sort()).toEqual([...semCampoEditavel].sort());
  });

  it("cada um dos 4 relatórios aponta para a seção da análise de onde o documento dele sai", () => {
    expect(ANALYSIS_SECTION_BY_REPORT_TYPE).toEqual({
      executive_summary: "executive_summary",
      risk_report: "risks",
      bom_report: "bom",
      questions_report: "clarification_questions",
    });
  });

  it("getReopenRegenerationSection devolve a seção para os 4 relatórios", () => {
    expect(getReopenRegenerationSection("executive_summary")).toBe("executive_summary");
    expect(getReopenRegenerationSection("risk_report")).toBe("risks");
    expect(getReopenRegenerationSection("bom_report")).toBe("bom");
    expect(getReopenRegenerationSection("questions_report")).toBe("clarification_questions");
  });

  it("getReopenRegenerationSection devolve null para os 3 tipos com campo editável - eles continuam clonando a v1, sem gastar IA", () => {
    for (const tipo of ["technical", "commercial", "technical_commercial"] as const) {
      expect(getReopenRegenerationSection(tipo)).toBeNull();
      expect(isReportOnlyProposalType(tipo)).toBe(false);
    }
  });

  it("todo tipo de proposta cai num dos dois caminhos, nenhum fica sem resposta", () => {
    for (const tipo of PROPOSAL_TYPES) {
      const secao = getReopenRegenerationSection(tipo);
      expect(secao === null || typeof secao === "string").toBe(true);
      expect(secao === null).toBe(PROPOSAL_TYPE_EDITABLE_FIELDS[tipo].length > 0);
    }
  });

  it("nenhuma seção da análise é alvo de dois relatórios diferentes (um mapa 1-para-1)", () => {
    const secoes = Object.values(ANALYSIS_SECTION_BY_REPORT_TYPE);
    expect(new Set(secoes).size).toBe(secoes.length);
  });
});
