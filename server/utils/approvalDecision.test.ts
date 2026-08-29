import { describe, expect, it } from "vitest";
import {
  validateApprovalDecisionComments,
  REJECTION_REASON_REQUIRED_MESSAGE,
  COMMENTS_MUST_BE_STRING_MESSAGE,
} from "./approvalDecision";

// PreSales F8 (PARTE A) - o motivo da rejeição.
//
// O defeito que estes testes travam: server/routes/approvals.ts gravava `comments: comments || ""`
// numa coluna NOT NULL, então uma REJEIÇÃO sem motivo era aceita e ficava registrada como texto
// vazio. Cada caso abaixo falha contra o código antigo.
describe("PreSales F8 — validateApprovalDecisionComments (rejeição exige motivo)", () => {
  it("recusa rejeição sem nenhum comments", () => {
    const result = validateApprovalDecisionComments("rejected", undefined);
    expect(result.valid).toBe(false);
    expect(result).toMatchObject({ message: REJECTION_REASON_REQUIRED_MESSAGE });
  });

  it("recusa rejeição com string vazia", () => {
    expect(validateApprovalDecisionComments("rejected", "").valid).toBe(false);
  });

  it("recusa rejeição com motivo só de espaços em branco", () => {
    // Este é o caso que um `if (!comments)` cru deixaria passar - e na tela do vendedor um motivo
    // de espaços é indistinguível de motivo nenhum.
    expect(validateApprovalDecisionComments("rejected", "   \n\t  ").valid).toBe(false);
  });

  it("recusa rejeição com null explícito", () => {
    expect(validateApprovalDecisionComments("rejected", null).valid).toBe(false);
  });

  it("aceita rejeição com motivo real, e devolve o texto sem as bordas em branco", () => {
    const result = validateApprovalDecisionComments("rejected", "  Margem abaixo do mínimo da alçada.  ");
    expect(result).toEqual({ valid: true, comments: "Margem abaixo do mínimo da alçada." });
  });

  it("mantém a compatibilidade: aprovação sem comentário continua válida", () => {
    expect(validateApprovalDecisionComments("approved", undefined)).toEqual({ valid: true, comments: "" });
    expect(validateApprovalDecisionComments("approved", "")).toEqual({ valid: true, comments: "" });
    expect(validateApprovalDecisionComments("approved", "   ")).toEqual({ valid: true, comments: "" });
  });

  it("aprovação com comentário preserva o texto", () => {
    expect(validateApprovalDecisionComments("approved", " Margens conferidas. ")).toEqual({
      valid: true,
      comments: "Margens conferidas.",
    });
  });

  it("recusa comments que não é string, nos dois tipos de decisão (nada de coerção implícita)", () => {
    for (const decision of ["approved", "rejected"] as const) {
      for (const bogus of [42, true, { text: "x" }, ["x"]]) {
        const result = validateApprovalDecisionComments(decision, bogus);
        expect(result.valid).toBe(false);
        expect(result).toMatchObject({ message: COMMENTS_MUST_BE_STRING_MESSAGE });
      }
    }
  });
});
