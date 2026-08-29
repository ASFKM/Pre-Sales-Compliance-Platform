import { prisma } from "./prisma";
import { dbStore } from "./dbStore";
import { randomId } from "./idGenerator";
import { isIaKbActive } from "../server/utils/aiProviders";
import { redis } from "./redis";

// critical_extraction and proposal_generation were removed (2026-07 AI Orchestrator redesign) -
// both had provider/model settings in the UI but resolveProvider() was never actually called for
// either anywhere in the codebase (confirmed via a full grep before removing) - the full analysis
// schema (critical_requirements/risks/opportunities/bom/proposal drafts) is produced by a single
// document_analysis call, not separate steps. document_classification was hardcoded to Gemini in
// server/utils/documentClassification.ts before this - now routed through here like the other
// real task types.
export type AiTaskType = "document_analysis" | "web_grounding" | "spec_copilot" | "document_classification" | "poc_test_generation" | "poc_schedule_generation" | "poc_final_report_generation" | "proposal_opinion_panel" | "pricing_budget_optimization" | "pricing_catalog_extraction" | "proposal_generation";

export interface ProviderResolution {
  provider: string;
  model: string;
  intendedProvider: string;
  isFallback: boolean;
}

interface TaskProviderSettings {
  default_model: string;
  document_analysis_model: string;
  document_analysis_provider: string;
  web_grounding_model: string;
  web_grounding_provider: string;
  spec_copilot_model: string;
  spec_copilot_provider: string;
  document_classification_model: string;
  document_classification_provider: string;
  poc_test_generation_model: string;
  poc_test_generation_provider: string;
  poc_schedule_generation_model: string;
  poc_schedule_generation_provider: string;
  poc_final_report_generation_model: string;
  poc_final_report_generation_provider: string;
  proposal_opinion_panel_model: string;
  proposal_opinion_panel_provider: string;
  pricing_budget_optimization_model: string;
  pricing_budget_optimization_provider: string;
  pricing_catalog_extraction_model: string;
  pricing_catalog_extraction_provider: string;
  openai_api_key_encrypted?: string;
  anthropic_api_key_encrypted?: string;
}

// F11 (docs/cdc/16-integracao-cmcrm-presales.md, itens 06/10): a IA gerenciada pelo Fleet
// Manager virou base do produto - os 3 provedores embutidos sempre roteiam por lá agora
// (isIaKbActive incondicional em server/utils/aiProviders.ts), então "conectado" deixou de
// depender de chave local. Provedores personalizados morreram junto com o add-on (§8 item 34).
async function isProviderConnected(provider: string, _settings: TaskProviderSettings): Promise<boolean> {
  return provider === "gemini" || provider === "openai" || provider === "anthropic";
}

// Resolves the intended provider/model for a task type against tenant settings, falling back
// to Gemini (logged as such) when the intended provider isn't actually connected. Always
// returns a usable provider - callers never need their own "what if it's not connected" branch.
export async function resolveProvider(taskType: AiTaskType, settings: TaskProviderSettings): Promise<ProviderResolution> {
  let intendedProvider = (settings as any)[`${taskType}_provider`] as string;
  let intendedModel = (settings as any)[`${taskType}_model`] as string;

  // ia_kb add-on: once active, the CMSaaS admin - not the tenant - chooses provider/model per
  // task (synced down on every heartbeat, see server/utils/fleetLicense.ts). Overrides the
  // tenant's own (now read-only, possibly stale) platform_settings fields above.
  if (await isIaKbActive()) {
    const taskConfig = await dbStore.getAllIaKbTaskConfig();
    const override = taskConfig.find((c) => c.task_type === taskType);
    if (override) {
      intendedProvider = override.provider;
      intendedModel = override.model;
    }
  }

  if (await isProviderConnected(intendedProvider, settings)) {
    return { provider: intendedProvider, model: intendedModel, intendedProvider, isFallback: false };
  }

  return {
    // The fallback provider is always gemini (the one key required platform-wide, per
    // isProviderConnected above) - but settings[`${taskType}_model`] holds whatever model the
    // *intended* (unconnected) provider was configured with, which may not even be a Gemini model
    // name at all (e.g. web_grounding configured for an Anthropic model). default_model is the
    // tenant's actual chosen Gemini default, the only field guaranteed to name a real Gemini
    // model regardless of which task type is falling back.
    provider: "gemini",
    model: settings.default_model,
    intendedProvider,
    isFallback: true,
  };
}

