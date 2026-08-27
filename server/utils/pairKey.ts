import crypto from "crypto";
import { prisma } from "../../src/prisma";
import { redis } from "../../src/redis";
import { getFleetLicenseStatus } from "./fleetLicense";
import { logger } from "./logger";

// CDC 16 — Fase 1. A PRIMEIRA camada de autenticação de máquina deste produto.
//
// Plano: fleet-manager:docs/cdc/16-integracao-cmcrm-presales.md (§2.1, D01/D04).
// Contrato: fleet-manager:docs/cdc/16-contratos/presales-inbound.v1.yaml.
// ADR: docs/adr/0001-integracao-cmcrm.md (§2.1, §2.8).
//
// Até aqui, toda rota do PreSales exigia sessão humana (requireAuth /
// requirePermission). O que nasce neste arquivo é a outra ponta: quem chama é o
// CMCRM, com a CHAVE DO PAR no cabeçalho `X-Pair-Key`, e não uma pessoa.
//
// Três decisões que valem estar escritas aqui, porque nenhuma delas é óbvia:
//
// 1. A CHAVE NÃO É GUARDADA DESTE LADO, nem o hash dela. Quem sabe se um par
//    existe é o CMSaaS, que é quem o emite e quem o revoga (D04). Guardar uma
//    cópia local criaria o estado que o §2.1 do plano proíbe: um lado achando
//    que está integrado depois de a revogação já ter acontecido do outro. O
//    preço é uma chamada de rede; o cache abaixo é o que impede que ela caia no
//    caminho de cada requisição.
//
// 2. QUEM RESOLVE O TENANT É O `installation_id` DO LADO PRESALES. O par tem uma
//    chave só, válida para os dois lados, então possuir a chave não diz de que
//    lado se está falando. O que amarra a chave a ESTA instalação é o
//    `sides.presales.installation_id` que o CMSaaS devolve bater com a
//    identificação desta instalação na licença assinada. Sem essa conferência,
//    a chave de um par de OUTRO cliente, atendido pelo mesmo CMSaaS, entraria
//    aqui e escreveria neste tenant.
//
// 3. O 403 DO CMSAAS ATRAVESSA. Chave válida cujo lado foi suspenso é 403 lá
//    (par existe, instalação não está ativa) e continua 403 aqui. Traduzir para
//    401 faria o CMCRM pedir uma chave nova, que não resolveria nada.

const CACHE_TTL_OK_SECONDS = 60;
// A negativa também é cacheada, e por um motivo prático: uma chave errada em
// retentativa automática do outro lado bateria no CMSaaS a cada tentativa.
const CACHE_TTL_NEGATIVE_SECONDS = 30;
const VERIFY_TIMEOUT_MS = 8000;

export interface PairSideInfo {
  product: "cmcrm" | "presales";
  installation_id: string;
  label: string;
  environment: string;
  status: string;
}

export interface VerifiedPair {
  /** Tenant local que responde por esta chave. */
  tenantId: string;
  pairId: string;
  customerId: string;
  customerName: string | null;
  /** Par que cruza ambientes (D03) - marcado visivelmente nos dois lados. */
  crossEnvironment: boolean;
  sides: { cmcrm: PairSideInfo; presales: PairSideInfo };
}

export type PairVerification =
  | { ok: true; pair: VerifiedPair }
  | { ok: false; status: 401 | 403 | 502; error: string; message: string };

function cacheKey(rawKey: string): string {
  // sha256 da chave crua: a chave em si nunca entra no Redis, no log nem em
  // mensagem de erro.
  return `pair:verify:${crypto.createHash("sha256").update(rawKey).digest("hex")}`;
}

interface CmsaasPairResponse {
  pair_id: string;
  status: string;
  active: boolean;
  customer_id: string;
  customer_name?: string | null;
  cross_environment: boolean;
  sides: { cmcrm: PairSideInfo; presales: PairSideInfo };
}

/**
 * As instalações locais candidatas: todo tenant que tem um CMSaaS configurado.
 *
 * Deliberadamente NÃO filtra por `fleetManagerEnabled`: quem decide se o par
 * vale é o CMSaaS, e um tenant sem licença verificada é descartado logo abaixo
 * de qualquer jeito, por não ter `installation_id` conhecido.
 */
async function candidatos(): Promise<Array<{ tenantId: string; url: string }>> {
  const rows = await prisma.platformSettings.findMany({
    where: { fleetManagerUrl: { not: null } },
    select: { tenantId: true, fleetManagerUrl: true },
  });
  return rows
    .filter((r) => (r.fleetManagerUrl || "").trim().length > 0)
    .map((r) => ({ tenantId: r.tenantId, url: (r.fleetManagerUrl as string).replace(/\/+$/, "") }));
}

async function perguntarAoCmsaas(url: string, rawKey: string): Promise<
  { kind: "ok"; body: CmsaasPairResponse } | { kind: "unknown" } | { kind: "suspended"; message: string } | { kind: "unreachable" }
