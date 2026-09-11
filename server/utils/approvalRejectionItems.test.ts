import { describe, expect, it } from "vitest";
import {
  validateRejectionItems,
  ITENS_SO_EM_REJEICAO_MESSAGE,
  ITENS_DEVEM_SER_LISTA_MESSAGE,
  LIMITE_DE_ITENS_POR_REJEICAO,
} from "./approvalRejectionItems";

/*
 * F8 — a rejeição estruturada por seção.
 *
 * O contrato que estes testes protegem, além da validação em si: os itens são um ACRÉSCIMO ao
 * `comments` obrigatório, nunca um substituto (isso é provado em approvalDecision.test.ts, que
 * continua valendo), e a APROVAÇÃO não leva ressalva.
 */
describe("F8 — validateRejectionItems", () => {
  it("ausência de itens é o caso normal: rejeitar só com texto livre continua valendo", () => {
    expect(validateRejectionItems("rejected", undefined)).toEqual({ valid: true, items: [] });
    expect(validateRejectionItems("rejected", null)).toEqual({ valid: true, items: [] });
  });

  it("aceita VÁRIOS itens e numera o ordinal na ordem enviada", () => {
    const r = validateRejectionItems("rejected", [
      { target_kind: "template_field", target_key: "escopo_tecnico", comment: "Falta o prazo de implantação." },
      { target_kind: "proposal_field", target_key: "payment_terms", comment: "  30/60/90 não foi aprovado pela diretoria.  " },
    ]);
    expect(r.valid).toBe(true);
    expect(r.valid && r.items).toEqual([
      { ordinal: 1, targetKind: "template_field", targetKey: "escopo_tecnico", comment: "Falta o prazo de implantação." },
      { ordinal: 2, targetKind: "proposal_field", targetKey: "payment_terms", comment: "30/60/90 não foi aprovado pela diretoria." },
    ]);
  });

  it("aceita DUAS observações sobre a MESMA seção — são dois problemas diferentes", () => {
    const r = validateRejectionItems("rejected", [
      { target_kind: "template_field", target_key: "escopo_tecnico", comment: "Falta prazo." },
      { target_kind: "template_field", target_key: "escopo_tecnico", comment: "Falta a matriz de responsabilidade." },
    ]);
    expect(r.valid).toBe(true);
    expect(r.valid && r.items).toHaveLength(2);
  });

  it("APROVAÇÃO com itens é recusada — a aprovação não leva ressalva", () => {
    const r = validateRejectionItems("approved", [{ target_kind: "geral", comment: "Ok, mas revejam a margem." }]);
    expect(r).toEqual({ valid: false, message: ITENS_SO_EM_REJEICAO_MESSAGE });
  });

  it("APROVAÇÃO com lista VAZIA passa — é o que todo cliente antigo manda", () => {
    expect(validateRejectionItems("approved", [])).toEqual({ valid: true, items: [] });
  });

  it("recusa item sem comentário, inclusive comentário só de espaços", () => {
    for (const comment of ["", "   ", "\n\t "]) {
      const r = validateRejectionItems("rejected", [{ target_kind: "geral", comment }]);
      expect(r.valid).toBe(false);
      expect(r.valid === false && r.message).toContain("Item 1 da rejeição");
    }
    const semCampo = validateRejectionItems("rejected", [{ target_kind: "geral" }]);
    expect(semCampo.valid).toBe(false);
  });

  it("recusa target_kind fora do vocabulário do apontamento", () => {
    const r = validateRejectionItems("rejected", [{ target_kind: "secao_qualquer", target_key: "x", comment: "c" }]);
    expect(r.valid).toBe(false);
    expect(r.valid === false && r.message).toContain("target_kind");
  });

  it("exige target_key em proposal_field e template_field, e NÃO exige em geral", () => {
    expect(validateRejectionItems("rejected", [{ target_kind: "proposal_field", comment: "c" }]).valid).toBe(false);
    expect(validateRejectionItems("rejected", [{ target_kind: "template_field", target_key: "  ", comment: "c" }]).valid).toBe(false);
    const geral = validateRejectionItems("rejected", [{ target_kind: "geral", target_key: "ignorada", comment: "c" }]);
    expect(geral.valid).toBe(true);
    // "geral" nunca carrega chave: ela é descartada, não propagada.
    expect(geral.valid && geral.items[0].targetKey).toBeNull();
  });

  it("recusa tipos errados sem coerção implícita", () => {
    expect(validateRejectionItems("rejected", "isto não é lista")).toEqual({ valid: false, message: ITENS_DEVEM_SER_LISTA_MESSAGE });
    expect(validateRejectionItems("rejected", [{ target_kind: "geral", comment: 42 }]).valid).toBe(false);
    expect(validateRejectionItems("rejected", [{ target_kind: "template_field", target_key: 7, comment: "c" }]).valid).toBe(false);
  });

  it("recusa acima do limite de itens por rejeição", () => {
    const muitos = Array.from({ length: LIMITE_DE_ITENS_POR_REJEICAO + 1 }, (_, i) => ({
      target_kind: "geral",
      comment: `item ${i}`,
    }));
    const r = validateRejectionItems("rejected", muitos);
    expect(r.valid).toBe(false);
    expect(r.valid === false && r.message).toContain(String(LIMITE_DE_ITENS_POR_REJEICAO));
    expect(validateRejectionItems("rejected", muitos.slice(0, LIMITE_DE_ITENS_POR_REJEICAO)).valid).toBe(true);
  });
});
