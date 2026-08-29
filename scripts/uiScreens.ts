// Fonte de verdade das telas que compõem o baseline visual do produto.
//
// Existe por causa do programa de identidade visual (docs/roadmap/IDENTIDADE_VISUAL_2026-08.md):
// as fases 2 a 7 repaletizam ~2.900 classes de cor espalhadas por 22 componentes, e antes da
// Fase 0 este projeto não tinha NENHUMA ferramenta de captura visual - só `vitest`, e as 30+
// imagens dos manuais foram feitas à mão. Sem um baseline capturado com o visual atual não há
// como provar depois que só a cor mudou.
//
// Dois consumidores compartilham este módulo de propósito, para que capturar e comparar não
// possam divergir:
//   - `scripts/capture-ui.ts`  grava as imagens em docs/visual-baseline/ (`npm run capture:ui`)
//   - `tests/visual/screens.spec.ts` compara a tela viva contra essas mesmas imagens
//     (`npm run test:visual`)
//
// Nada aqui entra no bundle de produção: o build do servidor é `esbuild --packages=external` e o
// do cliente parte de `index.html`; `scripts/` e `tests/` ficam de fora dos dois.
import type { Browser, Page } from "@playwright/test";

export interface CaptureViewport {
  /** Entra no caminho do arquivo: docs/visual-baseline/<id>/<tela>.png */
  id: string;
  width: number;
  height: number;
  isMobile: boolean;
}

// Os dois pontos pedidos pelo programa: 1440px (desktop de trabalho, onde o produto é usado) e
// 390px (o telefone mais comum). A altura acompanha o aparelho real - a aplicação é `h-screen`
// com rolagem interna, então o recorte é sempre uma tela cheia, nunca a página inteira.
export const VIEWPORTS: CaptureViewport[] = [
  { id: "desktop-1440", width: 1440, height: 900, isMobile: false },
  { id: "mobile-390", width: 390, height: 844, isMobile: true },
];

export interface Screen {
  /** Nome do arquivo PNG, sem extensão. */
  id: string;
  /** O que a tela é, para o log e para quem for ler o diretório do baseline. */
  label: string;
  /** Se falso, a tela é capturada antes de autenticar. */
  authenticated: boolean;
  open(page: Page): Promise<void>;
}

export const DEFAULT_BASE_URL = "http://127.0.0.1:3000";

/**
 * Espera a tela assentar. `networkidle` sozinho não serve: a aplicação faz polling permanente
 * (/api/health de minuto em minuto, renovação silenciosa de token, progresso de tarefas em
 * segundo plano), então a espera é limitada no tempo e o fracasso dela não é erro.
 */
export async function settle(page: Page, extraMs = 500): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
  await page.evaluate(() => document.fonts.ready.then(() => undefined)).catch(() => undefined);
  await page.waitForTimeout(extraMs);
}

/**
 * Neutraliza o que muda entre duas execuções sem que nada tenha mudado no produto.
 *
 * O `animations: "disabled"` do próprio Playwright congela animação CSS e Web Animations, mas
 * não alcança o que o `motion` (usado no Login e nos formulários) anima via estilo inline, nem o
 * cursor piscando dentro de um campo focado. As regras abaixo cobrem esse resto. É aplicado
 * igualmente na captura e na comparação - por isso mora aqui, e não em um dos dois lados.
 */
export async function stabilize(page: Page): Promise<void> {
  // A mesma aba percorre todas as telas, então a folha só precisa entrar uma vez.
  const alreadyApplied = await page
    .evaluate(() => !!document.getElementById("captura-visual-estabilizacao"))
    .catch(() => false);
  if (alreadyApplied) return;

  await page.addStyleTag({
    content: `
      /* id: captura-visual-estabilizacao */
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
        caret-color: transparent !important;
      }
      html { scroll-behavior: auto !important; }
    `,
  });
  await page
    .evaluate(() => {
      const tag = document.head.querySelector("style:last-of-type");
      if (tag) tag.id = "captura-visual-estabilizacao";
    })
    .catch(() => undefined);
}

