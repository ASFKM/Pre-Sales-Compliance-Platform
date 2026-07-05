import { prisma } from "./prisma";
import { redis } from "./redis";
import { getCurrentTenantId } from "./tenantContext";

function randomId(prefix: string): string {
  return `${prefix}_` + Math.random().toString(36).substring(2, 11);
}

export type BackgroundTaskType = "document_analysis" | "proposal_generation" | "project_intake_analysis";
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
  result_type: string | null;
  result_id: string | null;
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
    result_type: t.resultType ?? null,
    result_id: t.resultId ?? null,
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
}): Promise<BackgroundTask> {
  const t = await prisma.backgroundTask.create({
    data: {
      id: randomId("task"),
      tenantId: requireTenantId(),
      userId: params.userId,
      type: params.type,
      status: "queued",
      currentStep: params.currentStep,
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

export async function completeTask(id: string, result: { resultType: string; resultId: string }): Promise<BackgroundTask> {
  const t = await prisma.backgroundTask.update({
    where: { id },
    data: {
      status: "completed",
      currentStep: "Concluído",
      progressPct: 100,
      resultType: result.resultType,
      resultId: result.resultId,
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

  subscriber.subscribe(channel).catch((err) => console.error("Failed to subscribe to task channel:", err));
  subscriber.on("message", (_channel, message) => {
    try {
      onMessage(JSON.parse(message));
    } catch (err) {
      console.error("Failed to parse task update message:", err);
    }
  });

  return () => {
    subscriber.unsubscribe(channel).catch(() => {});
    subscriber.quit().catch(() => {});
  };
}
