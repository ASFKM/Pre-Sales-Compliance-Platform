import { sanitizeAndMaskObject, SENSITIVE_KEY_SUBSTRINGS } from "../utils/security";

// CloudMountain Diagnostics Agent (CDA) - first layer of redaction, applied inside this
// installation BEFORE anything is buffered or sent to the CMSaaS (briefing Seção 25: "a
// sanitização no servidor do CMSaaS será uma segunda camada, não a única"). sanitizeAndMaskObject
// (server/utils/security.ts) already does this for structured/keyed metadata (password, token,
// cookie, etc. by field NAME) - reused as-is, not duplicated. What it does not cover is a secret
// embedded inside free text (an exception message or stack trace that happens to interpolate a
// header value, a connection string, or a JWT) - that's what the two regexes below add.
const BEARER_TOKEN_RE = /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi;
const JWT_RE = /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const CONNECTION_STRING_RE = /\b(postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s'"]+/gi;
// Matches "password=...", "api_key: ...", etc. inside free text - reuses the same substring list
// sanitizeAndMaskObject keys off of, so both layers stay in sync with exactly one list to update.
const KEY_VALUE_RE = new RegExp(`\\b(${SENSITIVE_KEY_SUBSTRINGS.join("|")})\\s*[:=]\\s*\\S+`, "gi");

export function redactText(text: string | null | undefined): string | null | undefined {
  if (!text) return text;
  return text
    .replace(BEARER_TOKEN_RE, "Bearer [REDACTED]")
    .replace(JWT_RE, "[REDACTED_JWT]")
    .replace(CONNECTION_STRING_RE, (match) => `${match.split("://")[0]}://[REDACTED]`)
    .replace(KEY_VALUE_RE, (_match, key) => `${key}=[REDACTED]`);
}

export interface RedactableEventFields {
  message: string;
  exceptionType?: string | null;
  stackTrace?: string | null;
  metadata?: Record<string, unknown> | null;
}

export function redactDiagnosticsEvent<T extends RedactableEventFields>(event: T): T {
  return {
    ...event,
    message: redactText(event.message) as string,
    stackTrace: redactText(event.stackTrace ?? null),
    metadata: event.metadata ? sanitizeAndMaskObject(event.metadata) : event.metadata,
  };
}
