import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { prisma } from "./prisma";
import { runWithTenant } from "./tenantContext";
import { resolveProvider } from "./aiOrchestrator";
import { randomId } from "./idGenerator";

// F11 (docs/cdc/16-integracao-cmcrm-presales.md, itens 06/10): a IA gerenciada pelo Fleet
// Manager deixou de ser um add-on por tenant (module_entitlements não tem mais "ia_kb") e virou
// base do produto - resolveProvider() sempre roteia gemini/openai/anthropic por lá agora
// (server/utils/aiProviders.ts, isIaKbActive incondicional). Este arquivo era um teste de
// regressão para o bug real corrigido em 2026-07-14 (resolveProvider tinha sua própria cópia de
// isProviderConnected que não sabia do add-on, e um tenant com o add-on ativo caía silenciosamente
// no Gemini em vez de ir pelo proxy do Fleet Manager) - o caso "ia_kb inativo" que ele testava
// deixou de existir com a F11, então o teste que o exercitava foi removido, não apenas
// desabilitado, e os que continuam valendo perderam a manipulação de cache do Redis que
// simulava aquele estado (isIaKbActive não lê mais o cache - é sempre true).
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
  // Deliberately unset - a tenant's own key, mantido só para provar que a IA gerenciada nem
  // olha para este campo mais (ver teste abaixo).
  openai_api_key_encrypted: undefined,
  anthropic_api_key_encrypted: undefined,
};

describe("resolveProvider - IA gerenciada é base do produto (F11) (src/aiOrchestrator.ts)", () => {
  beforeAll(async () => {
    await prisma.iaKbTaskConfig.deleteMany({ where: { tenantId: TENANT_ID } });
    await prisma.tenant.deleteMany({ where: { id: TENANT_ID } });
    await prisma.tenant.create({ data: { id: TENANT_ID, name: "Test Tenant (aiOrchestrator.test.ts)" } });
  });

  afterEach(async () => {
    await prisma.iaKbTaskConfig.deleteMany({ where: { tenantId: TENANT_ID } });
  });

  afterAll(async () => {
    await prisma.iaKbTaskConfig.deleteMany({ where: { tenantId: TENANT_ID } });
    await prisma.tenant.deleteMany({ where: { id: TENANT_ID } });
  });

  it("routes anthropic through the Fleet Manager even with no local key configured (never falls back)", async () => {
    await runWithTenant({ tenantId: TENANT_ID }, async () => {
      const resolution = await resolveProvider("poc_test_generation", BASE_SETTINGS as any);
      expect(resolution.isFallback).toBe(false);
      expect(resolution.provider).toBe("anthropic");
    });
  });

  it("falls back to gemini when the configured provider is a retired custom provider (pre-F11 leftover)", async () => {
    await runWithTenant({ tenantId: TENANT_ID }, async () => {
      const settings = { ...BASE_SETTINGS, poc_test_generation_provider: "grok", poc_test_generation_model: "grok-4" };
      const resolution = await resolveProvider("poc_test_generation", settings as any);
      expect(resolution.isFallback).toBe(true);
      expect(resolution.provider).toBe("gemini");
      expect(resolution.intendedProvider).toBe("grok");
    });
  });

  it("uses the CMSaaS-configured per-task override, instead of the tenant's own settings", async () => {
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

    await runWithTenant({ tenantId: TENANT_ID }, async () => {
      const resolution = await resolveProvider("poc_test_generation", BASE_SETTINGS as any);
      // No override for TENANT_ID - falls through to its own settings, which point at anthropic.
      expect(resolution.provider).toBe("anthropic");
    });

    await prisma.iaKbTaskConfig.deleteMany({ where: { tenantId: otherTenant } });
    await prisma.tenant.deleteMany({ where: { id: otherTenant } });
  });
});
