// Configuração do Playwright - ferramenta de desenvolvimento, dev-only.
//
// Só existe para a comparação visual do programa de identidade visual
// (docs/roadmap/IDENTIDADE_VISUAL_2026-08.md). Não substitui e não toca no `vitest`: aquele
// continua sendo `npm run test` e roda apenas `server/**/*.test.ts` e `src/**/*.test.ts`, que não
// alcançam `tests/`. Os dois convivem sem se enxergar.
//
// `snapshotPathTemplate` aponta a comparação para os MESMOS arquivos que `npm run capture:ui`
// grava. Sem isso o Playwright criaria uma segunda cópia do baseline, em `__snapshots__`, e
// passaria a comparar contra ela - duas verdades para a mesma pergunta.
import { defineConfig } from "@playwright/test";
import { AUTH_STATE_PATH, VIEWPORTS, contextOptionsFor } from "./scripts/uiScreens";

export default defineConfig({
  testDir: "./tests/visual",
  // Autentica uma vez para a execução inteira - ver o comentário em tests/visual/global-setup.ts.
  globalSetup: "./tests/visual/global-setup.ts",
  snapshotPathTemplate: "docs/visual-baseline/{projectName}/{arg}{ext}",
  // A comparação lê estado real de um servidor real: em paralelo, duas abas disputando as mesmas
  // telas produzem diferença que não é de cor.
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  timeout: 120000,
  reporter: [["list"]],
  expect: {
    toHaveScreenshot: {
      // Zero tolerância é o ponto: numa fase de repaletização, "quase igual" não prova nada.
      // Quando uma fase mudar cor de propósito, o baseline é recapturado e revisado no PR, não
      // afrouxado aqui.
      maxDiffPixels: 0,
      animations: "disabled",
      caret: "hide",
      scale: "css",
    },
  },
  projects: VIEWPORTS.map((viewport) => ({
    name: viewport.id,
    use: { storageState: AUTH_STATE_PATH, ...contextOptionsFor(viewport) },
  })),
});
