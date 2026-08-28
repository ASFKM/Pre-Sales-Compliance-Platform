// CDC 16 — Fase 7. O CICLO DE VIDA da demanda, como regra PURA.
//
// Contrato: fleet-manager:docs/cdc/16-contratos/presales-inbound.v1.yaml.
//
// Este arquivo não importa Prisma, não lê configuração e não escreve nada. Ele
// existe porque a F7 encosta em TRÊS VERBOS que se parecem e têm desfechos
// diferentes, sobre uma demanda que já tem seis estados — e uma regra dessas
// escondida dentro de um handler de rota não é revisável por quem a escreveu um
// mês depois. Mesma disciplina que a F5 aplicou a `demandSla.ts`.
//
// ─────────────────────────────────────────────────────────────────────────────
// A MÁQUINA, escrita antes do código que a usa
// ─────────────────────────────────────────────────────────────────────────────
//
// CANCELAR (D18) — o vendedor desistiu e o líder direto aprovou, do lado do CRM.
//
//   queued                 → `cancelled` NA HORA          (outcome: cancelled)
//   assigned | in_analysis → PEDIDO registrado            (outcome: cancellation_requested)
//                            o estado NÃO muda: alguém está trabalhando
//   cancelled              → `cancelled`, sem escrever    (outcome: cancelled, idempotente)
//   returned | completed   → 409 `demand_closed`
//
//   "Enquanto a demanda está na fila sem dono, o cancelamento é efetivado na
//   hora. Já assumida, vira pedido de encerramento que quem assumiu (ou o
//   gerente) conclui" — a spec, literalmente. O que a spec NÃO diz é o que
//   fazer com uma demanda que já acabou, e a resposta aqui é 409: responder
//   200 `cancelled` sobre uma demanda CONCLUÍDA faria o CRM marcar como
//   cancelada uma oportunidade cuja proposta já foi entregue. É o mesmo 409
//   que a spec declara para o PATCH, pelo mesmo motivo, e está registrado no
//   §10 da fase.
//
// PERDER (D29) — NÃO é um verbo desta porta, e é decisão desta fase.
//
//   "Oportunidade perdida AVISA, e quem assumiu decide encerrar ou concluir."
//   Avisar sem decidir é exatamente o que o PATCH faz (D27): chega como
//   atualização visível e não muda o ciclo. Inventar um caminho `POST /lost`
//   que a spec não declara seria mudar o contrato na implementação — a lição
//   que a F6 escreveu ao recusar um 200 não declarado. A perda viaja no
//   `opportunity.stage` do PATCH, e o produto a reconhece pelo que ela é.
//
// ATUALIZAR (D27)
//
//   queued | assigned | in_analysis → atualização registrada (202)
//   returned | cancelled | completed → 409 `demand_closed`
//
// EXPURGAR (D35) — não olha o ciclo, de propósito.
//
//   Apagar a cópia é conformidade, e conformidade não espera o trabalho
//   terminar. O expurgo age em QUALQUER estado, inclusive numa demanda
//   concluída — e principalmente nela, que é a que mais tempo fica guardada.
//
// A DEMANDA ESPELHO (F6, `source = "presales"`) NÃO é caso especial em
// nenhum dos três, e essa é a resposta escrita que a fase devia dar. Ela nasce
// `assigned` com o dono do projeto: cancelar cai no ramo do pedido, que é a
// verdade (há alguém trabalhando, e quem trabalha decide quando parar);
// atualizar mostra o que mudou na oportunidade que o próprio PreSales criou; e
// expurgar apaga o endereço de retorno junto com o resto, que é o que sobra
// quando a empresa deixou de existir do outro lado. Um 404 seria a outra
// resposta legítima, e é pior: faria o CRM procurar defeito num `demand_ref`
// que ele conhece e que funciona para todos os outros caminhos.

/** Os seis estados do ciclo, na ordem em que a F1 os criou. */
export type EstadoDaDemanda =
  | "queued"
  | "assigned"
  | "in_analysis"
  | "returned"
  | "cancelled"
  | "completed";

/**
 * Estados terminais: a demanda acabou, por qualquer um dos três caminhos.
 *
 * `returned` está aqui porque a demanda VOLTOU para o CRM — o trabalho não é
 * mais deste lado, e continuar aceitando atualização ou cancelamento seria
 * escrever sobre um objeto que ninguém olha.
 */
