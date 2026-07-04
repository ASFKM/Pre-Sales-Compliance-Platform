import express, { Request, Response, NextFunction } from "express";
import { dbStore } from "../../src/dbStore";
import { requireAuth, requirePermission } from "./auth";
import { encryptSecret, maskSecret, decryptSecret } from "../utils/security";

const router = express.Router();

function parseConfiguration(configuration: any): Record<string, any> {
  if (!configuration) return {};
  if (typeof configuration === "object") return configuration;
  try {
    return JSON.parse(configuration);
  } catch {
    return {};
  }
}

function stringifyConfiguration(configuration: Record<string, any>) {
  return JSON.stringify(configuration || {});
}

function normalizeStatus(status: any): "connected" | "disconnected" | "error" {
  if (status === "connected" || status === "disconnected" || status === "error") return status;
  if (status === "active") return "connected";
  return "disconnected";
}

function safeConnectorForResponse(conn: any) {
  const cloned = { ...conn } as any;
  const configuration = parseConfiguration(cloned.configuration);

  cloned.url = configuration.url || configuration.endpoint || "";
  cloned.sync_frequency = configuration.sync_frequency || "";
  cloned.configuration = stringifyConfiguration(configuration);

  if (cloned.api_key) {
    try {
      cloned.token = maskSecret(decryptSecret(cloned.api_key));
      cloned.api_key = cloned.token;
    } catch {
      cloned.token = "********";
      cloned.api_key = "********";
    }
  } else {
    cloned.token = "";
  }

  if (cloned.webhook_secret) {
    try {
      cloned.webhook_secret = maskSecret(decryptSecret(cloned.webhook_secret));
    } catch {
      cloned.webhook_secret = "********";
    }
  }

  return cloned;
}

function buildConnectorPayload(input: any, existing?: any) {
  const currentConfig = parseConfiguration(existing?.configuration);
  const incomingConfig = parseConfiguration(input.configuration);

  const mergedConfig = {
    ...currentConfig,
    ...incomingConfig,
  };

  if (input.url) {
    mergedConfig.url = input.url;
  }

  delete mergedConfig.token;
  delete mergedConfig.api_key;
  delete mergedConfig.webhook_secret;
  delete mergedConfig.secret;

  const payload: any = {
    ...input,
    configuration: stringifyConfiguration(mergedConfig),
  };

  delete payload.url;
  delete payload.token;

  if (input.name !== undefined) payload.name = String(input.name).trim();
  if (input.type !== undefined) payload.type = String(input.type).trim() || "Custom";
  if (input.status !== undefined) payload.status = normalizeStatus(input.status);

  if (input.api_key && !String(input.api_key).includes("*") && !String(input.api_key).includes("•") && !String(input.api_key).includes("...")) {
    payload.api_key = encryptSecret(String(input.api_key));
  } else {
    delete payload.api_key;
  }

  if (input.token && !String(input.token).includes("*") && !String(input.token).includes("•") && !String(input.token).includes("...")) {
    payload.api_key = encryptSecret(String(input.token));
  }

  if (input.webhook_secret && !String(input.webhook_secret).includes("*") && !String(input.webhook_secret).includes("•") && !String(input.webhook_secret).includes("...")) {
    payload.webhook_secret = encryptSecret(String(input.webhook_secret));
  } else {
    delete payload.webhook_secret;
  }

  return payload;
}

async function auditIntegration(req: Request, action: string, entityId: string, metadata: any) {
  const userId = (req.headers["x-user-id"] as string) || "u1";
  await dbStore.addAuditLog({
    user_id: userId,
    action,
    entity_type: "IntegrationConnector",
    entity_id: entityId,
    ip_address: req.ip || "127.0.0.1",
    user_agent: req.headers["user-agent"] || "unknown",
    metadata: JSON.stringify(metadata || {})
  });
}

// Retrieve all integration connectors with masked credentials
router.get("/", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const integrations = await dbStore.getIntegrations();
    res.json(integrations.map(safeConnectorForResponse));
  } catch (err) {
    next(err);
  }
});

// Create integration connector
router.post("/", requirePermission("integrations:manage"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = req.body as any;

    if (!data.name || !String(data.name).trim()) {
      return res.status(400).json({ success: false, message: "Integration name is required." });
    }

    const payload = buildConnectorPayload({
      ...data,
      status: normalizeStatus(data.status || "disconnected"),
      last_sync_status: data.last_sync_status || "NEVER_SYNCED",
    });

    const newConn = await dbStore.addIntegration(payload) as any;

    await auditIntegration(req, "Add Integration Connector", newConn.id, {
      name: newConn.name,
      type: newConn.type,
      status: newConn.status
    });

    res.status(201).json(safeConnectorForResponse(newConn));
  } catch (err) {
    next(err);
  }
});

// Update integration connector
router.put("/:id", requirePermission("integrations:manage"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const integrations = await dbStore.getIntegrations();
    const existing = integrations.find(c => c.id === req.params.id) as any;

    if (!existing) {
      return res.status(404).json({ success: false, message: "Integration not found" });
    }

    const updates = buildConnectorPayload(req.body as any, existing);
    const conn = await dbStore.updateIntegration(req.params.id, updates) as any;

    await auditIntegration(req, "Update Integration", req.params.id, {
      name: conn.name,
      type: conn.type,
      status: conn.status
    });

    res.json(safeConnectorForResponse(conn));
  } catch (err) {
    next(err);
  }
});

// Delete integration
router.delete("/:id", requirePermission("integrations:manage"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const deleted = await dbStore.deleteIntegration(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: "Integration not found" });
    }

    await auditIntegration(req, "Remove Integration", req.params.id, { id: req.params.id });

    res.json({ success: true, message: "Integration removed successfully" });
  } catch (err) {
    next(err);
  }
});

// Validate connector configuration securely without simulating an external sync
router.post("/:id/test", requirePermission("integrations:manage"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const integrations = await dbStore.getIntegrations();
    const conn = integrations.find(c => c.id === req.params.id) as any;
    if (!conn) {
      return res.status(404).json({ success: false, message: "Integration not found" });
    }

    let hasCredential = false;
    if (conn.api_key) {
      const actualKey = decryptSecret(conn.api_key);
      hasCredential = Boolean(actualKey);
      console.log(`[Integration Test] Pinging ${conn.name} with credential ${maskSecret(actualKey)}`);
    }

    const configuration = parseConfiguration(conn.configuration);
    const canConnect = Boolean(configuration.url || configuration.endpoint);

    const status = canConnect ? "connected" : "error";
    const lastSyncStatus = canConnect ? "CONFIG_VALIDATED" : "CONFIG_INVALID";

    const updated = await dbStore.updateIntegration(req.params.id, {
      status,
      last_sync_status: lastSyncStatus,
      last_sync_date: new Date().toISOString(),
      error_message: canConnect ? "" : "Missing endpoint URL."
    }) as any;

    await auditIntegration(req, "Validate Integration Configuration", req.params.id, {
      name: conn.name,
      status,
      has_credential: hasCredential,
      endpoint_configured: canConnect,
      external_sync_executed: false
    });

    res.json({
      success: canConnect,
      status,
      validation_mode: "configuration_only",
      external_sync_executed: false,
      latency_ms: null,
      credential_configured: hasCredential,
      integration: safeConnectorForResponse(updated),
      message: canConnect
        ? "Connector configuration validated. No external sync was executed."
        : "Integration endpoint is not configured."
    });
  } catch (err) {
    next(err);
  }
});

export default router;
