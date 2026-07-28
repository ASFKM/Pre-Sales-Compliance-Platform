import { prisma } from "../../src/prisma";
import { dbStore } from "../../src/dbStore";
import { runWithTenant } from "../../src/tenantContext";
import { randomId } from "../../src/idGenerator";
import { decryptSecret } from "../utils/security";
import { logger } from "../utils/logger";
import { redactDiagnosticsEvent, redactText } from "./redact";
import { sendDiagnosticsBatch, sendBugReport, sendAttachment, DiagnosticsWireEvent, BugReportWirePayload } from "./transport";

// CloudMountain Diagnostics Agent (CDA) - the module embedded in this Pre-Sales Compliance
// Platform process that captures, buffers and forwards diagnostics events to the CMSaaS
// Diagnostics Center. A failure ANYWHERE in this module must never propagate to the caller (the
// whole point of "falha no Agent nunca pode impedir a operação principal" - briefing Seção 8) -
// every exported function below swallows its own errors after logging them.
//
// Multi-tenant note: this Pre-Sales process can serve several tenants at once, each with its own
// independent Fleet Manager identity (PlatformSettings.fleetManagerApiKeyEncrypted per tenant) -
// unlike a single-tenant deployment, there is no one global "this installation's API key". Every
// capture/flush call is explicitly tenant-scoped (never relies on ambient ALS context alone,
// since errorHandler and background code often run outside any runWithTenant() call chain).

const BATCH_SIZE = 50;

export interface CaptureBackendErrorParams {
  tenantId: string | undefined;
  message: string;
  exceptionType?: string;
  stackTrace?: string;
  route?: string;
  httpMethod?: string;
  httpStatus?: number;
  operation?: string;
  correlationId?: string;
  severity?: "low" | "medium" | "high" | "critical";
}

export async function captureBackendError(params: CaptureBackendErrorParams): Promise<void> {
  if (!params.tenantId) {
    // No known tenant (e.g. a failed login for a nonexistent email) - same case DebugLog already
    // accepts as unattributable. Nothing to buffer against, and nothing to fail loudly about.
    return;
  }
  const tenantId = params.tenantId;

  try {
    await runWithTenant({ tenantId }, async () => {
      const redacted = redactDiagnosticsEvent({
        message: params.message,
        exceptionType: params.exceptionType ?? null,
        stackTrace: params.stackTrace ?? null,
        metadata: null,
      });
      await prisma.diagnosticsOutboxEvent.create({
        data: {
          id: randomId("diagoutbox"),
          tenantId,
          externalEventId: randomId("evt"),
          eventType: "exception",
          source: "backend",
          severity: params.severity ?? "high",
          message: redacted.message,
          exceptionType: redacted.exceptionType,
          stackTrace: redacted.stackTrace,
          route: params.route,
          httpMethod: params.httpMethod,
          httpStatus: params.httpStatus,
          operation: params.operation,
          correlationId: params.correlationId,
          occurredAt: new Date(),
        },
      });
    });
  } catch (err) {
    logger.error({ err, tenantId }, "cda: failed to buffer diagnostics event - dropping, never blocking the caller");
    return;
  }

  // Best-effort immediate flush - fire-and-forget. If the CMSaaS is unreachable right now, the
  // row just stays in the outbox (sentAt null) until the next periodic flush picks it up - see
  // server.ts's flushDiagnosticsOutboxForAllEnabledTenants interval.
  flushDiagnosticsOutboxForTenant(tenantId).catch((err) => logger.error({ err, tenantId }, "cda: immediate flush attempt failed"));
}

export function toWireEvent(row: {
  externalEventId: string;
  eventType: string;
  source: string;
  severity: string;
  message: string;
  exceptionType: string | null;
  stackTrace: string | null;
  route: string | null;
  httpMethod: string | null;
  httpStatus: number | null;
  operation: string | null;
  correlationId: string | null;
  sessionId: string | null;
  occurredAt: Date;
}): DiagnosticsWireEvent {
  return {
    external_event_id: row.externalEventId,
    event_type: row.eventType,
    source: row.source,
    severity: row.severity,
    message: row.message,
    // CMSaaS's EventSchema (server/routes/diagnosticsIngestion.ts) types these as
    // z.string().optional() - undefined (an absent key) is fine, but an explicit `null` fails
    // validation with HTTP 400. Prisma represents an unset nullable column as `null`, not
    // `undefined`, so every one of these needs the `?? undefined` normalization or any event
    // missing one of them gets rejected outright - found by actually running the pipeline
    // end-to-end (2026-07-27), not by reading either schema in isolation.
    exception_type: row.exceptionType ?? undefined,
    stack_trace: row.stackTrace ?? undefined,
    route: row.route ?? undefined,
    http_method: row.httpMethod ?? undefined,
    http_status: row.httpStatus ?? undefined,
    operation: row.operation ?? undefined,
    correlation_id: row.correlationId ?? undefined,
    session_id: row.sessionId ?? undefined,
    occurred_at: row.occurredAt.toISOString(),
  };
}

interface FleetManagerCredentials {
  url: string;
  apiKey: string;
}

// Shared by the outbox flush and the synchronous bug-report/attachment submissions below - one
// place that decides "is this tenant even configured to talk to a Fleet Manager right now".
async function getFleetManagerCredentials(): Promise<FleetManagerCredentials | null> {
  const settings = await dbStore.getSettings();
  if (!settings.fleet_manager_enabled || !settings.fleet_manager_url || !settings.fleet_manager_api_key_encrypted) {
    return null;
  }
  return { url: settings.fleet_manager_url, apiKey: decryptSecret(settings.fleet_manager_api_key_encrypted) };
}

