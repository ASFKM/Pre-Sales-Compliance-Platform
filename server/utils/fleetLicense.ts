import crypto from "crypto";
import os from "os";
import { dbStore } from "../../src/dbStore";
import { redis } from "../../src/redis";
import { runWithTenant } from "../../src/tenantContext";
import { prisma } from "../../src/prisma";
import { decryptSecret } from "./security";
import { randomId } from "../../src/idGenerator";
import { logger } from "./logger";
import { reconcileIncomingKnowledgeEntry, IncomingGlobalKbEntry } from "./knowledgeBaseReconciliation";

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
  plan_name: string | null;
  contract_start_date: string | null;
  contract_end_date: string | null;
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

// Additive payload only: correlation_id/user_id/safe_metadata are new fields alongside the
// original timestamp/operation/level/message - a Fleet Manager build that only reads the
// original 4 keeps working unchanged.
async function collectRecentLogs(tenantId: string): Promise<Record<string, any>[]> {
  const lastSync = await redis.get(lastLogSyncKey(tenantId));
  const since = lastSync ? new Date(lastSync) : new Date(Date.now() - 24 * 60 * 60 * 1000);

  // getDebugLogsSince is tenant-scoped and DB-filtered (the previous dbStore.getDebugLogs() call
  // here had neither: it returned up to 1000 rows across ALL tenants, filtered by "since" in JS
  // afterwards - a multi-tenant install's heartbeat was shipping every other tenant's debug logs
  // to the Fleet Manager too). It also never truncates warn/error/fatal, only caps the info/debug
  // sample - the old .slice(0, 100) applied after filtering could silently drop the oldest events
  // of a busy window regardless of severity.
  const logs = await dbStore.getDebugLogsSince(tenantId, since, 100);
  return logs.map((l) => ({
    timestamp: l.timestamp,
    operation: l.operation,
    level: l.log_level,
    message: l.message,
    correlation_id: l.correlation_id,
    user_id: l.user_id,
    safe_metadata: l.safe_metadata,
  }));
}

interface VulnerabilityFinding {
  package_name: string;
  severity: string;
  title: string;
  url: string;
}

// Each key in npm audit's `vulnerabilities` object is a distinct package - a stable-enough
// identifier to correlate the same finding across scans (present -> still open, absent from a
// later scan -> resolved). `via` entries are either a string (an indirect dependency name) or an
// object carrying the actual advisory title/url - only the object form has that detail.
function extractFindings(vulnerabilities: Record<string, any>): VulnerabilityFinding[] {
  return Object.entries(vulnerabilities || {}).map(([packageName, info]: [string, any]) => {
    const advisory = (info.via || []).find((v: any) => typeof v === "object");
    return {
      package_name: packageName,
      severity: info.severity || "unknown",
      title: advisory?.title || "",
      url: advisory?.url || "",
    };
  });
}

function parseAuditOutput(raw: string) {
  const parsed = JSON.parse(raw);
  const counts = parsed.metadata?.vulnerabilities || {};
  return {
    report: parsed.metadata || {},
    critical_count: counts.critical || 0,
    high_count: counts.high || 0,
    medium_count: counts.moderate || 0,
    low_count: counts.low || 0,
    findings: extractFindings(parsed.vulnerabilities),
  };
}

type VulnerabilityScanResult = {
  report: Record<string, any>;
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  findings: VulnerabilityFinding[];
};

// Not tenant-scoped: every tenant on this install shares the same node_modules, so the same scan
// result applies to all of them - a global cache avoids running npm audit once per tenant on the
// same heartbeat cycle. 24h TTL because the dependency tree only changes on deploy, not between
// heartbeats (every 15-60 min per tenant, per runHeartbeatForTenant below).
const VULN_SCAN_CACHE_KEY = "fleet:vuln_scan:global";
const VULN_SCAN_CACHE_TTL_SECONDS = 24 * 60 * 60;

