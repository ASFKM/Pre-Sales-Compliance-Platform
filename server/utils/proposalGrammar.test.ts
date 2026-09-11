import { describe, it, expect } from "vitest";
import { localizarCorrecoes, aplicarCorrecao, reposicionarAposAplicar } from "./proposalGrammar";

const TEXTO = "A entrega sera realizada em 30 dias. O pagamento sera feito a vista. A entrega inclui instalacao.";

describe("localizarCorrecoes", () => {
  it("localiza cada trecho e devolve o offset onde ele começa", () => {
    const c = localizarCorrecoes(TEXTO, [{ trecho_original: "sera realizada", trecho_corrigido: "será realizada", motivo: "acentuação" }]);
    expect(c).toHaveLength(1);
    expect(TEXTO.slice(c[0].offset, c[0].offset + c[0].trecho_original.length)).toBe("sera realizada");
  });

  it("DESCARTA a correção cujo trecho não existe literalmente - senão o botão aceitar não mudaria nada", () => {
    const c = localizarCorrecoes(TEXTO, [{ trecho_original: "sera  realizada", trecho_corrigido: "será realizada", motivo: "x" }]);
    expect(c).toHaveLength(0);
  });

  it("descarta a correção que devolve o trecho igual ao original", () => {
    const c = localizarCorrecoes(TEXTO, [{ trecho_original: "A entrega", trecho_corrigido: "A entrega", motivo: "x" }]);
    expect(c).toHaveLength(0);
  });

  it("duas correções sobre a mesma palavra repetida pegam ocorrências diferentes", () => {
    const c = localizarCorrecoes(TEXTO, [
      { trecho_original: "A entrega", trecho_corrigido: "A entrega do sistema", motivo: "1" },
      { trecho_original: "A entrega", trecho_corrigido: "A entrega final", motivo: "2" },
    ]);
    expect(c).toHaveLength(2);
    expect(c[0].offset).not.toBe(c[1].offset);
  });

  it("devolve as correções em ordem de posição no texto", () => {
    const c = localizarCorrecoes(TEXTO, [
      { trecho_original: "instalacao", trecho_corrigido: "instalação", motivo: "b" },
      { trecho_original: "sera realizada", trecho_corrigido: "será realizada", motivo: "a" },
    ]);
    expect(c.map((x) => x.trecho_original)).toEqual(["sera realizada", "instalacao"]);
  });
});

describe("aplicarCorrecao - aceitar UMA muda só aquele trecho", () => {
  it("substitui exatamente o trecho do offset e preserva o resto", () => {
    const [correcao] = localizarCorrecoes(TEXTO, [{ trecho_original: "instalacao", trecho_corrigido: "instalação", motivo: "acentuação" }]);
    const novo = aplicarCorrecao(TEXTO, correcao)!;
    expect(novo).toBe("A entrega sera realizada em 30 dias. O pagamento sera feito a vista. A entrega inclui instalação.");
    expect(novo).toContain("sera realizada");
  });

  it("aplica na SEGUNDA ocorrência quando é dela que a correção trata", () => {
    const correcoes = localizarCorrecoes(TEXTO, [
      { trecho_original: "A entrega", trecho_corrigido: "A entrega do sistema", motivo: "1" },
      { trecho_original: "A entrega", trecho_corrigido: "A instalação", motivo: "2" },
    ]);
    const alvo = correcoes.find((c) => c.trecho_corrigido === "A instalação")!;
    expect(aplicarCorrecao(TEXTO, alvo)).toBe(TEXTO.replace(/A entrega inclui/, "A instalação inclui"));
  });

  it("recusa aplicar quando o texto mudou embaixo da correção", () => {
    const [correcao] = localizarCorrecoes(TEXTO, [{ trecho_original: "instalacao", trecho_corrigido: "instalação", motivo: "x" }]);
    expect(aplicarCorrecao("Outro texto qualquer, bem mais curto.", correcao)).toBeNull();
  });
});

describe("reposicionarAposAplicar - recusar não muda nada, aceitar desloca o que vem depois", () => {
  it("remove a aplicada e desloca só as posteriores", () => {
    const correcoes = localizarCorrecoes(TEXTO, [
      { trecho_original: "sera realizada", trecho_corrigido: "será realizada", motivo: "a" },
      { trecho_original: "instalacao", trecho_corrigido: "instalação", motivo: "b" },
    ]);
    const aplicada = correcoes[0];
    const texto2 = aplicarCorrecao(TEXTO, aplicada)!;
    const restantes = reposicionarAposAplicar(correcoes, aplicada);
    expect(restantes).toHaveLength(1);
    expect(texto2.slice(restantes[0].offset, restantes[0].offset + restantes[0].trecho_original.length)).toBe("instalacao");
  });

  it("recusar uma correção deixa o texto e as demais intactos", () => {
    const correcoes = localizarCorrecoes(TEXTO, [
      { trecho_original: "sera realizada", trecho_corrigido: "será realizada", motivo: "a" },
      { trecho_original: "instalacao", trecho_corrigido: "instalação", motivo: "b" },
    ]);
    const restantes = correcoes.filter((c) => c.id !== correcoes[0].id);
    expect(TEXTO.slice(restantes[0].offset, restantes[0].offset + restantes[0].trecho_original.length)).toBe("instalacao");
  });
});
