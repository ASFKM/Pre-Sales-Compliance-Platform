import { prisma } from "./prisma";
import { dbStore } from "./dbStore";
import { BackgroundTaskType } from "@prisma/client";

export type AiTaskType = "document_analysis" | "critical_extraction" | "web_grounding" | "proposal_generation" | "spec_copilot";

export interface ProviderResolution {
  provider: string;
  model: string;
  intendedProvider: string;
  isFallback: boolean;
}

interface TaskProviderSettings {
  document_analysis_model: string;
  document_analysis_provider: string;
  critical_extraction_model: string;
  critical_extraction_provider: string;
  web_grounding_model: string;
  web_grounding_provider: string;
  proposal_generation_model: string;
  proposal_generation_provider: string;
  spec_copilot_model: string;
  spec_copilot_provider: string;
  openai_api_key_encrypted?: string;
  anthropic_api_key_encrypted?: string;
}

// Gemini's key is required platform-wide already (every install needs it for the Workspace
// copilot chat, unrelated to this per-task provider selection), so it's always connected.
// OpenAI/Anthropic are only connected once their own key has actually been configured - checked
// against the same settings object passed in here (which env-var overrides aside, real callers
// always get from dbStore.getSettings()), not a hardcoded list, so this reflects real state
// instead of a fixed-at-code-time assumption.
function isProviderConnected(provider: string, settings: TaskProviderSettings): boolean {
  if (provider === "gemini") return true;
  if (provider === "openai") return Boolean(process.env.OPENAI_API_KEY || settings.openai_api_key_encrypted);
  if (provider === "anthropic") return Boolean(process.env.ANTHROPIC_API_KEY || settings.anthropic_api_key_encrypted);
  return false;
}

// Resolves the intended provider/model for a task type against tenant settings, falling back
// to Gemini (logged as such) when the intended provider isn't actually connected. Always
// returns a usable provider - callers never need their own "what if it's not connected" branch.
export function resolveProvider(taskType: AiTaskType, settings: TaskProviderSettings): ProviderResolution {
  const intendedProvider = (settings as any)[`${taskType}_provider`] as string;
  const intendedModel = (settings as any)[`${taskType}_model`] as string;

  if (isProviderConnected(intendedProvider, settings)) {
    return { provider: intendedProvider, model: intendedModel, intendedProvider, isFallback: false };
  }

  return {
    provider: "gemini",
    model: settings.document_analysis_model,
    intendedProvider,
    isFallback: true,
  };
}

function startOfCurrentMonth(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

const AI_CALLING_TASK_TYPES: BackgroundTaskType[] = ["document_analysis", "project_intake_analysis"];

export interface CostCapCheck {
  blocked: boolean;
  warningThresholdReached: boolean;
  currentSpendUsd: number;
  capUsd: number | null;
}

// Checked before starting an AI-calling task - the cap is a real block, not just a dashboard
// number. 80% is a warning (task still runs) so nobody discovers the cap mid-emergency.
export async function checkCostCap(tenantId: string, capUsd: number | null): Promise<CostCapCheck> {
  if (capUsd === null) {
    return { blocked: false, warningThresholdReached: false, currentSpendUsd: 0, capUsd: null };
  }

  const rows = await prisma.backgroundTask.findMany({
    where: {
      tenantId,
      type: { in: AI_CALLING_TASK_TYPES },
      createdAt: { gte: startOfCurrentMonth() },
      estimatedCostUsd: { not: null },
    },
    select: { estimatedCostUsd: true },
  });

  const currentSpendUsd = rows.reduce((sum, r) => sum + (r.estimatedCostUsd || 0), 0);

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
  const rows = await prisma.backgroundTask.findMany({
    where: { tenantId, type: { in: AI_CALLING_TASK_TYPES }, createdAt: { gte: startOfCurrentMonth() }, estimatedCostUsd: { not: null } },
    select: { estimatedCostUsd: true },
  });
  return rows.reduce((sum, r) => sum + (r.estimatedCostUsd || 0), 0);
}

// Same real spend, broken down by which task type actually incurred it - the cost card used to
// only show one combined total, giving no visibility into which service (document analysis vs.
// intake extraction) is actually driving spend.
export async function getCurrentMonthSpendByTaskType(tenantId: string): Promise<Record<string, number>> {
  const rows = await prisma.backgroundTask.findMany({
    where: { tenantId, type: { in: AI_CALLING_TASK_TYPES }, createdAt: { gte: startOfCurrentMonth() }, estimatedCostUsd: { not: null } },
    select: { type: true, estimatedCostUsd: true },
  });
  const byType: Record<string, number> = {};
  for (const r of rows) {
    byType[r.type] = (byType[r.type] || 0) + (r.estimatedCostUsd || 0);
  }
  return byType;
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
