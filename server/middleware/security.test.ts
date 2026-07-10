import { describe, it, expect } from "vitest";
import { requireUserId } from "./security";

function mockReq(headers: Record<string, string | undefined>) {
  return { headers, method: "GET", path: "/api/test-route" } as any;
}

describe("requireUserId", () => {
  it("returns the x-user-id header when present", () => {
    expect(requireUserId(mockReq({ "x-user-id": "u_real123" }))).toBe("u_real123");
  });

  it("throws instead of silently falling back to a default user id when the header is missing", () => {
    // Every call site behind requireAuth/requirePermission gets this header set for real; a
    // missing header here previously fell back to the literal "u1" (a real administrator account)
    // instead of surfacing the bug - this is the case that must now throw and reach errorHandler.
    expect(() => requireUserId(mockReq({}))).toThrow(/Missing x-user-id context/);
  });
});
