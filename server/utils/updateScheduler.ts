import { spawn } from "child_process";
import path from "path";
import { prisma } from "../../src/prisma";
import { runWithTenant } from "../../src/tenantContext";
import { dbStore } from "../../src/dbStore";
import { randomId } from "../../src/idGenerator";
import { getAppVersion } from "./appVersion";
import { logger } from "./logger";

// Sistema de Atualização de Produção (Ponto 5/6 do plano). Deliberately does NOT import
// fleetLicense.ts (which imports this module to call persistLatestRelease/triggerImmediateUpdate
// on apply_update) - that would be a circular import. The "send an immediate out-of-band
// heartbeat on failure" step lives in scripts/systemUpdateRunner.ts instead, the CLI entrypoint
// update.sh calls at each lifecycle transition, which is free to import both modules since
// nothing imports the CLI script back.

export interface LatestReleaseInfo {
  id: string;
  version: string;
  channel: string;
  code_ref: string;
  published_at: string | null;
}

// process.cwd() rather than a __dirname-based resolution: this module runs both under tsx (real
// ESM, no __dirname) and bundled into dist/server.cjs by the production build - the one thing
// both have in common is being launched from the repo root (systemd unit's WorkingDirectory, npm
// scripts, and every manual tsx invocation in this codebase all do this already - see
// performVulnerabilityScan's own `cwd: process.cwd()` a few files over for the same assumption).
const REPO_ROOT = process.cwd();
const UPDATE_SCRIPT_PATH = path.join(REPO_ROOT, "scripts", "update.sh");

// A legitimate run (backup + checkout + npm ci + migrate + build + restart + health check, or
// the same again for an automatic rollback) should never take anywhere near this long - past it,
// the detached child almost certainly crashed or was killed, and nothing else will ever mark the
// row as finished.
const MAX_UPDATE_DURATION_MS = 30 * 60 * 1000;
// Missed-schedule tolerance (decisão já confirmada): run automatically if the delay is small,
// otherwise require the admin to explicitly reschedule.
const MISSED_SCHEDULE_TOLERANCE_MS = 15 * 60 * 1000;
const SCHEDULE_CHECK_INTERVAL_MS = 5 * 60 * 1000;

// Caches the last heartbeat's latest_release into this tenant's SystemUpdateState, alongside a
// fresh snapshot of the version this process is actually running right now. Called from
// fleetLicense.ts on every successful heartbeat (mirrors how every other heartbeat-derived field
// gets persisted there).
export async function persistLatestRelease(tenantId: string, latestRelease: LatestReleaseInfo | null): Promise<void> {
  const appVersion = getAppVersion();
  const existing = await prisma.systemUpdateState.findUnique({ where: { tenantId } });
  const releaseChanged = (existing?.latestReleaseId ?? null) !== (latestRelease?.id ?? null);

  const data = {
    currentVersion: appVersion.version,
    currentGitSha: appVersion.gitShaShort,
    lastCheckedAt: new Date(),
    latestReleaseId: latestRelease?.id ?? null,
    latestReleaseVersion: latestRelease?.version ?? null,
    latestReleaseChannel: latestRelease?.channel ?? null,
    latestReleaseCodeRef: latestRelease?.code_ref ?? null,
    latestReleasePublishedAt: latestRelease?.published_at ? new Date(latestRelease.published_at) : null,
    // A newer (or now-absent, e.g. retracted) release invalidates the cached full notes text -
    // the admin console re-fetches on demand the next time it's opened.
    ...(releaseChanged ? { latestReleaseNotesMd: null } : {}),
  };

  // upsert() is disallowed on tenant-scoped models by src/prisma.ts's own extension (its
  // tenantId-injection can't safely reach an upsert's `where` clause) - findUnique + create/update
  // instead, same pattern the extension's own error message points to.
  if (existing) {
    await prisma.systemUpdateState.update({ where: { tenantId }, data });
  } else {
    await prisma.systemUpdateState.create({ data: { id: randomId("sus"), tenantId, ...data } });
  }
}

export async function scheduleUpdate(tenantId: string, params: { updateAt: Date; releaseId: string; codeRef: string }): Promise<void> {
  await prisma.systemUpdateState.update({
    where: { tenantId },
    data: { scheduledUpdateAt: params.updateAt, scheduledReleaseId: params.releaseId, scheduledCodeRef: params.codeRef },
  });
}

