import { describe, it, expect } from "vitest";
import { resolverMarcaDaInstalacao, MARCA_AUSENTE, DependenciasDaMarca } from "./marcaDaInstalacao";

/**
 * F6 (01/09/2026) — a regra que decide DE QUEM é esta instalação para a tela de entrada.
 *
 * A licença é assinada em Ed25519 pelo CMSaaS, e forjar uma exigiria a chave privada do
 * fornecedor — que é justamente o que a verificação existe para impedir. Por isso o que estes
 * casos exercitam é a RESOLUÇÃO (qual tenant responde pela instalação, e quando é melhor não
 * responder nada), com a leitura da licença injetada; a verificação da assinatura tem os próprios
 * testes em `fleetLicense.test.ts`.
 *
 * Nenhum caso aqui toca Postgres ou Redis: o ponto da rota é ela não depender de nada que possa
 * estar fora do ar no momento do login.
 */

function licenca(nome: string | null, logo: string | null = null, connected = true) {
  return { connected, customer_name: nome, customer_logo_base64: logo };
}

function deps(
  tenants: string[],
  porTenant: Record<string, ReturnType<typeof licenca>>
): DependenciasDaMarca {
  return {
    listarTenantsComRelatoDeFrota: async () => tenants,
    lerLicencaLocal: async (tenantId: string) =>
      porTenant[tenantId] ?? licenca(null, null, false),
  };
}

const LOGO = "data:image/png;base64,iVBORw0KGgo=";

describe("resolverMarcaDaInstalacao — COM marca", () => {
  it("um único tenant licenciado: devolve nome e logo do cache local", async () => {
    const marca = await resolverMarcaDaInstalacao(
      deps(["tenant_default"], { tenant_default: licenca("Cliente Alfa Ltda", LOGO) })
    );
    expect(marca).toEqual({ licenciado_para: "Cliente Alfa Ltda", logo_base64: LOGO });
  });

  it("nome com espaços em volta é aparado antes de virar rótulo", async () => {
    const marca = await resolverMarcaDaInstalacao(
      deps(["t1"], { t1: licenca("  Cliente Alfa Ltda  ") })
    );
    expect(marca.licenciado_para).toBe("Cliente Alfa Ltda");
  });

  it("dois tenants do MESMO cliente não são ambiguidade: o nome está certo de qualquer jeito", async () => {
    const marca = await resolverMarcaDaInstalacao(
      deps(["t_b", "t_a"], { t_a: licenca("Cliente Alfa Ltda"), t_b: licenca("Cliente Alfa Ltda", LOGO) })
    );
    expect(marca).toEqual({ licenciado_para: "Cliente Alfa Ltda", logo_base64: LOGO });
  });

  it("a ordem de percurso é estável: a mesma lista embaralhada responde a mesma coisa", async () => {
    const porTenant = { t_a: licenca("Cliente Alfa Ltda", LOGO), t_b: licenca("Cliente Alfa Ltda", "data:image/png;base64,OUTRO") };
    const primeira = await resolverMarcaDaInstalacao(deps(["t_a", "t_b"], porTenant));
    const segunda = await resolverMarcaDaInstalacao(deps(["t_b", "t_a"], porTenant));
    expect(segunda).toEqual(primeira);
    expect(primeira.logo_base64).toBe(LOGO);
  });

  it("logo que não é data: URI de imagem é descartado, o nome permanece", async () => {
    const marca = await resolverMarcaDaInstalacao(
      deps(["t1"], { t1: licenca("Cliente Alfa Ltda", "https://cdn.exemplo.invalid/logo.png") })
    );
    expect(marca).toEqual({ licenciado_para: "Cliente Alfa Ltda", logo_base64: null });
  });

  it("logo acima do teto é descartado - o tamanho de uma resposta publica nao fica a mercê do CMSaaS", async () => {
    const gigante = "data:image/png;base64," + "A".repeat(512 * 1024);
    const marca = await resolverMarcaDaInstalacao(deps(["t1"], { t1: licenca("Cliente Alfa Ltda", gigante) }));
    expect(marca).toEqual({ licenciado_para: "Cliente Alfa Ltda", logo_base64: null });
  });

  it("logo do tamanho real desta instalacao (~100 KB) passa", async () => {
    const real = "data:image/png;base64," + "A".repeat(100 * 1024);
    const marca = await resolverMarcaDaInstalacao(deps(["t1"], { t1: licenca("Cliente Alfa Ltda", real) }));
    expect(marca.logo_base64).toBe(real);
  });
});

describe("resolverMarcaDaInstalacao — SEM marca (degrada em silêncio)", () => {
  it("instalação nova, nenhum tenant com relato de frota ligado", async () => {
    expect(await resolverMarcaDaInstalacao(deps([], {}))).toEqual(MARCA_AUSENTE);
  });

  it("tenant habilitado mas cache vazio / assinatura inválida (connected: false)", async () => {
    const marca = await resolverMarcaDaInstalacao(
      deps(["tenant_default"], { tenant_default: licenca("Cliente Alfa Ltda", LOGO, false) })
    );
    expect(marca).toEqual(MARCA_AUSENTE);
  });

  it("licença conectada sem customer_name não vira rótulo vazio", async () => {
    expect(await resolverMarcaDaInstalacao(deps(["t1"], { t1: licenca("   ", LOGO) }))).toEqual(MARCA_AUSENTE);
  });

  it("dois clientes DIFERENTES: ausência, nunca o nome do cliente errado na porta de entrada", async () => {
    const marca = await resolverMarcaDaInstalacao(
      deps(["t_a", "t_b"], { t_a: licenca("Cliente Alfa Ltda", LOGO), t_b: licenca("Cliente Beta S.A.") })
    );
    expect(marca).toEqual(MARCA_AUSENTE);
  });

  it("banco fora do ar (a listagem de tenants lança) não propaga exceção", async () => {
    const marca = await resolverMarcaDaInstalacao({
      listarTenantsComRelatoDeFrota: async () => {
        throw new Error("ECONNREFUSED postgres");
      },
      lerLicencaLocal: async () => licenca("Cliente Alfa Ltda", LOGO),
    });
    expect(marca).toEqual(MARCA_AUSENTE);
  });

  it("Redis fora do ar (a leitura da licença lança) não propaga exceção", async () => {
    const marca = await resolverMarcaDaInstalacao({
      listarTenantsComRelatoDeFrota: async () => ["tenant_default"],
      lerLicencaLocal: async () => {
        throw new Error("ECONNREFUSED redis");
      },
    });
    expect(marca).toEqual(MARCA_AUSENTE);
  });
});
