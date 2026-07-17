import { prisma } from "./prisma";
import { redis } from "./redis";
import { getCurrentTenantId } from "./tenantContext";
import { randomId } from "./idGenerator";
import { logger } from "../server/utils/logger";

export type BackgroundTaskType = "document_analysis" | "proposal_generation" | "project_intake_analysis" | "knowledge_base_analysis" | "poc_test_generation" | "poc_schedule_generation" | "section_reanalysis" | "proposal_opinion_panel" | "system_update";
export type BackgroundTaskStatus = "queued" | "running" | "completed" | "failed";

export interface BackgroundTask {
  id: string;
  tenant_id: string;
  user_id: string;
  type: BackgroundTaskType;
  status: BackgroundTaskStatus;
  current_step: string;
  progress_pct: number | null;
  error_message: string | null;
  warning_message: string | null;
  result_type: string | null;
  result_id: string | null;
  estimated_cost_usd: number | null;
  ai_provider: string | null;
  intended_provider: string | null;
  is_provider_fallback: boolean;
  created_at: string;
  updated_at: string;
}

function mapTask(t: any): BackgroundTask {
  return {
    id: t.id,
    tenant_id: t.tenantId,
    user_id: t.userId,
    type: t.type,
    status: t.status,
    current_step: t.currentStep,
    progress_pct: t.progressPct ?? null,
    error_message: t.errorMessage ?? null,
    warning_message: t.warningMessage ?? null,
    result_type: t.resultType ?? null,
    result_id: t.resultId ?? null,
    estimated_cost_usd: t.estimatedCostUsd ?? null,
    ai_provider: t.aiProvider ?? null,
    intended_provider: t.intendedProvider ?? null,
    is_provider_fallback: t.isProviderFallback ?? false,
    created_at: t.createdAt.toISOString(),
    updated_at: t.updatedAt.toISOString(),
  };
}

function channelFor(tenantId: string, userId: string): string {
  return `tasks:${tenantId}:${userId}`;
}

async function publish(task: BackgroundTask): Promise<void> {
  await redis.publish(channelFor(task.tenant_id, task.user_id), JSON.stringify(task));
}

function requireTenantId(): string {
  const tenantId = getCurrentTenantId();
  if (!tenantId) {
    throw new Error("No tenant context set - this operation must run inside runWithTenant().");
  }
  return tenantId;
}

export async function createTask(params: {
  userId: string;
  type: BackgroundTaskType;
  currentStep: string;
  // Known up front for document_analysis (the project id) - set immediately instead of only at
  // completion, so the frontend can tell which project a *running* task belongs to (needed to
  // correctly re-disable the "Executar Análise IA" button after a page reload, when the local
  // isAnalyzing state is gone but the real task is still running).
  resultId?: string;
}): Promise<BackgroundTask> {
  const t = await prisma.backgroundTask.create({
    data: {
      id: randomId("task"),
      tenantId: requireTenantId(),
      userId: params.userId,
      type: params.type,
      status: "queued",
      currentStep: params.currentStep,
      resultId: params.resultId,
    },
  });
  const task = mapTask(t);
  await publish(task);
  return task;
}

export async function updateTaskProgress(id: string, updates: {
  status?: BackgroundTaskStatus;
  currentStep?: string;
  progressPct?: number;
}): Promise<BackgroundTask> {
  const t = await prisma.backgroundTask.update({
    where: { id },
    data: {
      status: updates.status,
      currentStep: updates.currentStep,
      progressPct: updates.progressPct,
    },
  });
  const task = mapTask(t);
  await publish(task);
  return task;
}

export async function completeTask(id: string, result: {
  resultType: string;
  resultId: string;
  estimatedCostUsd?: number;
  aiProvider?: string;
  intendedProvider?: string;
  isProviderFallback?: boolean;
  warningMessage?: string | null;
}): Promise<BackgroundTask> {
  const t = await prisma.backgroundTask.update({
    where: { id },
    data: {
      status: "completed",
      currentStep: "Concluído",
      progressPct: 100,
      resultType: result.resultType,
      resultId: result.resultId,
      estimatedCostUsd: result.estimatedCostUsd,
      aiProvider: result.aiProvider,
      intendedProvider: result.intendedProvider,
      isProviderFallback: result.isProviderFallback,
      warningMessage: result.warningMessage ?? null,
    },
  });
  const task = mapTask(t);
  await publish(task);
  return task;
}

export async function failTask(id: string, errorMessage: string): Promise<BackgroundTask> {
  const t = await prisma.backgroundTask.update({
    where: { id },
    data: {
      status: "failed",
      errorMessage,
    },
  });
  const task = mapTask(t);
  await publish(task);
  return task;
}

export async function getTask(id: string): Promise<BackgroundTask | undefined> {
  const t = await prisma.backgroundTask.findUnique({ where: { id } });
  return t ? mapTask(t) : undefined;
}

export async function getActiveTasksForUser(userId: string): Promise<BackgroundTask[]> {
  const rows = await prisma.backgroundTask.findMany({
    where: { userId, status: { in: ["queued", "running"] } },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(mapTask);
}

// One Redis connection per SSE client (a subscribed ioredis connection can't issue other
// commands, so this can't reuse the shared singleton). Caller is responsible for calling the
// returned unsubscribe function when the client disconnects.
export function subscribeToUserTasks(tenantId: string, userId: string, onMessage: (task: BackgroundTask) => void): () => void {
  const subscriber = redis.duplicate();
  const channel = channelFor(tenantId, userId);

  subscriber.subscribe(channel).catch((err) => logger.error({ err, tenantId, userId }, "Failed to subscribe to task channel"));
  subscriber.on("message", (_channel, message) => {
    try {
      onMessage(JSON.parse(message));
    } catch (err) {
      logger.error({ err, tenantId, userId }, "Failed to parse task update message");
    }
  });

  return () => {
    subscriber.unsubscribe(channel).catch(() => {});
    subscriber.quit().catch(() => {});
  };
}
