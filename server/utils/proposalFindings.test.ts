import { describe, expect, it } from "vitest";
import { exigeJustificativa, ehStatusFechado, recortarApontamento } from "./proposalFindings";

/*
 * F6: as duas garantias do apontamento que precisam valer no SERVIDOR.
 *
 * A primeira é a que o dono da fase pediu para provar na tela: sem justificativa, "aceito com
 * risco" não acontece. A segunda é a que impede o modelo de escolher onde escrever.
 */

const ALVOS_DE_PROPOSTA = new Set(["payment_terms", "delivery_terms", "exclusions"]);
const ALVOS_DE_TEMPLATE = new Set(["resumo_executivo", "principais_riscos"]);

describe("ciclo do apontamento", () => {
  it("aceitar com risco e descartar exigem justificativa", () => {
    expect(exigeJustificativa("aceito_com_risco")).toBe(true);
    expect(exigeJustificativa("descartado")).toBe(true);
  });

  // O contrapeso: resolver não exige, porque a prova de um "resolvido" é a mudança na seção, que o
  // histórico já registra. Se este teste inverter um dia, o campo vai acabar preenchido com "ok".
  it("abrir, tratar e resolver NÃO exigem justificativa", () => {
    expect(exigeJustificativa("aberto")).toBe(false);
    expect(exigeJustificativa("em_tratativa")).toBe(false);
    expect(exigeJustificativa("resolvido")).toBe(false);
  });

  it("só os status de fechamento carimbam autor e instante", () => {
    expect(ehStatusFechado("aberto")).toBe(false);
    expect(ehStatusFechado("em_tratativa")).toBe(false);
    expect(ehStatusFechado("resolvido")).toBe(true);
    expect(ehStatusFechado("aceito_com_risco")).toBe(true);
    expect(ehStatusFechado("descartado")).toBe(true);
  });
});

describe("recorte do alvo de um apontamento", () => {
  const base = { title: "T", detail: "D", severity: "warning" as const };

  it("mantém um alvo de campo da proposta que este tipo realmente possui", () => {
    const r = recortarApontamento(
      { ...base, target_kind: "proposal_field", target_key: "payment_terms", suggested_value: "45 dias" },
      ALVOS_DE_PROPOSTA,
      ALVOS_DE_TEMPLATE
    );
    expect(r.targetKind).toBe("proposal_field");
    expect(r.targetKey).toBe("payment_terms");
    expect(r.suggestedValue).toBe("45 dias");
  });

  it("mantém uma seção de texto do template", () => {
    const r = recortarApontamento(
      { ...base, target_kind: "template_field", target_key: "resumo_executivo", suggested_value: "Texto novo" },
      ALVOS_DE_PROPOSTA,
      ALVOS_DE_TEMPLATE
    );
    expect(r.targetKind).toBe("template_field");
    expect(r.suggestedValue).toBe("Texto novo");
  });

  /*
   * A garantia central deste bloco: um campo que o modelo inventou, um que este tipo de proposta
   * não tem, ou um fato do sistema (preço, cliente, BOM) DESCEM para "geral" - o texto do
   * apontamento sobrevive, o botão de aplicar não.
   */
  it.each([
    ["campo inventado", "proposal_field", "margem_de_lucro"],
    ["campo de outro tipo de proposta", "proposal_field", "commercial_assumptions"],
    ["preço, que o sistema calcula", "template_field", "preco_total"],
    ["cliente, que vem do cadastro", "template_field", "cliente"],
    ["BOM, que é laço", "template_field", "bom"],
  ])("desce para geral: %s", (_rotulo, kind, key) => {
    const r = recortarApontamento(
      { ...base, target_kind: kind, target_key: key, suggested_value: "valor forjado" },
      ALVOS_DE_PROPOSTA,
      ALVOS_DE_TEMPLATE
    );
    expect(r.targetKind).toBe("geral");
    expect(r.targetKey).toBeNull();
    expect(r.suggestedValue).toBeNull();
    // O que NÃO se perde: o apontamento continua legível e acionável na tela.
    expect(r.title).toBe("T");
    expect(r.detail).toBe("D");
  });

  it("um apontamento sem alvo nasce geral, sem isso ser erro", () => {
    const r = recortarApontamento(
      { ...base, target_kind: "geral", target_key: null, suggested_value: null },
      ALVOS_DE_PROPOSTA,
      ALVOS_DE_TEMPLATE
    );
    expect(r.targetKind).toBe("geral");
    expect(r.severity).toBe("warning");
  });

  it("alvo válido com target_key só de espaços não vira alvo", () => {
    const r = recortarApontamento(
      { ...base, target_kind: "template_field", target_key: "   ", suggested_value: "x" },
      ALVOS_DE_PROPOSTA,
      ALVOS_DE_TEMPLATE
    );
    expect(r.targetKind).toBe("geral");
  });
});
