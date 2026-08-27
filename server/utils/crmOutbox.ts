import { prisma } from "../../src/prisma";
import { randomId } from "../../src/idGenerator";
import { logger } from "./logger";
import { chamarPortaDoCrm, resolverDestino } from "./crmPort";
import { montarRetratoDoProjeto } from "./crmProjectState";

// CDC 16 — Fase 3. A FILA DE SAÍDA: o que este lado tem a contar ao CRM.
//
// Por que uma fila, e não uma chamada direta de dentro de quem muda o estado:
// uma chamada HTTP dentro da transação prende o banco pelo tempo da rede do
// outro lado, e um CRM fora do ar faria "assumir a demanda" falhar para quem
// está trabalhando AQUI - quando o fato aconteceu de qualquer jeito. A entrega é
// em segundo plano com retentativa, que é a mesma escolha que a D10 fez para a
// direção oposta.
//
// A ordem de entrega é preservada por demanda: o drenador processa uma demanda
// por vez, em ordem de criação, e para no primeiro item que falhar. Entregar
// `returned` antes de `assigned` faria o CRM recusar o segundo com 409 "fora de
// ordem" - com toda a razão, e o evento se perderia.

const INTERVALO_MS = 20_000;
const MAX_TENTATIVAS = 8;
// Escada de espera, em segundos: 10s, 30s, 2min, 5min, 15min, 30min, 1h, 1h.
const ESPERA_SEGUNDOS = [10, 30, 120, 300, 900, 1800, 3600, 3600];

export type TipoDeSaida = "event" | "project_state";

export interface AtorDoEvento {
  name: string;
  presales_user_id?: string;
  crm_user_id?: string;
}

/** Marcos que o contrato reconhece, e que este produto sabe produzir hoje. */
export type EventoDeSaida =
  | "assigned"
  | "reassigned"
  | "in_analysis"
  | "returned"
  | "completed"
  | "poc_started"
  | "poc_accepted"
  | "pricing_ready"
  | "proposal_ready";

function segundosEntre(fim: Date, inicio: Date | null | undefined): number | undefined {
  if (!inicio) return undefined;
  const s = Math.round((fim.getTime() - inicio.getTime()) / 1000);
  return s >= 0 ? s : undefined;
}

/**
 * Enfileira um evento da demanda.
 *
 * `occurredAt` é o instante do FATO e entra no corpo congelado. Chamado DEPOIS
 * da transação que mudou o estado, e nunca dentro dela: um evento enfileirado
 * numa transação que depois desfaz contaria ao CRM algo que não aconteceu.
 */
/**
 * O corpo que viaja, montado a partir do fato.
 *
 * Separado de quem grava para poder ser provado sem banco: é aqui que mora a decisão de mandar o
 * instante do FATO e a medição de tempo (D20), e uma medição negativa (relógios fora de sincronia
 * entre os dois lados) é OMITIDA em vez de viajar — um "assumida -3 segundos depois do envio"
 * envenenaria a média da equipe em vez de sinalizar o problema.
 */
export function montarPayloadDoEvento(entrada: {
  event: EventoDeSaida;
  occurredAt: Date;
  actor?: AtorDoEvento;
  reason?: string | null;
  note?: string | null;
  sentAt?: Date | null;
  assignedAt?: Date | null;
}): Record<string, unknown> {
  const elapsed: Record<string, number> = {};
  const desdeEnvio = segundosEntre(entrada.occurredAt, entrada.sentAt ?? null);
  const desdeAssumir = segundosEntre(entrada.occurredAt, entrada.assignedAt ?? null);
  if (desdeEnvio !== undefined) elapsed.since_sent_seconds = desdeEnvio;
  if (desdeAssumir !== undefined) elapsed.since_assigned_seconds = desdeAssumir;

  const payload: Record<string, unknown> = {
    event: entrada.event,
    occurred_at: entrada.occurredAt.toISOString(),
  };
  if (entrada.actor) payload.actor = entrada.actor;
  if (entrada.reason) payload.reason = entrada.reason;
  if (entrada.note) payload.note = entrada.note;
  if (Object.keys(elapsed).length > 0) payload.elapsed = elapsed;
  return payload;
}

/**
 * O que não adianta repetir.
 *
 * 404 (demanda que o CRM não conhece), 409 (fora de ordem, ou chave usada com outro corpo), 422
 * (corpo fora do contrato) e 400 são falhas de NEGÓCIO; 401/403 dizem que o par não vale mais.
 * Só 5xx e queda de rede são retentados — a mesma separação que a F2 fez na direção oposta.
 */
