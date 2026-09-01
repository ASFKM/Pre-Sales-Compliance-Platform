import React, { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, CircleAlert, Key, Lock, Mail, ShieldAlert } from "lucide-react";
import ApiClient from "../lib/api";
import RequisitosDeSenha, { usePoliticaDeSenha } from "./RequisitosDeSenha";
import { requisitosDaPolitica } from "../../server/utils/politicaDeSenha";

interface LoginProps {
  locale: "pt";
  onLoginSuccess: (user: any, token: string) => void;
}

/**
 * F1 (31/08/2026) — a tela volta a pedir e-mail e senha.
 *
 * Decisão do dono: sai o Keycloak compartilhado, e cada produto volta a gerenciar os próprios
 * usuários. Os três passos que a Fase 13 tinha empurrado para o realm estão de volta aqui, na
 * mesma ordem de antes: credenciais, segundo fator (só para quem tem `mfa_enabled`) e troca
 * obrigatória de senha (conta nova, ou senha redefinida por um administrador).
 *
 * O que NÃO voltou é a aparência antiga. A moldura desta tela — vídeo, véu claro, cartão branco
 * e rodapé de marca — é a que a F14/F14b padronizou entre os três produtos, e ela fica. A Fase 13
 * esvaziou o cartão; esta fase o preenche de novo, sem mexer na casca.
 *
 * F3 (01/09/2026) — O NÚMERO COPIADO SAIU. A política de senha (comprimento, classes de
 * caractere, histórico e validade) é editável por tenant em Administração › Usuários, e chega
 * aqui por `GET /api/auth/password-policy` — com o token pendente, para o servidor resolver de
 * qual instalação é a política, em vez de a tela escolher.
 *
 * A lista de requisitos acende enquanto a pessoa digita. Continua valendo que quem decide é a
 * rota: a tela avisa antes de gastar uma ida à rede.
 *
 * F6 (01/09/2026) — O "LICENSED TO" VOLTOU AO RODAPÉ. Decisão do dono: a tela de entrada volta a
 * dizer de quem é esta instalação. O que impedia isso era a suposição de que a marca do cliente
 * exigia perguntar ao CMSaaS — e ela caiu: o heartbeat já guarda a licença assinada no Redis
 * local, e "GET /api/auth/brand" lê só esse cache. Zero rede no login, mesma origem, sem sessão.
 */

interface MarcaDaInstalacao {
  licenciado_para: string | null;
  logo_base64: string | null;
}

const MARCA_AUSENTE: MarcaDaInstalacao = { licenciado_para: null, logo_base64: null };

/**
 * A marca desta instalação, vinda de "GET /api/auth/brand" — rota pública, mesma origem, servida
 * do cache local que o heartbeat alimenta (nenhuma ida ao CMSaaS acontece aqui).
 *
 * Nasce AUSENTE e só troca de estado se a resposta trouxer um nome. Não existe estado
 * "carregando", de propósito: enquanto a consulta não volta — ou se ela nunca voltar, porque o
 * servidor é mais antigo que esta rota, porque a rede caiu, porque o JSON veio quebrado — a tela
 * renderiza exatamente como renderizava antes desta fase. Um esqueleto ou um espaço reservado na
 * porta de entrada seria pior do que a marca simplesmente aparecer quando chegar.
 */
function useMarcaDaInstalacao(): MarcaDaInstalacao {
  const [marca, setMarca] = useState<MarcaDaInstalacao>(MARCA_AUSENTE);

  useEffect(() => {
    let ativo = true;
    fetch("/api/auth/brand")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const nome = typeof data?.licenciado_para === "string" ? data.licenciado_para.trim() : "";
        if (!ativo || !nome) return;
        // O logo entra direto no src de uma <img>: só data: URI de imagem, que é o que a CSP
        // desta instalação aceita. O servidor já filtra; a tela não confia por confiar.
        const logo =
          typeof data?.logo_base64 === "string" && data.logo_base64.startsWith("data:image/")
            ? data.logo_base64
            : null;
        setMarca({ licenciado_para: nome, logo_base64: logo });
      })
      .catch(() => undefined);
    return () => {
      ativo = false;
    };
  }, []);

  return marca;
}

