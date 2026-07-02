import express, { Request, Response, NextFunction } from "express";
import { dbStore } from "../../src/dbStore";
import { requireAuth, requirePermission } from "./auth";
import { encryptSecret, maskSecret, decryptSecret } from "../utils/security";

const router = express.Router();

// Retrieve all integration connectors with masked credentials
router.get("/", requireAuth, (req: Request, res: Response, next: NextFunction) => {
  try {
    const integrations = dbStore.getIntegrations();
    
    // Mask tokens/keys before sending them to the client-side browser
    const safeIntegrations = integrations.map(conn => {
      const cloned = { ...conn } as any;
      if (cloned.api_key) {
        cloned.api_key = maskSecret(cloned.api_key);
      }
      if (cloned.webhook_secret) {
        cloned.webhook_secret = maskSecret(cloned.webhook_secret);
      }
      return cloned;
    });

    res.json(safeIntegrations);
  } catch (err) {
    next(err);
  }
});

// Create integration connector
router.post("/", requirePermission("integrations:manage"), (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = req.body as any;
    
    // Encrypt sensitive values securely before storing in dbStore
    if (data.api_key) {
      data.api_key = encryptSecret(data.api_key);
    }
    if (data.webhook_secret) {
      data.webhook_secret = encryptSecret(data.webhook_secret);
    }

    const newConn = dbStore.addIntegration({
      ...data,
      status: "active"
    }) as any;

    const userId = (req.headers["x-user-id"] as string) || "u1";
    dbStore.addAuditLog({
      user_id: userId,
      action: "Add Integration Connector",
      entity_type: "IntegrationConnector",
      entity_id: newConn.id,
      ip_address: req.ip || "127.0.0.1",
      user_agent: req.headers["user-agent"] || "unknown",
      metadata: JSON.stringify({ name: newConn.name, provider: newConn.provider || newConn.type })
    });

    res.status(211).json(newConn);
  } catch (err) {
    next(err);
  }
});

// Update integration connector
router.put("/:id", requirePermission("integrations:manage"), (req: Request, res: Response, next: NextFunction) => {
  try {
    const updates = req.body as any;

    // Encrypt secret tokens if modified
    if (updates.api_key && !updates.api_key.includes("...")) {
      updates.api_key = encryptSecret(updates.api_key);
    }
    if (updates.webhook_secret && !updates.webhook_secret.includes("...")) {
      updates.webhook_secret = encryptSecret(updates.webhook_secret);
    }

    const conn = dbStore.updateIntegration(req.params.id, updates) as any;
    if (!conn) {
      return res.status(404).json({ success: false, message: "Integration not found" });
    }

    const userId = (req.headers["x-user-id"] as string) || "u1";
    dbStore.addAuditLog({
      user_id: userId,
      action: "Update Integration",
      entity_type: "IntegrationConnector",
      entity_id: req.params.id,
      ip_address: req.ip || "127.0.0.1",
      user_agent: req.headers["user-agent"] || "unknown",
      metadata: JSON.stringify({ name: conn.name })
    });

    res.json(conn);
  } catch (err) {
    next(err);
  }
});

// Delete integration
router.delete("/:id", requirePermission("integrations:manage"), (req: Request, res: Response, next: NextFunction) => {
  try {
    const deleted = dbStore.deleteIntegration(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: "Integration not found" });
    }

    const userId = (req.headers["x-user-id"] as string) || "u1";
    dbStore.addAuditLog({
      user_id: userId,
      action: "Remove Integration",
      entity_type: "IntegrationConnector",
      entity_id: req.params.id,
      ip_address: req.ip || "127.0.0.1",
      user_agent: req.headers["user-agent"] || "unknown",
      metadata: JSON.stringify({ id: req.params.id })
    });

    res.json({ success: true, message: "Integration removed successfully" });
  } catch (err) {
    next(err);
  }
});

// Test integration (decrypts key internally to run test)
router.post("/:id/test", requirePermission("integrations:manage"), (req: Request, res: Response, next: NextFunction) => {
  try {
    const conn = dbStore.getIntegrations().find(c => c.id === req.params.id) as any;
    if (!conn) {
      return res.status(404).json({ success: false, message: "Integration not found" });
    }

    let actualKey = "";
    if (conn.api_key) {
      actualKey = decryptSecret(conn.api_key);
    }

    // Run connection probe simulator securely
    console.log(`[Integration Test] Pinging external provider ${conn.provider || conn.type} with decrypted credentials ${maskSecret(actualKey)}`);

    res.json({ success: true, status: "connected", latency_ms: 124 });
  } catch (err) {
    next(err);
  }
});

export default router;