/**
 * Opções de contexto de cada largura. Vive aqui porque a captura e a comparação precisam abrir o
 * navegador exatamente igual - se divergirem, a comparação passa a medir a diferença entre os dois
 * scripts em vez da diferença entre duas versões do produto.
 */
export function contextOptionsFor(viewport: CaptureViewport) {
  return {
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: viewport.isMobile,
    hasTouch: viewport.isMobile,
    deviceScaleFactor: 1,
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    reducedMotion: "reduce" as const,
    colorScheme: "light" as const,
  };
}

/**
 * Traduz o sintoma quando o servidor recusa por limite de requisições.
 *
 * Sem isto a falha aparece como "esperando o <nav> ficar visível" e a captura mostra a tela de
 * login - ou seja, um problema de orçamento de requisições se disfarça de defeito de interface, e
 * custa meia hora de investigação até alguém ler o texto na imagem. São dois limitadores
 * diferentes em server/middleware/security.ts: 20 logins por IP a cada 15 minutos e 1.000
 * requisições de API por IP na mesma janela.
 */
async function assertNaoLimitado(page: Page): Promise<void> {
  const texto = await page.locator("body").innerText().catch(() => "");
  if (/Too many (requests|login attempts)/i.test(texto)) {
    throw new Error(
      "O servidor recusou por limite de requisições (server/middleware/security.ts): \"" +
        texto.split("\n").find((l) => /Too many/i.test(l))?.trim() +
        "\". Uma rodada completa consome perto do orçamento de 1.000 requisições por 15 minutos, " +
        "então capturar e comparar em seguida na mesma janela estoura. Espere a janela virar.",
    );
  }
}

/** Autentica pela tela real de login - o mesmo caminho que um usuário percorre. */
export async function login(
  page: Page,
  options: { baseUrl: string; email: string; password: string },
): Promise<void> {
  await page.goto(options.baseUrl + "/", { waitUntil: "domcontentloaded" });
  await page.locator("#login-card").waitFor({ state: "visible", timeout: 30000 });
  await page.locator('input[type="email"]').fill(options.email);
  await page.locator('input[type="password"]').fill(options.password);
  await page.getByRole("button", { name: "Entrar" }).click();

  // A conta usada para captura tem MFA desligado de propósito (o código muda a cada execução e
  // tornaria o baseline irreprodutível). Se algum dia ela cair no desafio de MFA, falhar aqui com
  // uma mensagem clara é melhor do que capturar 18 telas do formulário de MFA.
  const mfaPrompt = page.getByText("Autenticação de Dois Fatores");
  const shell = page.locator("nav").first();
  try {
    await Promise.race([
      shell.waitFor({ state: "visible", timeout: 45000 }),
      mfaPrompt.waitFor({ state: "visible", timeout: 45000 }),
    ]);
  } catch (erro) {
    await assertNaoLimitado(page);
    throw erro;
  }
  if (await mfaPrompt.isVisible().catch(() => false)) {
    throw new Error(
      "A conta de captura caiu no desafio de MFA. Ela precisa ter mfa_enabled = false: " +
        "um código que muda a cada execução impede um baseline reprodutível.",
    );
  }
  await settle(page);
}

/**
 * Caminho de autenticação usado pelas duas pontas: entra uma vez, guarda o estado da sessão
 * (token em localStorage + cookie de renovação) num arquivo e deixa cada tela nascer de uma
 * sessão nova a partir dele.
 *
 * Existe porque `/api/auth/login` tem limitador dedicado - 20 tentativas por IP a cada 15
 * minutos (server/middleware/security.ts). A primeira versão desta rede autenticava uma vez por
 * tela: 34 logins por execução, e a comparação parava no meio com "Too many login attempts". O
 * limitador está certo, quem estava errado era a rede.
 *
 * Pelo mesmo motivo a rede percorre todas as telas numa ABA SÓ por largura, em vez de abrir um
 * contexto novo por tela: cada carga fria da aplicação dispara dezenas de chamadas de API, e 36
 * cargas frias por rodada chegavam perto do teto de 1.000 requisições por IP a cada 15 minutos do
 * limitador geral - o suficiente para a rodada seguinte falhar inteira. Navegar entre abas custa
 * uma fração disso.
 */
