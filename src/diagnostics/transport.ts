import { ApiClient } from "../lib/api";
import { redactFrontendText } from "./redact";

// CloudMountain Diagnostics Agent (CDA), frontend transport. Sends to THIS app's own backend
// (server/routes/diagnosticsAgent.ts), never directly to the CMSaaS - the browser must never hold
// this installation's Fleet Manager API key. The backend buffers/forwards from there.
export interface FrontendCapturePayload {
  message: string;
  stackTrace?: string;
  route?: string;
  sessionId?: string;
  correlationId?: string;
  severity?: "low" | "medium" | "high" | "critical";
}

let sessionId: string | null = null;
export function getOrCreateDiagnosticsSessionId(): string {
  if (!sessionId) {
    sessionId = `sess-${Math.random().toString(36).substring(2, 11)}-${Date.now().toString(36)}`;
  }
  return sessionId;
}

// Fail-safe by construction: a broken network/backend must never throw back into whatever
// caught the original error (window.onerror, unhandledrejection, the Error Boundary) - that would
// risk a second, unrelated failure right where the app is already in trouble.
export async function sendFrontendCapture(payload: FrontendCapturePayload): Promise<void> {
  try {
    await ApiClient.post("/api/diagnostics-agent/frontend-events", {
      message: redactFrontendText(payload.message)?.slice(0, 5000) ?? "(no message)",
      stack_trace: redactFrontendText(payload.stackTrace)?.slice(0, 20000),
      route: payload.route ?? window.location.pathname,
      session_id: payload.sessionId ?? getOrCreateDiagnosticsSessionId(),
      correlation_id: payload.correlationId,
      severity: payload.severity ?? "medium",
    });
  } catch {
    // Swallow. There is nowhere safe left to report this failure to.
  }
}
