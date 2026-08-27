import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

// getFleetLicenseStatus é substituído porque a licença é assinada em Ed25519
// pelo CMSaaS: produzir uma válida num teste exigiria a CHAVE PRIVADA do
// fornecedor, e falsificá-la é justamente o que a verificação existe para
// impedir. O que estes casos exercitam é a RESOLUÇÃO - qual instalação local
// responde por uma chave de par -, não a verificação da licença, que tem os
// próprios testes em fleetLicense.test.ts.
const licencaPorTenant = new Map<string, { installation_id: string | null }>();
vi.mock("./fleetLicense", async () => {
  const real = await vi.importActual<typeof import("./fleetLicense")>("./fleetLicense");
  return {
    ...real,
    getFleetLicenseStatus: async (tenantId: string) => ({
      connected: true,
      installation_id: licencaPorTenant.get(tenantId)?.installation_id ?? null,
      status: "active",
      block_mode: null,
      modules: [],
      plan_name: null,
      contract_start_date: null,
      contract_end_date: null,
      last_verified_at: null,
      customer_name: null,
      customer_city: null,
      customer_state: null,
      customer_logo_base64: null,
    }),
  };
});

import { prisma } from "../../src/prisma";
import { redis } from "../../src/redis";
import { verifyPairKey, invalidatePairKeyCache } from "./pairKey";

const TENANT = "test_tenant_cdc16_pair";
const CMSAAS = "https://cmsaas-de-teste.invalid";
const INSTALACAO_LOCAL = "inst_presales_de_teste";

function respostaDoPar(installationPresales: string, extras: Record<string, unknown> = {}) {
  return {
    success: true,
    pair_id: "pair_de_teste",
    status: "active",
    active: true,
    customer_id: "cust_de_teste",
    customer_name: "Cliente de Teste",
    cross_environment: false,
    sides: {
      cmcrm: { product: "cmcrm", installation_id: "inst_crm_de_teste", label: "CRM", environment: "development", status: "active" },
      presales: { product: "presales", installation_id: installationPresales, label: "PreSales", environment: "development", status: "active" },
    },
    ...extras,
  };
}

// Responde SÓ pelo CMSaaS deste teste; qualquer outro devolve 401, como um
// CMSaaS que não conhece a chave devolveria. Sem isso o teste passa a depender
// de quantos tenants com CMSaaS configurado existem no banco compartilhado - e
// o banco é compartilhado: o cenário da prova de execução real cria os dele
// nesta mesma base.
function fetchQueResponde(status: number, corpo: unknown) {
  return vi.fn(async (url: any) => {
    if (!String(url).startsWith(CMSAAS)) {
      return { ok: false, status: 401, json: async () => ({ success: false, message: "Invalid or revoked pair key." }) };
    }
    return { ok: status >= 200 && status < 300, status, json: async () => corpo };
  }) as unknown as typeof fetch;
}

/** Quantas vezes o CMSaaS DESTE teste foi consultado. */
function chamadasAoCmsaasDoTeste(f: unknown): number {
  return ((f as any).mock.calls as any[][]).filter((c) => String(c[0]).startsWith(CMSAAS)).length;
}

async function limpar() {
  await prisma.platformSettings.deleteMany({ where: { tenantId: TENANT } });
  await prisma.tenant.deleteMany({ where: { id: TENANT } });
}

