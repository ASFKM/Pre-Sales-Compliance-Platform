import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { prisma } from "./prisma";
import { runWithTenant } from "./tenantContext";
import { resolveProvider } from "./aiOrchestrator";
import { redis } from "./redis";
import { randomId } from "./idGenerator";

// Regression test for a real production bug fixed 2026-07-14: resolveProvider() had its own
// local copy of isProviderConnected() that didn't know about the ia_kb add-on, so once a tenant
// activated it (and had its own OpenAI/Anthropic keys cleared, by design - see
// server/utils/fleetLicense.ts), every real feature call silently fell back to Gemini instead of
// actually going through the Fleet Manager's proxy - only caught by manual end-to-end testing at
// the time, not by any automated test. Integration-style against a real database and Redis
// (same convention as src/prisma.test.ts), since a mock of isIaKbActive()/dbStore would have
// hidden the exact class of bug this guards against - it duplicated correct-looking code, not
// broken code.
const TENANT_ID = "test_tenant_ai_orchestrator";

const BASE_SETTINGS = {
  default_model: "gemini-2.5-flash",
  document_analysis_model: "gemini-2.5-flash",
  document_analysis_provider: "gemini",
  web_grounding_model: "gemini-2.5-flash",
  web_grounding_provider: "gemini",
  spec_copilot_model: "gemini-2.5-flash",
  spec_copilot_provider: "gemini",
  document_classification_model: "gemini-2.5-flash",
  document_classification_provider: "gemini",
  poc_test_generation_model: "claude-opus-4",
  poc_test_generation_provider: "anthropic",
  poc_schedule_generation_model: "gemini-2.5-flash",
  poc_schedule_generation_provider: "gemini",
  poc_final_report_generation_model: "gemini-2.5-flash",
  poc_final_report_generation_provider: "gemini",
  // Deliberately unset - simulates a tenant whose own Anthropic/OpenAI keys were cleared on ia_kb
  // activation, the exact state that caused the real bug this suite guards against.
  openai_api_key_encrypted: undefined,
  anthropic_api_key_encrypted: undefined,
};

async function setIaKbActive(active: boolean) {
  const key = `fleet:license:${TENANT_ID}`;
  if (!active) {
    await redis.del(key);
    return;
  }
  // Mirrors the real cache shape server/utils/fleetLicense.ts writes on every heartbeat -
  // isIaKbActive() reads payload.modules directly (see server/utils/aiProviders.ts).
  await redis.set(key, JSON.stringify({ payload: { modules: ["base", "poc", "ia_kb"] } }));
}

describe("resolveProvider ia_kb regression (src/aiOrchestrator.ts)", () => {
  beforeAll(async () => {
    await prisma.iaKbTaskConfig.deleteMany({ where: { tenantId: TENANT_ID } });
    await prisma.tenant.deleteMany({ where: { id: TENANT_ID } });
    await prisma.tenant.create({ data: { id: TENANT_ID, name: "Test Tenant (aiOrchestrator.test.ts)" } });
  });

  afterEach(async () => {
    await setIaKbActive(false);
    await prisma.iaKbTaskConfig.deleteMany({ where: { tenantId: TENANT_ID } });
  });

  afterAll(async () => {
    await redis.del(`fleet:license:${TENANT_ID}`);
    await prisma.iaKbTaskConfig.deleteMany({ where: { tenantId: TENANT_ID } });
    await prisma.tenant.deleteMany({ where: { id: TENANT_ID } });
  });

  it("falls back to gemini when the intended provider has no key and ia_kb is inactive", async () => {
    await runWithTenant({ tenantId: TENANT_ID }, async () => {
      const resolution = await resolveProvider("poc_test_generation", BASE_SETTINGS as any);
      expect(resolution.isFallback).toBe(true);
      expect(resolution.provider).toBe("gemini");
      expect(resolution.intendedProvider).toBe("anthropic");
    });
  });

  it("does NOT fall back when ia_kb is active, even with the tenant's own key cleared", async () => {
    await setIaKbActive(true);
    await runWithTenant({ tenantId: TENANT_ID }, async () => {
      const resolution = await resolveProvider("poc_test_generation", BASE_SETTINGS as any);
      expect(resolution.isFallback).toBe(false);
      expect(resolution.provider).toBe("anthropic");
    });
  });

  it("uses the CMSaaS-configured per-task override once ia_kb is active, instead of the tenant's own settings", async () => {
    await setIaKbActive(true);
    await prisma.iaKbTaskConfig.create({
      data: { id: randomId("iakbtc"), tenantId: TENANT_ID, taskType: "poc_test_generation", provider: "openai", model: "gpt-5.1" },
    });
    await runWithTenant({ tenantId: TENANT_ID }, async () => {
      const resolution = await resolveProvider("poc_test_generation", BASE_SETTINGS as any);
      expect(resolution.isFallback).toBe(false);
      expect(resolution.provider).toBe("openai");
      expect(resolution.model).toBe("gpt-5.1");
    });
  });

  it("ignores a stale per-task override for a different tenant", async () => {
    const otherTenant = "test_tenant_ai_orchestrator_other";
    await prisma.tenant.deleteMany({ where: { id: otherTenant } });
    await prisma.tenant.create({ data: { id: otherTenant, name: "Other tenant (aiOrchestrator.test.ts)" } });
    await prisma.iaKbTaskConfig.create({
      data: { id: randomId("iakbtc"), tenantId: otherTenant, taskType: "poc_test_generation", provider: "openai", model: "gpt-5.1" },
    });

    await setIaKbActive(true);
    await runWithTenant({ tenantId: TENANT_ID }, async () => {
      const resolution = await resolveProvider("poc_test_generation", BASE_SETTINGS as any);
      // No override for TENANT_ID - falls through to its own settings, which point at anthropic.
      expect(resolution.provider).toBe("anthropic");
    });

    await prisma.iaKbTaskConfig.deleteMany({ where: { tenantId: otherTenant } });
    await prisma.tenant.deleteMany({ where: { id: otherTenant } });
  });
});
