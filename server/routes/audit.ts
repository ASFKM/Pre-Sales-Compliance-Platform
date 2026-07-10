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

function validateAuditQuery(req: Request) {
  const { q, from, to } = req.query as Record<string, string | undefined>;

  if (q && q.length > 200) {
    return { valid: false, message: "Audit search query is too long." };
  }

  if (from && Number.isNaN(new Date(from).getTime())) {
    return { valid: false, message: "Invalid audit from date." };
  }

  if (to && Number.isNaN(new Date(to).getTime())) {
    return { valid: false, message: "Invalid audit to date." };
  }

  if (from && to && new Date(from).getTime() > new Date(to).getTime()) {
    return { valid: false, message: "Audit from date must be before to date." };
  }

  return { valid: true, message: "" };
}

// Filtering/searching/the limit are all applied at the DB level (dbStore.queryAuditLogs) instead
// of fetching up to 1000 rows unconditionally and filtering them in JS on every request, even for
// a query that only ever wanted a handful of rows (a single user_id, a narrow date range, a tight
// limit).
async function filterAuditLogs(req: Request) {
  const {
    user_id,
    action,
    entity_type,
    entity_id,
    project_id,
    q,
    from,
    to
  } = req.query as Record<string, string | undefined>;

  return dbStore.queryAuditLogs({
    userId: user_id,
    action,
    entityType: entity_type,
    entityId: entity_id,
    projectId: project_id,
    from: from && !Number.isNaN(new Date(from).getTime()) ? new Date(from) : undefined,
    to: to && !Number.isNaN(new Date(to).getTime()) ? new Date(to) : undefined,
    q,
    limit: parseLimit(req.query.limit),
  });
}

function csvEscape(value: any) {
  let text = value === undefined || value === null ? "" : String(value);

  if (/^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }

  return `"${text.replace(/"/g, '""')}"`;
}

router.get("/audit-logs", requirePermission("admin:audit"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const queryValidation = validateAuditQuery(req);
    if (!queryValidation.valid) {
      return res.status(400).json({ success: false, message: queryValidation.message });
    }

    const logs = (await filterAuditLogs(req)).map(log => sanitizeAndMaskObject(log));
    res.json(logs);
  } catch (err) {
    next(err);
  }
});

router.get("/audit-logs/export/csv", requirePermission("admin:audit"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const queryValidation = validateAuditQuery(req);
    if (!queryValidation.valid) {
      return res.status(400).json({ success: false, message: queryValidation.message });
    }

    const logs = (await filterAuditLogs(req)).map(log => sanitizeAndMaskObject(log));

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
