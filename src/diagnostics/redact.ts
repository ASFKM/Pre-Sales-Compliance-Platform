// CloudMountain Diagnostics Agent (CDA), frontend - first redaction pass, before anything ever
// leaves the browser (briefing Seção 25/28: never send Authorization/cookies/tokens/secrets by
// default). Deliberately a small standalone copy of the same patterns the backend agent uses
// (server/diagnostics/redact.ts) rather than a shared import - frontend and backend are separate
// build targets in this repo (no isomorphic shared package today), and this redaction is cheap and
// stable enough that duplicating it is simpler than introducing one for just this.
const BEARER_TOKEN_RE = /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi;
const JWT_RE = /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const SENSITIVE_KEY_VALUE_RE = /\b(password|token|apikey|api_key|secret|privatekey|private_key|authorization|cookie|session)\s*[:=]\s*\S+/gi;

export function redactFrontendText(text: string | undefined): string | undefined {
  if (!text) return text;
  return text
    .replace(BEARER_TOKEN_RE, "Bearer [REDACTED]")
    .replace(JWT_RE, "[REDACTED_JWT]")
    .replace(SENSITIVE_KEY_VALUE_RE, (_match, key) => `${key}=[REDACTED]`);
}