function startOfCurrentMonth(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

// Every task type that spends real AI-provider tokens - kept as one list so adding a new
// AI-calling path (like knowledge_base_analysis was, until this fix) means adding it here and
// nowhere else. Previously only 2 of these were ever counted against the cap or shown in the cost
// breakdown (document_analysis, project_intake_analysis via BackgroundTask.estimatedCostUsd) -
// spec_copilot_chat, bom_web_search, kb_suggest, kb_document_analysis, and document_classification
// spent real money completely uncapped and uncounted.
export const AI_SPENDING_TASK_TYPES = [
  "document_analysis",
  "project_intake_analysis",
  "knowledge_base_analysis",
  "spec_copilot_chat",
  "bom_web_search",
  "kb_suggest",
  "document_classification",
  "kb_reconciliation",
  "poc_test_generation",
  "poc_schedule_generation",
  "poc_final_report_generation",
  "proposal_opinion_panel",
  "pricing_budget_optimization",
  "pricing_catalog_extraction",
  // F6: apoio de IA na geracao da proposta (preenchimento de variaveis livres e redacao de secoes
  // de texto corrido). platform_settings ja tinha proposal_generation_provider/_model, e a tela de
  // Admin ja mostrava "LLM Propostas" - so nao havia chamada de IA nenhuma nesse fluxo para usar.
  "proposal_generation",
] as const;
export type AiSpendingTaskType = (typeof AI_SPENDING_TASK_TYPES)[number];

// Single write path for every AI call that completed, real cost or not - the only source of truth
// checkCostCap/getCurrentMonthSpendUsd/getCurrentMonthSpendByTaskTypeAndProvider read from.
// backgroundTaskId is optional traceability, not a requirement - most of the newly-covered task
// types (chat, BOM enrichment, KB suggest, classification) are synchronous calls with no
// BackgroundTask of their own.
export async function recordAiUsage(params: {
  tenantId: string;
  taskType: AiSpendingTaskType;
  provider: string;
  model: string;
  estimatedCostUsd: number;
  backgroundTaskId?: string;
  // F11 (docs/cdc/16, item 31): opcional de propósito - nem toda chamada nasce dentro de uma
  // requisição com usuário autenticado (ex: retomada de fila, job agendado). Quando ausente e
  // houver backgroundTaskId, o chamador deve preferir passar o userId do próprio BackgroundTask
  // (já carrega quem disparou) em vez de deixar este campo NULL por preguiça - só fica NULL
  // quando genuinamente não há dono a atribuir.
  userId?: string | null;
}): Promise<void> {
  await prisma.aiUsageLog.create({
    data: {
      id: randomId("ail"),
      tenantId: params.tenantId,
      taskType: params.taskType,
      provider: params.provider,
      model: params.model,
      estimatedCostUsd: params.estimatedCostUsd,
      backgroundTaskId: params.backgroundTaskId,
      userId: params.userId ?? undefined,
    },
  });
}

export interface CostCapCheck {
  blocked: boolean;
  warningThresholdReached: boolean;
  currentSpendUsd: number;
  capUsd: number | null;
}

// AUD-016 (auditoria de segurança, 2026-07-20): checkCostCap só LÊ o gasto já gravado
// (aiUsageLog) e recordAiUsage só GRAVA depois que a chamada de IA real termina - entre os dois
// não existe nenhuma trava. N chamadas concorrentes perto do teto podem todas ler o mesmo
// "currentSpendUsd" (ainda sem refletir as outras em andamento), todas passar no `< capUsd`, e só
// gravar seus custos bem depois - o teto mensal pode ser furado por qualquer grau de
// concorrência. Não dá pra reservar o custo EXATO de uma chamada aqui (varia por modelo/tamanho
// de prompt/resposta, só conhecido depois que a chamada termina), então a correção reserva o
// PIOR CASO (MAX_SINGLE_CALL_RESERVATION_USD) atomicamente via Redis (INCRBYFLOAT) assim que uma
// chamada passa no teto, e deixa essa reserva expirar sozinha (TTL) em vez de exigir que cada um
// dos 14 pontos de chamada (analysis.ts, pocs.ts, pricing.ts, projectIntake.ts, knowledgeBase.ts,
// proposals.ts) seja alterado para "liberar" a reserva depois - mais simples, sem mudar a
// assinatura da função nem nenhum call site, e falha para o lado seguro (superestima o gasto
// durante a janela do TTL, nunca subestima).
const MAX_SINGLE_CALL_RESERVATION_USD = 2.0;
const COST_RESERVATION_TTL_SECONDS = 120;

function costReservationRedisKey(tenantId: string): string {
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  return `aicost:reserved:${tenantId}:${monthKey}`;
}

// Checked before starting ANY AI-calling task or call - the cap is a real block, not just a
// dashboard number. 80% is a warning (task still runs) so nobody discovers the cap mid-emergency.
export async function checkCostCap(tenantId: string, capUsd: number | null): Promise<CostCapCheck> {
  if (capUsd === null) {
    return { blocked: false, warningThresholdReached: false, currentSpendUsd: 0, capUsd: null };
  }

  const result = await prisma.aiUsageLog.aggregate({
    where: { tenantId, createdAt: { gte: startOfCurrentMonth() } },
    _sum: { estimatedCostUsd: true },
  });
  const currentSpendUsd = result._sum.estimatedCostUsd || 0;

  const reservationKey = costReservationRedisKey(tenantId);
  // INCRBYFLOAT cria a chave com o próprio incremento se ela não existir - atômico, então duas
  // chamadas concorrentes nunca leem/escrevem o mesmo valor base.
  const reservedAfterIncrement = Number(await redis.incrbyfloat(reservationKey, MAX_SINGLE_CALL_RESERVATION_USD));
  // NX: só arma o TTL na primeira reserva do mês para este tenant - chamadas seguintes só
  // estendem o valor, nunca resetam a contagem regressiva de uma reserva ainda ativa.
  await redis.expire(reservationKey, COST_RESERVATION_TTL_SECONDS, "NX");

  const wouldExceedCap = currentSpendUsd + reservedAfterIncrement > capUsd;
  if (wouldExceedCap) {
    // Devolve a reserva - esta chamada não vai prosseguir, não deve contar contra o teto.
    await redis.incrbyfloat(reservationKey, -MAX_SINGLE_CALL_RESERVATION_USD);
  }

  return {
    blocked: wouldExceedCap || currentSpendUsd >= capUsd,
    warningThresholdReached: currentSpendUsd >= capUsd * 0.8,
    currentSpendUsd,
    capUsd,
  };
}

// Real current-month AI spend, independent of whether a cap is configured - used by the "Custos
// de IA e Prompts" card, which used to show a hardcoded placeholder number unrelated to any real
// usage.
export async function getCurrentMonthSpendUsd(tenantId: string): Promise<number> {
  const result = await prisma.aiUsageLog.aggregate({
    where: { tenantId, createdAt: { gte: startOfCurrentMonth() } },
    _sum: { estimatedCostUsd: true },
  });
  return result._sum.estimatedCostUsd || 0;
}

// Real spend broken down by BOTH which service incurred it and which provider actually served the
// call (a task type can span providers within the same month if its configured provider changed,
// or fell back to Gemini) - the cost card used to only show one combined total per service, with
// no visibility into provider mix.
export async function getCurrentMonthSpendByTaskTypeAndProvider(tenantId: string): Promise<Record<string, Record<string, number>>> {
  const rows = await prisma.aiUsageLog.groupBy({
    by: ["taskType", "provider"],
    where: { tenantId, createdAt: { gte: startOfCurrentMonth() } },
    _sum: { estimatedCostUsd: true },
  });

  const byTypeAndProvider: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    byTypeAndProvider[r.taskType] ??= {};
    byTypeAndProvider[r.taskType][r.provider] = r._sum.estimatedCostUsd || 0;
  }
  return byTypeAndProvider;
}

