// Captura as imagens dos manuais (docs/manuais/screenshots/), pilotando a interface de verdade.
//
// Por que existe: o `README.md` da pasta diz que os prints têm de sair de "Playwright pilotando a UI
// de verdade, num tenant descartável dedicado a isso" — e até 25/08/2026 as 31 imagens tinham sido
// feitas à mão, o que as deixou mostrando o produto verde depois das nove fases de identidade visual.
//
// Tenant: `manual_demo_tenant`, com conta dedicada (`.env.manual.local`, fora do git). A cor gravada
// nele é a da marca e a rampa derivada dela é IDÊNTICA à oficial (Δ 0 por canal nos 11 degraus),
// então a interface capturada é a padrão do produto — não a de um cliente co-marcado.
//
// Diferença deliberada em relação a `capture-ui.ts`: aqui o recorte segue o MANUAL, não o baseline.
// Algumas imagens são a mesma seção em rolagens diferentes (o Admin Console é longo), e três são
// modais.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { chromium } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
import { DEFAULT_BASE_URL, contextOptionsFor, login, settle, stabilize, VIEWPORTS } from "./uiScreens";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DESTINO_PADRAO = path.join(ROOT, "docs/manuais/screenshots");

interface Tela {
  arquivo: string;
  o_que: string;
  abrir(page: Page): Promise<void>;
}

/** Clica numa aba da barra superior. Escopado ao <nav>: fora dele os mesmos rótulos reaparecem. */
async function aba(page: Page, nome: string): Promise<void> {
  await page.locator("nav").first().getByRole("button", { name: nome, exact: true }).first().click();
  await settle(page);
}

/**
 * Clica numa sub-aba. Duas tolerâncias que a primeira execução exigiu:
 *  - sem âncora quando a ancorada não casa: o rótulo do Explorador de Arquivos começa com um emoji
 *    ("📁"), então `^Explorador` não encontra o nome acessível dele;
 *  - sempre sem diferenciar maiúsculas: as sub-abas da Base de Conhecimento aparecem em caixa alta
 *    por CSS (`uppercase`), mas o texto do DOM continua "Upload de Arquivos (2)".
 */
async function subAba(page: Page, prefixo: string): Promise<void> {
  const ancorado = page.getByRole("button", { name: new RegExp("^" + prefixo, "i") }).first();
  const alvo = (await ancorado.count()) > 0 ? ancorado : page.getByRole("button", { name: new RegExp(prefixo, "i") }).first();
  await alvo.click();
  await settle(page);
}

async function secaoAdmin(page: Page, rotulo: string): Promise<void> {
  await aba(page, "Configurações");
  await page.getByRole("button", { name: new RegExp("^" + rotulo, "i") }).first().click();
  await settle(page);
}

/** Rola até o texto âncora — várias imagens do manual são a mesma seção mais abaixo. */
async function rolarAte(page: Page, texto: string | RegExp): Promise<void> {
  const alvo = page.getByText(texto).first();
  await alvo.scrollIntoViewIfNeeded({ timeout: 15000 }).catch(() => undefined);
  await page.waitForTimeout(400);
}

/**
 * Fecha qualquer modal aberto antes da próxima tela. Três das imagens do manual SÃO modais, e o
 * overlay `fixed inset-0` de um modal aberto intercepta o clique da tela seguinte — o erro aparece
 * na navegação, apontando para o elemento errado (a mesma armadilha que a Fase 7 registrou:
 * `Escape` não fecha os modais deste produto).
 *
 * Recarregar a página entre telas resolveria e é o que NÃO se pode fazer: 31 cargas frias passam
 * do teto de 1.000 requisições por IP a cada 15 minutos do limitador.
 */