export const ESTADOS_TERMINAIS: ReadonlySet<EstadoDaDemanda> = new Set<EstadoDaDemanda>([
  "returned",
  "cancelled",
  "completed",
]);

/** Estados em que existe alguém trabalhando — e portanto alguém a consultar. */
export const ESTADOS_COM_DONO: ReadonlySet<EstadoDaDemanda> = new Set<EstadoDaDemanda>([
  "assigned",
  "in_analysis",
]);

export type DesfechoDoCancelamento =
  /** Cancelada na hora: estava na fila, sem dono. */
  | { desfecho: "cancelled" }
  /** Pedido registrado: alguém está trabalhando e decide quando parar. */
  | { desfecho: "cancellation_requested" }
  /** Já estava cancelada: repetir não é erro, e nada é reescrito. */
  | { desfecho: "cancelled"; jaEstava: true }
  /** Acabou por outro caminho: 409, e o motivo dito por extenso. */
  | { desfecho: "recusado"; motivo: string };

/**
 * O que o cancelamento faz, dado o estado atual. É a tabela do cabeçalho.
 */
export function avaliarCancelamento(status: EstadoDaDemanda): DesfechoDoCancelamento {
  if (status === "cancelled") return { desfecho: "cancelled", jaEstava: true };
  if (status === "queued") return { desfecho: "cancelled" };
  if (ESTADOS_COM_DONO.has(status)) return { desfecho: "cancellation_requested" };
  return {
    desfecho: "recusado",
    motivo:
      status === "completed"
        ? "Esta demanda já foi concluída pelo pré-vendas; não há mais o que cancelar."
        : "Esta demanda já foi devolvida ao CRM; não há mais o que cancelar deste lado.",
  };
}

/** A atualização pós-envio (D27) só entra enquanto a demanda está viva. */
export function aceitaAtualizacao(status: EstadoDaDemanda): boolean {
  return !ESTADOS_TERMINAIS.has(status);
}

/**
 * A atualização precisa de DECISÃO de gente, ou já está resolvida ao chegar?
 *
 * Na fila, sem dono, não há a quem perguntar — e não há projeto onde incorporar
 * coisa alguma: o projeto ainda nem nasceu, e vai nascer da demanda já
 * atualizada. Registrar a atualização como pendente ali deixaria um pendente
 * que ninguém pode resolver e que sobreviveria ao ato de assumir, contando para
 * sempre uma mudança que já está dentro do projeto desde o primeiro segundo.
 */
export function precisaDeDecisao(status: EstadoDaDemanda): boolean {
  return ESTADOS_COM_DONO.has(status);
}

// ─────────────────────────────────────────────────────────────────────────────
// O que mudou: o antes e o depois, campo a campo
// ─────────────────────────────────────────────────────────────────────────────

export interface Diferenca {
  /** Nome do campo no envelope do contrato (`opportunity.value`, `sheet.deadline`). */
  campo: string;
  /** Rótulo em português, que é o que a tela mostra. */
  rotulo: string;
  antes: string | null;
  depois: string | null;
}

/** Os campos do envelope que a atualização pode mexer, e como se chamam na tela. */
export const ROTULO_DO_CAMPO: Record<string, string> = {
  "opportunity.name": "Nome da oportunidade",
  "opportunity.stage": "Etapa no funil",
  "opportunity.deal_type": "Tipo de negócio",
  "opportunity.value": "Valor",
  "opportunity.currency": "Moeda",
  "opportunity.probability": "Probabilidade",
  "opportunity.margin_percent": "Margem",
  "opportunity.expected_close_date": "Fechamento previsto",
  "opportunity.risks": "Riscos comerciais",
  "opportunity.origin": "Origem",
  "sheet.title": "Título",
  "sheet.vertical": "Vertical",
  "sheet.description": "Descrição",
  "sheet.deadline": "Prazo do edital",
  "sheet.proposal_validity_date": "Validade da proposta",
  "sheet.output_language": "Idioma da análise",
  "sheet.proposal_language": "Idioma da proposta",
  "sheet.ai_orientation_mode": "Orientação de IA",
  "sheet.ai_orientation_text": "Texto da orientação",
  "sheet.procurement_modality": "Modalidade",
  "sheet.procurement_subtype": "Subtipo",
  objective: "Objetivo",
  documents: "Documentos",
};

