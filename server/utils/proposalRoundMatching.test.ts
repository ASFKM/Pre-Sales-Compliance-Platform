import { describe, it, expect } from "vitest";
import {
  casarApontamentos,
  compararRodadas,
  similaridadeDeTitulo,
  tokensDoTitulo,
  LIMIAR_DE_SIMILARIDADE,
  type ApontamentoParaCasar,
} from "./proposalRoundMatching";

/*
 * Os casos abaixo usam os títulos REAIS da rodada medida na proposta "Prova PreSales F8"
 * (prop_ca71b0cee40d92e2) - inclusive os dois apontamentos distintos sobre `payment_terms`, que são
 * exatamente o caso que derruba o casamento só por seção-alvo.
 */
const ant = (id: string, title: string, targetKey: string | null, targetKind = "proposal_field"): ApontamentoParaCasar =>
  ({ id, title, targetKind: targetKey === null ? "geral" : targetKind, targetKey });

describe("tokensDoTitulo", () => {
  it("normaliza acento, caixa e pontuação para que o mesmo título não pareça outro", () => {
    expect([...tokensDoTitulo("Condições de Pagamento")].sort()).toEqual(["condicoes", "pagamento"]);
  });

  it("descarta palavras de até 2 letras, que não distinguem apontamento nenhum", () => {
    expect(tokensDoTitulo("Ajustar o prazo da proposta").has("da")).toBe(false);
  });
});

describe("similaridadeDeTitulo", () => {
  it("dá 1 para o mesmo título escrito com acento e caixa diferentes", () => {
    expect(similaridadeDeTitulo("Inconsistência de Moeda", "inconsistencia de moeda")).toBe(1);
  });

  it("reconhece o título reescrito pela IA sobre o mesmo ponto", () => {
    const s = similaridadeDeTitulo(
      "Histórico Interno Exposto nas Condições de Pagamento",
      "Remover notas internas nas condições de pagamento"
    );
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(1);
  });

  it("dá 0 para títulos sem nada em comum", () => {
    expect(similaridadeDeTitulo("Exclusões não parametrizadas", "Ausência de BOM")).toBe(0);
  });
});

describe("casarApontamentos - o vínculo do modelo é primário e sempre revalidado", () => {
  const anteriores = [
    ant("pof_a", "Remover notas internas nas condições de pagamento", "payment_terms"),
    ant("pof_b", "Ajustar prazo de validade da proposta", "proposal_validity"),
  ];

  it("aceita o vínculo declarado quando o id existe na rodada anterior", () => {
    const casados = casarApontamentos(anteriores, [
      { id: "pof_novo", title: "Notas internas seguem nas condições", targetKind: "proposal_field", targetKey: "payment_terms", previousFindingId: "pof_a" },
    ]);
    expect(casados[0]).toMatchObject({ anteriorId: "pof_a", origem: "modelo" });
  });

  it("DESCARTA um id inventado pelo modelo: o apontamento conta como novo, sem erro", () => {
    const casados = casarApontamentos(anteriores, [
      { id: "pof_novo", title: "Algo completamente distinto aqui", targetKind: "geral", targetKey: null, previousFindingId: "pof_inexistente" },
    ]);
    expect(casados[0]).toMatchObject({ anteriorId: null, origem: null });
  });

  it("não deixa dois apontamentos novos reivindicarem o mesmo antecessor", () => {
    const casados = casarApontamentos(anteriores, [
      { id: "n1", title: "Primeiro", targetKind: "proposal_field", targetKey: "payment_terms", previousFindingId: "pof_a" },
      { id: "n2", title: "Segundo", targetKind: "proposal_field", targetKey: "payment_terms", previousFindingId: "pof_a" },
    ]);
    expect(casados.filter((c) => c.anteriorId === "pof_a")).toHaveLength(1);
    expect(casados.find((c) => c.novoId === "n2")!.anteriorId).toBeNull();
  });
});

describe("casarApontamentos - o desempate determinístico exige seção E similaridade", () => {
  it("casa o título reescrito quando a seção-alvo é a mesma", () => {
    const casados = casarApontamentos(
      [ant("pof_a", "Condições de pagamento sem prazo definido", "payment_terms")],
      [{ id: "n1", title: "Prazo das condições de pagamento não definido", targetKind: "proposal_field", targetKey: "payment_terms" }]
    );
    expect(casados[0].origem).toBe("heuristica");
    expect(casados[0].similaridade).toBeGreaterThanOrEqual(LIMIAR_DE_SIMILARIDADE);
  });

  it("NÃO casa dois apontamentos distintos da mesma seção - o defeito de casar só por alvo", () => {
    const casados = casarApontamentos(
      [ant("pof_a", "Remover notas internas nas condições de pagamento", "payment_terms")],
      [{ id: "n1", title: "Parcelamento incompatível com o fluxo de caixa", targetKind: "proposal_field", targetKey: "payment_terms" }]
    );
    expect(casados[0].anteriorId).toBeNull();
  });

  it("NÃO casa títulos parecidos em seções diferentes", () => {
    const casados = casarApontamentos(
      [ant("pof_a", "Premissas comerciais ausentes", "commercial_assumptions")],
      [{ id: "n1", title: "Premissas comerciais ausentes", targetKind: "proposal_field", targetKey: "exclusions" }]
    );
    expect(casados[0].anteriorId).toBeNull();
  });

  it("casa dois apontamentos 'geral' pelo título, já que geral não tem chave", () => {
    const casados = casarApontamentos(
      [ant("pof_a", "Inconsistência de Moeda (USD vs BRL)", null)],
      [{ id: "n1", title: "Inconsistencia de moeda entre USD e BRL", targetKind: "geral", targetKey: null }]
    );
    expect(casados[0].anteriorId).toBe("pof_a");
  });
});

describe("compararRodadas", () => {
  const anterioresAbertos = [
    ant("pof_a", "Remover notas internas nas condições de pagamento", "payment_terms"),
    ant("pof_b", "Ajustar prazo de validade da proposta", "proposal_validity"),
    ant("pof_c", "Inconsistência de Moeda (USD vs BRL)", null),
  ];

  it("separa sanados, parciais e novos", () => {
    const novos: ApontamentoParaCasar[] = [
      { id: "n1", title: "Notas internas ainda presentes nas condições de pagamento", targetKind: "proposal_field", targetKey: "payment_terms", previousFindingId: "pof_a" },
      { id: "n2", title: "Falta cláusula de reajuste", targetKind: "geral", targetKey: null },
    ];
    const casados = casarApontamentos(anterioresAbertos, novos);
    const c = compararRodadas(anterioresAbertos, novos, casados);
    expect(c.parciais).toEqual(["n1"]);
    expect(c.novos).toEqual(["n2"]);
    expect(c.sanados.sort()).toEqual(["pof_b", "pof_c"]);
  });

  it("uma rodada nova vazia significa que TUDO que estava aberto foi sanado", () => {
    const c = compararRodadas(anterioresAbertos, [], []);
    expect(c.sanados).toHaveLength(3);
    expect(c.parciais).toHaveLength(0);
    expect(c.novos).toHaveLength(0);
  });

  it("comparar contra uma rodada anterior SEM apontamentos torna todos novos - verdade e inútil", () => {
    const novos: ApontamentoParaCasar[] = [
      { id: "n1", title: "Qualquer ponto", targetKind: "geral", targetKey: null },
    ];
    const c = compararRodadas([], novos, casarApontamentos([], novos));
    expect(c.novos).toEqual(["n1"]);
    expect(c.sanados).toHaveLength(0);
  });
});
