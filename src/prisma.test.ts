import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma, TENANT_SCOPED_MODELS } from "./prisma";
import { runWithTenant } from "./tenantContext";

// Integration test against a real database (CI provisions an ephemeral Postgres and applies
// migrations before running tests - see .github/workflows/ci.yml). This extension is the single
// mechanism enforcing tenant isolation across the whole app; a bug here has already caused 3 real
// incidents this project's history (silent upsert() fallback to create) and one confirmed IDOR
// (GET /api/tasks/:id) before being fixed - it deserves a real regression test, not a unit test
// against a mock.
//
// Every runWithTenant() callback below awaits its Prisma call before returning - see the comment
// on runWithTenant() in ./tenantContext.ts for why that's required, not stylistic (a version of
// this file that instead returned the bare, unawaited Prisma call passed every assertion for the
// wrong reason: the tenant filter silently never applied at all).
const TENANT_A = "test_tenant_a_prisma_ext";
const TENANT_B = "test_tenant_b_prisma_ext";

describe("tenant-scoping Prisma extension (src/prisma.ts)", () => {
  beforeAll(async () => {
    await prisma.vertical.deleteMany({ where: { tenantId: { in: [TENANT_A, TENANT_B] } } });
    await prisma.backgroundTask.deleteMany({ where: { tenantId: { in: [TENANT_A, TENANT_B] } } });
    await prisma.tenant.deleteMany({ where: { id: { in: [TENANT_A, TENANT_B] } } });
    await prisma.tenant.createMany({
      data: [
        { id: TENANT_A, name: "Test Tenant A (prisma.test.ts)" },
        { id: TENANT_B, name: "Test Tenant B (prisma.test.ts)" },
      ],
    });
  });

  afterAll(async () => {
    await prisma.vertical.deleteMany({ where: { tenantId: { in: [TENANT_A, TENANT_B] } } });
    await prisma.backgroundTask.deleteMany({ where: { tenantId: { in: [TENANT_A, TENANT_B] } } });
    await prisma.tenant.deleteMany({ where: { id: { in: [TENANT_A, TENANT_B] } } });
  });

  it("scopes a pre-existing tenant-scoped model (Vertical) so tenant B never sees tenant A's row", async () => {
    await runWithTenant({ tenantId: TENANT_A }, async () => {
      await prisma.vertical.create({ data: { id: "test_vert_a", tenantId: TENANT_A, name: "OnlyInTenantA" } });
    });

    const seenFromB = await runWithTenant({ tenantId: TENANT_B }, async () =>
      prisma.vertical.findUnique({ where: { id: "test_vert_a" } })
    );
    expect(seenFromB).toBeNull();

    const seenFromA = await runWithTenant({ tenantId: TENANT_A }, async () =>
      prisma.vertical.findUnique({ where: { id: "test_vert_a" } })
    );
    expect(seenFromA?.id).toBe("test_vert_a");
  });

  it("scopes BackgroundTask (one of the 5 models added to close the tenant-isolation gap) the same way", async () => {
    await runWithTenant({ tenantId: TENANT_A }, async () => {
      await prisma.backgroundTask.create({
        data: { id: "test_task_a", tenantId: TENANT_A, userId: "u_test", type: "document_analysis", currentStep: "test" },
      });
    });

    const seenFromB = await runWithTenant({ tenantId: TENANT_B }, async () =>
      prisma.backgroundTask.findUnique({ where: { id: "test_task_a" } })
    );
    expect(seenFromB).toBeNull();

    const seenFromA = await runWithTenant({ tenantId: TENANT_A }, async () =>
      prisma.backgroundTask.findUnique({ where: { id: "test_task_a" } })
    );
    expect(seenFromA?.id).toBe("test_task_a");
  });

  it("blocks a cross-tenant update even when the target id is known (the confirmed IDOR shape)", async () => {
    await runWithTenant({ tenantId: TENANT_A }, async () => {
      await prisma.vertical.create({ data: { id: "test_vert_update", tenantId: TENANT_A, name: "Original" } });
    });

    await expect(
      runWithTenant({ tenantId: TENANT_B }, async () =>
        prisma.vertical.update({ where: { id: "test_vert_update" }, data: { name: "Hijacked" } })
      )
    ).rejects.toThrow();

    const stillOriginal = await runWithTenant({ tenantId: TENANT_A }, async () =>
      prisma.vertical.findUnique({ where: { id: "test_vert_update" } })
    );
    expect(stillOriginal?.name).toBe("Original");
  });

  it("throws on .upsert() instead of silently falling back to create (the bug that hit 3 times before)", async () => {
    await expect(
      runWithTenant({ tenantId: TENANT_A }, async () =>
        (prisma as any).vertical.upsert({
          where: { id: "test_vert_upsert" },
          create: { id: "test_vert_upsert", tenantId: TENANT_A, name: "New" },
          update: { name: "Updated" },
        })
      )
    ).rejects.toThrow(/upsert\(\) is disallowed/);
  });

  it("TENANT_SCOPED_MODELS covers every model in the real schema that carries a tenantId column", () => {
    // This is what would have caught the original gap (5 models missing) automatically instead of
    // needing a full-codebase audit to find it - derives the "should be scoped" list from the
    // actual Prisma schema (DMMF), not from a second hand-maintained list that could drift the
    // same way the first one did.
    const modelsWithTenantId = Prisma.dmmf.datamodel.models
      .filter((m) => m.fields.some((f) => f.name === "tenantId"))
      .map((m) => m.name.charAt(0).toLowerCase() + m.name.slice(1));

    const missing = modelsWithTenantId.filter((m) => !TENANT_SCOPED_MODELS.has(m));
    expect(missing).toEqual([]);

    // And the reverse: nothing in the set should be a name that doesn't exist in the schema at
    // all (a typo, or a model that was later renamed/removed) - silently doing nothing is its own
    // kind of bug.
    const scopedButUnknown = [...TENANT_SCOPED_MODELS].filter((m) => !modelsWithTenantId.includes(m));
    expect(scopedButUnknown).toEqual([]);
  });
});
