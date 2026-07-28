import { describe, it, expect } from "vitest";
import { toWireEvent } from "./agent";

// Regression test for a real bug found 2026-07-27 while validating the diagnostics agent
// end-to-end against a live CMSaaS: toWireEvent used to pass Prisma's `null` straight through for
// every optional field. CMSaaS's EventSchema (server/routes/diagnosticsIngestion.ts in
// fleet-manager) types those as z.string().optional() - undefined is fine, an explicit `null`
// fails validation with HTTP 400. Every single frontend-captured error hits this (exceptionType
// is never set for that source), so this wasn't an edge case - it broke the whole feature.
describe("toWireEvent (server/diagnostics/agent.ts)", () => {
  const baseRow = {
    externalEventId: "evt_1",
    eventType: "exception",
    source: "frontend",
    severity: "medium",
    message: "boom",
    exceptionType: null,
    stackTrace: null,
    route: null,
    httpMethod: null,
    httpStatus: null,
    operation: null,
    correlationId: null,
    sessionId: null,
    occurredAt: new Date("2026-07-27T12:00:00.000Z"),
  };

  it("converts every nullable Prisma field to undefined, never null, on the wire", () => {
    const wire = toWireEvent(baseRow);
    expect(wire.exception_type).toBeUndefined();
    expect(wire.stack_trace).toBeUndefined();
    expect(wire.route).toBeUndefined();
    expect(wire.http_method).toBeUndefined();
    expect(wire.http_status).toBeUndefined();
    expect(wire.operation).toBeUndefined();
    expect(wire.correlation_id).toBeUndefined();
    expect(wire.session_id).toBeUndefined();
    // JSON.stringify drops undefined keys entirely but keeps null ones - the actual bug only
    // shows up after serialization, so assert on that directly rather than just the object shape.
    const serialized = JSON.parse(JSON.stringify(wire));
    expect(serialized).not.toHaveProperty("exception_type");
    expect(serialized).not.toHaveProperty("stack_trace");
  });

  it("passes real values through unchanged", () => {
    const wire = toWireEvent({
      ...baseRow,
      exceptionType: "TypeError",
      stackTrace: "at foo (bar.ts:1:1)",
      route: "/bugs",
      httpStatus: 500,
    });
    expect(wire.exception_type).toBe("TypeError");
    expect(wire.stack_trace).toBe("at foo (bar.ts:1:1)");
    expect(wire.route).toBe("/bugs");
    expect(wire.http_status).toBe(500);
  });
});