> {
  try {
    const res = await fetch(`${url}/api/pair/v1/verify`, {
      method: "GET",
      headers: { "X-Pair-Key": rawKey },
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
    if (res.status === 401) return { kind: "unknown" };
    if (res.status === 403) {
      const corpo = await res.json().catch(() => ({}));
      return { kind: "suspended", message: (corpo as any)?.message || "O par existe, mas uma das instalações não está ativa." };
    }
    if (!res.ok) return { kind: "unreachable" };
    const corpo = (await res.json()) as CmsaasPairResponse & { success?: boolean };
    if (!corpo?.sides?.presales?.installation_id) return { kind: "unreachable" };
    return { kind: "ok", body: corpo };
  } catch {
    // Rede, DNS, TLS ou timeout. Diferente de "chave inválida" de propósito: o
    // CMCRM que receber 502 sabe que pode repetir; o que receber 401 não.
    return { kind: "unreachable" };
  }
}

/**
 * Verifica a chave do par contra o CMSaaS e resolve o tenant local.
 *
 * Nunca lança: todo caminho de falha vira um veredito com status HTTP, porque
 * quem chama é um middleware que precisa responder alguma coisa.
 */
export async function verifyPairKey(rawKey: string): Promise<PairVerification> {
  const chave = (rawKey || "").trim();
  if (!chave) {
    return { ok: false, status: 401, error: "pair_key_required", message: "X-Pair-Key header required." };
  }

  const ck = cacheKey(chave);
  try {
    const bruto = await redis.get(ck);
    if (bruto) return JSON.parse(bruto) as PairVerification;
  } catch {
    // Redis fora do ar não pode derrubar a porta: segue para a verificação viva.
  }

  const locais = await candidatos();
  if (locais.length === 0) {
    return {
      ok: false,
      status: 401,
      error: "installation_not_managed",
      message: "This installation is not connected to a CMSaaS, so it cannot be part of a pair.",
    };
  }

  // Uma pergunta por CMSaaS distinto, não uma por tenant: a resposta é a mesma
  // para todos os tenants que apontam para o mesmo lugar.
  const urls = Array.from(new Set(locais.map((l) => l.url)));

  let algumIndisponivel = false;
  for (const url of urls) {
    const resposta = await perguntarAoCmsaas(url, chave);
    if (resposta.kind === "unreachable") {
      algumIndisponivel = true;
      continue;
    }
    if (resposta.kind === "unknown") continue;
    if (resposta.kind === "suspended") {
      const veredito: PairVerification = { ok: false, status: 403, error: "pair_not_active", message: resposta.message };
      await guardar(ck, veredito, CACHE_TTL_NEGATIVE_SECONDS);
      return veredito;
    }

    const par = resposta.body;
    if (!par.active) {
      const veredito: PairVerification = {
        ok: false,
        status: 403,
        error: "pair_not_active",
        message: "O par existe, mas não está ativo.",
      };
      await guardar(ck, veredito, CACHE_TTL_NEGATIVE_SECONDS);
      return veredito;
    }

    // A conferência que amarra a chave a ESTA instalação (decisão 2 do topo).
    const idDoLadoPresales = par.sides.presales.installation_id;
    for (const local of locais.filter((l) => l.url === url)) {
      const licenca = await getFleetLicenseStatus(local.tenantId);
      if (licenca.installation_id && licenca.installation_id === idDoLadoPresales) {
        const veredito: PairVerification = {
          ok: true,
          pair: {
            tenantId: local.tenantId,
            pairId: par.pair_id,
            customerId: par.customer_id,
            customerName: par.customer_name ?? null,
            crossEnvironment: Boolean(par.cross_environment),
            sides: par.sides,
          },
        };
        await guardar(ck, veredito, CACHE_TTL_OK_SECONDS);
        return veredito;
      }
    }

    // Chave boa, par ativo, mas o lado PreSales do par não é esta instalação.
    logger.warn(
      { pairId: par.pair_id, presalesInstallation: idDoLadoPresales },
      "cdc16: chave do par válida no CMSaaS, mas o lado PreSales do par não é esta instalação"
    );
    const veredito: PairVerification = {
      ok: false,
      status: 401,
      error: "pair_not_for_this_installation",
      message: "This pair key belongs to a pair whose PreSales side is another installation.",
    };
    await guardar(ck, veredito, CACHE_TTL_NEGATIVE_SECONDS);
    return veredito;
  }

  if (algumIndisponivel) {
    // Não é cacheado: repetir daqui a um segundo pode dar certo.
    return {
      ok: false,
      status: 502,
      error: "pairing_authority_unreachable",
      message: "Could not reach the CMSaaS to verify the pair key.",
    };
  }

  const veredito: PairVerification = {
    ok: false,
    status: 401,
    error: "invalid_pair_key",
    message: "Invalid or revoked pair key.",
  };
  await guardar(ck, veredito, CACHE_TTL_NEGATIVE_SECONDS);
  return veredito;
}

async function guardar(ck: string, veredito: PairVerification, ttlSegundos: number): Promise<void> {
  try {
    await redis.set(ck, JSON.stringify(veredito), "EX", ttlSegundos);
  } catch {
    // Sem cache o produto ainda funciona - só fala mais com o CMSaaS.
  }
}

/**
 * Apaga o cache de uma chave. Usado quando a própria porta descobre que o par
 * mudou de estado no meio do caminho.
 */
export async function invalidatePairKeyCache(rawKey: string): Promise<void> {
  try {
    await redis.del(cacheKey(rawKey));
  } catch {
    /* idem */
  }
}