export async function cancelScheduledUpdate(tenantId: string): Promise<void> {
  await prisma.systemUpdateState.update({
    where: { tenantId },
    data: { scheduledUpdateAt: null, scheduledReleaseId: null, scheduledCodeRef: null },
  });
}

export interface TriggerUpdateParams {
  releaseId: string;
  codeRef: string;
  releaseVersion?: string;
  triggeredBy: "scheduled" | "manual" | "remote_command";
  // Only meaningful for triggeredBy === "manual" - the admin who clicked "Atualizar Agora".
  actorUserId?: string;
}

export interface TriggerUpdateResult {
  started: boolean;
  reason?: string;
  historyId?: string;
  taskId?: string;
}

// Creates the BackgroundTask/SystemUpdateHistory rows and spawns scripts/update.sh as a detached
// child process - detached because the script's own steps restart THIS process (systemctl restart
// commercial-assistant-ai), so it can't be a synchronous in-process call that would be killed
// mid-flight by its own restart step.
export async function triggerImmediateUpdate(tenantId: string, params: TriggerUpdateParams): Promise<TriggerUpdateResult> {
  const alreadyRunning = await prisma.backgroundTask.findFirst({
    where: { tenantId, type: "system_update", status: { in: ["queued", "running"] } },
  });
  if (alreadyRunning) {
    return { started: false, reason: "Já existe uma atualização em andamento para esta instalação." };
  }

  const appVersion = getAppVersion();
  const now = new Date();
  const taskId = randomId("bgt");
  const historyId = randomId("sush");
  const toVersion = params.releaseVersion || params.codeRef;

  await prisma.backgroundTask.create({
    data: {
      id: taskId,
      tenantId,
      userId: params.triggeredBy === "manual" ? params.actorUserId ?? null : null,
      type: "system_update",
      status: "running",
      currentStep: "Preparando atualização (backup)",
    },
  });
  await prisma.systemUpdateHistory.create({
    data: {
      id: historyId,
      tenantId,
      fromVersion: appVersion.version,
      fromCodeRef: appVersion.gitShaShort,
      toVersion,
      toCodeRef: params.codeRef,
      releaseId: params.releaseId,
      startedAt: now,
      status: "in_progress",
      triggeredBy: params.triggeredBy,
      backgroundTaskId: taskId,
    },
  });
  await prisma.systemUpdateState.update({
    where: { tenantId },
    data: {
      lastAttemptStatus: "in_progress",
      lastAttemptStartedAt: now,
      lastAttemptFinishedAt: null,
      lastAttemptFromVersion: appVersion.version,
      lastAttemptToVersion: toVersion,
      lastAttemptErrorLog: null,
      lastAttemptErrorReportedAt: null,
    },
  });

  // Caught by the real Presales Demo rehearsal (2026-07-17): plain `detached: true` isn't enough
  // to survive `pm2 restart` - PM2 (via the treekill package) walks the OS process tree by PPID
  // and kills every descendant of the app it's restarting, which still includes this child at the
  // moment restart_app() runs inside update.sh, even though Node's own event loop had already
  // detached from it. `setsid` puts the child in a brand-new session before bash even starts,
  // which is what actually breaks the PPID chain treekill walks - `detached: true` alone only
  // asks Node not to wait on it, it doesn't reparent the process immediately.
  const child = spawn(
    "setsid",
    ["bash", UPDATE_SCRIPT_PATH, "--ref", params.codeRef, "--release-id", params.releaseId, "--tenant-id", tenantId, "--history-id", historyId, "--task-id", taskId],
    { detached: true, stdio: "ignore", cwd: REPO_ROOT }
  );
  child.unref();

  return { started: true, historyId, taskId };
}

// Shared by the boot/periodic staleness-reaper below and (via scripts/systemUpdateRunner.ts) by
// update.sh's own failure/rollback-failure paths.
export async function markAttemptFailed(
  tenantId: string,
  errorLog: string,
  opts?: { historyId?: string; taskId?: string; rolledBack?: boolean }
): Promise<void> {
  const now = new Date();
  const status: "failed" | "rolled_back" = opts?.rolledBack ? "rolled_back" : "failed";
  await prisma.systemUpdateState.update({
    where: { tenantId },
    data: { lastAttemptStatus: status, lastAttemptFinishedAt: now, lastAttemptErrorLog: errorLog, lastAttemptErrorReportedAt: now },
  });
  if (opts?.historyId) {
    await prisma.systemUpdateHistory.update({ where: { id: opts.historyId }, data: { status, finishedAt: now, errorLog } });
  }
  if (opts?.taskId) {
    await prisma.backgroundTask.update({ where: { id: opts.taskId }, data: { status: "failed", errorMessage: errorLog } });
  }
}

