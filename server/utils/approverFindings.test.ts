import { describe, expect, it } from "vitest";
import {
  apontamentosDoAprovador,
  tituloDoApontamentoDoAprovador,
  detalheDoApontamentoDoAprovador,
  PERSPECTIVA_DO_APROVADOR,
  ORIGEM_APROVADOR,
} from "./approverFindings";

/*
 * F8 — os itens do aprovador viram apontamentos na v2.
 *
 * O que estes testes travam é a conversão: nenhum item pode se perder, a ordem é a que o aprovador
 * escreveu, o alvo é o mesmo vocabulário do apontamento, e a severidade é `critical` (é ela que faz
 * o gate de envio da F7 ver o item — o que FORTALECE o gate, nunca o afrouxa).
 */
describe("F8 — apontamentosDoAprovador", () => {
  const itens = [
    { id: "adi_2", ordinal: 2, targetKind: "proposal_field", targetKey: "payment_terms", comment: "30/60/90 não passa.", sectionSnapshot: "Pagamento em 30/60/90 dias." },
    { id: "adi_1", ordinal: 1, targetKind: "template_field", targetKey: "escopo_tecnico", comment: "Falta o prazo.", sectionSnapshot: null },
  ];

  it("converte todos os itens, reordenados pelo ordinal do aprovador", () => {
    const r = apontamentosDoAprovador(itens);
    expect(r).toHaveLength(2);
    expect(r.map((a) => a.itemId)).toEqual(["adi_1", "adi_2"]);
    expect(r.map((a) => a.ordinal)).toEqual([1, 2]);
  });

  it("todo apontamento do aprovador nasce critical e amarrado ao item da rejeição", () => {
    for (const a of apontamentosDoAprovador(itens)) {
      expect(a.severity).toBe("critical");
      expect(a.approvalDecisionItemId).toBe(a.itemId);
    }
  });

  it("preserva o alvo do item, e zera a chave em 'geral'", () => {
    const r = apontamentosDoAprovador(itens);
    expect(r[0]).toMatchObject({ targetKind: "template_field", targetKey: "escopo_tecnico" });
    const geral = apontamentosDoAprovador([{ id: "g", ordinal: 1, targetKind: "geral", targetKey: "sobra", comment: "c", sectionSnapshot: null }]);
    expect(geral[0].targetKey).toBeNull();
  });

  it("lista vazia não produz apontamento — uma rejeição sem itens é legítima", () => {
    expect(apontamentosDoAprovador([])).toEqual([]);
  });

  it("os rótulos de origem são estáveis: é neles que a comparação de rodadas se apoia", () => {
    expect(PERSPECTIVA_DO_APROVADOR).toBe("aprovador");
    expect(ORIGEM_APROVADOR).toBe("aprovador");
  });
});

describe("F8 — título e detalhe", () => {
  it("título curto é o comentário inteiro", () => {
    expect(tituloDoApontamentoDoAprovador("Falta o prazo de implantação.")).toBe("Falta o prazo de implantação.");
  });

  it("título usa a primeira linha NÃO VAZIA, não o parágrafo inteiro", () => {
    expect(tituloDoApontamentoDoAprovador("\n\n  Margem baixa.\nDetalhe longo abaixo.")).toBe("Margem baixa.");
  });

  it("título longo é cortado com reticência, sem partir palavra no meio", () => {
    const longo = "A cláusula de penalidade contratual precisa ser reescrita porque o texto atual expõe a empresa a multa ilimitada em caso de atraso de entrega";
    const titulo = tituloDoApontamentoDoAprovador(longo);
    expect(titulo.length).toBeLessThanOrEqual(121);
    expect(titulo.endsWith("…")).toBe(true);
    expect(longo.startsWith(titulo.slice(0, -1))).toBe(true);
  });

  it("detalhe carrega o retrato da seção, e não inventa bloco quando não há retrato", () => {
    expect(detalheDoApontamentoDoAprovador("Falta prazo.", null)).toBe("Falta prazo.");
    expect(detalheDoApontamentoDoAprovador("Falta prazo.", "   ")).toBe("Falta prazo.");
    const com = detalheDoApontamentoDoAprovador("Falta prazo.", "Escopo atual do projeto.");
    expect(com).toContain("Falta prazo.");
    expect(com).toContain("no momento da rejeição");
    expect(com).toContain("Escopo atual do projeto.");
  });
});
