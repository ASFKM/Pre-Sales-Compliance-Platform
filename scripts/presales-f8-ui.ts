/**
 * PreSales F8 — prova da INTERFACE, no navegador de verdade.
 *
 * scripts/presales-f8-provar.ts prova o servidor pelas rotas. Esta prova cobre a outra metade da
 * PARTE A, que rota nenhuma alcança: a caixa de texto do parecer existe na tela, o botão de
 * REJEITAR fica DESABILITADO enquanto ela estiver vazia, e habilita quando o aprovador escreve —
 * e a PARTE B: o botão "Reabrir e Editar" aparece numa proposta rejeitada, e a versão sai com o
 * número real ao lado do link para a versão anterior.
 *
 * Sem isso, o "campo obrigatório" da fase estaria provado só do lado do servidor, e uma tela que
 * manda texto vazio e leva 400 na cara do usuário passaria como pronta.
 *
 *   PROVA_PASSWORD=<senha do usuário da prova> npx tsx scripts/presales-f8-ui.ts
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { chromium, Page } from "@playwright/test";
import { prisma } from "../src/prisma";
import { runWithTenant } from "../src/tenantContext";
import { login, settle } from "./uiScreens";

const TENANT = process.env.PROVA_TENANT || "tenant_default";
const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const EMAIL = "prova-presales-f8-gerente@local.invalid";
const PROJETO = "prova-f8-projeto";
const SAIDA = process.env.PROVA_SAIDA || "/tmp/presales-f8-ui";

let passou = 0;
let falhou = 0;
const linhas: string[] = [];

function checar(rotulo: string, condicao: boolean, detalhe: string) {
  if (condicao) { passou++; linhas.push(`  OK    ${rotulo} — ${detalhe}`); }
  else { falhou++; linhas.push(`  FALHA ${rotulo} — ${detalhe}`); }
}

async function abrirAba(page: Page, nome: string) {
  const nav = page.locator("nav").first();
  await nav.getByRole("button", { name: nome, exact: true }).first().click();
  await settle(page);
}

async function main() {
  const senha = process.env.PROVA_PASSWORD;
  if (!senha) throw new Error("PROVA_PASSWORD ausente");
  fs.mkdirSync(SAIDA, { recursive: true });

  // O cenário é o que scripts/presales-f8-provar.ts deixou no projeto dedicado (uma rejeitada e a
  // v2 dela). Falta uma proposta ENVIADA com etapa pendente para a caixa de parecer aparecer — se
  // não houver, esta prova cria uma pelas rotas reais, do mesmo jeito que um usuário faria.
  const cenario = await runWithTenant({ tenantId: TENANT, canSeeAllProjects: true }, async () => {
    let submetida = await prisma.proposal.findFirst({ where: { projectId: PROJETO, status: "submitted" } });
    const rejeitada = await prisma.proposal.findFirst({ where: { projectId: PROJETO, status: "rejected" } });

    if (!submetida) {
      const entrada = await fetch(`${BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: EMAIL, password: senha }),
      });
      const corpo: any = await entrada.json().catch(() => ({}));
      const token = corpo?.token || corpo?.session_token;
      if (!token) throw new Error(`login de API falhou para o cenário: status=${entrada.status}`);
      const sessao = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

      const template = await prisma.proposalTemplate.findFirst({ where: { tenantId: TENANT, active: true, templateType: "commercial" } });
      if (!template) throw new Error("nenhum template ATIVO do tipo 'commercial'");
      const antes = (await prisma.proposal.findMany({ where: { projectId: PROJETO }, select: { id: true } })).map((p) => p.id);
      const geracao = await fetch(`${BASE}/api/projects/${PROJETO}/proposals/commercial`, {
        method: "POST",
        headers: sessao,
        body: JSON.stringify({
          template_id: template.id,
          language: "Portuguese",
          payment_terms: "30/60/90 dias (cenário da prova de interface)",
          delivery_terms: "45 dias após o pedido",
          proposal_validity: "2026-12-31",
        }),
      });
      if (geracao.status !== 202) throw new Error(`geração recusada: ${geracao.status} ${(await geracao.text()).slice(0, 200)}`);
      for (let i = 0; i < 60 && !submetida; i++) {
        const nova = await prisma.proposal.findFirst({ where: { projectId: PROJETO, id: { notIn: antes } }, orderBy: { generatedAt: "desc" } });
        if (nova) {
          const envio = await fetch(`${BASE}/api/proposals/${nova.id}/approval/submit`, { method: "POST", headers: sessao });
          if (envio.status !== 200) throw new Error(`submissão recusada: ${envio.status}`);
          submetida = await prisma.proposal.findUnique({ where: { id: nova.id } });
          break;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    return { submetida, rejeitada };
  });
  checar(
    "o cenário tem uma proposta ENVIADA (etapa pendente) e uma REJEITADA no mesmo projeto",
    !!cenario.submetida && !!cenario.rejeitada,
    `submetida=${cenario.submetida?.id} rejeitada=${cenario.rejeitada?.id}`
  );

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "pt-BR" });
    const page = await context.newPage();
    await login(page, { baseUrl: BASE, email: EMAIL, password: senha });

    // ── PARTE B na tela: o botão de reabrir, e a versão real no cabeçalho ────────────────────
    await abrirAba(page, "Estúdio de Propostas");
    const cardRejeitada = page.locator(`#proposal-${cenario.rejeitada?.id}`);
    await cardRejeitada.waitFor({ state: "visible", timeout: 20000 });
    const botaoReabrir = cardRejeitada.getByRole("button", { name: /Reabrir e Editar/i });
    checar("o card da proposta rejeitada mostra o botão \"Reabrir e Editar\"", await botaoReabrir.isVisible(), `card=#proposal-${cenario.rejeitada?.id}`);
    // `innerText` devolve o texto COMO RENDERIZADO, e o h3 tem `uppercase` — a comparação precisa
    // ser insensível a caixa, senão a prova falha por causa do CSS e não do produto.
    const tituloRejeitada = (await cardRejeitada.locator("h3").first().innerText()).trim();
    checar(
      "o cabeçalho traz a versão REAL da proposta (e não mais o literal \"v1.0\" fixo no código)",
      /-\s*v\d+$/i.test(tituloRejeitada) && !/v\d+\.0$/i.test(tituloRejeitada),
      `título=${tituloRejeitada}`
    );

    const v2 = await runWithTenant({ tenantId: TENANT, canSeeAllProjects: true }, () =>
      prisma.proposal.findFirst({ where: { previousVersionId: cenario.rejeitada?.id ?? "" } })
    );
    if (v2) {
      const cardV2 = page.locator(`#proposal-${v2.id}`);
      const linkAnterior = cardV2.getByRole("link", { name: `v${v2.version - 1}` });
      checar(
        "a versão nova mostra o link para a versão anterior",
        await linkAnterior.isVisible(),
        `href=${await linkAnterior.getAttribute("href")}`
      );
    }
    await page.screenshot({ path: path.join(SAIDA, "estudio-propostas-reabrir.png") });

    // ── PARTE A na tela: a caixa de parecer e o botão de rejeitar que só habilita com texto ──
    await abrirAba(page, "Centro de Aprovação");
    const cardSubmetida = page.locator("div", { hasText: cenario.submetida?.id ?? "" });
    await page.getByText(cenario.submetida?.id ?? "", { exact: false }).first().waitFor({ state: "visible", timeout: 20000 });

    const caixa = page.locator("textarea[id^='approval-comment-']").first();
    await caixa.waitFor({ state: "visible", timeout: 20000 });
    checar("a etapa pendente mostra a CAIXA DE TEXTO do parecer do aprovador", await caixa.isVisible(), `id=${await caixa.getAttribute("id")}`);
    checar("e ela começa VAZIA — nenhuma frase fixa é enviada por baixo dos panos", (await caixa.inputValue()) === "", `valor=${JSON.stringify(await caixa.inputValue())}`);

    const acoes = caixa.locator("xpath=following-sibling::div[1]");
    const botaoRejeitar = acoes.getByRole("button", { name: "Rejeitar" });
    const botaoAprovar = acoes.getByRole("button", { name: "Aprovar" });
    checar("com a caixa vazia, REJEITAR está desabilitado", await botaoRejeitar.isDisabled(), "disabled=true");
    checar("e APROVAR continua habilitado (comentário é opcional na aprovação)", await botaoAprovar.isEnabled(), "disabled=false");
    await page.screenshot({ path: path.join(SAIDA, "aprovacao-motivo-vazio.png") });

    await caixa.fill("Margem abaixo da alçada comercial: rever o desconto do switch.");
    await page.waitForTimeout(200);
    checar("depois de o aprovador escrever o motivo, REJEITAR habilita", await botaoRejeitar.isEnabled(), "disabled=false");
    await page.screenshot({ path: path.join(SAIDA, "aprovacao-motivo-preenchido.png") });

    for (const arquivo of ["estudio-propostas-reabrir.png", "aprovacao-motivo-vazio.png", "aprovacao-motivo-preenchido.png"]) {
      const bytes = fs.statSync(path.join(SAIDA, arquivo)).size;
      checar(`a captura ${arquivo} tem tamanho real`, bytes > 20000, `${bytes} bytes`);
    }
    void cardSubmetida;
  } finally {
    await browser.close();
  }
}

main()
  .then(() => {
    console.log(linhas.join("\n"));
    console.log(`\n${passou} OK, ${falhou} FALHA (capturas em ${SAIDA})`);
    process.exit(falhou > 0 ? 1 : 0);
  })
  .catch((err) => {
    console.log(linhas.join("\n"));
    console.error("\nERRO:", err);
    process.exit(1);
  });
