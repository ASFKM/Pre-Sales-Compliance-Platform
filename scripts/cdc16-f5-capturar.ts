/**
 * CDC 16 — Fase 5. Prova visual do prazo, do alerta e do desempenho.
 *
 * Mesmos helpers da rede de captura do produto (scripts/uiScreens.ts): login pela tela real,
 * estabilização de animação, as duas larguras (1440 e 390). E, como na F1, as imagens saem FORA
 * de `docs/visual-baseline/` — regravar parte do baseline muda o trajeto de `npm run test:visual`
 * sem ninguém pedir.
 *
 *   BASE_URL=http://127.0.0.1:3010 PROVA_PASSWORD=… SAIDA=/tmp/cdc16-f5 \
 *     npx tsx scripts/cdc16-f5-capturar.ts
 */
import fs from "fs";
import path from "path";
import { chromium } from "@playwright/test";
import { VIEWPORTS, contextOptionsFor, login, settle, stabilize } from "./uiScreens";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3010";
const SAIDA = process.env.SAIDA || "/tmp/cdc16-f5";
// O ADMINISTRADOR, e não a equipe: é ele que enxerga o formulário de configuração (D19), e a
// captura tem de mostrar a tela de quem decide o prazo.
const EMAIL = process.env.PROVA_EMAIL || "prova-cdc16-f5-admin@local.invalid";
const SENHA = process.env.PROVA_PASSWORD || "";

// As MESMAS larguras do baseline do produto, com a ALTURA aumentada. Neste shell quem rola é um
// container interno, então `fullPage` captura a viewport e nada mais — a F3 perdeu uma timeline
// inteira assim. Uma viewport alta é o que faz a tela caber na imagem em vez de ser cortada.
const ALTOS = VIEWPORTS.map((v) => ({ ...v, height: v.isMobile ? 2400 : 1800 }));

async function main() {
  if (!SENHA) throw new Error("PROVA_PASSWORD ausente.");
  fs.mkdirSync(SAIDA, { recursive: true });

  const navegador = await chromium.launch();
  const medidas: Record<string, unknown> = {};
  try {
    for (const viewport of ALTOS) {
      const contexto = await navegador.newContext(contextOptionsFor(viewport));
      const pagina = await contexto.newPage();

      // Exceção não capturada mata o script da página e deixa a tela pela metade SEM nada no
      // console: `pageerror` é o único evento que a enxerga.
      const erros: string[] = [];
      pagina.on("pageerror", (e) => erros.push(String(e?.message || e)));

      await login(pagina, { baseUrl: BASE, email: EMAIL, password: SENHA });
      await stabilize(pagina);

      const aba = pagina.getByRole("button", { name: /^Demandas/ });
      await aba.waitFor({ state: "visible", timeout: 20000 });
      await aba.click();
      await settle(pagina);
      await pagina.screenshot({ path: path.join(SAIDA, `${viewport.id}-fila-com-prazo.png`) });

      // A coluna de prazo do SLA existe e tem CONTEÚDO. Contar as células é o que separa "a
      // coluna está lá" de "a coluna mostra alguma coisa" — a F4 capturou um gráfico no quadro
      // zero e a asserção passou porque olhava o texto ao lado.
      const prazos = await pagina.evaluate(`(() => {
        const celulas = [...document.querySelectorAll("[data-testid^='sla-prazo-']")];
        return {
          quantas: celulas.length,
          exemplo: celulas[0] ? celulas[0].textContent.replace(/\\s+/g, " ").trim() : null,
        };
      })()`);
      medidas[`${viewport.id}.prazosNaFila`] = prazos;
      console.log(`  prazos na fila (${viewport.id}): ${JSON.stringify(prazos)}`);

      const paraPrazos = pagina.getByTestId("demand-vista-prazos");
      await paraPrazos.click();
      await settle(pagina);
      // O painel tem três seções e a última (desempenho) fica abaixo da dobra em 1440 e MUITO
      // abaixo em 390. Neste shell quem rola é um container interno, então `fullPage` captura a
      // viewport e nada mais — a F3 pagou isso com uma timeline inteira cortada. A saída são
      // duas imagens: o topo e o fim, com a rolagem feita no container certo.
      await pagina.screenshot({ path: path.join(SAIDA, `${viewport.id}-prazos-topo.png`) });

      const rolou = await pagina.evaluate(`(() => {
        const alvo = document.querySelector("[data-testid=sla-desempenho]");
        if (!alvo) return null;
        alvo.scrollIntoView({ block: "end" });
        return { scrollY: window.scrollY, altura: document.documentElement.scrollHeight };
      })()`);
      medidas[`${viewport.id}.rolagem`] = rolou;
      await settle(pagina, 400);
      await pagina.screenshot({ path: path.join(SAIDA, `${viewport.id}-prazos-desempenho.png`) });

      const conteudo = await pagina.evaluate(`(() => {
        const alerta = document.querySelector("[data-testid=sla-lista-alertas]");
        const config = document.querySelector("[data-testid=sla-configuracao]");
        const desempenho = document.querySelector("[data-testid=sla-desempenho]");
        const linhas = desempenho ? desempenho.querySelectorAll("tbody tr").length : 0;
        return {
          alertasVisiveis: alerta ? alerta.children.length : 0,
          configPresente: !!config,
          linhasDeDesempenho: linhas,
          primeiraPessoa: desempenho ? (desempenho.querySelector("tbody tr td")?.textContent ?? null) : null,
        };
      })()`);
      medidas[`${viewport.id}.painel`] = conteudo;
      console.log(`  painel (${viewport.id}): ${JSON.stringify(conteudo)}`);

      if (erros.length) throw new Error(`erro de página em ${viewport.id}: ${erros.join(" | ")}`);
      console.log(`capturado: ${viewport.id}`);
      await contexto.close();
    }
  } finally {
    await navegador.close();
  }

  fs.writeFileSync(path.join(SAIDA, "medidas.json"), JSON.stringify(medidas, null, 2));
  // O TAMANHO de cada arquivo, porque uma captura que saiu com a altura da viewport em vez da
  // página inteira é indistinguível de uma boa até alguém medir os bytes.
  for (const arquivo of fs.readdirSync(SAIDA).filter((f) => f.endsWith(".png")).sort()) {
    console.log(`  ${arquivo}: ${(fs.statSync(path.join(SAIDA, arquivo)).size / 1024).toFixed(0)} KB`);
  }
  console.log(`imagens em ${SAIDA}`);
}

main().catch((err) => {
  console.error("captura falhou:", err?.message || err);
  process.exit(1);
});
