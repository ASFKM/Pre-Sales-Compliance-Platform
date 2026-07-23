import crypto from "crypto";
import { describe, it, expect } from "vitest";
import { signDiagnosticsPayload, signAttachmentPayload } from "./transport";

// Mirrors the CMSaaS's own requireDiagnosticsSignature verification exactly (fleet-manager's
// server/middleware/diagnosticsAuth.ts) - HMAC-SHA256 over "${timestamp}.${rawBody}". A test here
// that drifts from that middleware's own expectation would mean events never actually get
// accepted, discovered only in production.
describe("signDiagnosticsPayload (server/diagnostics/transport.ts)", () => {
  it("produces the same signature the CMSaaS side independently recomputes", () => {
    const apiKey = "test-api-key";
    const timestamp = 1737500000000;
    const body = JSON.stringify({ hello: "world" });

    const signature = signDiagnosticsPayload(apiKey, timestamp, body);

    const expected = crypto.createHmac("sha256", apiKey).update(`${timestamp}.${body}`).digest("hex");
    expect(signature).toBe(expected);
  });

  it("changes if the body changes", () => {
    const apiKey = "test-api-key";
    const timestamp = 1737500000000;
    const sigA = signDiagnosticsPayload(apiKey, timestamp, JSON.stringify({ a: 1 }));
    const sigB = signDiagnosticsPayload(apiKey, timestamp, JSON.stringify({ a: 2 }));
    expect(sigA).not.toBe(sigB);
  });

  it("changes if the timestamp changes, even with the same body", () => {
    const apiKey = "test-api-key";
    const body = JSON.stringify({ a: 1 });
    const sigA = signDiagnosticsPayload(apiKey, 1000, body);
    const sigB = signDiagnosticsPayload(apiKey, 2000, body);
    expect(sigA).not.toBe(sigB);
  });
});

// Mirrors requireDiagnosticsFileSignature exactly (fleet-manager's server/middleware/
// diagnosticsAuth.ts) - HMAC over "${timestamp}.${sha256(fileBuffer)}", not the raw multipart
// body (which has no canonical raw-byte form to sign consistently on both ends).
describe("signAttachmentPayload (server/diagnostics/transport.ts)", () => {
  it("produces the same signature the CMSaaS side independently recomputes", () => {
    const apiKey = "test-api-key";
    const timestamp = 1737500000000;
    const fileBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

    const signature = signAttachmentPayload(apiKey, timestamp, fileBuffer);

    const fileHash = crypto.createHash("sha256").update(fileBuffer).digest("hex");
    const expected = crypto.createHmac("sha256", apiKey).update(`${timestamp}.${fileHash}`).digest("hex");
    expect(signature).toBe(expected);
  });

  it("changes if the file contents change", () => {
    const apiKey = "test-api-key";
    const timestamp = 1737500000000;
    const sigA = signAttachmentPayload(apiKey, timestamp, Buffer.from("file a"));
    const sigB = signAttachmentPayload(apiKey, timestamp, Buffer.from("file b"));
    expect(sigA).not.toBe(sigB);
  });
});
