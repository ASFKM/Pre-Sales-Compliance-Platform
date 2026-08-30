/**
 * Capturas do PreSales Compliance Platform para o site da CloudMountain.
 *
 * Esta rotina NÃO vive no repositório do produto: mora em
 * `cloudmountain-site/site/scripts/capturas/` e é copiada para `scripts/` do
 * PreSales na hora de rodar — mesmo arranjo de `cmcrm-site.spec.ts`. A imagem é
 * ativo do site, então quem precisa recapturar quando a tela muda é quem mantém o
 * site, e a rotina tem de estar à mão dele.
 *
 * Reaproveita `scripts/uiScreens.ts` do produto (login, estabilização, espera) para
 * que a captura do site não divirja da captura do baseline visual. O que ela NÃO
 * reaproveita é a lista `SCREENS` e o `contextOptionsFor`, por dois motivos:
 *
 *   1. o site precisa de seis telas específicas, uma delas numa sub-aba que o
 *      baseline não visita (a Base de Conhecimento abre em "Documentos de
 *      Referência", e quem conta a história do site é "Conhecimento Aprovado");
 *   2. o baseline captura com `deviceScaleFactor: 1` porque compara pixel a pixel
 *      com ele mesmo. O site precisa de 2: a captura de 1440 px exibida num
 *      carrossel de 608 px já era ilegível, e o popup ampliado da Fase 7 mostra a
 *      imagem em tamanho real — numa tela densa, 1440 físicos não sobram.
 *
 * Não grava em `docs/visual-baseline/`. O baseline do produto é do produto; regravar
 * parte dele por engano produz pixel que a suíte completa não reproduz.
 *
 * Uso, dentro do repositório do PreSales:
 *   npx tsx scripts/presales-site.ts [--out DIR]
 *
 * Credenciais: conta `site-capture@cloudmountain.local`, do tenant descartável
 * `tenant_site_captura` criado por `presales-semear.sql`. A senha é a MESMA da conta
 * de captura dos manuais — o semeador copia o hash — e por isso sai de
 * `.env.manual.local`, que já existe no host e já está fora do git. Nenhuma senha
 * nova é inventada, transportada ou guardada por causa desta fase.
 */
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { chromium } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
import { AUTH_STATE_PATH, DEFAULT_BASE_URL, openApp, saveAuthState, settle, stabilize } from "./uiScreens";

const ROOT = process.cwd();
dotenv.config({ path: path.join(ROOT, ".env.manual.local"), quiet: true });
dotenv.config({ path: path.join(ROOT, ".env.capture.local"), quiet: true });

