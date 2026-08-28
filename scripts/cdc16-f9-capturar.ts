/**
 * CDC 16 — Fase 9. Prova visual: a aba saiu do topo, a fila continua alcançável, e a
 * Administração ganhou a seção Demandas.
 *
 * Duas pessoas, de propósito. O que esta fase muda depende de QUEM olha, e uma captura feita só
 * com o administrador provaria metade da regra: ele alcança a Administração, e a pessoa que mais
 * usa a fila — o pré-vendas, que tem `demand:read` e NÃO tem `admin:settings` — não alcança. É
 * justamente ela que ficaria sem caminho nenhum se a aba saísse sem reposição.
 *
 * As imagens saem FORA de `docs/visual-baseline/`: regravar parte do baseline muda o trajeto de
 * `npm run test:visual` sem ninguém pedir.
 *
 *   BASE_URL=http://127.0.0.1:3019 PROVA_PASSWORD=… SAIDA=/tmp/cdc16-f9 \
 *     npx tsx scripts/cdc16-f9-capturar.ts
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { chromium } from "@playwright/test";
import { prisma } from "../src/prisma";
import { runWithTenant } from "../src/tenantContext";
import { VIEWPORTS, contextOptionsFor, login, settle, stabilize } from "./uiScreens";
import { PAPEIS_DA_PROVA, entrarComo, papelDaProva } from "./cdc16-f5-comum";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3019";
const SAIDA = process.env.SAIDA || "/tmp/cdc16-f9";
const TENANT = process.env.PROVA_TENANT || "tenant_default";
const PREFIXO = "captura-cdc16-f9-";
const SENHA = process.env.PROVA_PASSWORD || "";

const EMAIL_ADMIN = `${PREFIXO}alberto@teste.invalid`;
const EMAIL_EQUIPE = `${PREFIXO}ana@teste.invalid`;

// Neste shell quem rola é um container interno, então `fullPage` captura a viewport e nada mais.
const ALTOS = VIEWPORTS.map((v) => ({ ...v, height: v.isMobile ? 2400 : 1800 }));

const medidas: Record<string, any> = {};

/** Os rótulos da tira de abas do topo, lidos do DOM. */
const ABAS_DO_TOPO = `(() => {
  const nav = document.querySelector("nav");
  if (!nav) return null;
  return [...nav.querySelectorAll("button")]
    .map((b) => (b.innerText || "").replace(/\\s+/g, " ").trim())
    .filter(Boolean);
})()`;

/**
 * Os VALORES da coluna "Valor", na ordem em que a tabela os desenha. `null` para a demanda sem
 * valor — que é o caso que a ordenação precisa tratar e o título não revela.
 */
const VALORES_DA_FILA = `(() => {
  return [...document.querySelectorAll("table tbody tr")].map((tr) => {
    const td = tr.querySelectorAll("td")[3];
    if (!td) return null;
    const t = (td.innerText || "").split("\\n")[0].replace(/\\s+/g, "").trim();
    if (!t || t === "\u2014") return null;
    const n = Number(t.replace(/[^0-9,.-]/g, "").replace(/\\./g, "").replace(",", "."));
    return Number.isFinite(n) ? n : null;
  });
})()`;

/** Os títulos da coluna "Demanda", na ordem em que a tabela os desenha. */
const TITULOS_DA_FILA = `(() => {
  const linhas = [...document.querySelectorAll("table tbody tr")];
  return linhas
    .map((tr) => {
      const b = tr.querySelector("td button");
      return b ? (b.innerText || "").replace(/\\s+/g, " ").trim() : null;
    })
    .filter(Boolean);
})()`;

async function preparar() {
  await runWithTenant({ tenantId: TENANT, canSeeAllProjects: true }, async () => {
    const papelAdmin = await papelDaProva(`${PREFIXO}admin`, [...PAPEIS_DA_PROVA.admin, "demand:manage"]);
    const papelEquipe = await papelDaProva(`${PREFIXO}equipe`, PAPEIS_DA_PROVA.equipe);
    const registrar = (r: string, ok: boolean, d: string) => {
      medidas[`preparo:${r}`] = `${ok ? "OK" : "FALHA"} ${d}`;
    };
    await entrarComo(`${PREFIXO}Alberto`, EMAIL_ADMIN, papelAdmin.id, SENHA, registrar);
    await entrarComo(`${PREFIXO}Ana`, EMAIL_EQUIPE, papelEquipe.id, SENHA, registrar);
  });
}