async function fecharModais(page: Page): Promise<void> {
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const overlay = page.locator("div.fixed.inset-0").first();
    if (!(await overlay.isVisible().catch(() => false))) return;
    const rotulado = overlay.getByRole("button", { name: /^(Cancelar|Fechar)$/i }).first();
    const alvo = (await rotulado.count()) > 0 ? rotulado : overlay.locator("button").first();
    await alvo.click({ timeout: 5000 }).catch(() => undefined);
    await settle(page, 300);
  }
}

/** Abre o projeto do tenant de demonstração que tem análise concluída. */
async function abrirProjeto(page: Page, nome: string): Promise<void> {
  await aba(page, "Projetos");
  const linha = page.locator("tr", { hasText: nome }).first();
  await linha.getByTitle("Abrir na Área de Trabalho").click();
  await settle(page);
}

const PROJETO_COM_ANALISE = "Sistema de Telemedicina";

const TELAS: Tela[] = [
  // ---------- Manual do usuário -------------------------------------------------------------
  { arquivo: "03-home", o_que: "Página Inicial", async abrir(p) { await aba(p, "Início"); } },
  { arquivo: "04-projetos", o_que: "Lista de projetos", async abrir(p) { await aba(p, "Projetos"); } },
  {
    arquivo: "05-novo-projeto-passo1",
    o_que: "Nova proposta — enviar documentos (modal sobre a Página Inicial)",
    async abrir(p) {
      await aba(p, "Início");
      await p.getByRole("button", { name: /Adicionar Nova/i }).first().click();
      await settle(p, 700);
    },
  },
  {
    arquivo: "07-novo-projeto-manual",
    o_que: "Nova proposta — cadastro manual",
    async abrir(p) {
      await aba(p, "Início");
      await p.getByRole("button", { name: /Adicionar Nova/i }).first().click();
      await settle(p, 500);
      await p.getByRole("button", { name: /criar manualmente/i }).first().click();
      await settle(p, 700);
    },
  },
  {
    arquivo: "08-workspace-resumo",
    o_que: "Área de Trabalho — Resumo Executivo de Conformidade",
    async abrir(p) { await abrirProjeto(p, PROJETO_COM_ANALISE); await subAba(p, "Resumo Executivo de Conformidade"); },
  },
  {
    arquivo: "09-workspace-requisitos",
    o_que: "Área de Trabalho — Matriz de Requisitos",
    async abrir(p) { await abrirProjeto(p, PROJETO_COM_ANALISE); await subAba(p, "Matriz de Requisitos"); },
  },
  {
    arquivo: "10-workspace-riscos",
    o_que: "Área de Trabalho — Riscos e Oportunidades",
    async abrir(p) { await abrirProjeto(p, PROJETO_COM_ANALISE); await subAba(p, "Riscos e Oportunidades"); },
  },
  {
    arquivo: "11-workspace-bom",
    o_que: "Área de Trabalho — BOM & Conformidade",
    async abrir(p) { await abrirProjeto(p, PROJETO_COM_ANALISE); await subAba(p, "Mecanismo de BOM"); },
  },
  {
    arquivo: "12-workspace-propostas",
    o_que: "Área de Trabalho — Estúdio de Geração de Propostas",
    async abrir(p) { await abrirProjeto(p, PROJETO_COM_ANALISE); await subAba(p, "Estúdio de Geração"); },
  },
  {
    arquivo: "13-workspace-arquivos",
    o_que: "Área de Trabalho — Explorador de Arquivos",
    async abrir(p) { await abrirProjeto(p, PROJETO_COM_ANALISE); await subAba(p, "Explorador"); },
  },
  {
    arquivo: "14-copiloto",
    o_que: "Copiloto de Especificações (modal sobre o Explorador)",
    // Precisa do projeto COM análise: o painel direito que hospeda o gatilho do copiloto só
    // renderiza quando há avaliação de conformidade — num projeto sem análise o botão não existe.
    async abrir(p) {
      await abrirProjeto(p, PROJETO_COM_ANALISE);
      await subAba(p, "Explorador");
      await p.getByRole("button", { name: /Copiloto de Especificações/i }).first().click();
      await settle(p, 700);
    },
  },
  { arquivo: "15-propostas", o_que: "Estúdio de Propostas", async abrir(p) { await aba(p, "Estúdio de Propostas"); } },
  { arquivo: "16-aprovacao", o_que: "Centro de Aprovação", async abrir(p) { await aba(p, "Centro de Aprovação"); } },
  {
    arquivo: "17-kb-upload",
    o_que: "Base de Conhecimento — Upload de Arquivos",
    async abrir(p) { await aba(p, "Base de Conhecimento"); await subAba(p, "UPLOAD DE ARQUIVOS"); },
  },
  {
    arquivo: "18-kb-aprovacoes",
    o_que: "Base de Conhecimento — Aprovações",
    async abrir(p) { await aba(p, "Base de Conhecimento"); await subAba(p, "APROVAÇÕES"); },
  },
  {
    arquivo: "19-kb-base",
    o_que: "Base de Conhecimento — entradas consolidadas",
    async abrir(p) { await aba(p, "Base de Conhecimento"); await subAba(p, "BASE DE CONHECIMENTO"); },
  },

  // ---------- Manual de administração ---------------------------------------------------------
  { arquivo: "26-admin-visao-geral", o_que: "Configurações — Visão Geral", async abrir(p) { await secaoAdmin(p, "Visão Geral"); } },
  {
    arquivo: "27-admin-perfis",
    o_que: "Configurações — Perfis (topo de Usuários e Acessos)",
    async abrir(p) { await secaoAdmin(p, "Usuários e Acessos"); },
  },
  {
    arquivo: "28-admin-usuarios",
    o_que: "Configurações — Diretório de Usuários (mesma seção, mais abaixo)",
    async abrir(p) { await secaoAdmin(p, "Usuários e Acessos"); await rolarAte(p, /Diretório de Acesso de Usuários/i); },
  },
  {
    arquivo: "29-admin-ia-provedores",
    o_que: "Configurações — Modelos e Provedores de IA",
    async abrir(p) { await secaoAdmin(p, "IA, Prompts e Custos"); },
  },
  {
    arquivo: "30-admin-ia-prompts",
    o_que: "Configurações — Templates de Prompt (mesma seção, mais abaixo)",
    async abrir(p) { await secaoAdmin(p, "IA, Prompts e Custos"); await rolarAte(p, /Templates de Prompt/i); },
  },
  { arquivo: "31-admin-templates", o_que: "Configurações — Templates de Propostas", async abrir(p) { await secaoAdmin(p, "Templates de Propostas"); } },
  { arquivo: "32-admin-fluxo-aprovacao", o_que: "Configurações — Fluxo de Aprovação", async abrir(p) { await secaoAdmin(p, "Fluxo de Aprovação"); } },
  { arquivo: "33-admin-licenca", o_que: "Configurações — Subscrição e Licença", async abrir(p) { await secaoAdmin(p, "Subscrição e Licença"); } },
  {
    arquivo: "sistema-atualizacao",
    o_que: "Configurações — Atualizações do Sistema (exige a permissão admin:system_updates, que o papel do tenant de demonstração NÃO tem — é por isso que esta imagem, citada no manual, nunca existiu)",
    async abrir(p) { await secaoAdmin(p, "Atualizações do Sistema"); },
  },
  { arquivo: "34-admin-branding", o_que: "Configurações — Identidade Visual", async abrir(p) { await secaoAdmin(p, "Identidade Visual"); } },
  { arquivo: "35-admin-integracoes", o_que: "Configurações — Integrações e APIs", async abrir(p) { await secaoAdmin(p, "Integrações e APIs"); } },
  { arquivo: "36-admin-armazenamento", o_que: "Configurações — Armazenamento", async abrir(p) { await secaoAdmin(p, "Armazenamento"); } },
  { arquivo: "37-admin-auditoria", o_que: "Configurações — Auditoria e Diagnóstico", async abrir(p) { await secaoAdmin(p, "Auditoria e Diagnóstico"); } },
  {
    arquivo: "38-admin-diagnostico",
    o_que: "Configurações — Diagnóstico Técnico (mesma seção, mais abaixo)",
    async abrir(p) { await secaoAdmin(p, "Auditoria e Diagnóstico"); await rolarAte(p, /Diagnóstico Técnico/i); },
  },
];

