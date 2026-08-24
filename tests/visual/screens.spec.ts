// Prova que a interface continua idêntica ao baseline gravado em docs/visual-baseline/.
//
// É a rede de segurança da repaletização: as fases 2 a 7 do programa de identidade visual trocam
// cor em ~2.900 classes espalhadas por 22 componentes, e sem esta comparação não há como
// distinguir "só a cor mudou" de "alguma coisa quebrou".
//
// Roda contra um servidor vivo (por padrão http://127.0.0.1:3000, ajustável em
// `CAPTURE_BASE_URL`). A autenticação acontece uma vez só, em `global-setup.ts`, e uma aba só
// percorre todas as telas de cada largura - as duas coisas por causa dos limitadores de
// requisição do servidor; ver o comentário em `scripts/uiScreens.ts`.
//
//   npm run test:visual                            compara tudo
//   npm run test:visual -- --project=desktop-1440  compara só um ponto de largura
//   npm run test:visual -- -g home                 compara uma tela
//
// Quando uma fase mudar cor de propósito, o caminho é recapturar (`npm run capture:ui`) e revisar
// as imagens novas no PR - nunca afrouxar a tolerância.
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  AUTH_STATE_PATH,
  DEFAULT_BASE_URL,
  SCREENS,
  VIEWPORTS,
  contextOptionsFor,
  openApp,
  settle,
  stabilize,
} from "../../scripts/uiScreens";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
dotenv.config({ path: path.join(ROOT, ".env.capture.local"), quiet: true });

const baseUrl = process.env.CAPTURE_BASE_URL || DEFAULT_BASE_URL;

test.describe("não autenticado", () => {
  // Descarta a sessão do global-setup: estas telas só existem antes de entrar.
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const screen of SCREENS.filter((s) => !s.authenticated)) {
    test(screen.id, async ({ page }) => {
      await page.goto(baseUrl + "/", { waitUntil: "domcontentloaded" });
      await screen.open(page);
      await settle(page, 250);
      await stabilize(page);
      await expect(page).toHaveScreenshot(screen.id + ".png", { fullPage: true });
    });
  }
});

test.describe("autenticado", () => {
  // Em série e com uma aba só: é assim que a captura percorre as telas, e é o que cabe no
  // orçamento de requisições do servidor.
  test.describe.configure({ mode: "serial" });

  let page: Page;

  test.beforeAll(async ({ browser }, testInfo) => {
    const viewport = VIEWPORTS.find((v) => v.id === testInfo.project.name);
    if (!viewport) throw new Error("Largura desconhecida: " + testInfo.project.name);
    const context = await browser.newContext({
      ...contextOptionsFor(viewport),
      storageState: path.join(ROOT, AUTH_STATE_PATH),
    });
    page = await context.newPage();
    await openApp(page, baseUrl);
  });

  test.afterAll(async () => {
    await page?.context().close();
  });

  for (const screen of SCREENS.filter((s) => s.authenticated)) {
    test(screen.id, async () => {
      await screen.open(page);
      await settle(page, 250);
      await stabilize(page);
      await expect(page).toHaveScreenshot(screen.id + ".png", { fullPage: true });
    });
  }
});
