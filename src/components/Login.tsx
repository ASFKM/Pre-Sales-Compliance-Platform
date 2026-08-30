import { useEffect, useState } from "react";
import { userManager, entrar } from "../auth/oidc";

interface LoginProps {
  locale: "pt";
  onLoginSuccess: (user: any, token: string) => void;
}

/**
 * Fase 13 — a tela de entrada deixou de pedir e-mail e senha.
 *
 * Quem pergunta isso agora é o Keycloak, no realm `cloudmountain` compartilhado pelos três
 * produtos, com a tela da casa (mesmo vídeo de fundo, logo e paleta do PreSales). Sumiram daqui
 * os passos de segundo fator e de troca obrigatória de senha: os dois acontecem lá, antes de
 * este produto ver qualquer token.
 *
 * Este componente faz as DUAS pontas do fluxo, e é por isso que ele não virou duas telas: a
 * aplicação não usa roteador de cliente para a entrada (o `App.tsx` decide por estado local se
 * mostra o login ou o produto), então uma rota `/callback` dependeria de o servidor devolver o
 * index.html para um caminho que ele nunca serviu. Chegando com `?code=` na URL, ele conclui a
 * entrada; sem isso, manda a pessoa para o Keycloak.
 */
export default function Login({ onLoginSuccess }: LoginProps) {
  const [erro, setErro] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState("Levando você para a tela de entrada…");

  useEffect(() => {
    let cancelado = false;

    const params = new URLSearchParams(window.location.search);
    const voltandoDoKeycloak = params.has("code") && params.has("state");
    const erroDoKeycloak = params.get("error");

    if (erroDoKeycloak) {
      setErro(params.get("error_description") ?? erroDoKeycloak);
      limparUrl();
      return;
    }

    if (voltandoDoKeycloak) {
      setMensagem("Concluindo sua entrada…");
      userManager
        .signinRedirectCallback()
        .then(async (user) => {
          if (cancelado) return;
          /**
           * O token vai para `localStorage` sob a MESMA chave de sempre: o interceptor global de
           * `fetch` (App.tsx) e o `ApiClient` leem daí, e manter a chave é o que dispensou mexer
           * em todas as chamadas do produto.
           */
          localStorage.setItem("ca_session_token", user.access_token);
          limparUrl();

          /**
           * Quem responde se esta pessoa TEM acesso a este produto é o servidor: o realm é
           * compartilhado, então um token válido pode pertencer a alguém que só usa o CMCRM ou o
           * CMSaaS. Sem esta conferência, a pessoa entraria na casca do produto e só descobriria
           * ao ver todas as telas falharem.
           */
          const res = await fetch("/api/auth/me", {
            headers: { Authorization: `Bearer ${user.access_token}` },
          });
          const dados = await res.json().catch(() => null);
          if (!res.ok || !dados?.success) {
            localStorage.removeItem("ca_session_token");
            setErro("Sua conta não tem acesso a este produto.");
            return;
          }
          onLoginSuccess(dados.user, user.access_token);
        })
        .catch((e) => {
          if (cancelado) return;
          limparUrl();
          setErro(e?.message ?? "Não foi possível concluir a entrada.");
        });
      return;
    }

    entrar().catch((e) => {
      if (cancelado) return;
      setErro(e?.message ?? "Não foi possível abrir a tela de entrada.");
    });

    return () => {
      cancelado = true;
    };
  }, [onLoginSuccess]);

  /**
   * Tira o código de autorização da barra de endereço. Ele é de uso único e já foi gasto; deixá-lo
   * ali faz o botão "voltar" tentar usá-lo de novo e produzir um erro sem sentido para quem só
   * quis voltar uma página.
   */
  function limparUrl() {
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  return (
    <div className="min-h-screen bg-brand-950 flex flex-col items-center justify-center p-4">
      <img src="/brand/logo-on-dark.svg" alt="PreSales" className="h-12 mb-6" />
      {erro ? (
        <div className="w-full max-w-sm space-y-4 text-center">
          <div className="text-xs rounded-lg p-3 bg-danger-900/40 border border-danger-700 text-danger-200">{erro}</div>
          <button
            onClick={() => {
              setErro(null);
              setMensagem("Levando você para a tela de entrada…");
              entrar().catch((e) => setErro(e?.message ?? "Não foi possível abrir a tela de entrada."));
            }}
            className="w-full rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold py-2.5"
          >
            Entrar
          </button>
        </div>
      ) : (
        <>
          <div className="w-10 h-10 border-4 border-brand-500 border-t-transparent rounded-full animate-spin mb-4" />
          <p className="text-slate-400 font-mono text-xs">{mensagem}</p>
        </>
      )}
    </div>
  );
}