export function falhaPermanente(status: number): boolean {
  return [400, 401, 403, 404, 409, 422].includes(status);
}

/** A chave da mensagem, estável por (demanda, evento, instante do fato). */
export function chaveDoEvento(demandId: string, event: string, occurredAt: Date): string {
  return `dem-${demandId}-${event}-${occurredAt.getTime()}`;
}

export async function enfileirarEvento(entrada: {
  tenantId: string;
  demandId: string;
  demandRef: string;
  event: EventoDeSaida;
  occurredAt: Date;
  actor?: AtorDoEvento;
  reason?: string | null;
  note?: string | null;
  sentAt?: Date | null;
  assignedAt?: Date | null;
}): Promise<void> {
  // Estável por (demanda, evento, instante): a mesma transição enfileirada duas
  // vezes por um clique duplo produz a MESMA chave, e o CRM devolve a resposta
  // que já tinha dado em vez de gravar duas linhas na timeline.
  const idempotencyKey = chaveDoEvento(entrada.demandId, entrada.event, entrada.occurredAt);

  const payload = montarPayloadDoEvento(entrada);

  await gravar(entrada.tenantId, entrada.demandId, "event", entrada.event, entrada.occurredAt, idempotencyKey, payload);
}

/** Enfileira o retrato do projeto vinculado (o `PUT` do contrato). */
export async function enfileirarEstadoDoProjeto(entrada: {
  tenantId: string;
  demandId: string;
  occurredAt: Date;
  payload: Record<string, unknown>;
}): Promise<void> {
  // O retrato SUBSTITUI o anterior por completo, então uma chave por instante é
  // o certo: dois retratos do mesmo segundo são o mesmo retrato.
  const idempotencyKey = `proj-${entrada.demandId}-${entrada.occurredAt.getTime()}`;
  await gravar(entrada.tenantId, entrada.demandId, "project_state", null, entrada.occurredAt, idempotencyKey, entrada.payload);
}

async function gravar(
  tenantId: string,
  demandId: string,
  kind: TipoDeSaida,
  event: string | null,
  occurredAt: Date,
  idempotencyKey: string,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    await prisma.demandOutboundEvent.create({
      data: {
        id: randomId("doe"),
        tenantId,
        demandId,
        kind,
        event,
        occurredAt,
        payload: payload as never,
        idempotencyKey,
      },
    });
  } catch (err: any) {
    // P2002 no índice (tenant, idempotency_key): o mesmo fato já está na fila.
    // Não é erro - é a idempotência funcionando antes mesmo de sair daqui.
    if (err?.code === "P2002") return;
    logger.error({ err, tenantId, demandId, kind, event }, "cdc16 F3: falha ao enfileirar saída para o CRM");
  }
}

/**
 * O caminho completo de um marco: o evento, o retrato do projeto que o acompanha
 * e a tentativa imediata de entrega.
 *
 * Os dois juntos, e não só o evento, porque é a combinação que o vendedor lê: o
 * marco diz O QUE aconteceu e o retrato diz COMO o projeto está agora. Mandar só
 * o evento deixaria o painel da oportunidade parado no retrato anterior, o que é
 * pior do que não ter painel — mostraria um estado velho com cara de atual.
 *
 * Nunca lança: um fato que já aconteceu deste lado não pode ser desfeito porque
 * o CRM está fora do ar. O que fica é a fila, e ela é visível.
 */
export async function empurrarMarcoDaDemanda(entrada: {
  tenantId: string;
  demanda: { id: string; demandRef: string; sentAt?: Date | null; assignedAt?: Date | null };
  event: EventoDeSaida;
  occurredAt: Date;
  actor?: AtorDoEvento;
  reason?: string | null;
  note?: string | null;
  projectId?: string | null;
}): Promise<void> {
  try {
    await enfileirarEvento({
      tenantId: entrada.tenantId,
      demandId: entrada.demanda.id,
      demandRef: entrada.demanda.demandRef,
      event: entrada.event,
      occurredAt: entrada.occurredAt,
      actor: entrada.actor,
      reason: entrada.reason,
      note: entrada.note,
      sentAt: entrada.demanda.sentAt ?? null,
      assignedAt: entrada.demanda.assignedAt ?? null,
    });

    if (entrada.projectId) {
      const retrato = await montarRetratoDoProjeto(entrada.projectId);
      if (retrato) {
        await enfileirarEstadoDoProjeto({
          tenantId: entrada.tenantId,
          demandId: entrada.demanda.id,
          occurredAt: entrada.occurredAt,
          payload: retrato,
        });
      }
    }

    tentarAgora(entrada.tenantId);
  } catch (err) {
    logger.error(
      { err, tenantId: entrada.tenantId, demandId: entrada.demanda.id, event: entrada.event },
      "cdc16 F3: falha ao empurrar o marco da demanda para o CRM"
    );
  }
}

