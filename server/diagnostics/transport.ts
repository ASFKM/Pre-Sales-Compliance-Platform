import crypto from "crypto";

// CloudMountain Diagnostics Agent (CDA) - signs the same way the CMSaaS's
// requireDiagnosticsSignature middleware expects (fleet-manager's server/middleware/
// diagnosticsAuth.ts): HMAC-SHA256 over "${timestamp}.${rawBody}", keyed with the installation's
// own Fleet Manager API key. Deliberately NOT the same signing helper the heartbeat call in
// fleetLicense.ts uses (that one signs the body alone, no timestamp, no replay window) - the
// diagnostics ingestion API requires the stronger guarantee, see that middleware's own comment.
export function signDiagnosticsPayload(apiKey: string, timestampMs: number, rawBody: string): string {
  const signedPayload = `${timestampMs}.${rawBody}`;
  return crypto.createHmac("sha256", apiKey).update(signedPayload).digest("hex");
}

export interface DiagnosticsWireEvent {
  external_event_id: string;
  event_type: string;
  source: string;
  severity: string;
  message: string;
  exception_type?: string | null;
  stack_trace?: string | null;
  route?: string | null;
  http_method?: string | null;
  http_status?: number | null;
  operation?: string | null;
  correlation_id?: string | null;
  session_id?: string | null;
  occurred_at: string;
}

export interface BugReportWirePayload {
  title: string;
  what_happened: string;
  expected_behavior?: string;
  steps_to_reproduce?: string;
  reported_severity?: "low" | "medium" | "high" | "critical";
  route?: string;
  session_id?: string;
  correlation_id?: string;
  reporter_name?: string;
  reporter_email?: string;
  screenshot_reference?: string;
}

// Bug reports are submitted synchronously (unlike error events, which buffer/retry) - the user is
// waiting on screen for a confirmation code (briefing Seção 17), so there is no outbox for these;
// a failure here surfaces immediately to the caller (server/routes/diagnosticsAgent.ts) instead
// of being silently queued.
export async function sendBugReport(
  fleetManagerUrl: string,
  apiKey: string,
  payload: BugReportWirePayload
): Promise<{ ok: boolean; confirmationCode?: string; error?: string }> {
  const body = JSON.stringify(payload);
  const timestampMs = Date.now();
  const signature = signDiagnosticsPayload(apiKey, timestampMs, body);

  try {
    const res = await fetch(`${fleetManagerUrl}/api/diagnostics/v1/bug-reports`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "X-Signature": signature,
        "X-Diagnostics-Timestamp": String(timestampMs),
      },
      body,
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: data.message || `HTTP ${res.status}` };
    }
    return { ok: true, confirmationCode: data.confirmation_code };
  } catch (err: any) {
    return { ok: false, error: err.message || "network error" };
  }
}

// Signs the uploaded file's own hash, not a "raw body" - matches the CMSaaS's
// requireDiagnosticsFileSignature exactly (fleet-manager's server/middleware/diagnosticsAuth.ts),
// which exists precisely because multipart bodies never have one canonical raw-byte form to sign.
export function signAttachmentPayload(apiKey: string, timestampMs: number, fileBuffer: Buffer): string {
  const fileHash = crypto.createHash("sha256").update(fileBuffer).digest("hex");
  return crypto.createHmac("sha256", apiKey).update(`${timestampMs}.${fileHash}`).digest("hex");
}

export async function sendAttachment(
  fleetManagerUrl: string,
  apiKey: string,
  fileBuffer: Buffer,
  mimeType: string,
  fileName: string
): Promise<{ ok: boolean; reference?: string; error?: string }> {
  const timestampMs = Date.now();
  const signature = signAttachmentPayload(apiKey, timestampMs, fileBuffer);

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(fileBuffer)], { type: mimeType }), fileName);

  try {
    const res = await fetch(`${fleetManagerUrl}/api/diagnostics/v1/attachments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "X-Signature": signature,
        "X-Diagnostics-Timestamp": String(timestampMs),
      },
      body: form,
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: data.message || `HTTP ${res.status}` };
    }
    return { ok: true, reference: data.reference };
  } catch (err: any) {
    return { ok: false, error: err.message || "network error" };
  }
}

export async function sendDiagnosticsBatch(
  fleetManagerUrl: string,
  apiKey: string,
  events: DiagnosticsWireEvent[]
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const body = JSON.stringify({
    protocol_version: "1",
    application_code: "pre-sales-compliance-platform",
    sent_at: new Date().toISOString(),
    events,
  });
  const timestampMs = Date.now();
  const signature = signDiagnosticsPayload(apiKey, timestampMs, body);

  try {
    const res = await fetch(`${fleetManagerUrl}/api/diagnostics/v1/events/batch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "X-Signature": signature,
        "X-Diagnostics-Timestamp": String(timestampMs),
      },
      body,
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      return { ok: false, status: res.status, error: `HTTP ${res.status}` };
    }
    return { ok: true, status: res.status };
  } catch (err: any) {
    return { ok: false, error: err.message || "network error" };
  }
}
