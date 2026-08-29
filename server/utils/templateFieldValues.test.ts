import { describe, expect, it } from "vitest";
import { buildTemplateVariables } from "./docxTemplateEngine";
import type { DocxTemplateData } from "./docx";

/*
 * F6: a regra de precedência dos campos livres aprovados por uma pessoa.
 *
 * Este é o teste que protege a garantia mais delicada da fase: um texto aprovado preenche o que
 * sairia em branco e NUNCA substitui um dado que o sistema conhece. Sem isso, uma sugestão aceita
 * sem atenção poderia trocar o nome do cliente ou um preço no documento que vai ao cliente.
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

  it("NÃO sobrescreve um valor que já veio preenchido pela análise", () => {
    const dados = dadosBase({
      analysis: { executive_summary: { project_overview: "Resumo real da análise" } },
      templateFieldValues: { resumo_executivo: "Texto que não deve entrar" },
    });
    const vars = buildTemplateVariables(dados) as Record<string, unknown>;
    expect(vars.resumo_executivo).toBe("Resumo real da análise");
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
