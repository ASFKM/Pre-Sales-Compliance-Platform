import { prisma } from "../../src/prisma";
import { randomId } from "../../src/idGenerator";
import { logger } from "./logger";
import { empurrarMarcoDaDemanda } from "./crmOutbox";
import { lerSla } from "./demandSlaConfig";
import {
  ESTADOS_ABERTOS,
  avaliarViolacoes,
  escolherResponsavel,
  etapaPendente,
  type CandidatoParaCarga,
  type EtapaDeSla,
} from "./demandSla";

// CDC 16 — Fase 5. A parte que fala com o banco: ler a configuração, achar o
// gerente, registrar a violação e contar ao CRM.
//
// A REGRA não mora aqui — mora em `demandSla.ts`, sem Prisma nenhum, e é
// provada caso a caso. Aqui está só o que precisa do banco para acontecer.

/** A permissão que define o GERENTE DE PRÉ-VENDAS (D16, D17, D19). */
export const PERMISSAO_DE_GERENTE = "demand:manage";

export const ROTULO_DA_ETAPA: Record<EtapaDeSla, string> = {
  assume: "assumir a demanda",
  analysis: "iniciar a análise técnica",
  proposal: "entregar a proposta",
};

// ─── Quem é o gerente de pré-vendas ─────────────────────────────────────────

/**
 * Os gerentes de pré-vendas ativos do tenant.
 *
 * "Gerente" não é um atributo do usuário: é quem tem `demand:manage` no papel.
 * O produto já modela responsabilidade assim (`project:read_all`,
 * `approval:manage`), e criar uma coluna `isPresalesManager` ao lado daria dois
 * lugares para responder a mesma pergunta — que é como um deles fica errado.
 *
 * Lista vazia é o estado normal, e não um defeito: a D17 diz "o gerente aprova
 * a devolução QUANDO HOUVER gerente", e nenhuma instalação no ar tem um. É por
 * isso que a migration desta fase não distribuiu a permissão para papel nenhum.
 */
export async function gerentesDePreVendas(): Promise<Array<{ id: string; name: string; email: string }>> {
  const papeis = await prisma.role.findMany({ select: { id: true, permissions: true } });
  const idsDePapel = papeis.filter((p) => p.permissions.includes(PERMISSAO_DE_GERENTE)).map((p) => p.id);
  if (idsDePapel.length === 0) return [];
  return prisma.user.findMany({
    where: { roleId: { in: idsDePapel }, status: "ACTIVE" },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });
}

export async function eGerente(roleId: string | undefined | null): Promise<boolean> {
  if (!roleId) return false;
  const papel = await prisma.role.findUnique({ where: { id: roleId }, select: { permissions: true } });
  return papel?.permissions.includes(PERMISSAO_DE_GERENTE) ?? false;
}

