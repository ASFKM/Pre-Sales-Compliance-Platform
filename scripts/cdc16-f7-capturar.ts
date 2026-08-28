/**
 * CDC 16 — Fase 7. Prova visual do ciclo de vida: a atualização pendente, o pedido de
 * cancelamento e o registro do expurgo.
 *
 * Mesmos helpers da rede de captura do produto (`scripts/uiScreens.ts`): login pela tela real,
 * estabilização de animação, as duas larguras (1440 e 390). As imagens saem FORA de
 * `docs/visual-baseline/` — regravar parte do baseline muda o trajeto de `npm run test:visual`
 * sem ninguém pedir.
 *
 * O cenário é montado pela PORTA e pelas ROTAS, e não por insert: é o mesmo caminho que o CMCRM
 * usa, e é o que garante que a tela mostra o que a porta escreve.
 *
 *   BASE_URL=http://127.0.0.1:3010 PROVA_PASSWORD=… PAIR_KEY=… SAIDA=/tmp/cdc16-f7 \
 *     npx tsx scripts/cdc16-f7-capturar.ts
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { chromium } from "@playwright/test";
import { prisma } from "../src/prisma";
import { runWithTenant } from "../src/tenantContext";
import { VIEWPORTS, contextOptionsFor, login, settle, stabilize } from "./uiScreens";
import { PAPEIS_DA_PROVA, chamarRota, entrarComo, papelDaProva } from "./cdc16-f5-comum";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3010";
const PORTA = `${BASE}/api/external/crm/v1`;
const SAIDA = process.env.SAIDA || "/tmp/cdc16-f7";
const TENANT = process.env.PROVA_TENANT || "tenant_default";
const PREFIXO = "captura-cdc16-f7-";
const EMAIL = `${PREFIXO}ana@teste.invalid`;
const SENHA = process.env.PROVA_PASSWORD || "";
const CHAVE = process.env.PAIR_KEY || "";

// As MESMAS larguras do baseline do produto, com a ALTURA aumentada. Neste shell quem rola é um
// container interno, então `fullPage` captura a viewport e nada mais — a F3 perdeu uma timeline
// inteira assim.
const ALTOS = VIEWPORTS.map((v) => ({ ...v, height: v.isMobile ? 2400 : 1800 }));

const FICHA = {
  title: `${PREFIXO}Videomonitoramento urbano`,
  vertical: "Segurança Pública",
  description: "Implantação de 40 pontos de monitoramento no centro.",
  deadline: "2026-09-30",
  proposal_validity_date: "2026-10-30",
  output_language: "Portuguese" as const,
  proposal_language: "Portuguese" as const,
  ai_orientation_mode: "Vendor-neutral" as const,
};

async function bater(metodo: string, caminho: string, corpo?: unknown, idem?: string) {
  const headers: Record<string, string> = { "X-Pair-Key": CHAVE, "Content-Type": "application/json" };
  if (idem) headers["Idempotency-Key"] = idem;
  const r = await fetch(`${PORTA}${caminho}`, {
    method: metodo,
    headers,
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  return { status: r.status, corpo: await r.json().catch(() => null) };
}

/** O cenário: uma demanda ASSUMIDA, com atualização pendente e pedido de cancelamento aberto. */
async function montarCenario(): Promise<void> {
  const ref = `${PREFIXO}demanda`;
  await runWithTenant({ tenantId: TENANT, canSeeAllProjects: true }, async () => {
    const antigas = await prisma.demand.findMany({ where: { demandRef: { startsWith: PREFIXO } }, select: { id: true, projectId: true } });
    const ids = antigas.map((d) => d.id);
    if (ids.length) {
      await prisma.demandUpdate.deleteMany({ where: { demandId: { in: ids } } });
      await prisma.demandOutboundEvent.deleteMany({ where: { demandId: { in: ids } } });
      await prisma.demandDocument.deleteMany({ where: { demandId: { in: ids } } });
      await prisma.demand.deleteMany({ where: { id: { in: ids } } });
    }
    const projetos = antigas.map((d) => d.projectId).filter((p): p is string => Boolean(p));
    if (projetos.length) await prisma.project.deleteMany({ where: { id: { in: projetos } } });
    // A CHAVE DE IDEMPOTÊNCIA sai junto da demanda que ela criou. Sem isto, a segunda execução
    // manda a mesma chave com `sent_at` novo — corpo diferente — e leva um 409 corretíssimo, que
    // parece defeito do produto e é da montagem do cenário. É a mesma armadilha que a F1
    // registrou ao remontar o envelope a cada tentativa.
    await prisma.idempotencyRecord.deleteMany({ where: { key: { startsWith: "captura-f7" } } });
  });

  const criada = await bater(
    "POST",
    "/demands",
    {
      demand_ref: ref,
      company: { crm_company_id: `${PREFIXO}cmp`, name: `${PREFIXO}Prefeitura de Teste` },
      opportunity: {
        crm_opportunity_id: `${PREFIXO}opp`,
        name: `${PREFIXO}Pregão 12/2026`,
        currency: "BRL",
        value: 250000,
        stage: "Proposta",
        margin_percent: 18.5,
      },
      sheet: FICHA,
      objective: "Dimensionamento técnico e proposta comercial.",
      sent_by: { crm_user_id: "crm_u1", name: `${PREFIXO}Vendedor` },
      sent_at: new Date().toISOString(),
    },
    `captura-f7-cria`,
  );
  if (criada.status !== 201) throw new Error(`não consegui criar a demanda: ${criada.status}`);

  const papel = await papelDaProva(`${PREFIXO}equipe`, PAPEIS_DA_PROVA.equipe);
  const ana = await entrarComo(`${PREFIXO}Ana`, EMAIL, papel.id, SENHA, () => undefined);
  if (!ana) throw new Error("o login da montagem falhou");

  const demanda = await runWithTenant({ tenantId: TENANT, canSeeAllProjects: true }, () =>
    prisma.demand.findFirstOrThrow({ where: { demandRef: ref } }),
  );
  const assumida = await chamarRota(ana, "POST", `/api/demands/${demanda.id}/assume`, {});
  if (assumida.status !== 200) throw new Error(`não consegui assumir: ${assumida.status}`);

  // A atualização que ESPERA decisão (D27): prazo do edital adiado por impugnação.
  await bater(
    "PATCH",
    `/demands/${ref}`,
    {
      sheet: { ...FICHA, deadline: "2026-10-15", proposal_validity_date: "2026-11-15" },
      changed_by: { crm_user_id: "crm_u1", name: `${PREFIXO}Vendedor` },
      changed_at: new Date().toISOString(),
      note: "Prazo adiado por impugnação julgada procedente.",
    },
    "captura-f7-patch",
  );

  // E o pedido de cancelamento, que só pode existir sobre uma demanda ASSUMIDA (D18).
  await bater("POST", `/demands/${ref}/cancel`, {
    justification: "O cliente suspendeu o processo licitatório por decisão judicial.",
    approved_by: { crm_user_id: "crm_lider", name: `${PREFIXO}Líder Direto` },
  });

  // Um expurgo executado, para o painel de registro ter o que mostrar (D35).
  await bater("POST", "/purge", {
    reason: "retention",
    targets: [{ kind: "document", crm_id: `${PREFIXO}crmdoc-antigo` }],
  });
}

