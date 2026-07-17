import express, { Response, NextFunction } from "express";
import type { Request } from "../types/express";
import { z } from "zod";
import { requirePermission } from "./auth";
import { requireUserId } from "../middleware/security";
import { getCurrentTenantId } from "../../src/tenantContext";
import { prisma } from "../../src/prisma";
import { scheduleUpdate, cancelScheduledUpdate, triggerImmediateUpdate } from "../utils/updateScheduler";
import { dbStore } from "../../src/dbStore";
import { decryptSecret } from "../utils/security";

const router = express.Router();

function mapState(s: any) {
  if (!s) return null;
  return {
    current_version: s.currentVersion,
    current_git_sha: s.currentGitSha,
    last_checked_at: s.lastCheckedAt,
    latest_release: s.latestReleaseId
      ? {
          id: s.latestReleaseId,
          version: s.latestReleaseVersion,
          channel: s.latestReleaseChannel,
          code_ref: s.latestReleaseCodeRef,
          published_at: s.latestReleasePublishedAt,
          notes_md: s.latestReleaseNotesMd,
        }
      : null,
    scheduled_update_at: s.scheduledUpdateAt,
    scheduled_release_id: s.scheduledReleaseId,
    scheduled_code_ref: s.scheduledCodeRef,
    last_attempt_status: s.lastAttemptStatus,
    last_attempt_started_at: s.lastAttemptStartedAt,
    last_attempt_finished_at: s.lastAttemptFinishedAt,
    last_attempt_from_version: s.lastAttemptFromVersion,
    last_attempt_to_version: s.lastAttemptToVersion,
    last_attempt_error_log: s.lastAttemptErrorLog,
    backup_ref: s.backupRef,
  };
}

// Sistema de Atualização de Produção: available to every installation (não é módulo licenciado à
// parte, decisão já confirmada), então só exige a permissão de admin - sem requireModule.
router.get("/admin/system-updates/state", requirePermission("admin:system_updates"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getCurrentTenantId();
    if (!tenantId) {
      return res.status(400).json({ success: false, message: "No tenant context." });
    }
    const state = await prisma.systemUpdateState.findUnique({ where: { tenantId } });
    res.json(mapState(state));
  } catch (err) {
    next(err);
  }
});

router.get("/admin/system-updates/history", requirePermission("admin:system_updates"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getCurrentTenantId();
    if (!tenantId) {
      return res.status(400).json({ success: false, message: "No tenant context." });
    }
    const rows = await prisma.systemUpdateHistory.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    res.json(
      rows.map((h) => ({
        id: h.id,
        from_version: h.fromVersion,
        to_version: h.toVersion,
        from_code_ref: h.fromCodeRef,
        to_code_ref: h.toCodeRef,
        release_id: h.releaseId,
        started_at: h.startedAt,
        finished_at: h.finishedAt,
        status: h.status,
        triggered_by: h.triggeredBy,
        error_log: h.errorLog,
        backup_ref: h.backupRef,
      }))
    );
  } catch (err) {
    next(err);
  }
});

const ScheduleSchema = z.object({
  update_at: z.string().datetime(),
});

router.post("/admin/system-updates/schedule", requirePermission("admin:system_updates"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getCurrentTenantId();
    if (!tenantId) {
      return res.status(400).json({ success: false, message: "No tenant context." });
    }
    const validated = ScheduleSchema.parse(req.body);
    const state = await prisma.systemUpdateState.findUnique({ where: { tenantId } });
    if (!state || !state.latestReleaseId || !state.latestReleaseCodeRef) {
      return res.status(400).json({ success: false, message: "Nenhuma atualização disponível para agendar ainda - aguarde o próximo heartbeat." });
    }
    if (state.lastAttemptStatus === "in_progress") {
      return res.status(400).json({ success: false, message: "Já existe uma atualização em andamento." });
    }
    const updateAt = new Date(validated.update_at);
    if (updateAt.getTime() <= Date.now()) {
      return res.status(400).json({ success: false, message: "A data/hora do agendamento deve estar no futuro." });
    }
    await scheduleUpdate(tenantId, { updateAt, releaseId: state.latestReleaseId, codeRef: state.latestReleaseCodeRef });
    res.json({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.issues[0].message });
    }
    next(err);
  }
});

router.post("/admin/system-updates/cancel", requirePermission("admin:system_updates"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getCurrentTenantId();
    if (!tenantId) {
      return res.status(400).json({ success: false, message: "No tenant context." });
    }
    await cancelScheduledUpdate(tenantId);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// "Atualizar Agora" (manual, distinto do push remoto do CMSaaS - mesmo mecanismo por baixo,
// triggeredBy diferente para o histórico deixar claro quem/o que disparou cada tentativa).
router.post("/admin/system-updates/run-now", requirePermission("admin:system_updates"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getCurrentTenantId();
    if (!tenantId) {
      return res.status(400).json({ success: false, message: "No tenant context." });
    }
    const state = await prisma.systemUpdateState.findUnique({ where: { tenantId } });
    if (!state || !state.latestReleaseId || !state.latestReleaseCodeRef) {
      return res.status(400).json({ success: false, message: "Nenhuma atualização disponível ainda - aguarde o próximo heartbeat." });
    }
    const result = await triggerImmediateUpdate(tenantId, {
      releaseId: state.latestReleaseId,
      codeRef: state.latestReleaseCodeRef,
      releaseVersion: state.latestReleaseVersion || undefined,
      triggeredBy: "manual",
      actorUserId: requireUserId(req),
    });
    if (!result.started) {
      return res.status(400).json({ success: false, message: result.reason });
    }
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// Full release notes (markdown, potentially large) are fetched on demand only when the admin
// actually opens this panel, not on every 20-minute heartbeat (see heartbeat.ts on the CMSaaS
// side for the same reasoning) - cached into SystemUpdateState afterwards so re-opening the panel
// doesn't refetch every time.
router.get("/admin/system-updates/release-notes", requirePermission("admin:system_updates"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getCurrentTenantId();
    if (!tenantId) {
      return res.status(400).json({ success: false, message: "No tenant context." });
    }
    const state = await prisma.systemUpdateState.findUnique({ where: { tenantId } });
    if (!state?.latestReleaseId) {
      return res.status(400).json({ success: false, message: "Nenhuma release disponível." });
    }
    if (state.latestReleaseNotesMd) {
      return res.json({ notes_md: state.latestReleaseNotesMd });
    }

    const settings = await dbStore.getSettings();
    if (!settings.fleet_manager_enabled || !settings.fleet_manager_url || !settings.fleet_manager_api_key_encrypted) {
      return res.status(400).json({ success: false, message: "Conexão com o CMSaaS não configurada." });
    }
    const apiKey = decryptSecret(settings.fleet_manager_api_key_encrypted);
    const releaseRes = await fetch(`${settings.fleet_manager_url}/api/heartbeat/releases/${state.latestReleaseId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!releaseRes.ok) {
      return res.status(502).json({ success: false, message: "Não foi possível buscar as notas de versão no CMSaaS." });
    }
    const release = await releaseRes.json();
    const notesMd = release.release_notes_md || "";
    await prisma.systemUpdateState.update({ where: { tenantId }, data: { latestReleaseNotesMd: notesMd } });
    res.json({ notes_md: notesMd });
  } catch (err) {
    next(err);
  }
});

export default router;
