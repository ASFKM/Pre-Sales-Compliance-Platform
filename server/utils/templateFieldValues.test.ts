import { describe, expect, it } from "vitest";
import { buildTemplateVariables } from "./docxTemplateEngine";
import type { DocxTemplateData } from "./docx";

/*
 * A regra de precedência dos campos de template aprovados por uma pessoa.
 *
 * F6 da rodada 09/2026 REESCREVEU esta regra, e este arquivo registra a troca. Antes: "preenche o
 * vazio, nunca substitui o conhecido" - um texto aprovado só ocupava variável em branco, e era
 * isso que protegia `cliente`. Agora: substituição explícita, limitada por uma allowlist
 * (podeSerSubstituidaPorTextoAprovado, server/utils/proposalAiAssist.ts).
 *
 * A garantia protegida aqui NÃO mudou de conteúdo, só de mecanismo: nenhum texto aprovado troca
 * `cliente`, um laço (BOM), um preço ou uma quantidade. O que mudou é que uma seção REDIGIDA
 * (resumo executivo e afins) passou a poder ser corrigida - sem isso, um apontamento de parecer
 * apontaria para um texto que ninguém consegue trocar, e a fase inteira não fecharia.
 */

function dadosBase(overrides: Partial<DocxTemplateData> = {}): DocxTemplateData {
  return {
    project: {
      name: "CFTV Municipal",
      customer_name: "Prefeitura de Exemplo",
      description: "200 câmeras",
      vertical: "Segurança Pública",
    },
    analysis: {
      executive_summary: {},
      bom: [{ equipment_name: "Câmera IP", quantity: 2, unit: "un" }],
    },
    ...overrides,
  } as DocxTemplateData;
}

describe("campos livres aprovados no merge do template", () => {
  it("preenche variável livre que o resolvedor não conhece", () => {
    const vars = buildTemplateVariables(
      dadosBase({ templateFieldValues: { justificativa_tecnica: "Texto aprovado pelo pré-vendas" } })
    ) as Record<string, unknown>;
    expect(vars.justificativa_tecnica).toBe("Texto aprovado pelo pré-vendas");
  });

  it("preenche seção do catálogo que a análise deixou vazia", () => {
    const vars = buildTemplateVariables(
      dadosBase({ templateFieldValues: { resumo_executivo: "Resumo redigido e aprovado" } })
    ) as Record<string, unknown>;
    expect(vars.resumo_executivo).toBe("Resumo redigido e aprovado");
  });

  // A garantia central: dado do sistema vence sempre.
  it("NÃO sobrescreve o nome do cliente, que vem do cadastro", () => {
    const vars = buildTemplateVariables(
      dadosBase({ templateFieldValues: { cliente: "Cliente Falsificado" } })
    ) as Record<string, unknown>;
    expect(vars.cliente).toBe("Prefeitura de Exemplo");
  });

  it("NÃO sobrescreve um laço como o BOM", () => {
    const vars = buildTemplateVariables(
      dadosBase({ templateFieldValues: { bom: "lista inventada" } })
    ) as Record<string, unknown>;
    expect(Array.isArray(vars.bom)).toBe(true);
    expect((vars.bom as any[])[0].equipamento).toBe("Câmera IP");
  });

  /*
   * MUDANÇA DELIBERADA DA F6, e a única do arquivo. Este teste afirmava o contrário ("NÃO
   * sobrescreve um valor que já veio preenchido pela análise") sob a regra do vazio. A regra nova
   * é o oposto para seções redigidas, e por isso a asserção inverte: uma seção que a análise
   * escreveu mal é exatamente o que um apontamento de parecer manda corrigir, e o ciclo do
   * apontamento (aberto -> resolvido) só fecha quando o documento realmente muda.
   */
  it("SUBSTITUI uma seção redigida que a análise havia preenchido (regra nova da F6)", () => {
    const dados = dadosBase({
      analysis: { executive_summary: { project_overview: "Resumo real da análise" } },
      templateFieldValues: { resumo_executivo: "Resumo corrigido após o parecer técnico" },
    });
    const vars = buildTemplateVariables(dados) as Record<string, unknown>;
    expect(vars.resumo_executivo).toBe("Resumo corrigido após o parecer técnico");
  });

  /*
   * O contrapeso da mudança acima: os fatos de cadastro continuam intocáveis, agora pela allowlist
   * e não pela regra do vazio. Se algum dia alguém remover um destes nomes de
   * FATOS_DE_CADASTRO_QUE_NINGUEM_SOBRESCREVE, é aqui que a remoção aparece.
   */
  it.each([
    ["projeto", "CFTV Municipal"],
    ["vertical", "Segurança Pública"],
    ["escopo", "200 câmeras"],
  ])("NÃO sobrescreve o fato de cadastro %s", (campo, esperado) => {
    const vars = buildTemplateVariables(
      dadosBase({ templateFieldValues: { [campo]: "Valor forjado" } })
    ) as Record<string, unknown>;
    expect(vars[campo]).toBe(esperado);
  });

  it("NÃO sobrescreve preço nem os termos comerciais, que têm edição estruturada própria", () => {
    const vars = buildTemplateVariables(
      dadosBase({
        proposal: { payment_terms: "45 dias" },
        templateFieldValues: {
          preco_total: "1,00",
          termos_pagamento: "à vista, sem garantia",
          prazo_projeto: "ontem",
        },
      })
    ) as Record<string, unknown>;
    expect(vars.preco_total).not.toBe("1,00");
    expect(vars.termos_pagamento).toBe("45 dias");
    expect(vars.prazo_projeto).not.toBe("ontem");
  });

  it("NÃO sobrescreve um campo interno de laço pelo nome dele", () => {
    const vars = buildTemplateVariables(
      dadosBase({ templateFieldValues: { quantidade: "9999", equipamento: "Item inventado" } })
    ) as Record<string, unknown>;
    expect(vars.quantidade).toBeUndefined();
    expect(vars.equipamento).toBeUndefined();
    expect((vars.bom as any[])[0].quantidade).toBe(2);
  });

  it("ignora valor vazio, que não é preenchimento nenhum", () => {
    const vars = buildTemplateVariables(
      dadosBase({ templateFieldValues: { justificativa_tecnica: "   " } })
    ) as Record<string, unknown>;
    expect(vars.justificativa_tecnica).toBeUndefined();
  });

  it("sem campos aprovados, o resultado é idêntico ao de sempre", () => {
    const semCampo = buildTemplateVariables(dadosBase()) as Record<string, unknown>;
    const comCampoNulo = buildTemplateVariables(dadosBase({ templateFieldValues: null })) as Record<string, unknown>;
    expect(comCampoNulo).toEqual(semCampo);
  });
});
