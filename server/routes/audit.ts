import express, { Request, Response, NextFunction } from "express";
import { dbStore } from "../../src/dbStore";
import { requirePermission } from "./auth";

const router = express.Router();

router.get("/audit-logs", requirePermission("admin:audit"), (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(dbStore.getAuditLogs());
  } catch (err) {
    next(err);
  }
});

// CSV Export Endpoint for audit logs
router.get("/audit-logs/export/csv", requirePermission("admin:audit"), (req: Request, res: Response, next: NextFunction) => {
  try {
    const logs = dbStore.getAuditLogs();
    
    let csv = "ID,Timestamp,User,Action,Entity,EntityID,IP Address,User Agent\n";
    logs.forEach(log => {
      csv += `"${log.id}","${log.created_at}","${log.user_id}","${log.action}","${log.entity_type}","${log.entity_id}","${log.ip_address}","${log.user_agent.replace(/"/g, '""')}"\n`;
    });

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=commercial_assistant_audit_log.csv");
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

export default router;