const CAMINHO: Record<TipoDeSaida, (ref: string) => string> = {
  event: (ref) => `/demands/${encodeURIComponent(ref)}/events`,
  project_state: (ref) => `/demands/${encodeURIComponent(ref)}/project`,
};

const METODO: Record<TipoDeSaida, "POST" | "PUT"> = {
  event: "POST",
  project_state: "PUT",
};

function proximaEspera(tentativas: number): Date {
  const s = ESPERA_SEGUNDOS[Math.min(tentativas, ESPERA_SEGUNDOS.length - 1)];
  return new Date(Date.now() + s * 1000);
}

export interface ResumoDaDrenagem {
  tentados: number;
  enviados: number;
  falharam: number;
  descartados: number;
}

/**
 * Drena a fila de um tenant.
 *
 * Uma demanda por vez, em ordem de criação, parando no primeiro item que não
 * sair: a ordem dos eventos é parte do significado deles, e o CRM recusa evento
 * fora de ordem (409). Outras demandas continuam sendo drenadas normalmente -
 * um CRM que recuse UM evento não pode travar a fila inteira.
 */
export async function drenarFila(tenantId: string): Promise<ResumoDaDrenagem> {
  const resumo: ResumoDaDrenagem = { tentados: 0, enviados: 0, falharam: 0, descartados: 0 };

  const pendentes = await prisma.demandOutboundEvent.findMany({
    where: { tenantId, status: "pendente", nextAttemptAt: { lte: new Date() } },
    orderBy: [{ demandId: "asc" }, { createdAt: "asc" }],
    include: { demand: { select: { demandRef: true } } },
  });
  if (pendentes.length === 0) return resumo;

  const destino = await resolverDestino(tenantId);
  if (!destino.ok) {
    for (const item of pendentes) {
      resumo.tentados += 1;
      if (destino.permanente) {
        // Permanente é o que não melhora sozinho: sem chave, sem endereço, ou
        // endereço que não é do par. Reagendar para sempre encheria a fila de
        // trabalho que nunca sai; `descartado` deixa o motivo escrito.
        resumo.descartados += 1;
        await prisma.demandOutboundEvent.update({
          where: { id: item.id },
          data: { status: "descartado", lastError: destino.motivo, attempts: { increment: 1 } },
        });
      } else {
        resumo.falharam += 1;
        await prisma.demandOutboundEvent.update({
          where: { id: item.id },
          data: {
            lastError: destino.motivo,
            attempts: { increment: 1 },
            nextAttemptAt: proximaEspera(item.attempts),
          },
        });
      }
    }
    return resumo;
  }

  const travadas = new Set<string>();
  for (const item of pendentes) {
    if (travadas.has(item.demandId)) continue;
    resumo.tentados += 1;

    const kind = item.kind as TipoDeSaida;
    const resposta = await chamarPortaDoCrm(
      destino,
      METODO[kind],
      CAMINHO[kind](item.demand.demandRef),
      item.idempotencyKey,
      item.payload
    );

    if ("erroDeRede" in resposta) {
      resumo.falharam += 1;
      travadas.add(item.demandId);
      await marcarFalha(item.id, item.attempts, null, resposta.erroDeRede);
      continue;
    }

    if (resposta.status >= 200 && resposta.status < 300) {
      resumo.enviados += 1;
      await prisma.demandOutboundEvent.update({
        where: { id: item.id },
        data: { status: "enviado", sentAt: new Date(), lastStatus: resposta.status, lastError: null, attempts: { increment: 1 } },
      });
      continue;
    }

    const mensagem = descrever(resposta.corpo, resposta.status);

    const permanente = falhaPermanente(resposta.status);
    if (permanente) {
      resumo.descartados += 1;
      travadas.add(item.demandId);
      await prisma.demandOutboundEvent.update({
        where: { id: item.id },
        data: { status: "descartado", lastStatus: resposta.status, lastError: mensagem, attempts: { increment: 1 } },
      });
      logger.warn({ tenantId, demandRef: item.demand.demandRef, event: item.event, status: resposta.status, mensagem },
        "cdc16 F3: o CRM recusou um evento em definitivo");
      continue;
    }

    resumo.falharam += 1;
    travadas.add(item.demandId);
    await marcarFalha(item.id, item.attempts, resposta.status, mensagem);
  }

  return resumo;
}