export default function Login({ onLoginSuccess }: LoginProps) {
  const ehAmbienteDeDemonstracao = import.meta.env.VITE_APP_RUNTIME_MODE !== "production";

  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [codigoMfa, setCodigoMfa] = useState("");
  const [mfaObrigatorio, setMfaObrigatorio] = useState(false);
  const [tokenPendente, setTokenPendente] = useState("");
  const [usuarioPendente, setUsuarioPendente] = useState<any>(null);
  const [trocaDeSenhaObrigatoria, setTrocaDeSenhaObrigatoria] = useState(false);
  const [senhaAtual, setSenhaAtual] = useState("");
  const [novaSenha, setNovaSenha] = useState("");
  const [confirmacaoDaNovaSenha, setConfirmacaoDaNovaSenha] = useState("");
  // Enquanto não há token pendente (primeira tela), o servidor devolve o padrão de fábrica; assim
  // que o login identifica a pessoa, a política vem a do tenant dela.
  const politicaDeSenha = usePoliticaDeSenha(tokenPendente || undefined);
  const marcaDaInstalacao = useMarcaDaInstalacao();
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(false);

  const CREDENCIAL_INVALIDA = "E-mail ou senha inválidos.";

  const entrarComSenha = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro("");
    setCarregando(true);

    try {
      const res: any = await ApiClient.post("/api/auth/login", {
        email: email.trim(),
        password: senha,
      });

      if (res.success) {
        if (res.mfa_required) {
          setTokenPendente(res.token);
          setMfaObrigatorio(true);
        } else if (res.must_change_password) {
          setTokenPendente(res.token);
          setUsuarioPendente(res.user);
          setTrocaDeSenhaObrigatoria(true);
        } else {
          onLoginSuccess(res.user, res.token);
        }
      } else {
        setErro(CREDENCIAL_INVALIDA);
      }
    } catch (err: any) {
      setErro(err.message || CREDENCIAL_INVALIDA);
    } finally {
      setCarregando(false);
    }
  };

  const verificarMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro("");
    setCarregando(true);

    try {
      const res: any = await ApiClient.post("/api/auth/mfa/verify", {
        token: tokenPendente,
        code: codigoMfa.trim(),
      });

      if (res.success && res.verified) {
        if (res.must_change_password) {
          setUsuarioPendente(res.user);
          setTrocaDeSenhaObrigatoria(true);
        } else {
          onLoginSuccess(res.user, tokenPendente);
        }
      } else {
        setErro("Código de verificação MFA inválido.");
      }
    } catch (err: any) {
      setErro(err.message || "Código de verificação MFA inválido.");
    } finally {
      setCarregando(false);
    }
  };

  const trocarSenha = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro("");

    const pendentes = requisitosDaPolitica(novaSenha, politicaDeSenha).filter((r) => !r.atendido);
    if (pendentes.length > 0) {
      setErro(`A senha não cumpre a política: ${pendentes.map((r) => r.texto).join("; ")}.`);
      return;
    }
    if (novaSenha !== confirmacaoDaNovaSenha) {
      setErro("A nova senha e a confirmação não conferem.");
      return;
    }

    setCarregando(true);
    try {
      const res: any = await ApiClient.post("/api/auth/change-password", {
        token: tokenPendente,
        current_password: senhaAtual,
        new_password: novaSenha,
      });

      if (res.success) {
        onLoginSuccess(usuarioPendente, tokenPendente);
      } else {
        setErro(res.message || CREDENCIAL_INVALIDA);
      }
    } catch (err: any) {
      setErro(err.message || CREDENCIAL_INVALIDA);
    } finally {
      setCarregando(false);
    }
  };

  const classeDoCampo =
    "w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-brand-500 transition-colors";
  const classeDoRotulo =
    "block text-[11px] font-mono text-slate-500 uppercase tracking-wider mb-1.5";
  const classeDoBotao =
    "w-full py-2.5 bg-brand-600 hover:bg-brand-500 text-white rounded-lg text-sm font-semibold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 cursor-pointer";

  const avisoDeErro = erro ? (
    <div className="bg-danger-50 border border-danger-200 text-danger-700 p-3 rounded-lg flex items-center gap-2 text-xs">
      <CircleAlert className="w-4 h-4 shrink-0" />
      <span>{erro}</span>
    </div>
  ) : null;

  return (
    <div
      id="login-screen-wrapper"
      className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden bg-cover bg-center p-4"
      style={{ backgroundImage: "url(/hero-poster.webp)" }}
    >
      {/* `aria-hidden` porque é decoração; `muted` + arquivo sem trilha de áudio é o que libera
          o autoplay sem interação; `playsInline` impede o iOS de abrir em tela cheia. */}
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
         */
        src="/hero-loop.mp4"
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div aria-hidden="true" className="absolute inset-0 bg-white/45" />

      {/* Cartao, e nao conteudo solto sobre a montanha: e a anatomia que a F14b padronizou entre
          os tres produtos. A logo e a versao de fundo CLARO, porque o veu e claro — a de fundo
          escuro sumia dentro do cartao. */}
      <div
        id="login-card"
        className="relative z-10 flex w-full max-w-[380px] flex-col items-center gap-5 rounded-lg border border-slate-200 bg-white/95 p-8 shadow-lg"
      >
        <img src="/brand/logo-on-light.svg" alt="PreSales" className="h-12" />

        <AnimatePresence mode="wait">
          {trocaDeSenhaObrigatoria ? (
            <motion.form
              key="password-change-form"
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              onSubmit={trocarSenha}
              className="w-full space-y-4"
            >
              <div className="text-center">
                <div className="mx-auto w-10 h-10 bg-warning-50 border border-warning-200 rounded-xl flex items-center justify-center mb-3 text-warning-600">
                  <ShieldAlert className="w-5 h-5" />
                </div>
                <h3 className="text-sm font-semibold text-slate-900">Troca de Senha Obrigatória</h3>
                <p className="text-[11px] text-slate-500 max-w-xs mx-auto leading-normal mt-1">
                  Esta é uma conta nova ou sua senha foi redefinida - defina uma nova senha para continuar.
                </p>
              </div>

              {avisoDeErro}

              <div>
                <label className={classeDoRotulo}>Senha Atual</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                  <input
                    type="password"
                    required
                    value={senhaAtual}
                    onChange={(e) => setSenhaAtual(e.target.value)}
                    className={classeDoCampo}
                    placeholder="••••••••"
                  />
                </div>
              </div>

              <div>
                <label className={classeDoRotulo}>Nova Senha</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                  <input
                    type="password"
                    required
                    minLength={politicaDeSenha.comprimento_minimo}
                    value={novaSenha}
                    onChange={(e) => setNovaSenha(e.target.value)}
                    className={classeDoCampo}
                    placeholder="••••••••"
                    aria-describedby="requisitos-da-senha"
                  />
                </div>
                <div id="requisitos-da-senha">
                  <RequisitosDeSenha senha={novaSenha} politica={politicaDeSenha} />
                </div>
              </div>

              <div>
                <label className={classeDoRotulo}>Confirmar Nova Senha</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                  <input
                    type="password"
                    required
                    minLength={politicaDeSenha.comprimento_minimo}
                    value={confirmacaoDaNovaSenha}
                    onChange={(e) => setConfirmacaoDaNovaSenha(e.target.value)}
                    className={classeDoCampo}
                    placeholder="••••••••"
                  />
                </div>
              </div>

              <button type="submit" disabled={carregando} className={classeDoBotao}>
                {carregando ? "Salvando..." : "Definir Nova Senha"}
                <ArrowRight className="w-4 h-4" />
              </button>
            </motion.form>
          ) : !mfaObrigatorio ? (
            <motion.form
              key="credentials-form"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              onSubmit={entrarComSenha}
              className="w-full space-y-4"
            >
              <p className="text-xs text-slate-500 text-center leading-relaxed">
                Plataforma de Engenharia de Pré-Vendas e Propostas
              </p>

              {avisoDeErro}

              <div>
                <label className={classeDoRotulo}>E-mail Corporativo</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        e.currentTarget.form?.requestSubmit();
                      }
                    }}
                    className={classeDoCampo}
                    placeholder="voce@empresa.com"
                  />
                </div>
              </div>

              <div>
                <label className={classeDoRotulo}>Senha</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                  <input
                    type="password"
                    required
                    value={senha}
                    onChange={(e) => setSenha(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        e.currentTarget.form?.requestSubmit();
                      }
                    }}
                    className={classeDoCampo}
                    placeholder="••••••••"
                  />
                </div>
              </div>

              <button type="submit" disabled={carregando} className={classeDoBotao}>
                {carregando ? "Autenticando..." : "Entrar"}
                <ArrowRight className="w-4 h-4" />
              </button>
            </motion.form>
          ) : (
            <motion.form
              key="mfa-form"
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              onSubmit={verificarMfa}
              className="w-full space-y-4"
            >
              <div className="text-center">
                <div className="mx-auto w-10 h-10 bg-brand-50 border border-brand-200 rounded-xl flex items-center justify-center mb-3 text-brand-600">
                  <Key className="w-5 h-5" />
                </div>
                <h3 className="text-sm font-semibold text-slate-900">Autenticação de Dois Fatores</h3>
                <p className="text-[11px] text-slate-500 max-w-xs mx-auto leading-normal mt-1">
                  Digite o código de 6 dígitos do seu aplicativo autenticador
                </p>
              </div>

              {avisoDeErro}

              <div>
                <label className={`${classeDoRotulo} text-center`}>Código de Verificação MFA</label>
                <input
                  type="text"
                  required
                  maxLength={6}
                  value={codigoMfa}
                  onChange={(e) => setCodigoMfa(e.target.value)}
                  className="w-full text-center tracking-[0.5em] font-mono text-lg py-2.5 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-brand-500 transition-colors"
                  placeholder={ehAmbienteDeDemonstracao ? "ex: 123456" : "Código de verificação"}
                />
              </div>

              <button type="submit" disabled={carregando} className={classeDoBotao}>
                {carregando ? "Verificando..." : "Verificar e Autenticar"}
                <ArrowRight className="w-4 h-4" />
              </button>

              {ehAmbienteDeDemonstracao && (
                <div className="text-center text-[10px] text-slate-400 pt-2 font-mono leading-normal">
                  Código MFA válido: 123456, 000000 ou 111111
                </div>
              )}
            </motion.form>
          )}
        </AnimatePresence>
      </div>

      {/* Rodapé de marca, na anatomia que a F14 definiu: rótulo minúsculo em versalete sobre a
          marca correspondente, num scrim escuro.

          F6 (01/09/2026) — O "LICENSED TO" ENTROU AQUI. O comentário que este substitui dizia que
          ele NÃO entrava, porque dependia de uma consulta ao CMSaaS e esta tela precisa aparecer
          inteira mesmo sem rede. A segunda metade continua valendo integralmente; a primeira
          deixou de valer: o dado não vem mais do CMSaaS na hora do login. O heartbeat guarda a
          licença assinada no Redis local, e "GET /api/auth/brand" lê SOMENTE esse cache — mesma
          origem, sem sessão, sem sair da máquina.

          O bloco do cliente só existe quando há marca. Instalação nova, cache vazio, Redis fora do
          ar ou tenants licenciados que discordam de quem é o cliente: a consulta devolve nome
          nulo, nada disto é renderizado, e o rodapé fica EXATAMENTE como era — nenhum espaço
          reservado, nenhuma linha divisória órfã, nenhuma espera. A tela nunca depende desta
          consulta para montar. */}
      <div className="pointer-events-none absolute bottom-5 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-1 rounded-[14px] border border-white/10 bg-[rgba(10,18,32,0.42)] px-[1.15rem] py-[0.6rem] backdrop-blur-[10px]">
        {marcaDaInstalacao.licenciado_para && (
          <>
            <span className="font-mono text-[9px] uppercase leading-none tracking-[0.12em] text-white/60">Licensed to</span>
            <div className="flex items-center gap-2">
              {marcaDaInstalacao.logo_base64 && (
                <img
                  src={marcaDaInstalacao.logo_base64}
                  alt=""
                  className="block h-5 w-auto max-w-[6rem] object-contain opacity-90"
                />
              )}
              <span className="text-[11px] font-semibold leading-none text-white/90">{marcaDaInstalacao.licenciado_para}</span>
            </div>
            <div className="my-1 h-px w-full bg-white/10" aria-hidden="true" />
          </>
        )}
        <span className="font-mono text-[9px] uppercase leading-none tracking-[0.12em] text-white/80">Powered by</span>
        <img src="/logo-cloudmountain.png" alt="CloudMountain" className="block h-8 w-auto opacity-85" />
      </div>
    </div>
  );
}