export async function markAttemptSucceeded(tenantId: string, opts: { historyId: string; taskId: string; backupRef?: string }): Promise<void> {
  const now = new Date();
  const appVersion = getAppVersion();
  await prisma.systemUpdateState.update({
    where: { tenantId },
    data: {
      lastAttemptStatus: "success",
      lastAttemptFinishedAt: now,
      currentVersion: appVersion.version,
      currentGitSha: appVersion.gitShaShort,
      scheduledUpdateAt: null,
      scheduledReleaseId: null,
      scheduledCodeRef: null,
      ...(opts.backupRef ? { backupRef: opts.backupRef } : {}),
    },
  });
  await prisma.systemUpdateHistory.update({
    where: { id: opts.historyId },
    data: { status: "success", finishedAt: now, toVersion: appVersion.version, toCodeRef: appVersion.gitShaShort || undefined, ...(opts.backupRef ? { backupRef: opts.backupRef } : {}) },
  });
  await prisma.backgroundTask.update({
    where: { id: opts.taskId },
    data: { status: "completed", currentStep: "Atualização concluída", progressPct: 100 },
  });
}

// Runs at boot and every SCHEDULE_CHECK_INTERVAL_MS afterwards - reaps a system_update that's
// been "running" far longer than any legitimate run should take (the detached child crashed or
// was killed with no one left to mark it finished), and fires scheduled updates that are due,
// within the confirmed missed-schedule tolerance.
export async function checkScheduledUpdatesForAllTenants(): Promise<void> {
  const tenantIds = await dbStore.getAllTenantIdsWithFleetReportingEnabled();
  for (const tenantId of tenantIds) {
    await runWithTenant({ tenantId }, async () => {
      try {
        const state = await prisma.systemUpdateState.findUnique({ where: { tenantId } });
        if (!state) return;

        if (state.lastAttemptStatus === "in_progress" && state.lastAttemptStartedAt) {
          const ageMs = Date.now() - state.lastAttemptStartedAt.getTime();
          if (ageMs > MAX_UPDATE_DURATION_MS) {
            logger.error({ tenantId, ageMs }, "system_update preso em in_progress além do tempo máximo esperado - marcando como falha");
            const runningTask = await prisma.backgroundTask.findFirst({ where: { tenantId, type: "system_update", status: { in: ["queued", "running"] } } });
            await markAttemptFailed(
              tenantId,
              "Atualização não concluiu dentro do tempo esperado (processo provavelmente interrompido) - marcada como falha na reconciliação periódica.",
              { taskId: runningTask?.id }
            );
          }
          return;
        }

        if (!state.scheduledUpdateAt) return;
        const dueMs = state.scheduledUpdateAt.getTime() - Date.now();
        if (dueMs > 0) return;

        if (Math.abs(dueMs) <= MISSED_SCHEDULE_TOLERANCE_MS) {
          if (!state.scheduledReleaseId || !state.scheduledCodeRef) return;
          await triggerImmediateUpdate(tenantId, {
            releaseId: state.scheduledReleaseId,
            codeRef: state.scheduledCodeRef,
            triggeredBy: "scheduled",
          });
        } else {
          logger.warn({ tenantId, scheduledUpdateAt: state.scheduledUpdateAt }, "Agendamento de atualização perdido (fora da janela de 15min) - requer reagendamento manual");
        }
      } catch (err) {
        logger.error({ err, tenantId }, "Erro ao reconciliar agendamento de atualização do sistema");
      }
    });
  }
}

export function startUpdateSchedulerInterval(): void {
  checkScheduledUpdatesForAllTenants().catch((err) => logger.error({ err }, "Falha na verificação inicial de agendamentos de atualização"));
  setInterval(() => {
    checkScheduledUpdatesForAllTenants().catch((err) => logger.error({ err }, "Falha ao verificar agendamentos de atualização"));
  }, SCHEDULE_CHECK_INTERVAL_MS);
}