describe("CDC 16 F1 - verifyPairKey", () => {
  beforeAll(async () => {
    await limpar();
    await prisma.tenant.create({ data: { id: TENANT, name: "Tenant de teste (pairKey.test.ts)" } });
    await prisma.platformSettings.create({
      data: {
        id: "ps_test_cdc16_pair",
        tenantId: TENANT,
        aiProvider: "gemini",
        defaultModel: "gemini-3.5-flash",
        documentAnalysisModel: "gemini-3.5-flash",
        proposalGenerationModel: "gemini-3.5-flash",
        localStoragePath: "uploads",
        s3Bucket: "",
        gcsBucket: "",
        defaultLanguage: "Portuguese",
        defaultLogLevel: "INFO",
        fleetManagerUrl: CMSAAS,
        fleetManagerEnabled: false,
      },
    });
    licencaPorTenant.set(TENANT, { installation_id: INSTALACAO_LOCAL });
  });

  afterAll(async () => {
    await limpar();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("chave ausente é 401, sem sequer perguntar ao CMSaaS", async () => {
    const f = fetchQueResponde(200, {});
    vi.stubGlobal("fetch", f);
    const r = await verifyPairKey("   ");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(401);
    expect(f).not.toHaveBeenCalled();
  });

  it("par ativo cujo lado PreSales é ESTA instalação resolve o tenant local", async () => {
    const chave = "chave-boa-1";
    await invalidatePairKeyCache(chave);
    vi.stubGlobal("fetch", fetchQueResponde(200, respostaDoPar(INSTALACAO_LOCAL, { cross_environment: true })));

    const r = await verifyPairKey(chave);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.pair.tenantId).toBe(TENANT);
    expect(r.pair.crossEnvironment).toBe(true);
    expect(r.pair.sides.cmcrm.installation_id).toBe("inst_crm_de_teste");
    await invalidatePairKeyCache(chave);
  });

  it("chave de um par cujo lado PreSales é OUTRA instalação é recusada", async () => {
    // É a conferência que impede a chave de um par de outro cliente, atendido
    // pelo mesmo CMSaaS, de escrever neste tenant.
    const chave = "chave-de-outro-par";
    await invalidatePairKeyCache(chave);
    vi.stubGlobal("fetch", fetchQueResponde(200, respostaDoPar("inst_presales_de_outro_cliente")));

    const r = await verifyPairKey(chave);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(401);
      expect(r.error).toBe("pair_not_for_this_installation");
    }
    await invalidatePairKeyCache(chave);
  });

  it("401 do CMSaaS (chave inválida ou revogada) atravessa como 401", async () => {
    const chave = "chave-inventada";
    await invalidatePairKeyCache(chave);
    vi.stubGlobal("fetch", fetchQueResponde(401, { success: false, message: "Invalid or revoked pair key." }));
    const r = await verifyPairKey(chave);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(401);
      expect(r.error).toBe("invalid_pair_key");
    }
    await invalidatePairKeyCache(chave);
  });

  it("403 do CMSaaS (lado suspenso) atravessa como 403, e não vira 401", async () => {
    // Traduzir para 401 faria o CMCRM pedir uma chave nova, que não resolveria
    // nada: a chave está certa, o que não está valendo é o par.
    const chave = "chave-de-par-suspenso";
    await invalidatePairKeyCache(chave);
    vi.stubGlobal("fetch", fetchQueResponde(403, { success: false, message: "O par existe, mas uma das instalações não está ativa." }));
    const r = await verifyPairKey(chave);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(403);
      expect(r.error).toBe("pair_not_active");
    }
    await invalidatePairKeyCache(chave);
  });

  it("CMSaaS inalcançável é 502, e NÃO é cacheado", async () => {
    const chave = "chave-com-cmsaas-fora";
    await invalidatePairKeyCache(chave);
    const f = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", f);

    const primeira = await verifyPairKey(chave);
    expect(primeira.ok).toBe(false);
    if (!primeira.ok) expect(primeira.status).toBe(502);
    const depoisDaPrimeira = (f as any).mock.calls.length;
    expect(depoisDaPrimeira).toBeGreaterThan(0);

    // Repetir precisa tentar de novo: um 502 cacheado transformaria uma queda de
    // rede de um segundo em 30 segundos de porta fechada.
    const segunda = await verifyPairKey(chave);
    expect(segunda.ok).toBe(false);
    expect((f as any).mock.calls.length).toBeGreaterThan(depoisDaPrimeira);
    await invalidatePairKeyCache(chave);
  });

  it("o veredito positivo é cacheado: a segunda chamada não fala com o CMSaaS", async () => {
    const chave = "chave-cacheada";
    await invalidatePairKeyCache(chave);
    const f = fetchQueResponde(200, respostaDoPar(INSTALACAO_LOCAL));
    vi.stubGlobal("fetch", f);

    await verifyPairKey(chave);
    await verifyPairKey(chave);
    expect(chamadasAoCmsaasDoTeste(f)).toBe(1);

    // E some quando o cache é invalidado.
    await invalidatePairKeyCache(chave);
    await verifyPairKey(chave);
    expect(chamadasAoCmsaasDoTeste(f)).toBe(2);
    await invalidatePairKeyCache(chave);
  });

  it("instalação cuja licença ainda não identificou o installation_id não resolve nada", async () => {
    licencaPorTenant.set(TENANT, { installation_id: null });
    const chave = "chave-sem-licenca-verificada";
    await invalidatePairKeyCache(chave);
    vi.stubGlobal("fetch", fetchQueResponde(200, respostaDoPar(INSTALACAO_LOCAL)));
    try {
      const r = await verifyPairKey(chave);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toBe("pair_not_for_this_installation");
    } finally {
      licencaPorTenant.set(TENANT, { installation_id: INSTALACAO_LOCAL });
      await invalidatePairKeyCache(chave);
    }
  });

  it("a chave crua nunca vira a própria chave do cache - o que entra no Redis é o sha256 dela", async () => {
    const chave = "chave-que-nao-pode-vazar";
    await invalidatePairKeyCache(chave);
    vi.stubGlobal("fetch", fetchQueResponde(200, respostaDoPar(INSTALACAO_LOCAL)));
    await verifyPairKey(chave);

    const chaves = await redis.keys("pair:verify:*");
    expect(chaves.some((k) => k.includes(chave))).toBe(false);
    await invalidatePairKeyCache(chave);
  });
});
