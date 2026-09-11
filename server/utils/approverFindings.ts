/*
 * F8 (rodada 09/2026): OS ITENS DO APROVADOR VIRAM APONTAMENTOS — a decisão de modelagem da fase.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * O QUE FOI ESCOLHIDO, E POR QUÊ
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Um item do aprovador vira um `ProposalOpinionFinding` na v2 reaberta, pendurado numa RODADA
 * SINTÉTICA (`ProposalOpinionRun.origem = "aprovador"`) que carrega um único
 * `ProposalAiOpinionItem` de `perspective = "aprovador"`.
 *
 * Ele PRECISA ser um Finding, e não um registro de outra espécie, porque o pedido da fase é que o
 * item entre no ciclo que a F6 construiu: o PATCH /proposals/:id/apontamentos/:findingId com
 * justificativa obrigatória em "aceito com risco"/"descartado", o botão de sugestão por seção, o
 * vínculo com ProposalSectionEdit (o histórico por seção guarda QUAL apontamento motivou cada
 * edição) e o gate de envio. Tudo isso já existe, testado, e opera sobre `ProposalOpinionFinding`.
 *
 * O incômodo é real e não se resolve fingindo que não existe: `ProposalAiOpinionItem` se chama
 * "AiOpinion", e um item humano não é parecer de IA nenhum. O que a fase fez foi tornar essa
 * diferença EXPLÍCITA no dado, em vez de deixá-la implícita: `origem` na rodada e `origem` no
 * apontamento, mais `approvalDecisionItemId`, que amarra cada apontamento ao item da rejeição que o
 * gerou. Um humano lendo a linha sabe de onde ela veio; uma consulta também.
 *
 * O `@@unique([runId, perspective])` continua de pé, intocado: a rodada do aprovador tem UMA
 * perspectiva, "aprovador", e nenhuma rodada de IA usa esse valor (as de IA usam technical,
 * commercial, legal, financial).
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * O QUE PROTEGE OS NÚMEROS DA F7
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Os três números da comparação entre rodadas (sanados / parciais / novos) têm dono e significado:
 * eles respondem "a IA está apontando as mesmas coisas de novo?". Um item humano entrando nessa
 * conta responderia outra pergunta com o mesmo número. Três amarras impedem isso:
 *
 *   1. `Proposal.latest_opinion_run_id` NUNCA passa a apontar para a rodada do aprovador. Ele
 *      continua significando "a última rodada de IA" - é o que o painel de pareceres lê e o que o
 *      gate da F7 usa como recorte.
 *   2. GET /proposals/:id/comparacao-de-rodadas filtra `origem: "ia"` ao buscar as duas rodadas.
 *      Sem esse filtro, a rodada do aprovador (criada DEPOIS, portanto primeira no `orderBy desc`)
 *      viraria "a rodada atual" e a comparação diria que 100% dos apontamentos são novos.
 *   3. O casamento entre rodadas (proposalRoundMatching) só recebe findings de rodada de IA, então
 *      nenhum item humano pode ser reivindicado como antecessor nem como sucessor de um da IA.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * O QUE AS ALTERNATIVAS CUSTARIAM
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * (a) Coluna de origem no Finding com `opinionId` NULO para o item humano. Custaria tornar
 *     nullable a FK que hoje é a única prova de posse de um apontamento: o PATCH autoriza por
 *     `apontamento.opinion.run.proposalId === proposal.id`. Com `opinionId` nulo essa checagem
 *     precisaria de um segundo caminho, e a rota passaria a ter dois modos de autorização - que é
 *     exatamente onde IDOR nasce. Trocar uma FK obrigatória por um `if` foi o que se recusou aqui.
 *
 * (b) Tabela irmã (`ApproverFinding`). Custaria duplicar o ciclo inteiro: a rota de status com
 *     justificativa, o gate de envio, o vínculo com ProposalSectionEdit, a tela de tratativa. Cinco
 *     lugares onde as duas cópias divergiriam na primeira manutenção - e o requisito da fase é
 *     justamente que o item do aprovador NÃO fique fora do ciclo da F6.
 *
 * (c) Enfiar o item numa rodada de IA existente, como uma quinta perspectiva. Custaria a
 *     integridade da própria rodada: uma rodada é o resultado de uma execução, com `logicVersion`,
 *     `status` e `completedAt` daquela execução. Acrescentar linha humana a ela faria a rodada
 *     mentir sobre o que foi executado, e o `@@unique([runId, perspective])` obrigaria a inventar
 *     perspectivas numeradas para uma segunda rejeição.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * SEVERIDADE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * O item do aprovador nasce `critical`. Não é escolha estética: quem apontou tem autoridade formal
 * para barrar a proposta e a usou - a rejeição já aconteceu. Consequência direta e intencional: o
 * gate de envio da F7 passa a ver esses itens, e a v2 não volta para aprovação com um deles em
 * aberto. A saída continua sendo a mesma, e é a que a F6 desenhou: "aceito com risco" COM
 * justificativa, carimbada com autor e instante. Isso FORTALECE o gate; nada aqui o afrouxa.
 */

