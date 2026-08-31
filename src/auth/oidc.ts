import { UserManager, WebStorageStateStore, type User } from "oidc-client-ts";

/**
 * Fase 13 — login por OIDC (Authorization Code + PKCE) contra o realm `cloudmountain`,
 * compartilhado com o CMCRM e o CMSaaS. O `client_id` é público, sem segredo no navegador:
 * quem protege o código de autorização é o PKCE.
 */

/**
 * O Keycloak responde por três rotas — IP da rede, IP do Tailscale e nome do Tailscale — a
 * pedido do dono ("isso não pode ser um limitador"). Diferente do CMCRM, aqui não dá para
 * simplesmente reaproveitar o hostname da página: o Keycloak mora em OUTRO host, então trocar só
 * o hostname mandaria o navegador para o endereço errado.
 *
 * O que se preserva é a FAMÍLIA da rota: quem chegou ao produto pelo Tailscale precisa falar com
 * o Keycloak pelo Tailscale, porque de dentro do túnel o IP da LAN não responde — e vice-versa.
 * Mandar alguém que veio pelo Tailscale para o IP da LAN é a forma mais fácil de quebrar o login
 * exatamente para quem está fora de casa.
 */
/**
 * A configuração do Keycloak vem do build, e NÃO tem valor padrão.
 *
 * Houve padrão aqui — os endereços da CloudMountain — e foi um erro conceitual: este produto é
 * instalado em cliente, e cada cliente tem o seu Keycloak. Um front compilado apontando para o
 * servidor de outra empresa é pior do que um front que não sobe: manda gente autenticar em lugar
 * errado e falha de um jeito que ninguém investiga.
 *
 * Estas variáveis são resolvidas em tempo de BUILD pelo Vite, lendo o `.env` da instalação — que
 * o wizard escreve ao perguntar o ambiente. Sem elas, `configuracaoAusente` fica verdadeiro e a
 * aplicação mostra o que falta, em vez de tentar falar com um endereço inexistente e morrer com
 * "Failed to fetch", que não diz nada a ninguém.
 */
const URLS = (import.meta.env.VITE_KEYCLOAK_URLS as string | undefined)?.trim();
const REALM = (import.meta.env.VITE_KEYCLOAK_REALM as string | undefined)?.trim();
const CLIENT_ID = (import.meta.env.VITE_KEYCLOAK_CLIENT_ID as string | undefined)?.trim();

export const configuracaoAusente: string[] = [
  !URLS ? "VITE_KEYCLOAK_URLS" : "",
  !REALM ? "VITE_KEYCLOAK_REALM" : "",
  !CLIENT_ID ? "VITE_KEYCLOAK_CLIENT_ID" : "",
].filter(Boolean);

export const keycloakConfigurado = configuracaoAusente.length === 0;

function rotaDoKeycloak(): string {
  const rotas = (URLS ?? "")
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);
  const atual = window.location.hostname;

  const ehNomeTailscale = atual.endsWith(".ts.net");
  const ehIpTailscale = /^100\.\d+\.\d+\.\d+$/.test(atual);

  const casa = (u: string) => {
    const host = new URL(u).hostname;
    if (ehNomeTailscale) return host.endsWith(".ts.net");
    if (ehIpTailscale) return /^100\.\d+\.\d+\.\d+$/.test(host);
    return !host.endsWith(".ts.net") && !/^100\./.test(host);
  };

  /**
   * Sem correspondência, vale a primeira da lista. É uma escolha consciente: uma rota nova
   * (outra VPN, outro nome) deve degradar para "tenta a principal" em vez de falhar com a lista
   * vazia — o pior caso vira um aviso de rede, não uma tela morta.
   */
  return rotas.find(casa) ?? rotas[0] ?? "";
}

export const userManager = new UserManager({
  authority: `${rotaDoKeycloak()}/realms/${REALM ?? ""}`,
  client_id: CLIENT_ID ?? "",
  /**
   * A volta do Keycloak cai na RAIZ, não numa rota `/callback` própria: este produto não usa
   * roteador de cliente para a tela de entrada (o `App.tsx` decide por estado local se mostra o
   * login ou a aplicação), então uma rota nova dependeria de o servidor devolver o index.html
   * para um caminho que ele nunca serviu. A raiz já funciona em qualquer configuração, e o
   * código de autorização é reconhecido pela query string.
   */
  redirect_uri: `${window.location.origin}/`,
  post_logout_redirect_uri: window.location.origin,
  response_type: "code",
  /**
   * `organization` não entra aqui de propósito: este produto não é multi-tenant por Organization
   * do Keycloak — o recorte dele vive no próprio banco. Pedir o escopo faria o Keycloak usar o
   * fluxo de login em DUAS etapas (usuário, depois senha), que só existe para descobrir a
   * organização pelo domínio. Sem ele, a tela de entrada é uma só.
   */
  scope: "openid profile email",
  userStore: new WebStorageStateStore({ store: window.localStorage }),
  /**
   * Renova o token em segundo plano antes de expirar (o realm emite access token de 5 minutos).
   * Sem isso, quem deixasse a tela aberta levaria 401 no meio de uma ação — o produto não tem
   * mais sessão própria em Redis para segurar isso.
   */
  automaticSilentRenew: true,
  silent_redirect_uri: `${window.location.origin}/`,
});

export async function usuarioAtivo(): Promise<User | null> {
  const user = await userManager.getUser();
  if (!user || user.expired) return null;
  return user;
}

export function entrar(): Promise<void> {
  return userManager.signinRedirect();
}

export function sair(): Promise<void> {
  return userManager.signoutRedirect();
}

/**
 * Reautenticação para ações sensíveis (step-up).
 *
 * `prompt: "login"` e `max_age: 0` juntos obrigam o Keycloak a perguntar de novo, mesmo com
 * sessão válida — é o que faz o token voltar com `auth_time` novo, que é o que o servidor
 * confere. Um refresh comum não serviria: ele renova a validade sem perguntar nada a ninguém, e
 * o `auth_time` fica onde estava.
 *
 * Em janela separada (`signinPopup`), e não por redirecionamento de página inteira, porque a
 * pessoa está no meio de uma ação: mandá-la embora da tela e trazê-la de volta perderia o
 * formulário preenchido e o contexto do que ela ia confirmar. Se o navegador bloquear a janela,
 * cai para o redirecionamento — funciona, só é mais áspero.
 */
export async function reautenticar(): Promise<User> {
  try {
    return await userManager.signinPopup({ prompt: "login", extraQueryParams: { max_age: 0 } });
  } catch (erro) {
    const bloqueado = String(erro).toLowerCase().includes("popup");
    if (!bloqueado) throw erro;
    await userManager.signinRedirect({ prompt: "login", extraQueryParams: { max_age: 0 } });
    // `signinRedirect` navega para fora da página; nada depois desta linha chega a rodar.
    throw erro;
  }
}
