// Autentica uma única vez por execução e guarda o estado da sessão para todos os testes visuais.
//
// Motivo concreto: `/api/auth/login` tem limitador dedicado de 20 tentativas por IP a cada 15
// minutos (server/middleware/security.ts). Autenticar por teste dava 36 logins numa rodada e a
// comparação morria no meio com "Too many login attempts" - com o agravante de que a falha se
// parece com um defeito de interface, já que o que aparece na captura é a tela de login.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { chromium } from "@playwright/test";
import { AUTH_STATE_PATH, DEFAULT_BASE_URL, saveAuthState } from "../../scripts/uiScreens";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

export default async function globalSetup(): Promise<void> {
  dotenv.config({ path: path.join(ROOT, ".env.capture.local"), quiet: true });

  const baseUrl = process.env.CAPTURE_BASE_URL || DEFAULT_BASE_URL;
  const email = process.env.CAPTURE_EMAIL;
  const password = process.env.CAPTURE_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "CAPTURE_EMAIL e CAPTURE_PASSWORD não estão definidos. Crie .env.capture.local no servidor " +
        "de dev com a conta dedicada de captura (MFA desligado).",
    );
  }

  const authStatePath = path.join(ROOT, AUTH_STATE_PATH);
  fs.mkdirSync(path.dirname(authStatePath), { recursive: true });

  const browser = await chromium.launch();
  try {
    await saveAuthState(browser, { baseUrl, email, password, path: authStatePath });
  } finally {
    await browser.close();
  }
}