async function marcarFalha(id: string, tentativas: number, status: number | null, mensagem: string): Promise<void> {
  const proxima = tentativas + 1;
  await prisma.demandOutboundEvent.update({
    where: { id },
    data:
      proxima >= MAX_TENTATIVAS
        ? { status: "falhou", lastStatus: status, lastError: mensagem, attempts: proxima }
        : { lastStatus: status, lastError: mensagem, attempts: proxima, nextAttemptAt: proximaEspera(tentativas) },
  });
}

function descrever(corpo: unknown, status: number): string {
  if (corpo && typeof corpo === "object") {
    const c = corpo as { message?: string; error?: string };
    if (c.message) return c.error ? `${c.error}: ${c.message}` : c.message;
  }
  if (typeof corpo === "string" && corpo.trim()) return corpo.slice(0, 500);
  return `HTTP ${status}`;
}

/**
 * Tenta entregar agora, sem esperar o próximo tique.
 *
 * Usado logo depois de enfileirar: o vendedor do outro lado não deveria esperar
 * 20 segundos para saber que a demanda foi assumida. Falhar aqui não é erro -
 * o item continua na fila e o drenador periódico cuida dele.
 */
export function tentarAgora(tenantId: string): void {
  void drenarFila(tenantId).catch((err) =>
    logger.warn({ err, tenantId }, "cdc16 F3: falha ao drenar a fila de saída logo após enfileirar")
  );
}

/**
 * Fecha a Demanda cujo projeto foi concluído, e conta ao CRM.
 *
 * Este produto não ganha um botão de "concluir a demanda": quem termina o
 * trabalho termina o PROJETO, e a demanda é o pedido que o originou. Sem este
 * gancho, `completedAt` seria coluna decorativa e `completed` nunca chegaria à
 * timeline do vendedor — que é justamente o marco que ele está esperando.
 *
 * `updateMany` condicionado ao estado aberto: um projeto reaberto e concluído de
 * novo não reescreve o instante em que a demanda foi concluída de verdade, e um
 * projeto sem demanda (o caso normal do intake) não casa com nada e custa uma
 * consulta.
 */
export async function concluirDemandaDoProjeto(projectId: string, tenantId: string): Promise<void> {
  try {
    const agora = new Date();
    const fechou = await prisma.demand.updateMany({
      where: { tenantId, projectId, status: { in: ["assigned", "in_analysis"] } },
      data: { status: "completed", completedAt: agora },
    });
    if (fechou.count === 0) return;

    const demanda = await prisma.demand.findFirst({
      where: { tenantId, projectId, status: "completed" },
      select: { id: true, demandRef: true, sentAt: true, assignedAt: true, completedAt: true, assignedUser: { select: { name: true } } },
    });
    if (!demanda) return;

    await empurrarMarcoDaDemanda({
      tenantId,
      demanda,
      event: "completed",
      occurredAt: demanda.completedAt ?? agora,
      actor: demanda.assignedUser?.name ? { name: demanda.assignedUser.name } : undefined,
      projectId,
    });
  } catch (err) {
    logger.error({ err, projectId, tenantId }, "cdc16 F3: falha ao concluir a demanda do projeto");
  }
}

export async function drenarTodosOsTenants(): Promise<void> {
  const tenants = await prisma.crmPairKey.findMany({ select: { tenantId: true } });
  for (const { tenantId } of tenants) {
    try {
      const r = await drenarFila(tenantId);
      if (r.tentados > 0) {
        logger.info({ tenantId, ...r }, "cdc16 F3: fila de saída drenada");
      }
    } catch (err) {
      logger.error({ err, tenantId }, "cdc16 F3: erro ao drenar a fila de saída");
    }
  }
}

export function startCrmOutboxInterval(): void {
  void drenarTodosOsTenants().catch((err) => logger.error({ err }, "cdc16 F3: falha na primeira drenagem"));
  setInterval(() => {
    void drenarTodosOsTenants().catch((err) => logger.error({ err }, "cdc16 F3: falha ao drenar a fila de saída"));
  }, INTERVALO_MS);
}
