import { describe, it, expect } from "vitest";
import { Writable } from "stream";
import pino from "pino";
import { REDACT_PATHS } from "./logger";
import { SENSITIVE_KEY_SUBSTRINGS, sanitizeAndMaskObject } from "./security";

// Builds a throwaway logger against the exact same REDACT_PATHS production uses, writing to an
// in-memory stream instead of stdout so the test can assert on what actually got emitted.
function buildTestLogger() {
  const lines: any[] = [];
  const stream = new Writable({
    write(chunk, _enc, callback) {
      lines.push(JSON.parse(chunk.toString()));
      callback();
    },
  });

  const logger = pino({ redact: { paths: REDACT_PATHS, censor: "[REDACTED]" } }, stream);
  return { logger, lines };
}

describe("logger redaction (Pino's fixed-path layer)", () => {
  it("masks a top-level known field name", () => {
    const { logger, lines } = buildTestLogger();
    logger.info({ password: "hunter2", token: "abc123" }, "test event");

    expect(lines[0].password).toBe("[REDACTED]");
    expect(lines[0].token).toBe("[REDACTED]");
  });

  it("masks a known field name one level deep via the *.field wildcard", () => {
    const { logger, lines } = buildTestLogger();
    logger.info({ nested: { apiKey: "sk-real-key" } }, "test event");

    expect(lines[0].nested.apiKey).toBe("[REDACTED]");
  });

  it("masks mfaTotpSecret since it is explicitly enumerated in KNOWN_SENSITIVE_FIELDS", () => {
    const { logger, lines } = buildTestLogger();
    logger.info({ mfaTotpSecret: "JBSWY3DPEHPK3PXP" }, "test event");

    expect(lines[0].mfaTotpSecret).toBe("[REDACTED]");
  });

  it("masks the authorization/cookie headers on a request-shaped object", () => {
    const { logger, lines } = buildTestLogger();
    logger.info({ req: { headers: { authorization: "Bearer eyJ...", cookie: "sid=abc" } } }, "test event");

    expect(lines[0].req.headers.authorization).toBe("[REDACTED]");
    expect(lines[0].req.headers.cookie).toBe("[REDACTED]");
  });

  it("does NOT catch a field name that isn't in KNOWN_SENSITIVE_FIELDS - this is the known gap Pino's exact-path redact cannot close on its own", () => {
    const { logger, lines } = buildTestLogger();
    // "customerSecretCode" contains "secret" as a substring but isn't itself an enumerated exact
    // path, and isn't a real field used anywhere in this codebase - included purely to prove the
    // boundary of this layer, not as a real-world field name.
    logger.info({ customerSecretCode: "should-not-be-redacted-by-pino" }, "test event");

    expect(lines[0].customerSecretCode).toBe("should-not-be-redacted-by-pino");
  });

  it("does not mask unrelated fields", () => {
    const { logger, lines } = buildTestLogger();
    logger.info({ operation: "proposal.generate", correlationId: "corr-1", userId: "u1" }, "test event");

    expect(lines[0].operation).toBe("proposal.generate");
    expect(lines[0].correlationId).toBe("corr-1");
    expect(lines[0].userId).toBe("u1");
  });
});

// The layer Pino's redact structurally cannot cover: arbitrary/nested business objects and field
// names not enumerated ahead of time. Any call site logging such data (logDebugMessage's
// safeMetadata, in particular) must run it through sanitizeAndMaskObject first - this is what
// actually generalizes via substring matching against SENSITIVE_KEY_SUBSTRINGS.
describe("sanitizeAndMaskObject (recursive substring layer)", () => {
  it("masks a field name not enumerated in Pino's KNOWN_SENSITIVE_FIELDS, at arbitrary nesting depth", () => {
    const result: any = sanitizeAndMaskObject({
      customer: { billing: { customerSecretCode: "real-secret-value" } },
    });

    expect(result.customer.billing.customerSecretCode).not.toBe("real-secret-value");
  });

  it("catches camelCase apiKey/privateKey (previously a dead pattern due to case sensitivity)", () => {
    const matches = (key: string) => SENSITIVE_KEY_SUBSTRINGS.some((sk) => key.toLowerCase().includes(sk));
    expect(matches("apiKey")).toBe(true);
    expect(matches("privateKey")).toBe(true);
    expect(matches("api_key")).toBe(true);
  });

  it("catches cpf/cnpj/ssn and mfaTotpSecret via the 'totp' substring entry", () => {
    const matches = (key: string) => SENSITIVE_KEY_SUBSTRINGS.some((sk) => key.toLowerCase().includes(sk));
    expect(matches("customer_cpf")).toBe(true);
    expect(matches("cnpj")).toBe(true);
    expect(matches("ssn")).toBe(true);
    expect(matches("mfaTotpSecret")).toBe(true);
  });
});