async function runVulnerabilityScan(): Promise<VulnerabilityScanResult | null> {
  const cached = await redis.get(VULN_SCAN_CACHE_KEY);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch {
      // fall through and re-scan on a corrupt cache entry
    }
  }

  const scanned = await performVulnerabilityScan();
  if (scanned) {
    await redis.set(VULN_SCAN_CACHE_KEY, JSON.stringify(scanned), "EX", VULN_SCAN_CACHE_TTL_SECONDS);
  }
  return scanned;
}

// execSync blocked the entire Node event loop for however long npm audit takes (a real network
// call to the npm registry against the full dependency tree - confirmed capable of running many
// seconds), during which no other request on this same process could be served at all. Promisified
// exec runs the subprocess without blocking the loop.
async function performVulnerabilityScan(): Promise<VulnerabilityScanResult | null> {
  try {
    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(exec);
    const { stdout } = await execAsync("npm audit --json", { cwd: process.cwd(), timeout: 60000, maxBuffer: 10 * 1024 * 1024 });
    return parseAuditOutput(stdout);
  } catch (err: any) {
    // npm audit exits non-zero when vulnerabilities are found - stdout still has valid JSON.
    if (err.stdout) {
      try {
        return parseAuditOutput(err.stdout.toString());
      } catch {
        return null;
      }
    }
    return null;
  }
}

function collectSystemInfo() {
  const totalMemoryMb = Math.round(os.totalmem() / (1024 * 1024));
  const usedMemoryMb = Math.round((os.totalmem() - os.freemem()) / (1024 * 1024));
  const cores = os.cpus().length || 1;
  // 1-minute load average as a % of total cores - a simple, dependency-free approximation of
  // CPU utilization (load average isn't a precise "% busy" figure, but it's good enough for a
  // fleet-wide trend chart and doesn't need a sampling window like a true CPU% measurement would).
  const cpuLoadPercent = Math.min(100, Math.round((os.loadavg()[0] / cores) * 100));
  return {
    os_platform: `${os.platform()} ${os.release()}`,
    cpu_cores: cores,
    cpu_load_percent: cpuLoadPercent,
    total_memory_mb: totalMemoryMb,
    memory_used_mb: usedMemoryMb,
    node_version: process.version,
  };
}