/**
 * Texto comparável de um valor do envelope.
 *
 * `null` e `undefined` colapsam no mesmo nada — a spec diz que "ausência de
 * campo significa 'não mudou', nunca 'apagar'", então quem chega com o campo
 * ausente nem passa por aqui. Datas viram DIA CIVIL, e não instante: o produto
 * inteiro lê `deadline` com `toISOString().substring(0,10)` (a convenção que a
 * F5 registrou), e comparar instante contra dia civil produziria uma diferença
 * a cada chamada, sobre um prazo que ninguém mudou.
 */
export function textoComparavel(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null;
  if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? null : valor.toISOString().substring(0, 10);
  if (Array.isArray(valor)) return valor.length === 0 ? null : valor.map((v) => String(v)).join(" · ");
  if (typeof valor === "number") return String(valor);
  if (typeof valor === "boolean") return valor ? "sim" : "não";
  const texto = String(valor).trim();
  if (texto === "") return null;
  // Data ISO completa que veio como texto: mesmo corte do dia civil acima.
  if (/^\d{4}-\d{2}-\d{2}T/.test(texto)) return texto.substring(0, 10);
  return texto;
}

/**
 * As diferenças entre o que estava guardado e o que o CRM acaba de mandar.
 *
 * Só entram os campos PRESENTES no `depois`: o contrato é explícito em que
 * ausência é "não mudou". Sem essa regra, um PATCH que traz só o prazo apagaria
 * a margem da tela de quem assumiu — que é o defeito "corrigir tirando, sem
 * repor" registrado numa frente anterior.
 */
export function diferencas(
  antes: Record<string, unknown>,
  depois: Record<string, unknown>
): Diferenca[] {
  const saida: Diferenca[] = [];
  for (const campo of Object.keys(depois)) {
    if (depois[campo] === undefined) continue;
    const a = textoComparavel(antes[campo]);
    const d = textoComparavel(depois[campo]);
    if (a === d) continue;
    saida.push({ campo, rotulo: ROTULO_DO_CAMPO[campo] ?? campo, antes: a, depois: d });
  }
  return saida;
}

// ─────────────────────────────────────────────────────────────────────────────
// A oportunidade perdida, reconhecida pelo que ela é
// ─────────────────────────────────────────────────────────────────────────────

/**
 * As etapas que significam "o negócio morreu", no vocabulário do CMCRM.
 *
 * O CRM escreve em português (`opportunities.status ∈ {aberta, ganha, perdida}`
 * e `stages.type` igual), e o campo que viaja no envelope é `opportunity.stage`,
 * que é o NOME da etapa configurada pela organização — não o tipo. Por isso a
 * lista tem as duas grafias e a comparação é frouxa: uma organização pode ter
 * chamado a etapa de "Perdido" ou "Perdida", e um casamento exato responderia
 * "não" para o caso mais comum. O inglês entra porque o campo é texto livre no
 * contrato e uma instalação em outra língua é possível.
 */
const MARCAS_DE_PERDA = ["perdid", "closed lost", "closed-lost", "closed_lost", "lost"];

export function pareceOportunidadePerdida(stage: string | null | undefined): boolean {
  if (!stage) return false;
  const texto = stage
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return MARCAS_DE_PERDA.some((marca) => texto.includes(marca));
}

/**
 * A espécie da atualização, para a tela poder dar destaque diferente.
 *
 * `oportunidade_perdida` não é um estado da demanda e nunca vai ser: é um
 * RÓTULO da atualização, e é exatamente o que a D29 pediu — avisa, e não decide.
 */
export type EspecieDaAtualizacao = "oportunidade_perdida" | "prazo" | "escopo" | "comercial" | "documentos";

export function especieDaAtualizacao(mudancas: readonly Diferenca[]): EspecieDaAtualizacao {
  const campos = new Set(mudancas.map((m) => m.campo));
  const etapa = mudancas.find((m) => m.campo === "opportunity.stage");
  if (etapa && pareceOportunidadePerdida(etapa.depois)) return "oportunidade_perdida";
  if (campos.has("sheet.deadline") || campos.has("sheet.proposal_validity_date")) return "prazo";
  if (campos.has("documents")) return "documentos";
  if (campos.has("sheet.description") || campos.has("sheet.title") || campos.has("objective")) return "escopo";
  return "comercial";
}