async function main() {
  if (!SENHA) throw new Error("PROVA_PASSWORD ausente.");
  if (!CHAVE) throw new Error("PAIR_KEY ausente.");
  fs.mkdirSync(SAIDA, { recursive: true });
  await montarCenario();

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
      await pagina.screenshot({ path: path.join(SAIDA, `${viewport.id}-fila-com-aviso.png`) });

      // O aviso do topo existe e CONTA: um banner sem número seria decorativo.
      const aviso = await pagina.evaluate(`(() => {
        const el = document.querySelector("[data-testid='aviso-ciclo-de-vida']");
        return el ? el.innerText.replace(/\\s+/g, " ").trim() : null;
      })()`);
      medidas[`${viewport.id}-aviso`] = aviso;

      // O DETALHE, que é onde o antes e o depois aparecem.
      //
      // Quem abre a gaveta é o BOTÃO com o título da demanda, e não a linha: clicar na linha
      // acerta uma célula que não tem gatilho nenhum, e a captura sai idêntica à da fila — foi o
      // que a primeira execução produziu, com as medidas dizendo `temAtualizacao: false` sobre
      // uma tela que nunca chegou a abrir.
      await pagina.getByRole("button", { name: `${PREFIXO}Videomonitoramento urbano` }).first().click();
      await pagina.waitForSelector("[data-testid='modal-atualizacoes-pendentes']", { timeout: 15000 });
      await settle(pagina);
      await pagina.screenshot({ path: path.join(SAIDA, `${viewport.id}-detalhe-ciclo.png`) });

      const detalhe = await pagina.evaluate(`(() => {
        const secao = document.querySelector("[data-testid='modal-atualizacoes-pendentes']");
        const cancelamento = document.querySelector("[data-testid='modal-cancelamento-pendente']");
        const linhas = secao ? [...secao.querySelectorAll("li")].map((li) => li.innerText.replace(/\\s+/g, " ").trim()) : [];
        return {
          temAtualizacao: !!secao,
          temCancelamento: !!cancelamento,
          mudancas: linhas,
          botaoIncorporar: !!document.querySelector("[data-testid^='incorporar-']"),
          botaoEncerrar: !!document.querySelector("[data-testid='encerrar-demanda']"),
        };
      })()`);
      medidas[`${viewport.id}-detalhe`] = detalhe;

      // A terceira vista: o registro do expurgo.
      //
      // A gaveta fecha pelo FUNDO, e não por Escape: ela não escuta a tecla, e um Escape que não
      // fecha deixa o overlay interceptando todo clique seguinte — o erro sai como "o botão
      // Expurgos não pôde ser clicado", a dezenas de linhas de distância da causa.
      await pagina.mouse.click(20, 20);
      await pagina.waitForSelector("[data-testid='demand-detail-body']", { state: "detached", timeout: 10000 });
      await settle(pagina);
      await pagina.getByTestId("demand-vista-expurgos").click();
      await settle(pagina);
      await pagina.screenshot({ path: path.join(SAIDA, `${viewport.id}-expurgos.png`) });
      const expurgos = await pagina.evaluate(`(() => {
        const lista = document.querySelector("[data-testid='purge-lista']");
        return { temPainel: !!document.querySelector("[data-testid='demand-purge-panel']"), execucoes: lista ? lista.children.length : 0 };
      })()`);
      medidas[`${viewport.id}-expurgos`] = expurgos;
      medidas[`${viewport.id}-erros`] = erros;

      await contexto.close();
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