export const AUTH_STATE_PATH = ".auth/capture-state.json";

export async function saveAuthState(
  browser: Browser,
  options: { baseUrl: string; email: string; password: string; path: string },
): Promise<void> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await login(page, options);
    await context.storageState({ path: options.path });
  } finally {
    await context.close();
  }
}

/** Abre a aplicação numa sessão já autenticada e espera o shell aparecer. */
export async function openApp(page: Page, baseUrl: string): Promise<void> {
  await page.goto(baseUrl + "/", { waitUntil: "domcontentloaded" });
  try {
    await page.locator("nav").first().waitFor({ state: "visible", timeout: 45000 });
  } catch (erro) {
    await assertNaoLimitado(page);
    throw erro;
  }
  await settle(page);
}

/** Clica numa aba da barra superior. Escopado ao <nav> - fora dele os mesmos rótulos reaparecem. */
async function openTab(page: Page, name: string | RegExp): Promise<void> {
  const nav = page.locator("nav").first();
  await nav.getByRole("button", { name, exact: typeof name === "string" }).first().click();
  await settle(page);
}

/** Clica numa sub-aba da Área de Trabalho. Os rótulos carregam contadores, daí o casamento por prefixo. */
async function openWorkspaceSubTab(page: Page, prefix: string): Promise<void> {
  await page.getByRole("button", { name: new RegExp("^" + prefix) }).first().click(); // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- dev-only capture script; `prefix` is always a hardcoded literal at the call site, never external input
  await settle(page);
}

/** Clica numa seção da barra lateral do Console de Administração. */
async function openAdminSection(page: Page, label: string): Promise<void> {
  await page.getByRole("button", { name: new RegExp("^" + label) }).first().click(); // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- same as openWorkspaceSubTab above
  await settle(page);
}

/**
 * Abre um projeto na Área de Trabalho. `CAPTURE_PROJECT_ID` fixa qual - sem ele o script abre o
 * primeiro da lista, o que funciona mas deixa o baseline refém da ordenação e de quantos projetos
 * existirem no banco de desenvolvimento no dia.
 */
async function openWorkspaceProject(page: Page): Promise<void> {
  await openTab(page, "Projetos");
  const projectId = process.env.CAPTURE_PROJECT_ID;
  const row = projectId
    ? page.locator("tr", { hasText: projectId }).first()
    : page.locator("tbody tr").first();
  await row.getByTitle("Abrir na Área de Trabalho").click();
  await settle(page);
}

/**
 * As telas. A lista cobre as nove abas do produto mais as sub-abas onde a cor carrega significado
 * - a matriz de conformidade da Área de Trabalho e as seções do Console de Administração são
 * exatamente onde a repaletização é mais arriscada.
 */