async function main(): Promise<void> {
  dotenv.config({ path: path.join(ROOT, ".env.manual.local"), quiet: true });
  const baseUrl = process.env.CAPTURE_BASE_URL || DEFAULT_BASE_URL;
  const email = process.env.MANUAL_CAPTURE_EMAIL;
  const password = process.env.MANUAL_CAPTURE_PASSWORD;
  if (!email || !password) throw new Error("MANUAL_CAPTURE_EMAIL/PASSWORD ausentes em .env.manual.local");

  const argOut = process.argv.indexOf("--out");
  const destino = argOut >= 0 ? path.resolve(process.argv[argOut + 1]) : DESTINO_PADRAO;
  const argSo = process.argv.indexOf("--only");
  const somente = argSo >= 0 ? process.argv[argSo + 1].split(",") : null;
  fs.mkdirSync(destino, { recursive: true });

  const viewport = VIEWPORTS[0]; // os manuais são 1440x900, como as imagens que já existiam
  const browser: Browser = await chromium.launch();
  const falhas: string[] = [];
  try {
    // 01-login: antes de autenticar, em contexto próprio
    if (!somente || somente.includes("01-login")) {
      const ctx = await browser.newContext(contextOptionsFor(viewport));
      const p = await ctx.newPage();
      p.setDefaultTimeout(20000);
      await p.goto(baseUrl + "/", { waitUntil: "domcontentloaded" });
      await p.locator("#login-card").waitFor({ state: "visible", timeout: 30000 });
      await settle(p);
      await stabilize(p);
      await p.screenshot({ path: path.join(destino, "01-login.png") });
      console.log("  01-login");
      await ctx.close();
    }

    const ctx = await browser.newContext(contextOptionsFor(viewport));
    const page = await ctx.newPage();
    // Sem isto, um seletor que não aparece PENDURA o script para sempre: fora de `@playwright/test`
    // não existe `actionTimeout`, e o default de espera de uma ação é "sem limite". A primeira
    // execução desta captura travou exatamente assim, calada, depois de 11 imagens.
    page.setDefaultTimeout(20000);
    await login(page, { baseUrl, email, password });
    await stabilize(page);

    for (const tela of TELAS) {
      if (somente && !somente.includes(tela.arquivo)) continue;
      try {
        await fecharModais(page);
        await tela.abrir(page);
        await stabilize(page);
        await page.screenshot({ path: path.join(destino, `${tela.arquivo}.png`) });
        console.log(`  ${tela.arquivo.padEnd(28)} ${tela.o_que}`);
      } catch (erro) {
        falhas.push(`${tela.arquivo}: ${(erro as Error).message.split("\n")[0]}`);
        console.log(`  ${tela.arquivo.padEnd(28)} FALHOU`);
        // Volta a um estado conhecido: um modal aberto intercepta o clique seguinte, e o erro
        // apareceria na tela errada (lição da Fase 7 — `Escape` não fecha os modais do produto).
        await page.goto(baseUrl + "/", { waitUntil: "domcontentloaded" }).catch(() => undefined);
        await settle(page).catch(() => undefined);
      }
    }
    await ctx.close();
  } finally {
    await browser.close();
  }

  console.log(`\ndestino: ${destino}`);
  if (falhas.length) {
    console.log(`\n${falhas.length} tela(s) não capturada(s):`);
    for (const f of falhas) console.log("  - " + f);
    process.exitCode = 1;
  }
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
