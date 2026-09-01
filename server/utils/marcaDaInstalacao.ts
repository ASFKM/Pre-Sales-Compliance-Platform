import { dbStore } from "../../src/dbStore";
import { getFleetLicenseStatus } from "./fleetLicense";

/**
 * F6 (01/09/2026) — a MARCA DA INSTALAÇÃO: de quem é esta instalação, para a tela de entrada
 * poder dizer "Licensed to <cliente>" antes de qualquer pessoa se identificar.
 *
 * POR QUE ISTO EXISTE AGORA. Até a F5, a tela de login decidia por conta própria NÃO mostrar o
 * "Licensed to", e o motivo escrito no arquivo era que o dado dependia de uma consulta ao CMSaaS
 * — e a tela de entrada é justamente a que precisa aparecer inteira no meio de uma falha de rede.
 * Essa objeção caiu: desde a Fase 7 o heartbeat guarda a licença ASSINADA no Redis local
 * (`fleet:license:<tenant>`), e `getFleetLicenseStatus` a lê de lá, sem tocar na rede. O que se
 * mostra na tela é cache local; se o cache não existe, não se mostra nada.
 *
 * O PROBLEMA DE PROJETO: QUAL TENANT. `getFleetLicenseStatus` pede um tenantId, e a tela de login
 * não sabe o tenant — ninguém se autenticou ainda. A regra escolhida, e o porquê de cada degrau:
 *
 *  1. OS CANDIDATOS SÃO OS TENANTS COM RELATO DE FROTA LIGADO (`fleet_manager_enabled`). São os
 *     únicos que fazem heartbeat (`runHeartbeatForAllEnabledTenants` percorre exatamente esta
 *     lista) e portanto os únicos que podem ter licença assinada em cache. Um tenant de
 *     demonstração, que nunca conversou com o CMSaaS, não tem opinião sobre de quem é a
 *     instalação e não entra na conta.
 *  2. SÓ ENTRA QUEM TEM LICENÇA VERIFICADA E NOME. `connected: true` já significa que a
 *     assinatura Ed25519 do CMSaaS conferiu; `customer_name` vazio não dá para escrever.
 *  3. ORDEM ESTÁVEL, NUNCA "O PRIMEIRO QUE VIER". A lista é ordenada por tenantId antes de ser
 *     percorrida, para que duas chamadas seguidas jamais respondam coisas diferentes por causa da
 *     ordem em que o Postgres devolveu as linhas.
 *  4. DIVERGÊNCIA É AUSÊNCIA, NÃO SORTEIO. Se dois tenants licenciados declaram clientes
 *     DIFERENTES, esta instalação não tem uma marca única, e a tela não tem como saber para qual
 *     delas a pessoa está entrando. Mostrar o nome do cliente ERRADO na porta de entrada é pior
 *     do que não mostrar nada — então devolve-se marca ausente. Nomes IGUAIS não são ambiguidade:
 *     é o mesmo cliente com mais de um tenant, e aí o nome está certo de qualquer jeito.
 *
 * O QUE NÃO SAI DAQUI. Esta função alimenta uma rota PÚBLICA, sem sessão. Devolve nome e logo, e
 * mais nada: `installation_id`, status/bloqueio da licença, módulos contratados, plano e datas de
 * contrato ficam onde já estavam, atrás de autenticação (`GET /api/settings/fleet/license`).
 *
 * DEGRADA EM SILÊNCIO, SEMPRE. Redis fora, cache vazio, banco fora, instalação nova, assinatura
 * inválida, qualquer exceção: o resultado é marca ausente. Nada aqui pode lançar para cima — a
 * tela de entrada não pode depender disto para montar.
 */

export interface MarcaDaInstalacao {
  licenciado_para: string | null;
  logo_base64: string | null;
}

export const MARCA_AUSENTE: MarcaDaInstalacao = { licenciado_para: null, logo_base64: null };

/** O que a resolução consome. Injetável para o teste não precisar de Postgres nem Redis. */
export interface DependenciasDaMarca {
  listarTenantsComRelatoDeFrota: () => Promise<string[]>;
  lerLicencaLocal: (tenantId: string) => Promise<{
    connected: boolean;
    customer_name: string | null;
    customer_logo_base64: string | null;
  }>;
}

const DEPENDENCIAS_REAIS: DependenciasDaMarca = {
  // Consulta transversal a tenants, num handler de requisição: legítimo aqui e só aqui, porque a
  // pergunta é "de quem é ESTA INSTALAÇÃO" e não "o que este usuário pode ver" — não há usuário.
  // Devolve apenas identificadores de tenant, nada de conteúdo.
  listarTenantsComRelatoDeFrota: () => dbStore.getAllTenantIdsWithFleetReportingEnabled(),
  lerLicencaLocal: (tenantId: string) => getFleetLicenseStatus(tenantId),
};

/**
 * Teto do logo devolvido pela rota pública. O conteúdo deste campo é escolhido no CMSaaS, do outro
 * lado da fronteira, e vai parar numa resposta que qualquer um pode pedir sem se autenticar — o
 * tamanho da resposta não pode ficar à mercê do que o outro lado resolver mandar. Meio megabyte de
 * data: URI já é folgado para um logo de cliente (o desta instalação ocupa ~100 KB); acima disso o
 * nome continua aparecendo e só o logo cai fora.
 */
const TETO_DO_LOGO_EM_CARACTERES = 512 * 1024;

/**
 * O logo vai direto para o `src` de uma `<img>` numa tela sem sessão. A CSP desta instalação
 * aceita `img-src 'self' data:` (server/middleware/security.ts), então só um data: URI de imagem
 * tem para onde ir — qualquer outra coisa vinda do payload (um endereço externo, um `javascript:`)
 * seria bloqueada de qualquer jeito, e é melhor não emitir do que emitir e depender da CSP.
 */
function logoUtilizavel(valor: string | null | undefined): string | null {
  if (!valor) return null;
  if (!valor.startsWith("data:image/")) return null;
  if (valor.length > TETO_DO_LOGO_EM_CARACTERES) return null;
  return valor;
}

export async function resolverMarcaDaInstalacao(
  deps: DependenciasDaMarca = DEPENDENCIAS_REAIS
): Promise<MarcaDaInstalacao> {
  try {
    const tenants = [...(await deps.listarTenantsComRelatoDeFrota())].sort();

    const candidatos: { nome: string; logo: string | null }[] = [];
    for (const tenantId of tenants) {
      const licenca = await deps.lerLicencaLocal(tenantId);
      if (!licenca || !licenca.connected) continue;
      const nome = (licenca.customer_name || "").trim();
      if (!nome) continue;
      candidatos.push({ nome, logo: logoUtilizavel(licenca.customer_logo_base64) });
    }

    if (candidatos.length === 0) return MARCA_AUSENTE;
    if (candidatos.some((c) => c.nome !== candidatos[0].nome)) return MARCA_AUSENTE;

    return {
      licenciado_para: candidatos[0].nome,
      // Todos concordam no nome, então é o mesmo cliente: vale o primeiro logo que existir na
      // ordem já estabilizada, em vez de ficar sem logo porque o primeiro tenant não trouxe um.
      logo_base64: candidatos.find((c) => c.logo)?.logo ?? null,
    };
  } catch {
    return MARCA_AUSENTE;
  }
}