async function main() {
  if (!SENHA) throw new Error("PROVA_PASSWORD ausente — a captura entra pela tela de login real");
  fs.mkdirSync(SAIDA, { recursive: true });
  await preparar();

  const navegador = await chromium.launch();
  try {
    for (const viewport of ALTOS) {
      // ─── 1. o ADMINISTRADOR ────────────────────────────────────────────────
      const ctxAdmin = await navegador.newContext(contextOptionsFor(viewport));
      const pAdmin = await ctxAdmin.newPage();
      const errosAdmin: string[] = [];
      pAdmin.on("pageerror", (e) => errosAdmin.push(String(e?.message || e)));

      await login(pAdmin, { baseUrl: BASE, email: EMAIL_ADMIN, password: SENHA });
      await stabilize(pAdmin);
      await settle(pAdmin);

      const abas = await pAdmin.evaluate(ABAS_DO_TOPO);
      medidas[`${viewport.id}-abas-do-topo`] = abas;
      // Os DOIS lados: "Demandas" saiu E o resto continua lá. Só o primeiro passaria numa tira
      // vazia por defeito de renderização.
      medidas[`${viewport.id}-aba-demandas-sumiu`] = !(abas as string[]).some((r) => /^Demandas/.test(r));
      medidas[`${viewport.id}-tira-intacta`] = ["Início", "Projetos", "Base de Conhecimento"].every((r) =>
        (abas as string[]).some((a) => a.startsWith(r))
      );

      const ponte = pAdmin.getByTestId("home-fila-de-pre-vendas");
      await ponte.waitFor({ state: "visible", timeout: 20000 });
      medidas[`${viewport.id}-ponte-na-inicio`] = (await ponte.innerText()).replace(/\s+/g, " ").trim();
      await pAdmin.screenshot({ path: path.join(SAIDA, `${viewport.id}-inicio-com-ponte.png`) });

      // A ponte LEVA à fila. Um bloco decorativo passaria no teste de existência.
      await ponte.click();
      await pAdmin.waitForSelector("table tbody tr", { timeout: 20000 });
      await settle(pAdmin);
      await pAdmin.screenshot({ path: path.join(SAIDA, `${viewport.id}-fila.png`) });

      medidas[`${viewport.id}-fila-sem-as-outras-vistas`] = await pAdmin.evaluate(`(() => ({
        prazos: !!document.querySelector("[data-testid='demand-vista-prazos']"),
        expurgos: !!document.querySelector("[data-testid='demand-vista-expurgos']"),
        apontaParaConfiguracoes: document.body.innerText.includes("Configurações › Demandas"),
      }))()`);

      // ─── a ordenação, medida no DOM e não presumida ────────────────────────
      const antes = (await pAdmin.evaluate(TITULOS_DA_FILA)) as string[];
      await pAdmin.getByTestId("ordenar-value").click();
      await pAdmin.waitForFunction(
        `(() => { const b = document.querySelector("[data-testid='ordenar-value']"); return b && b.className.includes("text-brand-700"); })()`,
        undefined,
        { timeout: 15000 }
      );
      await settle(pAdmin);
      const porValorAsc = (await pAdmin.evaluate(TITULOS_DA_FILA)) as string[];
      const valoresAsc = (await pAdmin.evaluate(VALORES_DA_FILA)) as Array<number | null>;
      await pAdmin.getByTestId("ordenar-value").click();
      await settle(pAdmin);
      const porValorDesc = (await pAdmin.evaluate(TITULOS_DA_FILA)) as string[];
      const valoresDesc = (await pAdmin.evaluate(VALORES_DA_FILA)) as Array<number | null>;

      // Medido pelo VALOR, e não pelos títulos. Um detalhe que a primeira execução ensinou: a
      // ordem decrescente NÃO é a lista crescente ao contrário, porque os nulos ficam no fim nas
      // duas direções — de propósito (ver `ORDENS.value`). Afirmar o inverso exato acusaria de
      // defeito justamente o comportamento que a fase escolheu.
      const monotonica = (v: Array<number | null>, sentido: "asc" | "desc") => {
        const comValor = v.filter((x): x is number => x !== null);
        const nulosNoFim = v.findIndex((x) => x === null) === -1 || v.slice(comValor.length).every((x) => x === null);
        const ordenada = comValor.every((x, i) => i === 0 || (sentido === "asc" ? comValor[i - 1] <= x : comValor[i - 1] >= x));
        return { ordenada, nulosNoFim, quantosComValor: comValor.length, quantosNulos: v.length - comValor.length };
      };
      medidas[`${viewport.id}-ordenacao`] = {
        padrao: antes.slice(0, 4),
        valorAsc: porValorAsc.slice(0, 4),
        valorDesc: porValorDesc.slice(0, 4),
        mudouAoOrdenar: JSON.stringify(antes) !== JSON.stringify(porValorAsc),
        crescente: monotonica(valoresAsc, "asc"),
        decrescente: monotonica(valoresDesc, "desc"),
        primeiroMudouComADirecao: porValorAsc[0] !== porValorDesc[0],
      };
      await pAdmin.screenshot({ path: path.join(SAIDA, `${viewport.id}-fila-ordenada-por-valor.png`) });

      // ─── o filtro por coluna, também medido ────────────────────────────────
      const opcoes = await pAdmin.evaluate(`(() => {
        const s = document.querySelector("[data-testid='filtro-vertical']");
        return s ? [...s.querySelectorAll("option")].map((o) => o.value) : null;
      })()`);
      const escolhida = ((opcoes as string[]) || []).filter(Boolean)[0];
      await pAdmin.getByTestId("filtro-vertical").selectOption(escolhida);
      await settle(pAdmin);
      const filtrada = (await pAdmin.evaluate(TITULOS_DA_FILA)) as string[];
      medidas[`${viewport.id}-filtro-por-coluna`] = {
        opcoes,
        escolhida,
        linhasAntes: porValorDesc.length,
        linhasDepois: filtrada.length,
        recortou: filtrada.length < porValorDesc.length,
      };
      await pAdmin.screenshot({ path: path.join(SAIDA, `${viewport.id}-fila-filtrada.png`) });

      // ─── a seção nova da Administração ─────────────────────────────────────
      await pAdmin.getByRole("button", { name: "Configurações", exact: true }).first().click();
      await settle(pAdmin);
      await pAdmin.getByRole("button", { name: "Demandas", exact: false }).first().click();
      await pAdmin.waitForSelector("[data-testid='admin-demandas-prazos']", { timeout: 20000 });
      await settle(pAdmin);
      await pAdmin.screenshot({ path: path.join(SAIDA, `${viewport.id}-admin-demandas-prazos.png`) });
      medidas[`${viewport.id}-admin-prazos`] = await pAdmin.evaluate(`(() => ({
        temPainelDeSla: !!document.querySelector("[data-testid='sla-desempenho']"),
        temSalvar: !!document.querySelector("[data-testid='sla-salvar']"),
        // A frase da D20 não pode sumir por mudar de lugar.
        diz0CrmNuncaVeDesempenho: document.body.innerText.includes("nunca o desempenho de quem trabalha nesta fila"),
      }))()`);

      await pAdmin.getByTestId("admin-demandas-expurgos").click();
      await settle(pAdmin);
      await pAdmin.screenshot({ path: path.join(SAIDA, `${viewport.id}-admin-demandas-expurgos.png`) });
      medidas[`${viewport.id}-admin-expurgos`] = await pAdmin.evaluate(`(() => ({
        temPainelDeExpurgo: !!document.querySelector("[data-testid='demand-purge-panel']"),
      }))()`);
      medidas[`${viewport.id}-erros-admin`] = errosAdmin;
      await ctxAdmin.close();

      // ─── 2. o PRÉ-VENDAS, que é quem o buraco atingiria ────────────────────
      const ctxEquipe = await navegador.newContext(contextOptionsFor(viewport));
      const pEquipe = await ctxEquipe.newPage();
      const errosEquipe: string[] = [];
      pEquipe.on("pageerror", (e) => errosEquipe.push(String(e?.message || e)));

      await login(pEquipe, { baseUrl: BASE, email: EMAIL_EQUIPE, password: SENHA });
      await stabilize(pEquipe);
      await settle(pEquipe);
      const abasEquipe = await pEquipe.evaluate(ABAS_DO_TOPO);
      medidas[`${viewport.id}-equipe-abas`] = abasEquipe;
      medidas[`${viewport.id}-equipe-sem-configuracoes`] = !(abasEquipe as string[]).some((r) =>
        /^Configura/.test(r)
      );
      const ponteEquipe = pEquipe.getByTestId("home-fila-de-pre-vendas");
      await ponteEquipe.waitFor({ state: "visible", timeout: 20000 });
      await pEquipe.screenshot({ path: path.join(SAIDA, `${viewport.id}-equipe-inicio.png`) });
      await ponteEquipe.click();
      await pEquipe.waitForSelector("table tbody tr", { timeout: 20000 });
      await settle(pEquipe);
      await pEquipe.screenshot({ path: path.join(SAIDA, `${viewport.id}-equipe-fila.png`) });
      medidas[`${viewport.id}-equipe-alcanca-a-fila`] = ((await pEquipe.evaluate(TITULOS_DA_FILA)) as string[]).length > 0;
      // Apontar para uma seção que esta pessoa não abre seria pior do que não apontar.
      medidas[`${viewport.id}-equipe-nao-ve-o-atalho-da-administracao`] = !(await pEquipe.evaluate(
        `document.body.innerText.includes("Configurações › Demandas")`
      ));
      medidas[`${viewport.id}-erros-equipe`] = errosEquipe;
      await ctxEquipe.close();
    }
  } finally {
    await navegador.close();
    await prisma.$disconnect();
  }

  fs.writeFileSync(path.join(SAIDA, "medidas.json"), JSON.stringify(medidas, null, 2));
  console.log(JSON.stringify(medidas, null, 2));
  console.log(`\ncapturas em ${SAIDA}`);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
