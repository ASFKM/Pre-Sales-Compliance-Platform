import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";
import { configuracaoDoKeycloak, variaveisAusentes } from "./keycloakConfig";

/**
 * Fase 13 — verificação do token emitido pelo Keycloak, no lugar da sessão própria em Redis.
 *
 * O PreSales passou a autenticar pelo realm `cloudmountain`, compartilhado com o CMCRM e o
 * PreSales. Este arquivo é a única porta de entrada dessa verificação: quem quiser saber se um
 * pedido é de alguém autenticado chama `verificarTokenDoKeycloak`.
 *
 * O QUE NÃO MUDOU DE LUGAR: o papel de cada pessoa continua no Postgres
 * (`User.role_id` → `Role.permissions`), casado pelo **e-mail** que vem no token. Não há
 * grupo nem role de Keycloak envolvido em permissão de produto. É o mesmo desenho já medido no
 * CMCRM, e evita duas fontes de verdade sobre quem pode o quê.
 */

export interface ClaimsDoKeycloak extends JWTPayload {
  email?: string;
  preferred_username?: string;
  /**
   * Instante em que a pessoa REALMENTE se autenticou (não em que o token foi emitido). É o que
   * sustenta o step-up: um token novo obtido por refresh mantém o `auth_time` antigo, então
   * exigir `auth_time` recente é exigir que a pessoa tenha digitado a senha agora.
   */
  auth_time?: number;
}

/**
 * Allowlist FECHADA de emissores aceitos.
 *
 * O Keycloak roda com hostname dinâmico — ele atende pelo IP da rede, pelo IP do Tailscale e
 * pelo nome do Tailscale, a pedido do dono, e monta o `iss` a partir da rota por onde a pessoa
 * chegou. Um único valor esperado seria um limitador; um curinga seria um buraco.
 *
 * Aceitar mais de um emissor não enfraquece nada: o que prova o token é a assinatura conferida
 * contra o JWKS, buscado de um endereço que ESTE código escolhe e que o token não influencia.
 * O `iss` é um campo a mais, e a lista é escrita à mão no `.env`.
 *
 * Lista vazia é ERRO, não allowlist vazia: `jose` trata `issuer` ausente como "não verifique o
 * emissor", então uma variável mal preenchida desligaria a checagem em silêncio.
 */
export function montarEmissoresAceitos(listaBruta: string, realm: string): string[] {
  const bases = listaBruta
    .split(",")
    .map((u) => semBarraFinal(u.trim()))
    .filter((u) => u.length > 0);
  if (bases.length === 0) {
    throw new Error(
      "KEYCLOAK_ISSUER_URLS está vazia — sem pelo menos um emissor a verificação de token aceitaria qualquer origem",
    );
  }
  const emissores = bases.map((u) => `${u}/realms/${realm}`);
  return emissores.filter((e, i) => emissores.indexOf(e) === i);
}

/**
 * Sem expressão regular de propósito: `/\/+$/` é um quantificador guloso ancorado no fim, com
 * backtracking super-linear, e o lint do CMCRM o barra como ReDoS. Mesma decisão aqui.
 */
function semBarraFinal(valor: string): string {
  let fim = valor.length;
  while (fim > 0 && valor.charAt(fim - 1) === "/") fim -= 1;
  return valor.slice(0, fim);
}

let jwksCache: JWTVerifyGetKey | null = null;
let emissoresCache: string[] | null = null;



function config() {
  if (jwksCache && emissoresCache) return { jwks: jwksCache, emissores: emissoresCache };

  const cfg = configuracaoDoKeycloak();
  if (!cfg) {
    // Mensagem que diz O QUE falta e onde resolver. Antes havia padrão embutido aqui, apontando
    // para o Keycloak da CloudMountain — o que numa instalação de cliente mandaria a autenticação
    // dele para um servidor alheio, e falharia de um jeito que ninguém investiga porque a tela
    // não acusa nada.
    throw new Error(
      `Keycloak não configurado nesta instalação: falta ${variaveisAusentes().join(", ")}. ` +
        `Rode o wizard (npm run setup) ou defina essas variáveis no .env e reinicie o serviço.`
    );
  }
  const realm = cfg.realm;
  const audience = cfg.audience;
  const listaEmissores = cfg.issuerUrls;
  /**
   * O JWKS vem de UM endereço só, escolhido aqui — nunca derivado do que o token diz. As chaves
   * são do realm, não da rota; deixar a busca de chave seguir o token trocaria a âncora de
   * confiança por um dado que o atacante controla.
   *
   * O certificado do Keycloak é auto-assinado e foi instalado como âncora nos hosts, via
   * `NODE_EXTRA_CA_CERTS` no `EnvironmentFile` do serviço (systemd lê o `.env` ANTES do Node
   * subir, que é o único momento em que essa variável tem efeito — carregá-la por dotenv em
   * runtime seria tarde demais). Sem isso a busca de JWKS falha com `SELF_SIGNED_CERT_IN_CHAIN`
   * e nenhum login funciona.
   */
  const jwksUrl = cfg.jwksUrl;


  emissoresCache = montarEmissoresAceitos(listaEmissores, realm);
  jwksCache = createRemoteJWKSet(new URL(jwksUrl));
  return { jwks: jwksCache, emissores: emissoresCache };
}

/**
 * Verifica assinatura, emissor, audiência e validade. Devolve os claims, ou lança.
 *
 * `algorithms: ["RS256"]` fixa o algoritmo: o JWKS remoto já só traz chaves RSA, mas fixar é
 * barato e protege contra uma mudança futura de configuração do realm que introduza um
 * algoritmo simétrico — a clássica confusão HS/RS.
 */
export async function verificarTokenDoKeycloak(accessToken: string): Promise<ClaimsDoKeycloak> {
  const { jwks, emissores } = config();
  const { payload } = await jwtVerify(accessToken, jwks, {
    issuer: emissores,
    audience: process.env.KEYCLOAK_AUDIENCE,
    algorithms: ["RS256"],
  });
  return payload as ClaimsDoKeycloak;
}

/**
 * O e-mail é a chave que liga a identidade do Keycloak ao `AdminUser` deste banco.
 *
 * `email` pode faltar num token se o client não pedir o escopo `email`; nesse caso
 * `preferred_username` costuma trazer o mesmo valor, porque as contas foram criadas com
 * username = e-mail. Um token sem nenhum dos dois não identifica ninguém e é recusado — melhor
 * negar do que adivinhar de quem é a sessão.
 */
export function emailDoToken(claims: ClaimsDoKeycloak): string {
  const email = claims.email ?? claims.preferred_username;
  if (!email || !email.includes("@")) {
    throw new Error("token sem e-mail — não é possível identificar a conta");
  }
  return email.toLowerCase();
}

/**
 * Quantos segundos se passaram desde que a pessoa realmente se autenticou.
 *
 * Sustenta o step-up: a rota sensível exige que este número seja pequeno, e só uma
 * reautenticação de verdade no Keycloak (`prompt=login`, `max_age=0`) o zera. Um refresh de
 * token, que renova a validade sem perguntar nada a ninguém, deixa o `auth_time` onde estava —
 * que é exatamente a propriedade que torna isso utilizável como segunda barreira.
 *
 * Token sem `auth_time` devolve `null`, e quem chama trata como "não posso afirmar que foi
 * recente" — nunca como zero.
 */
export function segundosDesdeAutenticacao(claims: ClaimsDoKeycloak): number | null {
  if (typeof claims.auth_time !== "number") return null;
  return Math.floor(Date.now() / 1000) - claims.auth_time;
}