// F11 (docs/cdc/16-integracao-cmcrm-presales.md, item 05): substitui o recorte por provedor no
// relatório do tenant - a tela de IA perdeu "Modelos e Provedores" (a IA gerenciada é sempre a
// mesma, pelo Fleet Manager, desde a F11), então "qual provedor atendeu" deixou de ser uma
// pergunta que o tenant precisa responder. O que continua útil é por SERVIÇO (taskType).
export async function getCurrentMonthSpendByTaskType(tenantId: string): Promise<Record<string, number>> {
  const rows = await prisma.aiUsageLog.groupBy({
    by: ["taskType"],
    where: { tenantId, createdAt: { gte: startOfCurrentMonth() } },
    _sum: { estimatedCostUsd: true },
  });
  const byType: Record<string, number> = {};
  for (const r of rows) byType[r.taskType] = r._sum.estimatedCostUsd || 0;
  return byType;
}

export interface AiUsageByUserRow {
  userId: string;
  userName: string;
  callCount: number;
  costUsd: number;
}

// F11 (item 05): "ganha relatórios" - por usuário, o que a tela nunca teve. Só existe a partir
// da coluna nova (ver a migration desta fase e recordAiUsage em src/aiOrchestrator.ts); chamadas
// anteriores a ela não têm dono e NUNCA vão aparecer aqui - ver getAiUsageOwnershipCoverage
// abaixo para o texto honesto sobre isso, que a tela é obrigada a mostrar junto.
export async function getCurrentMonthSpendByUser(tenantId: string): Promise<AiUsageByUserRow[]> {
  const rows = await prisma.aiUsageLog.groupBy({
    by: ["userId"],
    where: { tenantId, createdAt: { gte: startOfCurrentMonth() }, userId: { not: null } },
    _sum: { estimatedCostUsd: true },
    _count: { _all: true },
  });
  if (rows.length === 0) return [];
  const users = await prisma.user.findMany({
    where: { id: { in: rows.map((r) => r.userId as string) } },
    select: { id: true, name: true },
  });
  const nameById = new Map(users.map((u) => [u.id, u.name]));
  return rows
    .map((r) => ({
      userId: r.userId as string,
      userName: nameById.get(r.userId as string) || r.userId as string,
      callCount: r._count._all,
      costUsd: r._sum.estimatedCostUsd || 0,
    }))
    .sort((a, b) => b.costUsd - a.costUsd);
}