// Strips every *_encrypted field before the snapshot ever leaves this server - the Fleet Manager
// stores this purely as a recovery/diff aid, it should never receive even an encrypted secret.
function sanitizeSettingsForBackup(settings: Record<string, any>): Record<string, any> {
  const sanitized: Record<string, any> = {};
  for (const [key, value] of Object.entries(settings)) {
    if (key.endsWith("_encrypted")) continue;
    sanitized[key] = value;
  }
  return sanitized;
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
      // Locally-approved entries not yet uploaded - see dbStore.getKnowledgeBaseEntriesToSync.
      // Received synchronously by the Fleet Manager within this same request (unlike
      // commands/messages below, this direction needs no queue/ack - see
      // knowledgeBaseReconciliation.ts and heartbeat.ts for what happens to these on each end).
      const kbEntriesToSync = await dbStore.getKnowledgeBaseEntriesToSync(50);

      const body = JSON.stringify({
        logs,
        vulnerabilities: vulnerabilities || undefined,
        system_info: collectSystemInfo(),
        config_snapshot: sanitizeSettingsForBackup(settings as unknown as Record<string, any>),
        knowledge_base_entries: kbEntriesToSync.map((e) => ({
          id: e.id,
          category: e.category,
          trigger: e.trigger,
          knowledge: e.knowledge,
          source_project_name: e.source_project_name,
          source_document_name: e.source_document_name,
        })),
      });
      // Fase 1.6 of the Zero Trust rollout: HMAC over the exact bytes being sent, keyed with the
      // same per-installation API key the Bearer header already carries - see the Fleet
      // Manager's requireHmacSignature for what this catches (in-transit tampering independent
      // of TLS) and what it doesn't (an attacker already holding this API key).
      const signature = crypto.createHmac("sha256", apiKey).update(body).digest("hex");

      const res = await fetch(`${settings.fleet_manager_url}/api/heartbeat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}`, "X-Signature": signature },
        body,
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        logger.error({ tenantId, httpStatus: res.status }, "Fleet manager heartbeat failed");
        return;
      }

      const data = await res.json();
      if (!verifyPayload(data.license, data.signature)) {
        logger.error({ tenantId }, "Fleet manager heartbeat signature verification FAILED - ignoring response");
        return;
      }

      // Anti-replay (Fase 1.6 of the Zero Trust rollout): a captured {payload, signature} pair
      // stays validly signed for its whole valid_until window (up to 24h) - without this check,
      // replaying an old "active" response would resurrect that status even after a real
      // suspension. issued_at already exists on the payload and is set fresh by the Fleet
      // Manager on every heartbeat, so it doubles as a monotonic nonce with no wire-format
      // change on that end: reject anything that isn't strictly newer than what's already
      // cached.
      const previousRaw = await redis.get(licenseCacheKey(tenantId));
      if (previousRaw) {
        const previous: CachedLicense = JSON.parse(previousRaw);
        if (new Date(data.license.issued_at).getTime() <= new Date(previous.payload.issued_at).getTime()) {
          logger.error(
            { tenantId, newIssuedAt: data.license.issued_at, cachedIssuedAt: previous.payload.issued_at },
            "Fleet manager heartbeat replay suspected - issued_at not newer than cached, ignoring response"
          );
          return;
        }
      }

      const cached: CachedLicense = { payload: data.license, signature: data.signature, verifiedAt: new Date().toISOString() };
      const ttlMs = new Date(data.license.valid_until).getTime() - Date.now();
      await redis.set(licenseCacheKey(tenantId), JSON.stringify(cached), "PX", Math.max(ttlMs, 60000));
      await redis.set(lastLogSyncKey(tenantId), new Date().toISOString());

      for (const command of data.commands || []) {
        // force_log_collection/force_vulnerability_scan already happened above (this heartbeat
        // always sends both) - acknowledging just tells the fleet manager it was delivered.
        // force_kb_sync is different: it clears every locally-approved entry's "already synced"
        // marker so a full resync goes up on the NEXT heartbeat (this one's body was already
        // built before this response arrived) rather than only newly-approved ones.
        if (command.type === "force_kb_sync") {
          await dbStore.resetKnowledgeBaseSyncCursor().catch((err) => logger.warn({ err, tenantId }, "Failed to reset knowledge base sync cursor for force_kb_sync"));
        }
        await fetch(`${settings.fleet_manager_url}/api/heartbeat/commands/${command.id}/ack`, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(10000),
        }).catch(() => {});
      }

      for (const msg of data.messages || []) {
        // fleetMessageId is unique, so a message somehow re-delivered across heartbeats (the
        // Fleet Manager already tracks per-installation delivery, but this is cheap insurance)
        // just no-ops on the second insert instead of showing the same notice twice.
        // Not prisma.systemMessage.upsert(): the tenant-scoping extension (src/prisma.ts) adds
        // `tenantId` to an upsert's `where`, but fleetMessageId's unique constraint doesn't
        // include tenantId - the combined where then matches no unique index, Prisma can't find
        // the existing row, and a re-delivered message would hit the create branch again and
        // fail on the fleetMessageId unique constraint instead of the intended silent no-op.
        const existing = await prisma.systemMessage.findUnique({ where: { fleetMessageId: msg.id } });
        if (!existing) {
          await prisma.systemMessage.create({
            data: {
              id: randomId("sysmsg"),
              tenantId,
              source: "fleet_manager",
              fleetMessageId: msg.id,
              audience: msg.audience,
              body: msg.body,
              createdBy: "AI Pre-Sales Solutions",
              expiresAt: msg.expires_at ? new Date(msg.expires_at) : null,
            },
          });
        }
      }

      // Global Knowledge Base entries pushed down from the Fleet Manager - see
      // server/routes/heartbeat.ts on the Fleet Manager side for how these are queued
      // (PresalesKbDelivery, one per installation) and knowledgeBaseReconciliation.ts for the
      // duplicate/contradiction check each one goes through before landing locally.
      for (const kbItem of (data.knowledge_base_entries || []) as Array<IncomingGlobalKbEntry & { delivery_id: string }>) {
        try {
          const alreadyReceived = await dbStore.findKnowledgeBaseEntryByFleetGlobalId(kbItem.entry_id);
          if (!alreadyReceived) {
            const outcome = await reconcileIncomingKnowledgeEntry(kbItem, settings, tenantId);
            if (outcome.action === "create") {
              await dbStore.createKnowledgeBaseEntry({
                category: kbItem.category as any,
                trigger: kbItem.trigger,
                knowledge: outcome.status === "pending" ? `${outcome.conflictNote}${kbItem.knowledge}` : kbItem.knowledge,
                status: outcome.status,
                source: "fleet_manager_global",
                created_by: "Fleet Manager",
                fleet_global_entry_id: kbItem.entry_id,
              });
            }
          }
        } catch (kbErr) {
          logger.warn({ err: kbErr, tenantId, entryId: kbItem.entry_id }, "Failed to apply incoming Fleet Manager knowledge base entry");
        }

        // Acknowledged regardless of outcome above (create/skip/already-received) - the delivery
        // itself was received and processed, which is all the Fleet Manager's ack tracks (same
        // "delivered vs acted-on-already-happened" semantics as the commands loop above).
        await fetch(`${settings.fleet_manager_url}/api/heartbeat/knowledge-base/${kbItem.delivery_id}/ack`, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(10000),
        }).catch(() => {});
      }

      if (kbEntriesToSync.length > 0) {
        await dbStore.markKnowledgeBaseEntriesSynced(kbEntriesToSync.map((e) => e.id));
      }
    } catch (err) {
      logger.error({ err, tenantId }, "Fleet manager heartbeat error");
    }
  });
}

