/**
 * CDC 16 — Fase 1. Prova visual da fila de pré-vendas.
 *
 * Reaproveita os mesmos helpers da rede de captura do produto
 * (scripts/uiScreens.ts): mesmo login pela tela real, mesma estabilização de
 * animação, mesmas duas larguras (1440 e 390). O que ele NÃO faz é gravar em
 * docs/visual-baseline/: o baseline é comparado inteiro por `npm run test:visual`
 * e regravar só uma tela dele muda o trajeto da suíte sem que ninguém peça.
 * Estas imagens são evidência desta fase e saem fora do repositório.
 *
 *   BASE_URL=http://127.0.0.1:3010 SAIDA=/tmp/cdc16-f1 \
 *     npx tsx scripts/cdc16-f1-capturar-fila.ts
 */
import fs from "fs";
import path from "path";
import { chromium } from "@playwright/test";
import { VIEWPORTS, contextOptionsFor, login, settle, stabilize } from "./uiScreens";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3010";
const SAIDA = process.env.SAIDA || "/tmp/cdc16-f1";
const EMAIL = process.env.PROVA_EMAIL || "prova-cdc16-f1@local.invalid";
const SENHA = process.env.PROVA_PASSWORD || "";

async function main() {
  if (!SENHA) throw new Error("PROVA_PASSWORD ausente.");
  fs.mkdirSync(SAIDA, { recursive: true });

  const navegador = await chromium.launch();
  try {
    for (const viewport of VIEWPORTS) {
      const contexto = await navegador.newContext(contextOptionsFor(viewport));
      const pagina = await contexto.newPage();

      // Um erro não capturado mata o script da página e a tela fica pela metade
      // sem nada no console: `pageerror` é o evento que enxerga isso.
      const erros: string[] = [];
      pagina.on("pageerror", (e) => erros.push(String(e?.message || e)));

      await login(pagina, { baseUrl: BASE, email: EMAIL, password: SENHA });
      await stabilize(pagina);

      const aba = pagina.getByRole("button", { name: /^Demandas/ });
      await aba.waitFor({ state: "visible", timeout: 20000 });
      await aba.click();
      await settle(pagina);
      await pagina.screenshot({ path: path.join(SAIDA, `${viewport.id}-fila.png`) });

      // Mede a tira de abas do topo: com dez abas possíveis ela estoura, e o
      // número medido é o que sustenta a linha registrada no §8 do plano.
      const tira = await pagina.evaluate(`(() => {
        const t = document.querySelector("nav > div.order-3");
        return t ? { scrollWidth: t.scrollWidth, clientWidth: t.clientWidth, estoura: t.scrollWidth > t.clientWidth } : null;
      })()`);
      console.log(`  tira de abas em ${viewport.id}: ${JSON.stringify(tira)}`);

      // A demanda com documento, aberta: é onde vive o aviso de ambientes
      // cruzados e a lista de anexos.
      const linha = pagina.getByRole("button", { name: /Videomonitoramento urbano/ }).first();
      if (await linha.isVisible().catch(() => false)) {
        await linha.click();
        await settle(pagina);
        await pagina.screenshot({ path: path.join(SAIDA, `${viewport.id}-fila-detalhe.png`) });

        // O corpo do modal rola: sem descer até o fim, a lista de documentos -
        // que é onde se vê se o binário chegou - fica fora da imagem e alguém
        // conclui que ela não existe.
        await pagina.evaluate(`(() => {
          const caixa = document.querySelector("[data-testid=demand-detail-body]");
          if (caixa) caixa.scrollTop = caixa.scrollHeight;
        })()`);
        await settle(pagina, 300);
        await pagina.screenshot({ path: path.join(SAIDA, `${viewport.id}-fila-detalhe-documentos.png`) });
      }

      if (erros.length) {
        throw new Error(`erro de página em ${viewport.id}: ${erros.join(" | ")}`);
      }
      console.log(`capturado: ${viewport.id}`);
      await contexto.close();
    }
  } finally {
    await navegador.close();
  }
  console.log(`imagens em ${SAIDA}`);
}

main().catch((err) => {
  console.error("captura falhou:", err?.message || err);
  process.exit(1);
});