export async function flushDiagnosticsOutboxForTenant(tenantId: string): Promise<void> {
  await runWithTenant({ tenantId }, async () => {
    const credentials = await getFleetManagerCredentials();
    if (!credentials) return;

    const pending = await prisma.diagnosticsOutboxEvent.findMany({
      where: { tenantId, sentAt: null },
      orderBy: { createdAt: "asc" },
      take: BATCH_SIZE,
    });
    if (pending.length === 0) return;

    const result = await sendDiagnosticsBatch(credentials.url, credentials.apiKey, pending.map(toWireEvent));

    if (result.ok) {
      await prisma.diagnosticsOutboxEvent.updateMany({
        where: { id: { in: pending.map((p) => p.id) } },
        data: { sentAt: new Date() },
      });
      return;
    }

    logger.warn({ tenantId, error: result.error, status: result.status, pending: pending.length }, "cda: flush failed, will retry on next cycle");
    await prisma.diagnosticsOutboxEvent.updateMany({
      where: { id: { in: pending.map((p) => p.id) } },
      data: { attempts: { increment: 1 }, lastError: result.error ?? `HTTP ${result.status}` },
    });
  });
}

export async function flushDiagnosticsOutboxForAllEnabledTenants(): Promise<void> {
  const tenants = await dbStore.getAllTenantIdsWithFleetReportingEnabled();
  for (const tenantId of tenants) {
    await flushDiagnosticsOutboxForTenant(tenantId).catch((err) => logger.error({ err, tenantId }, "cda: flush cycle failed for tenant"));
  }
}

// Frontend events arrive already authenticated as a normal browser session (see
// server/routes/diagnosticsAgent.ts) - the tenant is known from that session, never from the
// browser's own say-so, same trust boundary as every other tenant-scoped route in this app.
export interface CaptureFrontendErrorParams {
  tenantId: string;
  message: string;
  stackTrace?: string;
  route?: string;
  sessionId?: string;
  correlationId?: string;
  severity?: "low" | "medium" | "high" | "critical";
}

export async function captureFrontendError(params: CaptureFrontendErrorParams): Promise<void> {
  try {
    await runWithTenant({ tenantId: params.tenantId }, async () => {
      const redacted = redactDiagnosticsEvent({ message: params.message, stackTrace: params.stackTrace ?? null, metadata: null });
      await prisma.diagnosticsOutboxEvent.create({
        data: {
          id: randomId("diagoutbox"),
          tenantId: params.tenantId,
          externalEventId: randomId("evt"),
          eventType: "exception",
          source: "frontend",
          severity: params.severity ?? "medium",
          message: redacted.message,
          stackTrace: redacted.stackTrace,
          route: params.route,
          sessionId: params.sessionId,
          correlationId: params.correlationId,
          occurredAt: new Date(),
        },
      });
    });
  } catch (err) {
    logger.error({ err, tenantId: params.tenantId }, "cda: failed to buffer frontend diagnostics event");
    return;
  }
  flushDiagnosticsOutboxForTenant(params.tenantId).catch((err) => logger.error({ err }, "cda: immediate flush attempt failed"));
}

// "Reportar problema" (briefing Seção 17) - submitted synchronously, unlike error events: the
// user is waiting on screen for a confirmation code, so there is no outbox/retry here. If the
// CMSaaS is unreachable, the caller (server/routes/diagnosticsAgent.ts) surfaces that directly
// rather than silently queuing - a bug report silently "lost" until some later flush would be a
// worse experience than an honest "não foi possível enviar agora" for this one, synchronous case.
export interface SubmitBugReportParams {
  tenantId: string;
  title: string;
  whatHappened: string;
  expectedBehavior?: string;
  stepsToReproduce?: string;
  reportedSeverity?: "low" | "medium" | "high" | "critical";
  route?: string;
  sessionId?: string;
  correlationId?: string;
  reporterName?: string;
  reporterEmail?: string;
  screenshotReference?: string;
}

export async function submitBugReport(params: SubmitBugReportParams): Promise<{ ok: boolean; confirmationCode?: string; error?: string }> {
  return runWithTenant({ tenantId: params.tenantId }, async () => {
    const credentials = await getFleetManagerCredentials();
    if (!credentials) {
      return { ok: false, error: "Diagnostics não está configurado para este tenant." };
    }

    const payload: BugReportWirePayload = {
      title: (redactText(params.title) as string).slice(0, 200),
      what_happened: redactText(params.whatHappened) as string,
      expected_behavior: redactText(params.expectedBehavior) ?? undefined,
      steps_to_reproduce: redactText(params.stepsToReproduce) ?? undefined,
      reported_severity: params.reportedSeverity,
      route: params.route,
      session_id: params.sessionId,
      correlation_id: params.correlationId,
      reporter_name: params.reporterName,
      reporter_email: params.reporterEmail,
      screenshot_reference: params.screenshotReference,
    };

    const result = await sendBugReport(credentials.url, credentials.apiKey, payload);
    if (!result.ok) {
      logger.error({ tenantId: params.tenantId, error: result.error }, "cda: bug report submission failed");
    }
    return { ok: result.ok, confirmationCode: result.confirmationCode, error: result.error };
  });
}

export async function uploadBugReportAttachment(
  tenantId: string,
  fileBuffer: Buffer,
  mimeType: string,
  fileName: string
): Promise<{ ok: boolean; reference?: string; error?: string }> {
  return runWithTenant({ tenantId }, async () => {
    const credentials = await getFleetManagerCredentials();
    if (!credentials) {
      return { ok: false, error: "Diagnostics não está configurado para este tenant." };
    }
    const result = await sendAttachment(credentials.url, credentials.apiKey, fileBuffer, mimeType, fileName);
    if (!result.ok) {
      logger.error({ tenantId, error: result.error }, "cda: attachment upload failed");
    }
    return result;
  });
}
