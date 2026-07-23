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
