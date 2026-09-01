import express, { Response, NextFunction } from "express";
import type { Request } from "../types/express";
import { dbStore } from "../../src/dbStore";
import { requirePermission } from "./auth";
import { sanitizeAndMaskObject } from "../utils/security";
import { getHistoricoDeHardwareLocal } from "../utils/hardwareLocalHistory";

const router = express.Router();

function getSafeCorrelationId(value: any) {
  const raw = typeof value === "string" ? value : "";
  const safe = raw.replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 80);

  if (safe) {
    return safe;
  }

  return `corr-diag-${Math.random().toString(36).substring(2, 11)}`;
}

function setNoStoreHeaders(res: Response) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");
}

async function getDiagnosticPayload(req: Request) {
  const rawData = await dbStore.getDiagnosticSummary();
  const correlationId = getSafeCorrelationId(req.headers["x-correlation-id"]);

  const activeConnectors = (rawData.integrationConnectors || [])
    .filter((conn: any) => conn.status === "connected")
    .map((conn: any) => conn.name);

  const sanitizedData = sanitizeAndMaskObject({
    projectsCount: rawData.projectsCount || 0,
    documentsCount: rawData.documentsCount || 0,
    jobsCount: rawData.jobsCount || 0,
    proposalsCount: rawData.proposalsCount || 0,
    usersCount: rawData.usersCount || 0,
    settings: rawData.platformSettings,
    integrations: rawData.integrationConnectors || [],
    debugLogs: rawData.debugLogs || [],
    auditLogs: rawData.auditLogs || [],
    systemEnvironment: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      uptimeSeconds: process.uptime(),
      memoryUsage: process.memoryUsage(),
      environment: process.env.NODE_ENV || "development"
    }
  });

  const generatedAt = new Date().toISOString();
  const filename = `commercial_assistant_diagnostic_package_${generatedAt.replace(/[:.]/g, "-")}.txt`;

  const reportContent =
`======================================================================
  COMMERCIAL ASSISTANT AI - SANITIZED DIAGNOSTIC PACKAGE REPORT
  Generated At: ${generatedAt}
  Correlation ID: ${correlationId}
  Product Version: 3.0.0-hardened
======================================================================

SYSTEM STATUS REPORT:
----------------------------------------------------------------------
Node.js: ${sanitizedData.systemEnvironment.nodeVersion}
Platform: ${sanitizedData.systemEnvironment.platform}
Architecture: ${sanitizedData.systemEnvironment.arch}
Environment: ${sanitizedData.systemEnvironment.environment}
Uptime Seconds: ${Math.round(sanitizedData.systemEnvironment.uptimeSeconds)}
Storage Mode: ${sanitizedData.settings?.storage_mode || "local"}

COUNTS:
----------------------------------------------------------------------
Total Projects: ${sanitizedData.projectsCount}
Total Documents: ${sanitizedData.documentsCount}
Total AI Jobs: ${sanitizedData.jobsCount}
Total Proposals: ${sanitizedData.proposalsCount}
Total Users: ${sanitizedData.usersCount}
Active Connectors: ${activeConnectors.length ? activeConnectors.join(", ") : "none"}

MEMORY USAGE:
----------------------------------------------------------------------
${JSON.stringify(sanitizedData.systemEnvironment.memoryUsage, null, 2)}

INTEGRATIONS SNAPSHOT (SANITIZED):
----------------------------------------------------------------------
${JSON.stringify(sanitizedData.integrations, null, 2)}

DEBUG LOG DUMP (LAST 100 RECORDS, SANITIZED):
----------------------------------------------------------------------
${JSON.stringify(sanitizedData.debugLogs, null, 2)}

AUDIT LOG DUMP (LAST 100 RECORDS, SANITIZED):
----------------------------------------------------------------------
${JSON.stringify(sanitizedData.auditLogs, null, 2)}

======================================================================
  END OF DIAGNOSTIC REPORT PACKAGE
======================================================================
`;

  return {
    success: true,
    correlation_id: correlationId,
    generated_at: generatedAt,
    filename,
    environment: sanitizedData.systemEnvironment.environment,
    active_connections: activeConnectors,
    summary: {
      projects: sanitizedData.projectsCount,
      documents: sanitizedData.documentsCount,
      jobs: sanitizedData.jobsCount,
      proposals: sanitizedData.proposalsCount,
      users: sanitizedData.usersCount,
      debug_logs: sanitizedData.debugLogs.length,
      audit_logs: sanitizedData.auditLogs.length,
      storage_mode: sanitizedData.settings?.storage_mode || "local"
    },
    report_content: reportContent
  };
}

router.get("/admin/logs/debug", requirePermission("admin:debug"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    setNoStoreHeaders(res);
    const logs = await dbStore.getDebugLogs(req.headers["x-tenant-id"] as string);
    const safeLogs = logs.map(log => sanitizeAndMaskObject(log));
    res.json(safeLogs);
  } catch (err) {
    next(err);
  }
});

router.get("/admin/system/status", requirePermission("admin:diagnostics"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    setNoStoreHeaders(res);
    const [settings, integrations, auditLogsCount, debugLogsCount] = await Promise.all([
      dbStore.getSettings(),
      dbStore.getIntegrations(),
      dbStore.countAuditLogs(),
      dbStore.countDebugLogs(),
    ]);

    res.json({
      success: true,
      status: "healthy",
      timestamp: new Date().toISOString(),
      engine: "Commercial Assistant AI Core",
      version: "3.0.0-hardened",
      uptime_seconds: process.uptime(),
      memory_usage: process.memoryUsage(),
      node_version: process.version,
      active_connections: integrations.filter((conn: any) => conn.status === "connected").length,
      database_connector: "PostgreSQL (Prisma)",
      encryption_status: "AES-256-GCM active",
      storage_mode: settings.storage_mode || "local",
      audit_logs: auditLogsCount,
      debug_logs: debugLogsCount
    });
  } catch (err) {
    next(err);
  }
});

router.get("/admin/system/hardware", requirePermission("admin:diagnostics"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    setNoStoreHeaders(res);
    res.json({
      success: true,
      pontos: getHistoricoDeHardwareLocal()
    });
  } catch (err) {
    next(err);
  }
});

router.post("/admin/diagnostics/package", requirePermission("admin:diagnostics"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    setNoStoreHeaders(res);
    const payload = await getDiagnosticPayload(req);
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

router.get("/admin/diagnostics/package/download", requirePermission("admin:diagnostics"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    setNoStoreHeaders(res);
    const payload = await getDiagnosticPayload(req);

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=${payload.filename}`);
    res.send(payload.report_content);
  } catch (err) {
    next(err);
  }
});

export default router;
