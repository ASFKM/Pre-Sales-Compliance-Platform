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
    /*
     * A moldura desta tela é a MESMA do tema `cloudmountain` do Keycloak, para onde ela leva.
     * Ela não coleta credencial nenhuma — quem pergunta usuário e senha é o Keycloak, desde a
     * Fase 13 —, mas ela APARECE: enquanto o redirecionamento não acontece, e principalmente
     * quando ele falha (Keycloak fora do ar, certificado desconhecido, rede caindo no meio).
     * Até a F14b era um fundo chapado, sem nada em volta, enquanto a tela seguinte tem vídeo,
     * véu e rodapé de marca — quem batia numa falha via a tela de outro produto.
     */
    <div
      className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden bg-cover bg-center p-4"
      style={{ backgroundImage: "url(/hero-poster.webp)" }}
    >
      {/* `aria-hidden` porque é decoração; `muted` + arquivo sem trilha de áudio é o que libera
          o autoplay sem interação; `playsInline` impede o iOS de abrir em tela cheia. Mesmos
          atributos, pelos mesmos motivos, que `cloudmountain-fundo.js` usa no tema. */}
      {/*
        O poster tambem entra como FUNDO do contentor, e nao so como atributo do <video>.
        Medido: quando o navegador nao consegue decodificar o arquivo, o elemento vai para
        MEDIA_ERR_SRC_NOT_SUPPORTED e para de desenhar o proprio poster — a tela fica BRANCA, sem
        erro visivel. Foi assim que esta tela apareceu vazia numa captura, com o arquivo integro
        (md5 conferido), servido com `video/mp4` e com Range (206) funcionando.
        Com o quadro no fundo, o pior caso vira a imagem parada em vez de nada, que e exatamente o
        que `prefers-reduced-motion` ja entrega de proposito.
      */}
      <video
        aria-hidden="true"
        autoPlay
        muted
        loop
        playsInline
        poster="/hero-poster.webp"
        /*
         * `src` DIRETO no <video>, e nao um <source> filho.
         *
         * Medido: com `<source>`, o React monta o <video> primeiro e anexa o filho depois — a
         * essa altura o navegador ja rodou o algoritmo de selecao de recurso e desistiu.
         * Resultado: `networkState === 3` (NETWORK_NO_SOURCE), `readyState === 0`, o arquivo
         * nunca chega a ser pedido na rede, e a tela fica branca sem nenhum erro. O poster
         * carrega (200) e mesmo assim nao pinta, porque o elemento esta em estado de "sem fonte".
         *
         * O tema do Keycloak nao tem esse problema porque monta o <video> por JS, com
         * appendChild — o filho ja esta la quando o elemento entra no documento.
         */
        src="/hero-loop.mp4"
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div aria-hidden="true" className="absolute inset-0 bg-white/45" />
      {/* Cartao, e nao conteudo solto sobre a montanha: e o que faz esta tela se parecer com a
          do Keycloak para onde ela leva. A logo passa a ser a versao de fundo CLARO, porque o
          veu agora e claro — a de fundo escuro sumia dentro do cartao. */}
      <div className="relative z-10 flex w-full max-w-[380px] flex-col items-center gap-5 rounded-lg border border-slate-200 bg-white/95 p-8 shadow-lg">
        <img src="/brand/logo-on-light.svg" alt="PreSales" className="h-12" />
      {erro ? (
        <div className="w-full space-y-4 text-center">
          <div className="text-xs rounded-lg p-3 bg-danger-50 border border-danger-200 text-danger-700">{erro}</div>
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
        <div className="flex flex-col items-center">
          <div className="w-10 h-10 border-4 border-brand-500 border-t-transparent rounded-full animate-spin mb-4" />
          <p className="text-slate-600 font-mono text-xs">{mensagem}</p>
        </div>
      )}
      </div>

      {/* Rodapé de marca, na mesma anatomia do tema do Keycloak: rótulo minúsculo em versalete
          sobre a marca da casa, num scrim escuro. O "Licensed to" NÃO entra aqui — ele depende
          de uma consulta ao CMSaaS, e esta tela pode estar justamente no meio de uma falha de
          rede. */}
      <div className="pointer-events-none absolute bottom-5 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-1 rounded-[14px] border border-white/10 bg-[rgba(10,18,32,0.42)] px-[1.15rem] py-[0.6rem] backdrop-blur-[10px]">
        <span className="font-mono text-[9px] uppercase leading-none tracking-[0.12em] text-white/80">Powered by</span>
        <img src="/logo-cloudmountain.png" alt="CloudMountain" className="block h-8 w-auto opacity-85" />
      </div>
    </div>
  );
}