/** Quem pode trabalhar na fila: papéis com `demand:assume`, usuários ativos. */
export async function equipeDePreVendas(): Promise<Array<{ id: string; name: string }>> {
  const papeis = await prisma.role.findMany({ select: { id: true, permissions: true } });
  const idsDePapel = papeis.filter((p) => p.permissions.includes("demand:assume")).map((p) => p.id);
  if (idsDePapel.length === 0) return [];
  return prisma.user.findMany({
    where: { roleId: { in: idsDePapel }, status: "ACTIVE" },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

// ─── D40: a distribuição automática ─────────────────────────────────────────

/**
 * Monta os candidatos com a carga que cada um já segura e devolve quem recebe.
 *
 * A consulta traz só o que a régua usa — prazo e instante em que assumiu —, e a
 * escolha acontece em `escolherResponsavel`, que é pura. Foi de propósito:
 * quem quiser discutir a política lê aquela função, e não este `findMany`.
 */
export async function escolherPorMenorCarga(agora: Date): Promise<string | null> {
  const equipe = await equipeDePreVendas();
  if (equipe.length === 0) return null;

  const abertas = await prisma.demand.findMany({
    where: { status: { in: ["assigned", "in_analysis"] }, assignedUserId: { in: equipe.map((u) => u.id) } },
    select: { assignedUserId: true, deadline: true, assignedAt: true },
  });

  const candidatos: CandidatoParaCarga[] = equipe.map((u) => ({
    userId: u.id,
    abertas: abertas
      .filter((d) => d.assignedUserId === u.id)
      .map((d) => ({ deadline: d.deadline, assignedAt: d.assignedAt })),
  }));

  return escolherResponsavel(candidatos, agora);
}

// ─── O alerta de prazo vencido (D19) ────────────────────────────────────────

export interface ResumoDaVarredura {
  demandasAbertas: number;
  vencidas: number;
  novas: number;
  avisados: number;
}

/**
 * Varre a fila, registra o que venceu e alerta.
 *
 * Três coisas acontecem por violação NOVA, nesta ordem, e a ordem importa:
 *
 * 1. a linha em `demand_sla_breaches` é gravada primeiro, e o índice único
 *    `(tenant, demanda, etapa)` é o que garante UMA vez. Não é uma checagem em
 *    memória: dois processos deste serviço verificando ao mesmo tempo é o caso
 *    normal depois de um restart, e quem perder a corrida recebe P2002 e para;
 * 2. o destinatário é resolvido — o gerente, ou a equipe quando não houver
 *    gerente (D19). É guardado na linha, e não derivado na leitura, porque a
 *    resposta certa é a de QUANDO o alerta saiu;
 * 3. `sla_breached` é enfileirado para o CRM. O evento já existia no contrato e
 *    na porta do outro lado desde a F3, e nunca tinha sido emitido por ninguém
 *    — esta é a fase que passa a emiti-lo.
 *
 * Um prazo publicado que não dispara alerta nenhum é promessa falsa que ninguém
 * confere; é por isso que o passo 3 não é opcional nem depende de o CRM estar
 * de pé — a fila de saída cuida da entrega.
 */
export async function varrerPrazos(tenantId: string): Promise<ResumoDaVarredura> {
  const resumo: ResumoDaVarredura = { demandasAbertas: 0, vencidas: 0, novas: 0, avisados: 0 };

  const sla = await lerSla();
  if (!sla || !sla.enabled) return resumo;

  const abertas = await prisma.demand.findMany({
    where: { status: { in: [...ESTADOS_ABERTOS] as any } },
    select: {
      id: true,
      demandRef: true,
      status: true,
      deadline: true,
      queuedAt: true,
      assignedAt: true,
      analysisStartedAt: true,
      sentAt: true,
      opportunityName: true,
      assignedUser: { select: { id: true, name: true } },
    },
  });
  resumo.demandasAbertas = abertas.length;
  if (abertas.length === 0) return resumo;

  const agora = new Date();
  const violacoes = avaliarViolacoes(abertas, sla, agora);
  resumo.vencidas = violacoes.length;
  if (violacoes.length === 0) return resumo;

  const gerentes = await gerentesDePreVendas();
  const recipientKind = gerentes.length > 0 ? "manager" : "team";
  const destinatarios =
    gerentes.length > 0 ? gerentes.map((g) => g.id) : (await equipeDePreVendas()).map((u) => u.id);

  for (const v of violacoes) {
    const demanda = abertas.find((d) => d.id === v.demandId);
    if (!demanda) continue;

    try {
      await prisma.demandSlaBreach.create({
        data: {
          id: randomId("dsb"),
          tenantId,
          demandId: v.demandId,
          stage: v.stage,
          dueAt: v.dueAt,
          detectedAt: agora,
          recipientKind,
          recipientUserIds: destinatarios,
        },
      });
    } catch (err: any) {
      // P2002 no índice único: este prazo já foi alertado. É a idempotência
      // funcionando, e não erro — o verificador roda a cada minuto.
      if (err?.code === "P2002") continue;
      logger.error({ err, tenantId, demandId: v.demandId, stage: v.stage },
        "cdc16 F5: falha ao registrar o prazo vencido");
      continue;
    }

    resumo.novas += 1;
    resumo.avisados += destinatarios.length;
    logger.warn(
      { tenantId, demandRef: demanda.demandRef, stage: v.stage, dueAt: v.dueAt.toISOString(), recipientKind, destinatarios: destinatarios.length },
      "cdc16 F5: prazo vencido"
    );

    const atrasoSegundos = Math.round((agora.getTime() - v.dueAt.getTime()) / 1000);
    await empurrarMarcoDaDemanda({
      tenantId,
      demanda: { id: demanda.id, demandRef: demanda.demandRef, sentAt: demanda.sentAt, assignedAt: demanda.assignedAt },
      event: "sla_breached",
      // O instante do FATO é o VENCIMENTO, e não o da varredura. Um serviço
      // parado por duas horas não pode fazer o atraso chegar ao vendedor duas
      // horas menor do que foi.
      occurredAt: v.dueAt,
      // Sem `actor`: ninguém fez isto acontecer. O ator de um prazo vencido é o
      // relógio, e inventar um nome ali poria a culpa em quem passou perto.
      note: `Prazo para ${ROTULO_DA_ETAPA[v.stage]} venceu há ${formatarDuracao(atrasoSegundos)}.`,
      dueAt: v.dueAt,
    });
  }

  return resumo;
}

export function formatarDuracao(segundos: number): string {
  const s = Math.max(0, segundos);
  const dias = Math.floor(s / 86400);
  const horas = Math.floor((s % 86400) / 3600);
  const minutos = Math.floor((s % 3600) / 60);
  if (dias > 0) return horas > 0 ? `${dias}d ${horas}h` : `${dias}d`;
  if (horas > 0) return minutos > 0 ? `${horas}h ${minutos}min` : `${horas}h`;
  return `${minutos}min`;
}

const INTERVALO_MS = 60_000;

async function varrerTodosOsTenants(): Promise<void> {
  // Um tenant só entra na varredura se ALGUÉM configurou SLA nele. Sem linha
  // não há prazo, e varrer a fila inteira de quem nunca configurou nada
  // custaria uma consulta por minuto para não decidir nada.
  const comSla = await prisma.demandSlaSettings.findMany({
    where: { enabled: true },
    select: { tenantId: true },
  });
  for (const { tenantId } of comSla) {
    try {
      const r = await varrerPrazos(tenantId);
      if (r.novas > 0) logger.info({ tenantId, ...r }, "cdc16 F5: prazos vencidos alertados");
    } catch (err) {
      logger.error({ err, tenantId }, "cdc16 F5: erro ao varrer prazos");
    }
  }
}

export function startDemandSlaInterval(): void {
  void varrerTodosOsTenants().catch((err) => logger.error({ err }, "cdc16 F5: falha na primeira varredura de prazos"));
  setInterval(() => {
    void varrerTodosOsTenants().catch((err) => logger.error({ err }, "cdc16 F5: falha ao varrer prazos"));
  }, INTERVALO_MS);
}

/** Só para o teste e para os scripts de prova: uma varredura, agora, sem intervalo. */
export const _varrerTodosOsTenants = varrerTodosOsTenants;

export { etapaPendente };
