import { describe, it, expect } from "vitest";
import { apontamentosQueBarramEnvio, mensagemDoGateDeEnvio, type ApontamentoParaGate } from "./proposalSubmissionGate";

const a = (over: Partial<ApontamentoParaGate>): ApontamentoParaGate => ({
  id: "pof_x", title: "Um apontamento", severity: "critical", status: "aberto", resolutionNote: null, targetKey: null, ...over,
});

describe("apontamentosQueBarramEnvio", () => {
  it("barra o crítico em aberto", () => {
    expect(apontamentosQueBarramEnvio([a({})])).toHaveLength(1);
  });

  it("barra o crítico em tratativa - começar a tratar não é ter tratado", () => {
    expect(apontamentosQueBarramEnvio([a({ status: "em_tratativa" })])).toHaveLength(1);
  });

  it("NÃO barra o crítico aceito com risco COM justificativa - é a saída explícita do gate", () => {
    expect(apontamentosQueBarramEnvio([a({ status: "aceito_com_risco", resolutionNote: "Cliente ciente, contrato cobre." })])).toHaveLength(0);
  });

  it("BARRA o aceito com risco sem justificativa, mesmo com o status certo", () => {
    expect(apontamentosQueBarramEnvio([a({ status: "aceito_com_risco", resolutionNote: "   " })])).toHaveLength(1);
  });

  it("não barra crítico resolvido nem descartado", () => {
    expect(apontamentosQueBarramEnvio([
      a({ status: "resolvido" }),
      a({ status: "descartado", resolutionNote: "não procede" }),
    ])).toHaveLength(0);
  });

  it("não barra warning nem info em aberto - aviso não impede aprovação", () => {
    expect(apontamentosQueBarramEnvio([a({ severity: "warning" }), a({ severity: "info" })])).toHaveLength(0);
  });

  it("lista vazia abre o portão", () => {
    expect(apontamentosQueBarramEnvio([])).toHaveLength(0);
  });

  it("devolve TODOS os que barram, não apenas o primeiro - a mensagem precisa nomear cada um", () => {
    const barrando = apontamentosQueBarramEnvio([
      a({ id: "p1" }), a({ id: "p2", status: "em_tratativa" }), a({ id: "p3", severity: "warning" }),
    ]);
    expect(barrando.map((x) => x.id)).toEqual(["p1", "p2"]);
  });
});

describe("mensagemDoGateDeEnvio", () => {
  it("nomeia o apontamento e diz a saída", () => {
    const m = mensagemDoGateDeEnvio([a({ title: "Inconsistência de Moeda", targetKey: "payment_terms" })]);
    expect(m).toContain("Inconsistência de Moeda");
    expect(m).toContain("payment_terms");
    expect(m).toContain("aceito com risco");
  });

  it("concorda no plural com mais de um bloqueante", () => {
    const m = mensagemDoGateDeEnvio([a({ id: "1", title: "A" }), a({ id: "2", title: "B" })]);
    expect(m).toContain("2 apontamentos críticos");
    expect(m).toContain("continuam em aberto");
  });

  it("distingue o aceito sem justificativa de um simples aberto", () => {
    const m = mensagemDoGateDeEnvio([a({ status: "aceito_com_risco", resolutionNote: "" })]);
    expect(m).toContain("sem justificativa registrada");
  });
});