export const SCREENS: Screen[] = [
  {
    id: "login",
    label: "Login (não autenticado)",
    authenticated: false,
    async open(page) {
      await page.locator("#login-card").waitFor({ state: "visible", timeout: 30000 });
      await settle(page);
    },
  },
  {
    id: "home",
    label: "Início - KPIs, funil e gráficos",
    authenticated: true,
    async open(page) {
      await openTab(page, "Início");
    },
  },
  {
    id: "projects",
    label: "Projetos - lista e etiquetas de estado",
    authenticated: true,
    async open(page) {
      await openTab(page, "Projetos");
    },
  },
  {
    id: "workspace-summary",
    label: "Área de Trabalho - Resumo Executivo de Conformidade",
    authenticated: true,
    async open(page) {
      await openWorkspaceProject(page);
      await openWorkspaceSubTab(page, "Resumo Executivo de Conformidade");
    },
  },
  {
    id: "workspace-requirements",
    label: "Área de Trabalho - Matriz de Requisitos (conforme/parcial/não conforme)",
    authenticated: true,
    async open(page) {
      await openWorkspaceProject(page);
      await openWorkspaceSubTab(page, "Matriz de Requisitos");
    },
  },
  {
    id: "workspace-risks",
    label: "Área de Trabalho - Riscos e Oportunidades",
    authenticated: true,
    async open(page) {
      await openWorkspaceProject(page);
      await openWorkspaceSubTab(page, "Riscos e Oportunidades");
    },
  },
  {
    id: "workspace-bom",
    label: "Área de Trabalho - Mecanismo de BOM & Conformidade",
    authenticated: true,
    async open(page) {
      await openWorkspaceProject(page);
      await openWorkspaceSubTab(page, "Mecanismo de BOM & Conformidade");
    },
  },
  {
    id: "workspace-proposal-builder",
    label: "Área de Trabalho - Estúdio de Geração de Propostas",
    authenticated: true,
    async open(page) {
      await openWorkspaceProject(page);
      await openWorkspaceSubTab(page, "Estúdio de Geração de Propostas");
    },
  },
  {
    id: "workspace-explorer",
    label: "Área de Trabalho - Explorador de Arquivos",
    authenticated: true,
    async open(page) {
      await openWorkspaceProject(page);
      await page.getByRole("button", { name: /Explorador de Arquivos/ }).first().click();
      await settle(page);
    },
  },
  {
    id: "proposals",
    label: "Estúdio de Propostas - pareceres e severidade",
    authenticated: true,
    async open(page) {
      await openTab(page, "Estúdio de Propostas");
    },
  },
  {
    id: "approval",
    label: "Centro de Aprovação",
    authenticated: true,
    async open(page) {
      await openTab(page, "Centro de Aprovação");
    },
  },
  {
    id: "knowledge-base",
    label: "Base de Conhecimento",
    authenticated: true,
    async open(page) {
      await openTab(page, /^Base de Conhecimento/);
    },
  },
  {
    id: "poc",
    label: "Gestão de POC - kanban e Gantt (add-on)",
    authenticated: true,
    async open(page) {
      await openTab(page, /^Gestão de POC/);
    },
  },
  {
    id: "pricing",
    label: "Precificação - catálogo e faixas de markup (add-on)",
    authenticated: true,
    async open(page) {
      await openTab(page, /^Precificação/);
    },
  },
  {
    id: "admin-overview",
    label: "Configurações - Visão Geral",
    authenticated: true,
    async open(page) {
      await openTab(page, "Configurações");
      await openAdminSection(page, "Visão Geral");
    },
  },
  {
    id: "admin-users",
    label: "Configurações - Usuários e Acessos",
    authenticated: true,
    async open(page) {
      await openTab(page, "Configurações");
      await openAdminSection(page, "Usuários e Acessos");
    },
  },
  {
    id: "admin-branding",
    label: "Configurações - Identidade Visual (alvo da Fase 8)",
    authenticated: true,
    async open(page) {
      await openTab(page, "Configurações");
      await openAdminSection(page, "Identidade Visual");
    },
  },
  {
    id: "admin-audit",
    label: "Configurações - Auditoria e Diagnóstico",
    authenticated: true,
    async open(page) {
      await openTab(page, "Configurações");
      await openAdminSection(page, "Auditoria e Diagnóstico");
    },
  },
];

/**
 * Opções do recorte, compartilhadas entre a captura e a comparação. `page.screenshot()` e
 * `expect(page).toHaveScreenshot()` aceitam os mesmos nomes - manter um objeto só garante que o
 * que foi gravado e o que é comparado saem do mesmo jeito.
 *
 * `fullPage` é verdadeiro por completude, mas na prática recorta uma tela: o shell é `h-screen`
 * com `overflow-hidden` e a rolagem acontece dentro dos painéis. Ou seja, o baseline vê o que o
 * usuário vê ao abrir a tela, não o conteúdo abaixo da dobra - limitação conhecida, registrada no
 * roadmap.
 */
export const SHOT_OPTIONS = {
  fullPage: true,
  animations: "disabled",
  caret: "hide",
  scale: "css",
} as const;