export const PERSPECTIVA_DO_APROVADOR = "aprovador";
export const ORIGEM_APROVADOR = "aprovador";
export const ORIGEM_IA = "ia";

const LIMITE_DO_TITULO = 120;

export interface ItemDeRejeicaoParaConverter {
  id: string;
  ordinal: number;
  targetKind: string;
  targetKey: string | null;
  comment: string;
  sectionSnapshot: string | null;
}

export interface ApontamentoDoAprovador {
  ordinal: number;
  title: string;
  detail: string;
  severity: "critical";
  targetKind: string;
  targetKey: string | null;
  approvalDecisionItemId: string;
}

/**
 * O TÍTULO do apontamento: a primeira linha do comentário, cortada.
 *
 * Não é um rótulo genérico do tipo "Item do aprovador" porque o título é o que aparece na lista e
 * na mensagem do gate de envio - e uma lista de cinco linhas idênticas não informa nada. O corte é
 * por caractere e no limite de palavra quando dá, com reticência, para que o texto completo
 * continue existindo em `detail` sem duplicar mal.
 */
export function tituloDoApontamentoDoAprovador(comment: string): string {
  const primeiraLinha = comment.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) || comment.trim();
  if (primeiraLinha.length <= LIMITE_DO_TITULO) return primeiraLinha;

  const cortado = primeiraLinha.slice(0, LIMITE_DO_TITULO);
  const ultimoEspaco = cortado.lastIndexOf(" ");
  // Só corta na palavra se sobrar texto suficiente; senão o título vira um fragmento inútil.
  const base = ultimoEspaco > LIMITE_DO_TITULO * 0.6 ? cortado.slice(0, ultimoEspaco) : cortado;
  return `${base.trimEnd()}…`;
}

/**
 * O DETALHE: o comentário inteiro mais o retrato do texto que a seção tinha na hora da rejeição.
 *
 * O retrato entra aqui, e não fica só na tabela da decisão, por uma razão prática: na v2 o texto da
 * seção vai mudar - é para isso que a v2 existe. Sem o retrato ao lado do comentário, quem lê o
 * apontamento depois da primeira edição não consegue mais saber a que texto o aprovador se referia.
 */
export function detalheDoApontamentoDoAprovador(comment: string, sectionSnapshot: string | null): string {
  const corpo = comment.trim();
  const retrato = (sectionSnapshot ?? "").trim();
  if (retrato.length === 0) return corpo;
  return `${corpo}\n\n— Texto desta seção no momento da rejeição —\n${retrato}`;
}

/**
 * A conversão, pura: os itens de UMA rejeição viram a lista de apontamentos da rodada do aprovador.
 *
 * Sem banco de propósito, como todo o resto das regras desta rodada: é aqui que um erro passaria
 * despercebido (perder um item, embaralhar a ordem, deixar um apontamento sem alvo) e é aqui que o
 * teste unitário consegue olhar.
 */
export function apontamentosDoAprovador(
  itens: readonly ItemDeRejeicaoParaConverter[]
): (ApontamentoDoAprovador & { itemId: string })[] {
  return [...itens]
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((item, i) => ({
      itemId: item.id,
      ordinal: i + 1,
      title: tituloDoApontamentoDoAprovador(item.comment),
      detail: detalheDoApontamentoDoAprovador(item.comment, item.sectionSnapshot),
      severity: "critical" as const,
      targetKind: item.targetKind,
      // "geral" nunca carrega chave - a mesma normalização que a validação da rejeição aplica,
      // repetida aqui porque esta função também é usada sobre linhas já gravadas.
      targetKey: item.targetKind === "geral" ? null : item.targetKey,
      approvalDecisionItemId: item.id,
    }));
}
