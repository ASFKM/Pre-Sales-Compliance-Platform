import { prisma } from "./prisma";
import { dbStore } from "./dbStore";
import { randomId } from "./idGenerator";

// critical_extraction and proposal_generation were removed (2026-07 AI Orchestrator redesign) -
// both had provider/model settings in the UI but resolveProvider() was never actually called for
// either anywhere in the codebase (confirmed via a full grep before removing) - the full analysis
// schema (critical_requirements/risks/opportunities/bom/proposal drafts) is produced by a single
// document_analysis call, not separate steps. document_classification was hardcoded to Gemini in
// server/utils/documentClassification.ts before this - now routed through here like the other
// real task types.
export type AiTaskType = "document_analysis" | "web_grounding" | "spec_copilot" | "document_classification";

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
  openai_api_key_encrypted?: string;
  anthropic_api_key_encrypted?: string;
}

// Gemini's key is required platform-wide already (every install needs it for the Workspace
// copilot chat, unrelated to this per-task provider selection), so it's always connected.
// OpenAI/Anthropic are only connected once their own key has actually been configured - checked
// against the same settings object passed in here (which env-var overrides aside, real callers
// always get from dbStore.getSettings()), not a hardcoded list, so this reflects real state
// instead of a fixed-at-code-time assumption.
async function isProviderConnected(provider: string, settings: TaskProviderSettings): Promise<boolean> {
  if (provider === "gemini") return true;
  if (provider === "openai") return Boolean(process.env.OPENAI_API_KEY || settings.openai_api_key_encrypted);
  if (provider === "anthropic") return Boolean(process.env.ANTHROPIC_API_KEY || settings.anthropic_api_key_encrypted);
  // User-added custom provider (Grok/DeepSeek/Mistral/etc.) - connected if a config row exists
  // for this tenant with this provider key.
  return Boolean(await prisma.aiProviderConfig.findFirst({ where: { providerKey: provider } }));
}

// Resolves the intended provider/model for a task type against tenant settings, falling back
// to Gemini (logged as such) when the intended provider isn't actually connected. Always
// returns a usable provider - callers never need their own "what if it's not connected" branch.
export async function resolveProvider(taskType: AiTaskType, settings: TaskProviderSettings): Promise<ProviderResolution> {
  const intendedProvider = (settings as any)[`${taskType}_provider`] as string;
  const intendedModel = (settings as any)[`${taskType}_model`] as string;

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
    },
  });
}

export interface CostCapCheck {
  blocked: boolean;
  warningThresholdReached: boolean;
  currentSpendUsd: number;
  capUsd: number | null;
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

  return {
    blocked: currentSpendUsd >= capUsd,
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
