import { describe, it, expect } from "vitest";
import { redactText, redactDiagnosticsEvent } from "./redact";

// CloudMountain Diagnostics Agent (CDA) - briefing Seção 48.6's literal required test: an event
// containing password/token/cookie/JWT/Authorization must never leave this installation with
// those values intact.
describe("redactText (server/diagnostics/redact.ts)", () => {
  it("redacts a Bearer token", () => {
    const result = redactText("Request failed with header Authorization: Bearer abc123.def456-ghi_789=");
    expect(result).not.toContain("abc123.def456-ghi_789=");
    expect(result).toContain("[REDACTED]");
  });

  it("redacts a JWT-shaped string embedded in free text", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"; // nosemgrep: generic.secrets.security.detected-jwt-token.detected-jwt-token -- fake JWT fixture testing the redaction function itself, not a real token
    const result = redactText(`Login failed, token was ${jwt}`);
    expect(result).not.toContain(jwt);
    expect(result).toContain("[REDACTED_JWT]");
  });

  it("redacts key=value pairs for password/token/cookie/secret", () => {
    const result = redactText("Connection failed: password=hunter2 token=xyz cookie=session_abc secret=topsecret");
    expect(result).not.toContain("hunter2");
    expect(result).not.toContain("xyz");
    expect(result).not.toContain("session_abc");
    expect(result).not.toContain("topsecret");
  });

  it("redacts a Postgres connection string", () => {
    const result = redactText("Failed to connect: postgresql://app_user:sup3rsecret@db.internal:5432/prod");
    expect(result).not.toContain("sup3rsecret");
    expect(result).not.toContain("app_user");
  });

  it("leaves ordinary error text untouched", () => {
    const result = redactText("Cannot read properties of undefined (reading 'map')");
    expect(result).toBe("Cannot read properties of undefined (reading 'map')");
  });

  it("redacts across the full event (message + stackTrace + metadata)", () => {
    const event = redactDiagnosticsEvent({
      message: "Authorization: Bearer abc123 failed",
      stackTrace: "at fetch (token=xyz123)",
      metadata: { password: "hunter2", note: "safe value" },
    });
    expect(event.message).not.toContain("abc123");
    expect(event.stackTrace).not.toContain("xyz123");
    expect((event.metadata as any).password).not.toBe("hunter2");
    expect((event.metadata as any).note).toBe("safe value");
  });
});