export interface AiUsageOwnershipCoverage {
  totalCalls: number;
  callsWithOwner: number;
}

// F11 (item 05, §8 item 31 do plano): "79% do consumo de IA do PreSales não tem dono
// recuperável" - medido no Demo em 28/08/2026 (526 chamadas, 111 com dono via caminho indireto
// de BackgroundTask, 415 sem dono nenhum). A coluna vale DE FRENTE; esta função conta contra o
// histórico REAL da instalação (todo o período, não só o mês atual), pra tela nunca mostrar um
// número congelado de um dia específico - a cobertura sobe com o tempo, à medida que chamadas
// antigas (sem dono) saem da janela relevante e novas (com dono) se acumulam.
export async function getAiUsageOwnershipCoverage(tenantId: string): Promise<AiUsageOwnershipCoverage> {
  const [totalCalls, callsWithOwner] = await Promise.all([
    prisma.aiUsageLog.count({ where: { tenantId } }),
    prisma.aiUsageLog.count({ where: { tenantId, userId: { not: null } } }),
  ]);
  return { totalCalls, callsWithOwner };
}

const FALLBACK_ALERT_WINDOW_MS = 60 * 60 * 1000;
const FALLBACK_ALERT_THRESHOLD = 3;

// Every fallback is audited unconditionally; 3+ fallbacks to the same intended provider within
// an hour additionally raises an Admin-visible alert - a real signal that the desired provider
// should be connected, not an isolated one-off.
export async function recordProviderFallback(params: {
  tenantId: string;
  taskType: AiTaskType;
  intendedProvider: string;
  userId: string;
}): Promise<void> {
  await dbStore.addAuditLog({
    user_id: params.userId,
    action: "AI Provider Fallback",
    entity_type: "BackgroundTask",
    entity_id: "",
    ip_address: "system",
    user_agent: "ai-orchestrator",
    metadata: JSON.stringify({ task_type: params.taskType, intended_provider: params.intendedProvider, used_provider: "gemini" }),
  });

  const recentFallbacks = await prisma.auditLog.count({
    where: {
      tenantId: params.tenantId,
      action: "AI Provider Fallback",
      createdAt: { gte: new Date(Date.now() - FALLBACK_ALERT_WINDOW_MS) },
      metadata: { contains: `"intended_provider":"${params.intendedProvider}"` },
    },
  });

  if (recentFallbacks >= FALLBACK_ALERT_THRESHOLD) {
    await dbStore.addAuditLog({
      user_id: params.userId,
      action: "AI Provider Fallback Alert",
      entity_type: "BackgroundTask",
      entity_id: "",
      ip_address: "system",
      user_agent: "ai-orchestrator",
      metadata: JSON.stringify({
        task_type: params.taskType,
        intended_provider: params.intendedProvider,
        occurrences_in_window: recentFallbacks,
        window_minutes: FALLBACK_ALERT_WINDOW_MS / 60000,
      }),
    });
  }
}
