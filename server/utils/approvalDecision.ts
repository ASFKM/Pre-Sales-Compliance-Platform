// PreSales F8 (PARTE A) - motivo de rejeição obrigatório.
//
// A regra vive aqui, pura e sem banco, pelo mesmo motivo que
// server/utils/proposalTypes.ts's getRejectedEditableFields vive fora da rota: é a parte que dá
// para provar por teste unitário sem subir Postgres, e o resto (RBAC de etapa, decisão duplicada,
// transição de status) é provado por execução real contra o servidor.
//
// O defeito que ela corrige: `ApprovalDecision.comments` sempre foi `String @db.Text` NOT NULL no
// schema Prisma, mas server/routes/approvals.ts gravava `comments || ""` - a coluna obrigatória
// aceitava vazio sem erro nenhum, e uma proposta podia ser RECUSADA sem que ninguém registrasse
// por quê. Quem paga isso é o vendedor, que recebe a recusa e não tem o que corrigir na versão
// seguinte (a reabertura pós-rejeição, POST /proposals/:id/reopen, é o outro lado desta fase).
//
// Aprovação continua aceitando comentário vazio - ali o comentário é mesmo opcional, e exigi-lo
// quebraria compatibilidade com todo cliente/script que aprova sem texto. O que NÃO é opcional em
// nenhum dos dois casos é o tipo: um `comments` que não é string nunca pode virar texto por
// coerção implícita.

export type ApprovalDecisionValue = "approved" | "rejected";

export type ApprovalCommentsValidation =
  | { valid: true; comments: string }
  | { valid: false; message: string };

export const REJECTION_REASON_REQUIRED_MESSAGE =
  "A rejection requires a reason: the 'comments' field must contain a non-empty justification.";

export const COMMENTS_MUST_BE_STRING_MESSAGE =
  "Approval decision comments must be a string.";

export function validateApprovalDecisionComments(
  decision: ApprovalDecisionValue,
  comments: unknown
): ApprovalCommentsValidation {
  if (comments != null && typeof comments !== "string") {
    return { valid: false, message: COMMENTS_MUST_BE_STRING_MESSAGE };
  }

  // `trim()` e não `length` cru: um motivo feito só de espaços/quebras de linha é exatamente o
  // mesmo vazio, só que mais difícil de ver na tela de quem recebeu a recusa.
  const normalized = typeof comments === "string" ? comments.trim() : "";

  if (decision === "rejected" && normalized.length === 0) {
    return { valid: false, message: REJECTION_REASON_REQUIRED_MESSAGE };
  }

  return { valid: true, comments: normalized };
}