export interface FleetLicenseStatus {
  connected: boolean;
  status: "active" | "suspended" | null;
  block_mode: "full_lockout" | "read_only" | null;
  modules: string[];
  plan_name: string | null;
  contract_start_date: string | null;
  contract_end_date: string | null;
  last_verified_at: string | null;
}

// What the admin console actually shows in "Assinatura e Licença" - the real cached status from
// the last successful, signature-verified heartbeat. Never throws; no cache (fleet reporting
// disabled, never checked in, or a stale/unverifiable entry) just reads as "not connected" rather
// than exposing raw cache-miss/expiry details the customer's admin has no use for.
export async function getFleetLicenseStatus(tenantId: string): Promise<FleetLicenseStatus> {
  const disconnected: FleetLicenseStatus = {
    connected: false,
    status: null,
    block_mode: null,
    modules: [],
    plan_name: null,
    contract_start_date: null,
    contract_end_date: null,
    last_verified_at: null,
  };
  try {
    const raw = await redis.get(licenseCacheKey(tenantId));
    if (!raw) return disconnected;
    const cached: CachedLicense = JSON.parse(raw);
    if (!verifyPayload(cached.payload, cached.signature)) return disconnected;
    return {
      connected: true,
      status: cached.payload.status,
      block_mode: cached.payload.block_mode,
      modules: cached.payload.modules,
      plan_name: cached.payload.plan_name,
      contract_start_date: cached.payload.contract_start_date,
      contract_end_date: cached.payload.contract_end_date,
      last_verified_at: cached.verifiedAt,
    };
  } catch {
    return disconnected;
  }
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
