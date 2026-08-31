/**
 * A configuração do Keycloak, num lugar só.
 *
 * Existe por causa de um defeito real: os padrões foram acrescentados em `keycloakAuth.ts` (que
 * valida o token) e NÃO em `security.ts` (que monta a CSP), porque as duas liam
 * `process.env.KEYCLOAK_ISSUER_URLS` por conta própria. Numa instalação sem a variável o
 * resultado foi o pior possível — a autenticação passava a funcionar, e a CSP saía **sem o
 * Keycloak em `connect-src`**, então o navegador bloqueava a chamada e o produto mostrava
 * "Failed to fetch" sem nada no servidor denunciando: o backend estava de pé, o health check
 * passava, e a atualização era dada como bem-sucedida.
 *
 * Duas leituras da mesma configuração é o que permite corrigir uma e esquecer a outra. Daqui em
 * diante existe uma fonte, e quem precisar da configuração importa daqui.
 *
 * NÃO HÁ SEGREDO AQUI. O fluxo é Authorization Code + PKCE com cliente público: não existe
 * `client_secret` neste produto. São endereços, o nome do realm e o id do cliente — os três
 * visíveis na barra de endereço de qualquer usuário que faça login. O `.env` continua vencendo;
 * isto é piso, não teto.
 */

/** Rotas por onde o Keycloak responde: IP da LAN, IP do Tailscale e nome do Tailscale. */
export const KEYCLOAK_ISSUER_URLS_PADRAO =
  "https://192.168.3.197:8443,https://100.106.236.106:8443,https://cmcrm-dev-01.tail7af88b.ts.net:8443";

export const KEYCLOAK_REALM_PADRAO = "cloudmountain";
export const KEYCLOAK_AUDIENCE_PADRAO = "presales-web";

/**
 * O JWKS aponta para o nome Tailscale de propósito: esse endereço tem certificado Let's Encrypt
 * de verdade, então a busca de chaves funciona sem depender de a instalação ter a CA interna
 * instalada — que é justamente o que uma instalação limpa não tem.
 */
export const KEYCLOAK_JWKS_URL_PADRAO = `https://cmcrm-dev-01.tail7af88b.ts.net:8443/realms/${KEYCLOAK_REALM_PADRAO}/protocol/openid-connect/certs`;

export function issuerUrlsDoKeycloak(): string {
  return process.env.KEYCLOAK_ISSUER_URLS || KEYCLOAK_ISSUER_URLS_PADRAO;
}

export function realmDoKeycloak(): string {
  return process.env.KEYCLOAK_REALM || KEYCLOAK_REALM_PADRAO;
}

export function audienceDoKeycloak(): string {
  return process.env.KEYCLOAK_AUDIENCE || KEYCLOAK_AUDIENCE_PADRAO;
}

export function jwksUrlDoKeycloak(): string {
  return process.env.KEYCLOAK_JWKS_URL || KEYCLOAK_JWKS_URL_PADRAO;
}

/**
 * As ORIGENS (esquema + host + porta) das rotas do Keycloak, que é o que a CSP entende.
 * `connect-src` cobre a busca da configuração do realm e a troca do código por token;
 * `frame-src` cobre a renovação silenciosa, que roda num iframe.
 */
export function origensDoKeycloak(): string[] {
  return issuerUrlsDoKeycloak()
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean)
    .map((u) => {
      try {
        return new URL(u).origin;
      } catch {
        return "";
      }
    })
    .filter(Boolean);
}
