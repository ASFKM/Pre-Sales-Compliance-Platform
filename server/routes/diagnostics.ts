import express, { Request, Response, NextFunction } from "express";
import { dbStore } from "../../src/dbStore";
import { requireAdmin } from "./auth";
import { sanitizeAndMaskObject } from "../utils/security";

const router = express.Router();

router.get("/admin/logs/debug", requireAdmin, (req: Request, res: Response, next: NextFunction) => {
  try {
    const logs = dbStore.getDebugLogs();
    // Sanitized logs
    const safeLogs = logs.map(l => sanitizeAndMaskObject(l));
    res.json(safeLogs);
  } catch (err) {
    next(err);
  }
});

router.get("/admin/system/status", requireAdmin, (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = {
      status: "healthy",
      timestamp: new Date().toISOString(),
      engine: "Commercial Assistant AI Core",
      version: "3.0.0-hardened",
      uptime_seconds: process.uptime(),
      memory_usage: process.memoryUsage(),
      node_version: process.version,
      active_connections: 1,
      database_connector: "JSON in-memory store",
      encryption_status: "AES-256-CBC active"
    };
    res.json(status);
  } catch (err) {
    next(err);
  }
});

// Post endpoint for diagnostic package generation as a sanitized, structured diagnostic report file
router.post("/admin/diagnostics/package", requireAdmin, (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawData = dbStore.getData();
    
    // Mask and sanitize EVERYTHING sensitive (passwords, tokens, configs) before generating diagnostic package
    const sanitizedData = sanitizeAndMaskObject({
      projectsCount: rawData.projects?.length || 0,
      documentsCount: rawData.documents?.length || 0,
      jobsCount: rawData.analysisJobs?.length || 0,
      settings: rawData.platformSettings,
      debugLogs: rawData.debugLogs?.slice(-100) || [],
      auditLogs: rawData.auditLogs?.slice(-100) || [],
      systemEnvironment: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        memoryUsage: process.memoryUsage()
      }
    });

    const reportContent = `======================================================================\n` +
                          `  COMMERCIAL ASSISTANT AI - SANITIZED DIAGNOSTIC PACKAGE REPORT\n` +
                          `  Generated At: ${new Date().toISOString()}\n` +
                          `  Product Version: 3.0.0-hardened\n` +
                          `======================================================================\n\n` +
                          `SYSTEM STATUS REPORT:\n` +
                          `----------------------------------------------------------------------\n` +
                          `Node.js: ${sanitizedData.systemEnvironment.nodeVersion}\n` +
                          `Platform: ${sanitizedData.systemEnvironment.platform}\n` +
                          `Architecture: ${sanitizedData.systemEnvironment.arch}\n` +
                          `Total Projects: ${sanitizedData.projectsCount}\n` +
                          `Total Document Metadata Records: ${sanitizedData.documentsCount}\n` +
                          `Total AI Jobs: ${sanitizedData.jobsCount}\n` +
                          `Storage Mode: ${sanitizedData.settings?.storage_mode || "local"}\n\n` +
                          `DEBUG LOG DUMP (LAST 100 RECORDS, SANITIZED):\n` +
                          `----------------------------------------------------------------------\n` +
                          JSON.stringify(sanitizedData.debugLogs, null, 2) + `\n\n` +
                          `AUDIT LOG DUMP (LAST 100 RECORDS, SANITIZED):\n` +
                          `----------------------------------------------------------------------\n` +
                          JSON.stringify(sanitizedData.auditLogs, null, 2) + `\n\n` +
                          `======================================================================\n` +
                          `  END OF DIAGNOSTIC REPORT PACKAGE\n` +
                          `======================================================================\n`;

    // Send package content back as downloadable plain text/diagnostic report
    res.setHeader("Content-Type", "text/plain");
    res.setHeader("Content-Disposition", "attachment; filename=commercial_assistant_diagnostic_package.txt");
    res.send(reportContent);

  } catch (err) {
    next(err);
  }
});

export default router;
