import express, { Request, Response, NextFunction } from "express";
import { dbStore } from "../../src/dbStore";
import { requirePermission } from "./auth";
import { sanitizeAndMaskObject } from "../utils/security";

const router = express.Router();

function parseLimit(value: any, fallback = 500, max = 1000) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function filterAuditLogs(req: Request) {
  const {
    user_id,
    action,
    entity_type,
    project_id,
    q,
    from,
    to
  } = req.query as Record<string, string | undefined>;

  const limit = parseLimit(req.query.limit);
  let logs = dbStore.getAuditLogs();

  if (user_id) logs = logs.filter(log => log.user_id === user_id);
  if (action) logs = logs.filter(log => log.action.toLowerCase().includes(action.toLowerCase()));
  if (entity_type) logs = logs.filter(log => log.entity_type === entity_type);
  if (project_id) logs = logs.filter(log => log.project_id === project_id);

  if (from) {
    const fromTime = new Date(from).getTime();
    if (!Number.isNaN(fromTime)) {
      logs = logs.filter(log => new Date(log.created_at).getTime() >= fromTime);
    }
  }

  if (to) {
    const toTime = new Date(to).getTime();
    if (!Number.isNaN(toTime)) {
      logs = logs.filter(log => new Date(log.created_at).getTime() <= toTime);
    }
  }

  if (q) {
    const needle = q.toLowerCase();
    logs = logs.filter(log => JSON.stringify(log).toLowerCase().includes(needle));
  }

  return logs.slice(0, limit);
}

function csvEscape(value: any) {
  const text = value === undefined || value === null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

router.get("/audit-logs", requirePermission("admin:audit"), (req: Request, res: Response, next: NextFunction) => {
  try {
    const logs = filterAuditLogs(req).map(log => sanitizeAndMaskObject(log));
    res.json(logs);
  } catch (err) {
    next(err);
  }
});

router.get("/audit-logs/export/csv", requirePermission("admin:audit"), (req: Request, res: Response, next: NextFunction) => {
  try {
    const logs = filterAuditLogs(req).map(log => sanitizeAndMaskObject(log));

    const headers = [
      "ID",
      "Timestamp",
      "User",
      "Action",
      "Entity",
      "EntityID",
      "ProjectID",
      "IP Address",
      "User Agent",
      "Metadata"
    ];

    const rows = logs.map(log => [
      log.id,
      log.created_at,
      log.user_id,
      log.action,
      log.entity_type,
      log.entity_id,
      log.project_id || "",
      log.ip_address,
      log.user_agent,
      log.metadata || ""
    ].map(csvEscape).join(","));

    const csv = [headers.map(csvEscape).join(","), ...rows].join("\n") + "\n";

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=commercial_assistant_audit_log.csv");
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

export default router;
