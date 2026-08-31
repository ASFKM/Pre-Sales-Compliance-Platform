/**
 * A configuração do Keycloak desta instalação, num lugar só.
 *
 * **Não há valores padrão aqui, e isso é deliberado.** Houve — endereços da CloudMountain
 * embutidos como piso — e foi um erro conceitual: este produto é instalado em cliente, e cada
 * cliente tem o seu próprio Keycloak, na sua própria rede. Apontar a autenticação de um cliente
 * para um servidor que não é dele é pior do que não subir: manda gente autenticar em lugar
 * errado, e falha de um jeito que ninguém investiga porque "está configurado".
 *
 * Sem configuração, cada função abaixo devolve `null` e quem chama decide o que fazer. O produto
 * deve falhar ALTO — dizer "Keycloak não configurado" — e não silenciosamente escolher um destino.
 *
 * A configuração vem do `.env`, escrito pelo wizard de instalação (`scripts/setup-installation.ts`),
 * que pergunta o ambiente em vez de assumir.
 *
 * Este módulo existe porque a mesma configuração era lida em três lugares por conta própria —
 * validação de token, CSP e readiness. Foi assim que um padrão entrou em um e faltou no outro,
 * e o produto subiu com a autenticação funcionando e a CSP bloqueando o navegador.
 */

export interface ConfiguracaoDoKeycloak {
  /** Rotas por onde o Keycloak responde, separadas por vírgula. */
  issuerUrls: string;
  realm: string;
  audience: string;
  jwksUrl: string;
}

/** Nomes das variáveis, num lugar só — é o que as mensagens de erro citam. */
export const VARIAVEIS_DO_KEYCLOAK = [
  "KEYCLOAK_ISSUER_URLS",
  "KEYCLOAK_REALM",
  "KEYCLOAK_AUDIENCE",
  "KEYCLOAK_JWKS_URL",
] as const;

/**
 * A configuração, ou `null` quando falta qualquer uma das quatro.
 *
 * Tudo-ou-nada de propósito: uma configuração pela metade — realm sem JWKS, por exemplo — produz
 * falha em runtime, no meio de um login, em vez de falha no boot. Melhor não estar configurado do
 * que estar configurado errado.
 */
export function configuracaoDoKeycloak(): ConfiguracaoDoKeycloak | null {
  const issuerUrls = process.env.KEYCLOAK_ISSUER_URLS?.trim();
  const realm = process.env.KEYCLOAK_REALM?.trim();
  const audience = process.env.KEYCLOAK_AUDIENCE?.trim();
  const jwksUrl = process.env.KEYCLOAK_JWKS_URL?.trim();
  if (!issuerUrls || !realm || !audience || !jwksUrl) return null;
  return { issuerUrls, realm, audience, jwksUrl };
}

/** Quais das quatro variáveis faltam. Serve para a mensagem dizer O QUE falta, não só "falta". */
export function variaveisAusentes(): string[] {
  return VARIAVEIS_DO_KEYCLOAK.filter((v) => !process.env[v]?.trim());
}

export function keycloakConfigurado(): boolean {
  return configuracaoDoKeycloak() !== null;
}

/**
 * As ORIGENS (esquema + host + porta) das rotas do Keycloak, que é o que a CSP entende.
 * `connect-src` cobre a busca da configuração do realm e a troca do código por token;
 * `frame-src` cobre a renovação silenciosa, que roda num iframe.
 *
 * Devolve lista vazia quando não há configuração — e a CSP então não libera ninguém, que é o
 * correto: sem Keycloak configurado não há a quem falar.
 */
export function origensDoKeycloak(): string[] {
  const cfg = configuracaoDoKeycloak();
  if (!cfg) return [];
  return cfg.issuerUrls
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
