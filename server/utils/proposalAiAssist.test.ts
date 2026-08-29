import { describe, expect, it } from "vitest";
import {
  consolidarSugestoes,
  identificarVariaveisParaSugerir,
  montarPromptDeSugestao,
  podeSerSugeridaPelaIa,
} from "./proposalAiAssist";

describe("podeSerSugeridaPelaIa", () => {
  it("libera campo de texto que o modelo pode redigir", () => {
    expect(podeSerSugeridaPelaIa("resumo_executivo")).toBe(true);
    expect(podeSerSugeridaPelaIa("contexto_cliente")).toBe(true);
  });

  // Regra que este módulo não negocia: a IA não fabrica fato estruturado.
  it("bloqueia variável de laço, que carrega dado com fonte própria", () => {
    expect(podeSerSugeridaPelaIa("bom")).toBe(false);
    expect(podeSerSugeridaPelaIa("precificacao")).toBe(false);
    expect(podeSerSugeridaPelaIa("riscos")).toBe(false);
  });

  it("bloqueia campo interno de laço", () => {
    expect(podeSerSugeridaPelaIa("preco_unitario")).toBe(false);
    expect(podeSerSugeridaPelaIa("quantidade")).toBe(false);
    expect(podeSerSugeridaPelaIa("fabricante")).toBe(false);
  });

  it("bloqueia número e compromisso comercial, que são decisão humana", () => {
    expect(podeSerSugeridaPelaIa("preco_total")).toBe(false);
    expect(podeSerSugeridaPelaIa("termos_pagamento")).toBe(false);
    expect(podeSerSugeridaPelaIa("validade_proposta")).toBe(false);
    expect(podeSerSugeridaPelaIa("prazo_projeto")).toBe(false);
  });
});

describe("identificarVariaveisParaSugerir", () => {
  it("não toca em variável que os dados do projeto já preencheram", () => {
    const variaveis = identificarVariaveisParaSugerir(["cliente"], { cliente: "Prefeitura" });
    expect(variaveis).toEqual([]);
  });

  it("pega seção conhecida do catálogo que saiu vazia (frente b)", () => {
    const variaveis = identificarVariaveisParaSugerir(["resumo_executivo"], { resumo_executivo: "" });
    expect(variaveis).toHaveLength(1);
    expect(variaveis[0].origem).toBe("secao_de_texto");
    expect(variaveis[0].descricao).toBeTruthy();
  });

  it("pega placeholder livre que o resolvedor nem conhece (frente a)", () => {
    const variaveis = identificarVariaveisParaSugerir(["justificativa_da_escolha"], {});
    expect(variaveis).toHaveLength(1);
    expect(variaveis[0].origem).toBe("variavel_livre");
    expect(variaveis[0].descricao).toBeUndefined();
  });

  it("nunca oferece variável proibida, mesmo vazia", () => {
    const variaveis = identificarVariaveisParaSugerir(["preco_total", "bom", "termos_pagamento"], {
      preco_total: "",
      bom: [],
      termos_pagamento: "",
    });
    expect(variaveis).toEqual([]);
  });
});

describe("montarPromptDeSugestao", () => {
  const base = {
    variaveis: [{ nome: "justificativa_tecnica", origem: "variavel_livre" as const }],
    idioma: "Portuguese",
    projeto: { nome: "CFTV Municipal", cliente: "Prefeitura", vertical: "Segurança Pública", escopo: "200 câmeras" },
    analise: { resumo_executivo: { project_overview: "Modernização do parque de CFTV" } },
  };

  it("leva a análise real do projeto como fonte de fatos", () => {
    const prompt = montarPromptDeSugestao(base);
    expect(prompt).toContain("Modernização do parque de CFTV");
    expect(prompt).toContain("CFTV Municipal");
    expect(prompt).toContain("justificativa_tecnica");
  });

  it("proíbe explicitamente inventar número e compromisso comercial", () => {
    const prompt = montarPromptDeSugestao(base);
    expect(prompt).toMatch(/não introduza fato, número, prazo, marca, quantidade ou compromisso/i);
    expect(prompt).toMatch(/decisão comercial humana/i);
  });

  it("manda devolver vazio quando falta material, em vez de inventar", () => {
    expect(montarPromptDeSugestao(base)).toMatch(/campo vazio honesto é melhor que um texto plausível inventado/i);
  });
});

describe("consolidarSugestoes", () => {
  const pedidas = [
    { nome: "resumo_executivo", origem: "secao_de_texto" as const },
    { nome: "justificativa_tecnica", origem: "variavel_livre" as const },
  ];

  it("mantém a origem de cada campo na sugestão devolvida", () => {
    const sugestoes = consolidarSugestoes(pedidas, [
      { variavel: "resumo_executivo", valor_sugerido: "Texto do resumo", justificativa: "da análise" },
    ]);
    expect(sugestoes).toHaveLength(1);
    expect(sugestoes[0].origem).toBe("secao_de_texto");
  });

  // Um modelo pode responder com um campo que ninguém pediu - inclusive um proibido.
  it("descarta campo que este servidor não pediu", () => {
    const sugestoes = consolidarSugestoes(pedidas, [
      { variavel: "preco_total", valor_sugerido: "999.999,00", justificativa: "inventado" },
    ]);
    expect(sugestoes).toEqual([]);
  });

  it("descarta sugestão vazia, que é o modelo dizendo que não tem material", () => {
    const sugestoes = consolidarSugestoes(pedidas, [
      { variavel: "resumo_executivo", valor_sugerido: "   ", justificativa: "sem material" },
    ]);
    expect(sugestoes).toEqual([]);
  });
});
