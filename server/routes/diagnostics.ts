import express, { Request, Response, NextFunction } from "express";
import { dbStore } from "../../src/dbStore";
import { requireAdmin } from "./auth";
import { sanitizeAndMaskObject } from "../utils/security";

const router = express.Router();

function getDiagnosticPayload(req: Request) {
  const rawData = dbStore.getData();
  const correlationId = (req.headers["x-correlation-id"] as string) || `corr-diag-${Math.random().toString(36).substring(2, 11)}`;

  const activeConnectors = (rawData.integrationConnectors || [])
    .filter((conn: any) => conn.status === "connected")
    .map((conn: any) => conn.name);

  const sanitizedData = sanitizeAndMaskObject({
    projectsCount: rawData.projects?.length || 0,
    documentsCount: rawData.documents?.length || 0,
    jobsCount: rawData.analysisJobs?.length || 0,
    proposalsCount: rawData.proposals?.length || 0,
    usersCount: rawData.users?.length || 0,
    settings: rawData.platformSettings,
    integrations: rawData.integrationConnectors || [],
    debugLogs: rawData.debugLogs?.slice(0, 100) || [],
    auditLogs: rawData.auditLogs?.slice(0, 100) || [],
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

router.get("/admin/logs/debug", requireAdmin, (req: Request, res: Response, next: NextFunction) => {
  try {
    const logs = dbStore.getDebugLogs();
    const safeLogs = logs.map(log => sanitizeAndMaskObject(log));
    res.json(safeLogs);
  } catch (err) {
    next(err);
  }
});

router.get("/admin/system/status", requireAdmin, (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawData = dbStore.getData();

    res.json({
      success: true,
      status: "healthy",
      timestamp: new Date().toISOString(),
      engine: "Commercial Assistant AI Core",
      version: "3.0.0-hardened",
      uptime_seconds: process.uptime(),
      memory_usage: process.memoryUsage(),
      node_version: process.version,
      active_connections: (rawData.integrationConnectors || []).filter((conn: any) => conn.status === "connected").length,
      database_connector: "JSON local store",
      encryption_status: "AES-256-CBC active",
      storage_mode: rawData.platformSettings?.storage_mode || "local",
      audit_logs: rawData.auditLogs?.length || 0,
      debug_logs: rawData.debugLogs?.length || 0
    });
  } catch (err) {
    next(err);
  }
});

router.post("/admin/diagnostics/package", requireAdmin, (req: Request, res: Response, next: NextFunction) => {
  try {
    const payload = getDiagnosticPayload(req);
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

router.get("/admin/diagnostics/package/download", requireAdmin, (req: Request, res: Response, next: NextFunction) => {
  try {
    const payload = getDiagnosticPayload(req);

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=${payload.filename}`);
    res.send(payload.report_content);
  } catch (err) {
    next(err);
  }
});

export default router;