function flag(nome: string): string | undefined {
  const i = process.argv.indexOf("--" + nome);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const outDir = path.resolve(ROOT, flag("out") || "../capturas-site-presales");
const baseUrl = process.env.CAPTURE_BASE_URL || DEFAULT_BASE_URL;
const email = process.env.SITE_CAPTURE_EMAIL || "site-capture@cloudmountain.local";
const password = process.env.SITE_CAPTURE_PASSWORD || process.env.MANUAL_CAPTURE_PASSWORD;

if (!password) {
  console.error(
    "Sem senha. A conta de captura do site compartilha o hash da conta dos manuais:\n" +
      "  - rode `npm run provision:manual-capture` (grava MANUAL_CAPTURE_PASSWORD em .env.manual.local), ou\n" +
      "  - exporte SITE_CAPTURE_PASSWORD.",
  );
  process.exit(1);
}

/**
 * 1680x1050 com o dobro da densidade.
 *
 * O baseline do produto usa 1440x900, e é onde ele deve continuar: 1440 é a largura
 * em que o produto é usado. Só que a barra de navegação do produto NÃO cabe em 1440 —
 * "Início" some atrás do nome da plataforma e "Base de Conhecimento" fica cortada
 * pelo chip do usuário. Numa captura de vitrine isso se lê exatamente como o "sem
 * padrão" que o dono relatou. 1680 é a primeira largura de desktop comum em que a
 * barra inteira cabe. A proporção 8:5 é a mesma de 1440x900, então as seis telas
 * mantêm o mesmo formato entre si.
 */
const VIEWPORT = { width: 1920, height: 1200 };
const DENSIDADE = 2;

/* Clica numa aba da barra superior. Escopado ao <nav>: fora dele os rótulos reaparecem. */
async function abrirAba(page: Page, nome: string | RegExp): Promise<void> {
  const nav = page.locator("nav").first();
  await nav.getByRole("button", { name: nome, exact: typeof nome === "string" }).first().click();
  await settle(page);
}

/* Sub-aba da Área de Trabalho. Os rótulos carregam contador, daí o casamento por prefixo. */
async function abrirSubAba(page: Page, prefixo: string): Promise<void> {
  await page.getByRole("button", { name: new RegExp("^" + prefixo) }).first().click();
  await settle(page);
}

/**
 * Abre o projeto fictício na Área de Trabalho. O id é fixo de propósito: sem ele o
 * script abriria o primeiro da lista, e a captura passaria a depender da ordenação.
 */
async function abrirProjeto(page: Page): Promise<void> {
  await abrirAba(page, "Projetos");
  const id = process.env.SITE_CAPTURE_PROJECT_ID || "p_site_vale_verde";
  await page.locator("tr", { hasText: id }).first().getByTitle("Abrir na Área de Trabalho").click();
  await settle(page);
}

interface Tela {
  arquivo: string;
  rotulo: string;
  abrir(page: Page): Promise<void>;
  /** Quando presente, o obturador recorta este retângulo em vez da tela inteira. */
  recorte?(page: Page): Promise<{ x: number; y: number; width: number; height: number }>;
}

const TELAS: Tela[] = [
  {
    arquivo: "presales-projetos",
    rotulo: "Projetos — a carteira de editais em andamento",
    abrir: (page) => abrirAba(page, "Projetos"),
  },
  {
    arquivo: "presales-requisitos",
    rotulo: "Matriz de Requisitos — exigência por exigência, com o trecho de origem",
    async abrir(page) {
      await abrirProjeto(page);
      await abrirSubAba(page, "Matriz de Requisitos");
    },
  },
  {
    arquivo: "presales-materiais",
    rotulo: "Mecanismo de BOM & Conformidade — a lista de materiais conferida",
    async abrir(page) {
      await abrirProjeto(page);
      await abrirSubAba(page, "Mecanismo de BOM & Conformidade");
    },
  },
  {
    arquivo: "presales-riscos",
    rotulo: "Riscos e Oportunidades",
    async abrir(page) {
      await abrirProjeto(page);
      await abrirSubAba(page, "Riscos e Oportunidades");
    },
  },
  {
    arquivo: "presales-propostas",
    rotulo: "Estúdio de Propostas — os quatro pareceres",
    abrir: (page) => abrirAba(page, "Estúdio de Propostas"),
  },
  {
    /* O hero da página. Tela inteira não serve aqui: no topo da página ela vira
       ruído e mostra os painéis vazios das bordas — foi a lição da Fase 2, quando o
       hero do CMCRM passou a ser o recorte do funil em vez da tela toda.
       O recorte é a faixa de indicadores e gráficos do Início, que é o análogo
       direto do funil do CMCRM: lê-se pequeno, porque é forma e não texto. O
       primeiro recorte tentado foi o Resumo Executivo, e ele é uma parede de texto
       — a 500px de largura na coluna do hero vira textura cinza. */
    arquivo: "presales-inicio",
    rotulo: "Início — indicadores e gráficos (recorte para o hero)",
    async abrir(page) {
      await abrirAba(page, "Início");
    },
    async recorte(page) {
      /* Começa na faixa de indicadores, e não no alto da tela: acima dela fica a
         caixa de tarefas pendentes, que num tenant recém-criado diz "Nenhuma
         tarefa pendente!" — estado vazio no elemento que abre a página. */
      const caixa = await page.locator("main, [role=main]").first().boundingBox();
      const kpis = await page.getByText("PROPOSTAS ATIVAS").first().boundingBox();
      if (!caixa || !kpis) throw new Error("recorte do hero: faixa de indicadores não encontrada");
      const y = kpis.y - 26;
      return { x: caixa.x + 12, y, width: caixa.width - 24, height: caixa.y + caixa.height - y - 10 };
    },
  },
  {
    arquivo: "presales-precificacao",
    rotulo: "Precificação — catálogo, markup e a planilha do projeto",
    abrir: (page) => abrirAba(page, /^Precificação/),
  },
  {
    /* A ABA de POC é um kanban de POCs, e com uma POC ele mostra um cartão e
       quatro colunas vazias. O que a página promete é o CRONOGRAMA da prova —
       tarefa a tarefa, com dependência. Ele vive dentro da POC, na aba
       "Cronograma". */
    arquivo: "presales-poc",
    rotulo: "Gestão de POC — o cronograma da prova de conceito",
    async abrir(page) {
      await abrirAba(page, /^Gestão de POC/);
      await page.getByText("POC de detecção automática de incidentes").first().click();
      await settle(page);
      await page.getByRole("button", { name: /^Cronograma/ }).first().click();
      await settle(page, 900);
    },
  },
  {
    arquivo: "presales-conhecimento",
    rotulo: "Base de Conhecimento — o acervo aprovado",
    async abrir(page) {
      await abrirAba(page, /^Base de Conhecimento/);
      /* A tela abre em "Upload de Arquivos". Quem conta a história do site — o acervo
         com fabricante e situação — é a terceira sub-aba, e ela se chama "Base de
         Conhecimento", exatamente igual à aba do topo: procurar pelo nome acha os dois
         e clica no que já estava aberto. O caminho seguro é entrar pela sub-aba
         vizinha, que tem nome único, e subir um nível. */
      const subnav = page.getByRole("button", { name: /^Upload de Arquivos/ }).first().locator("xpath=..");
      await subnav.getByRole("button", { name: /^Base de Conhecimento/ }).first().click();
      await settle(page, 900);
    },
  },
];

async function main(): Promise<void> {
  fs.mkdirSync(outDir, { recursive: true });
  const browser: Browser = await chromium.launch();
  let capturadas = 0;

  try {
    const authStatePath = path.join(ROOT, AUTH_STATE_PATH);
    fs.mkdirSync(path.dirname(authStatePath), { recursive: true });
    await saveAuthState(browser, { baseUrl, email, password: password as string, path: authStatePath });
    console.log(`sessão de ${email} guardada em ${AUTH_STATE_PATH}`);

    /* Uma aba só para as seis telas: cada carga fria dispara dezenas de chamadas de
       API e o servidor recusa por limite de requisições muito antes do fim. */
    const context = await browser.newContext({
      viewport: VIEWPORT,
      isMobile: false,
      hasTouch: false,
      deviceScaleFactor: DENSIDADE,
      locale: "pt-BR",
      timezoneId: "America/Sao_Paulo",
      reducedMotion: "reduce",
      colorScheme: "light",
      storageState: authStatePath,
    });
    /* Os dois painéis laterais da Área de Trabalho recolhidos.
       Eles ocupam 800 dos 1440 px e espremem a tabela do meio a ponto de a descrição
       do requisito quebrar em uma palavra por linha e a coluna de conformidade sair
       cortada — que é exatamente o "sem padrão" que o dono relatou. O produto guarda
       o estado dos dois em localStorage, então basta escrevê-lo antes de a aplicação
       montar: nenhum clique, nenhuma animação para esperar. */
    await context.addInitScript(() => {
      window.localStorage.setItem("ca_left_panel_collapsed", "1");
      window.localStorage.setItem("ca_right_panel_collapsed", "1");
    });
    const page = await context.newPage();
    try {
      await openApp(page, baseUrl);
      for (const tela of TELAS) {
        await tela.abrir(page);
        await stabilize(page);
        await page.waitForTimeout(700);
        const opcoes = {
          path: path.join(outDir, tela.arquivo + ".png"),
          animations: "disabled" as const,
          caret: "hide" as const,
        };
        const clip = tela.recorte ? await tela.recorte(page) : undefined;
        await page.screenshot(clip ? { ...opcoes, clip } : opcoes);
        capturadas += 1;
        console.log(`   ${tela.arquivo.padEnd(24)} ${tela.rotulo}`);
      }
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }

  console.log(`\n${capturadas} telas em ${outDir}, ${VIEWPORT.width}x${VIEWPORT.height} @${DENSIDADE}x`);
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
