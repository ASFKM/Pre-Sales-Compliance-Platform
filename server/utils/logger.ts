import pino from "pino";

// IMPORTANT: Pino's `redact` (via fast-redact) matches exact property-name paths, not substrings -
// unlike sanitizeAndMaskObject (server/utils/security.ts), which recursively matches any key name
// *containing* e.g. "secret". A first version of this file tried to reuse that substring list
// here directly (["secret", "*.secret", ...]) and it silently redacted nothing for any real field
// name, since "clientSecret" is never an exact match for the path "secret" - caught by
// logger.test.ts, which logs real sample fields and asserts on the actual output rather than
// trusting the config to be correct.
//
// So this list enumerates real, known field names (both camelCase and snake_case, since both
// appear across this codebase) up to 2 levels of nesting - the fast, structural layer. It only
// ever covers what's listed here; anything with an unpredictable/arbitrary shape (error metadata,
// business objects) must be run through sanitizeAndMaskObject before being handed to the logger -
// that function's substring matching is what actually generalizes to field names not enumerated
// below. logDebugMessage (server/middleware/security.ts) already does this for its metadata.
const KNOWN_SENSITIVE_FIELDS = [
  "password", "token", "apiKey", "api_key", "privateKey", "private_key",
  "authorization", "cookie", "session", "mfaTotpSecret", "mfa_totp_secret",
  "refreshToken", "refresh_token", "clientSecret", "client_secret",
  "webhookSecret", "webhook_secret", "cpf", "cnpj", "ssn",
];

// Exported so logger.test.ts builds its throwaway logger against the exact same paths production
// uses, instead of a hand-copied duplicate that could silently drift out of sync.
export const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  ...KNOWN_SENSITIVE_FIELDS.flatMap((key) => [key, `*.${key}`, `*.*.${key}`]),
];

const isProduction = (process.env.NODE_ENV || "development") === "production";

// Single Pino instance for the whole process. LOG_LEVEL env var overrides the environment
// default - lets an install turn on `debug` temporarily in production without a redeploy.
export const logger = pino({
  level: process.env.LOG_LEVEL || (isProduction ? "info" : "debug"),
  redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  // Plain JSON to stdout in production (works with whatever log collector/journal is already
  // watching the process); pretty-printed only in dev, where a human is actually reading it live.
  transport: isProduction
    ? undefined
    : { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:standard", ignore: "pid,hostname" } },
});

export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";
