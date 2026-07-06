import crypto from "crypto";
import { dbStore } from "../../src/dbStore";
import { redis } from "../../src/redis";
import { runWithTenant } from "../../src/tenantContext";
import { decryptSecret } from "./security";

// Phase 7 (fleet/license management): the public half of the fleet manager's Ed25519 signing
// keypair, baked into this build (not fetched at runtime - a compromised heartbeat response
// could otherwise swap in an attacker's key and forge an "active" status). Generated once on
// the fleet manager (saasmanager-01) and copied here manually when it's provisioned/rotated.
const FLEET_MANAGER_PUBLIC_KEY = "MCowBQYDK2VwAyEAhHOq3vmwve6en5Zy8CcL5GQwceu5W1FXZlkJ3BQHaxs=";

interface LicenseStatusPayload {
  installation_id: string;
  customer_name: string;
  status: "active" | "suspended";
  block_mode: "full_lockout" | "read_only" | null;
  modules: string[];
  issued_at: string;
  valid_until: string;
}

interface CachedLicense {
  payload: LicenseStatusPayload;
  signature: string;
  verifiedAt: string;
}

function licenseCacheKey(tenantId: string): string {
  return `fleet:license:${tenantId}`;
}

function lastLogSyncKey(tenantId: string): string {
  return `fleet:last_log_sync:${tenantId}`;
}

function verifyPayload(payload: LicenseStatusPayload, signature: string): boolean {
  try {
    const publicKey = crypto.createPublicKey({ key: Buffer.from(FLEET_MANAGER_PUBLIC_KEY, "base64"), format: "der", type: "spki" });
    const data = Buffer.from(JSON.stringify(payload, Object.keys(payload).sort()), "utf8");
    return crypto.verify(null, data, publicKey, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

async function collectRecentLogs(tenantId: string): Promise<Record<string, any>[]> {
  const lastSync = await redis.get(lastLogSyncKey(tenantId));
  const since = lastSync ? new Date(lastSync) : new Date(Date.now() - 24 * 60 * 60 * 1000);

  const logs = await dbStore.getDebugLogs();
  return logs
    .filter((l) => new Date(l.timestamp) > since)
    .slice(0, 100)
    .map((l) => ({ timestamp: l.timestamp, operation: l.operation, level: l.log_level, message: l.message }));
}

async function runVulnerabilityScan(): Promise<{ report: Record<string, any>; critical_count: number; high_count: number; medium_count: number; low_count: number } | null> {
  try {
    const { execSync } = await import("child_process");
    const output = execSync("npm audit --json", { cwd: process.cwd(), timeout: 60000 }).toString();
    const parsed = JSON.parse(output);
    const counts = parsed.metadata?.vulnerabilities || {};
    return {
      report: parsed.metadata || {},
      critical_count: counts.critical || 0,
      high_count: counts.high || 0,
      medium_count: counts.moderate || 0,
      low_count: counts.low || 0,
    };
  } catch (err: any) {
    // npm audit exits non-zero when vulnerabilities are found - stdout still has valid JSON.
    if (err.stdout) {
      try {
        const parsed = JSON.parse(err.stdout.toString());
        const counts = parsed.metadata?.vulnerabilities || {};
        return {
          report: parsed.metadata || {},
          critical_count: counts.critical || 0,
          high_count: counts.high || 0,
          medium_count: counts.moderate || 0,
          low_count: counts.low || 0,
        };
      } catch {
        return null;
      }
    }
    return null;
  }
}

// Called periodically (every 15-60 min) for every tenant with fleet reporting enabled. Never
// throws - a fleet manager outage or network failure must not disrupt the Pre-Sales Compliance
// Platform itself (fail-open is the whole point).
export async function runHeartbeatForTenant(tenantId: string): Promise<void> {
  await runWithTenant({ tenantId }, async () => {
    try {
      const settings = await dbStore.getSettings();
      if (!settings.fleet_manager_enabled || !settings.fleet_manager_url || !settings.fleet_manager_api_key_encrypted) {
        return;
      }

      const apiKey = decryptSecret(settings.fleet_manager_api_key_encrypted);
      const logs = await collectRecentLogs(tenantId);
      const vulnerabilities = await runVulnerabilityScan();

      const res = await fetch(`${settings.fleet_manager_url}/api/heartbeat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ logs, vulnerabilities: vulnerabilities || undefined }),
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        console.error(`Fleet manager heartbeat failed for tenant ${tenantId}: HTTP ${res.status}`);
        return;
      }

      const data = await res.json();
      if (!verifyPayload(data.license, data.signature)) {
        console.error(`Fleet manager heartbeat for tenant ${tenantId}: signature verification FAILED - ignoring response.`);
        return;
      }

      const cached: CachedLicense = { payload: data.license, signature: data.signature, verifiedAt: new Date().toISOString() };
      const ttlMs = new Date(data.license.valid_until).getTime() - Date.now();
      await redis.set(licenseCacheKey(tenantId), JSON.stringify(cached), "PX", Math.max(ttlMs, 60000));
      await redis.set(lastLogSyncKey(tenantId), new Date().toISOString());

      for (const command of data.commands || []) {
        // force_log_collection/force_vulnerability_scan already happened above (this heartbeat
        // always sends both) - acknowledging just tells the fleet manager it was delivered.
        await fetch(`${settings.fleet_manager_url}/api/heartbeat/commands/${command.id}/ack`, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(10000),
        }).catch(() => {});
      }
    } catch (err) {
      console.error(`Fleet manager heartbeat error for tenant ${tenantId}:`, err);
    }
  });
}

export type EnforcementResult = { blocked: boolean; readOnly: boolean; message?: string };

// Fail-open by construction: no cached status, an expired one, or a signature that (somehow)
// no longer verifies all resolve to "allowed" - only an explicit, currently-valid, verified
// "suspended" status blocks anything.
export async function checkLicenseEnforcement(tenantId: string): Promise<EnforcementResult> {
  try {
    const raw = await redis.get(licenseCacheKey(tenantId));
    if (!raw) return { blocked: false, readOnly: false };

    const cached: CachedLicense = JSON.parse(raw);
    if (new Date(cached.payload.valid_until).getTime() <= Date.now()) {
      return { blocked: false, readOnly: false };
    }
    if (!verifyPayload(cached.payload, cached.signature)) {
      return { blocked: false, readOnly: false };
    }

    if (cached.payload.status !== "suspended") {
      return { blocked: false, readOnly: false };
    }

    return {
      blocked: cached.payload.block_mode === "full_lockout",
      readOnly: cached.payload.block_mode === "read_only",
      message: "This account is suspended. Contact AI Pre-Sales Solutions to restore access.",
    };
  } catch {
    return { blocked: false, readOnly: false };
  }
}

export async function runHeartbeatForAllEnabledTenants(): Promise<void> {
  const tenants = await dbStore.getAllTenantIdsWithFleetReportingEnabled();
  for (const tenantId of tenants) {
    await runHeartbeatForTenant(tenantId);
  }
}
