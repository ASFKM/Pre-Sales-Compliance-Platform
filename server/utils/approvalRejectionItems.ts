/*
 * F8 (rodada 09/2026): a REJEIÇÃO ESTRUTURADA POR SEÇÃO — as regras, fora da rota.
 *
 * O que muda: rejeitar deixa de ser só um texto corrido e passa a poder apontar SEÇÕES ("nesta
 * seção, isto aqui"), várias por rejeição. O aprovador escolhe a seção, vê o texto atual ao lado e
 * escreve o comentário embaixo.
 *
 * O que NÃO muda, e é o ponto delicado desta fase: `ApprovalDecision.comments` continua sendo o
 * RESUMO da decisão e continua OBRIGATÓRIO na rejeição (server/utils/approvalDecision.ts). Os itens
 * são um acréscimo ao lado dele, nunca um substituto. A decisão da rodada foi "itens por seção OU
 * texto livre — pelo menos um dos dois"; como `comments` já é exigido em toda rejeição, essa
 * condição está satisfeita pelo contrato antigo, e enfraquecê-la para "agora que há itens, o resumo
 * é opcional" quebraria duas provas existentes (o teste unitário de approvalDecision e
 * scripts/regression-approval-rbac.sh) e tiraria do vendedor a frase que ele lê primeiro.
 *
 * APROVAÇÃO NÃO LEVA ITEM. Decisão da rodada: a aprovação não carrega ressalva — o que precisa
 * mudar se rejeita. Mandar itens junto de um "approved" é recusado com 400, e não ignorado em
 * silêncio: um cliente que mande ressalvas numa aprovação está pedindo algo que o produto não faz,
 * e engolir isso faria o aprovador acreditar que registrou uma condição que ninguém veria.
 *
 * Onde esta validação entra na rota: DEPOIS da de `comments` e ANTES da checagem de aprovador
 * (403). A ordem de respostas de POST /proposals/:id/approval/decision é contrato exercitado por
 * scripts/regression-approval-rbac.sh (404 -> 400 status -> 400 decisão -> 400 motivo -> 403
 * aprovador -> 409 duplicada); inserir aqui acrescenta um 400 num ponto que nenhum caso do script
 * atravessa e não move nenhuma das posições existentes.
 */

// O mesmo vocabulário de alvo de ProposalOpinionFinding.targetKind. Reusá-lo é o que permite que o
// item vire apontamento na reabertura sem tradução no meio - ver server/utils/approverFindings.ts.
export const TIPOS_DE_ALVO_DO_ITEM = ["proposal_field", "template_field", "geral"] as const;
export type TipoDeAlvoDoItem = (typeof TIPOS_DE_ALVO_DO_ITEM)[number];

export const LIMITE_DE_ITENS_POR_REJEICAO = 20;

export interface ItemDeRejeicaoBruto {
  target_kind?: unknown;
  target_key?: unknown;
  comment?: unknown;
}

export interface ItemDeRejeicaoValido {
  ordinal: number;
  targetKind: TipoDeAlvoDoItem;
  targetKey: string | null;
  comment: string;
}

export type ValidacaoDeItens =
  | { valid: true; items: ItemDeRejeicaoValido[] }
  | { valid: false; message: string };

export const ITENS_SO_EM_REJEICAO_MESSAGE =
  "Uma aprovação não leva ressalva: itens por seção só existem em uma rejeição. Se há algo a corrigir, rejeite apontando a seção.";

export const ITENS_DEVEM_SER_LISTA_MESSAGE =
  "O campo 'items' deve ser uma lista de itens de rejeição.";

export function validateRejectionItems(
  decision: "approved" | "rejected",
  itens: unknown
): ValidacaoDeItens {
  // Ausente é o caso normal: rejeitar só com o texto livre continua valendo.
  if (itens == null) {
    return { valid: true, items: [] };
  }

  if (!Array.isArray(itens)) {
    return { valid: false, message: ITENS_DEVEM_SER_LISTA_MESSAGE };
  }

  // Lista vazia numa aprovação é o que todo cliente antigo manda quando o campo existe mas ninguém
  // preencheu - tratá-la como "mandou ressalva" recusaria aprovações legítimas.
  if (itens.length === 0) {
    return { valid: true, items: [] };
  }

  if (decision !== "rejected") {
    return { valid: false, message: ITENS_SO_EM_REJEICAO_MESSAGE };
  }

  if (itens.length > LIMITE_DE_ITENS_POR_REJEICAO) {
    return {
      valid: false,
      message: `Uma rejeição aceita no máximo ${LIMITE_DE_ITENS_POR_REJEICAO} itens por seção; foram enviados ${itens.length}.`,
    };
  }

  const validados: ItemDeRejeicaoValido[] = [];

  for (let i = 0; i < itens.length; i++) {
    const bruto = (itens[i] ?? {}) as ItemDeRejeicaoBruto;
    const posicao = i + 1;

    const targetKind = bruto.target_kind as TipoDeAlvoDoItem;
    if (typeof targetKind !== "string" || !(TIPOS_DE_ALVO_DO_ITEM as readonly string[]).includes(targetKind)) {
      return {
        valid: false,
        message: `Item ${posicao} da rejeição: 'target_kind' deve ser um de ${TIPOS_DE_ALVO_DO_ITEM.join(", ")}.`,
      };
    }

    if (bruto.comment != null && typeof bruto.comment !== "string") {
      return { valid: false, message: `Item ${posicao} da rejeição: 'comment' deve ser texto.` };
    }

    // `trim()`, e não `length` cru, pela mesma razão que o motivo da rejeição: um comentário feito
    // de espaços é o mesmo vazio, só que mais difícil de ver na tela de quem recebeu a recusa.
    const comment = typeof bruto.comment === "string" ? bruto.comment.trim() : "";
    if (comment.length === 0) {
      return {
        valid: false,
        message: `Item ${posicao} da rejeição: escreva o que precisa mudar nesta seção. Um item sem comentário não diz nada a quem vai corrigir.`,
      };
    }

    if (bruto.target_key != null && typeof bruto.target_key !== "string") {
      return { valid: false, message: `Item ${posicao} da rejeição: 'target_key' deve ser texto.` };
    }
    const targetKey = typeof bruto.target_key === "string" ? bruto.target_key.trim() : "";

    // "geral" é o alvo de quem não conseguiu prender a observação a uma seção - ele NÃO carrega
    // chave. Os outros dois carregam obrigatoriamente: um "proposal_field" sem qual campo é um
    // apontamento que a v2 não sabe onde pendurar, e ele acabaria mudo no editor de seções.
    if (targetKind === "geral") {
      validados.push({ ordinal: validados.length + 1, targetKind, targetKey: null, comment });
      continue;
    }

    if (targetKey.length === 0) {
      return {
        valid: false,
        message: `Item ${posicao} da rejeição: escolha a seção ('target_key') apontada por este item.`,
      };
    }

    // Duas observações sobre a mesma seção são legítimas (dois problemas diferentes no mesmo
    // texto), então NÃO há checagem de duplicidade de `target_key` aqui de propósito.
    validados.push({ ordinal: validados.length + 1, targetKind, targetKey, comment });
  }

  return { valid: true, items: validados };
}
