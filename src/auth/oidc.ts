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
 * Configuração padrão do Keycloak, para quando o build não recebeu as variáveis `VITE_*`.
 *
 * Estas variáveis são resolvidas em tempo de BUILD pelo Vite — e o build de uma atualização
 * acontece dentro do `scripts/update.sh`, na própria instalação, lendo o `.env` que já estava
 * lá. Uma instalação anterior à Fase 13 não tem essas linhas, e o `update.sh` preserva o `.env`
 * mas nunca acrescenta variável nova: o resultado seria um front compilado sem saber onde fica o
 * Keycloak, ou seja, sem login — e o health check pós-atualização não olha autenticação, então a
 * atualização passaria como bem-sucedida.
 *
 * NÃO HÁ SEGREDO AQUI. O fluxo é Authorization Code + PKCE com cliente público: não existe
 * `client_secret` neste produto, e estes três valores aparecem na barra de endereço de qualquer
 * usuário que faça login. O `.env` continua vencendo — isto é piso, não teto.
 */
const PADRAO_URLS = "https://192.168.3.197:8443,https://100.106.236.106:8443,https://cmcrm-dev-01.tail7af88b.ts.net:8443";
const PADRAO_REALM = "cloudmountain";
const PADRAO_CLIENT_ID = "presales-web";

function rotaDoKeycloak(): string {
  const rotas = ((import.meta.env.VITE_KEYCLOAK_URLS as string | undefined) || PADRAO_URLS)
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
  return rotas.find(casa) ?? rotas[0]!;
}

export const userManager = new UserManager({
  authority: `${rotaDoKeycloak()}/realms/${import.meta.env.VITE_KEYCLOAK_REALM || PADRAO_REALM}`,
  client_id: import.meta.env.VITE_KEYCLOAK_CLIENT_ID || PADRAO_CLIENT_ID,
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
