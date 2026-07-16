import { describe, it, expect } from "vitest";
import { requireAuth, requirePermission, requireModule } from "./auth";

// Regression guard for a real production authentication bypass (2026-07-15): requireAuth's
// optional 4th parameter (`options?: RequireAuthOptions`) gave it Function.length === 4, which is
// Express's own signal for error-handling middleware ((err, req, res, next)) rather than regular
// middleware. Every route that registered requireAuth directly - `router.get("/", requireAuth,
// handler)` - had Express silently skip it for every normal request, running the real handler
// completely unauthenticated. This test fails loudly if that shape ever comes back, on requireAuth
// or on any future middleware meant to be used the same way.
describe("requireAuth arity (Express error-middleware detection guard)", () => {
  it("requireAuth is NOT arity 4 - Express would treat it as error-handling middleware and skip it for normal requests", () => {
    expect(requireAuth.length).not.toBe(4);
  });

  it("requireAuth has the arity Express expects for regular middleware (<=3)", () => {
    expect(requireAuth.length).toBeLessThanOrEqual(3);
  });

  it("requirePermission()'s returned middleware is arity 3 (safe to register directly on a route)", () => {
    const middleware = requirePermission("project:read");
    expect(middleware.length).toBe(3);
  });

  it("requireModule()'s returned middleware is arity 3 (safe to register directly on a route)", () => {
    const middleware = requireModule("poc");
    expect(middleware.length).toBe(3);
  });
});
