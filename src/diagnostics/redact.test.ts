import { describe, it, expect } from "vitest";
import { redactFrontendText } from "./redact";

describe("redactFrontendText (src/diagnostics/redact.ts)", () => {
  it("redacts a Bearer token before it ever leaves the browser", () => {
    const result = redactFrontendText("fetch failed, Authorization: Bearer abc123.def456");
    expect(result).not.toContain("abc123.def456");
  });

  it("redacts a JWT-shaped string", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"; // nosemgrep: generic.secrets.security.detected-jwt-token.detected-jwt-token -- fake JWT fixture testing the redaction function itself, not a real token
    expect(redactFrontendText(`token=${jwt}`)).not.toContain(jwt);
  });

  it("redacts password/token/cookie key=value pairs", () => {
    const result = redactFrontendText("password=hunter2 cookie=abc123");
    expect(result).not.toContain("hunter2");
    expect(result).not.toContain("abc123");
  });

  it("returns undefined for undefined input", () => {
    expect(redactFrontendText(undefined)).toBeUndefined();
  });
});
