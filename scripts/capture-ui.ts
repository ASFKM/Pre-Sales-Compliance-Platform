// Captura o baseline visual do produto: todas as telas de `scripts/uiScreens.ts`, nos dois pontos
// de largura do programa de identidade visual (1440px e 390px).
//
// Uso:
//   npm run capture:ui                        grava em docs/visual-baseline/
//   npm run capture:ui -- --out /tmp/depois   grava em outro lugar (para comparar uma fase)
//   npm run capture:ui -- --only home,pricing captura só as telas indicadas
//
// Credenciais: `CAPTURE_EMAIL` e `CAPTURE_PASSWORD`, lidas de `.env.capture.local` (ignorado pelo
// git) ou do ambiente. A conta precisa ser dedicada a captura, com MFA desligado e sem troca de
// senha pendente - ver o roadmap para o porquê. Nenhuma credencial mora neste arquivo.
//
// Ferramenta de desenvolvimento: não é importada por `server.ts` nem por `index.html`, logo não
// entra em nenhum dos dois bundles.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { chromium } from "@playwright/test";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import {
  AUTH_STATE_PATH,
  DEFAULT_BASE_URL,
  SCREENS,
  SHOT_OPTIONS,
  VIEWPORTS,
  contextOptionsFor,
  openApp,
  saveAuthState,
  settle,
  stabilize,
} from "./uiScreens";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

dotenv.config({ path: path.join(ROOT, ".env.capture.local"), quiet: true });

function readFlag(name: string): string | undefined {
  const index = process.argv.indexOf("--" + name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const outDir = path.resolve(ROOT, readFlag("out") || "docs/visual-baseline");
const only = (readFlag("only") || "").split(",").map((s) => s.trim()).filter(Boolean);
const baseUrl = process.env.CAPTURE_BASE_URL || DEFAULT_BASE_URL;
const email = process.env.CAPTURE_EMAIL;
const password = process.env.CAPTURE_PASSWORD;

const screens = only.length ? SCREENS.filter((s) => only.includes(s.id)) : SCREENS;
if (!screens.length) {
  console.error("Nenhuma tela corresponde a --only. Telas disponíveis: " + SCREENS.map((s) => s.id).join(", "));
  process.exit(1);
}
if (screens.some((s) => s.authenticated) && (!email || !password)) {
  console.error(
    "CAPTURE_EMAIL e CAPTURE_PASSWORD não estão definidos. Crie .env.capture.local no dev com a\n" +
      "conta dedicada de captura (MFA desligado) ou exporte as duas variáveis no ambiente.",
  );
  process.exit(1);
}

async function shoot(page: Page, targetDir: string, id: string): Promise<void> {
  fs.mkdirSync(targetDir, { recursive: true });
  await stabilize(page);
  await page.screenshot({ ...SHOT_OPTIONS, path: path.join(targetDir, id + ".png") });
}

async function main(): Promise<void> {
  const browser: Browser = await chromium.launch();
  let captured = 0;

  try {
    // Uma autenticação para a execução inteira, guardada em disco. Ver saveAuthState() para o
    // porquê - há dois limitadores de requisição em jogo, e a primeira versão desta rede batia
    // nos dois.
    const needsAuth = screens.some((s) => s.authenticated);
    const authStatePath = path.join(ROOT, AUTH_STATE_PATH);
    if (needsAuth) {
      fs.mkdirSync(path.dirname(authStatePath), { recursive: true });
      await saveAuthState(browser, {
        baseUrl,
        email: email as string,
        password: password as string,
        path: authStatePath,
      });
      console.log("Sessão autenticada uma vez e guardada em " + AUTH_STATE_PATH);
    }

    for (const viewport of VIEWPORTS) {
      const targetDir = path.join(outDir, viewport.id);
      console.log(`\n== ${viewport.id} (${viewport.width}x${viewport.height}) -> ${targetDir}`);
      const contextOptions = contextOptionsFor(viewport);

      const anonymous = screens.filter((s) => !s.authenticated);
      if (anonymous.length) {
        const context: BrowserContext = await browser.newContext(contextOptions);
        const page: Page = await context.newPage();
        try {
          await page.goto(baseUrl + "/", { waitUntil: "domcontentloaded" });
          for (const screen of anonymous) {
            await screen.open(page);
            await shoot(page, targetDir, screen.id);
            captured += 1;
            console.log(`   ${screen.id.padEnd(28)} ${screen.label}`);
          }
        } finally {
          await context.close();
        }
      }

      // Uma aba percorre todas as telas autenticadas desta largura, navegando entre as abas do
      // produto - do mesmo jeito que `tests/visual/screens.spec.ts` faz. É o que mantém captura e
      // comparação comparáveis, e é o que cabe no orçamento de requisições do servidor.
      const authenticated = screens.filter((s) => s.authenticated);
      if (authenticated.length) {
        const context: BrowserContext = await browser.newContext({
          ...contextOptions,
          storageState: authStatePath,
        });
        const page: Page = await context.newPage();
        try {
          await openApp(page, baseUrl);
          for (const screen of authenticated) {
            await screen.open(page);
            await settle(page, 250);
            await shoot(page, targetDir, screen.id);
            captured += 1;
            console.log(`   ${screen.id.padEnd(28)} ${screen.label}`);
          }
        } finally {
          await context.close();
        }
      }
    }
  } finally {
    await browser.close();
  }

  console.log(`\n${captured} imagens gravadas em ${outDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
