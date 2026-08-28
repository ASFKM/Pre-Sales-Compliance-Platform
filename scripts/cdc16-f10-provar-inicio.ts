/**
 * CDC 16 — Fase 10. Prova por execução real: a Início vira painel, lida PELAS ROTAS.
 *
 * Roda no host do PreSales, contra um servidor de prova em banco dedicado. As demandas entram
 * pela PORTA DE MÁQUINA real, com a chave real do par; tudo é exercitado por HTTP, com login de
 * verdade. Chamar o domínio direto passaria sem tocar o gancho da rota — armadilha já paga aqui.
 *
 * SETE seções:
 *
 *  1. os dois cards e a D15: o card das novas é a fila de TODA a equipe, e "Minhas demandas" é
 *     uma vista de conveniência — provado pelos dois lados, o meu e o do colega;
 *  2. a página de CINCO, que é o que o dono pediu, com o total do recorte por trás;
 *  3. os CONTADORES vindos do total do recorte, e não da página — o defeito que esta fase existe
 *     para consertar, afirmado com a página deliberadamente menor do que a contagem;
 *  4. a ordenação pelas quatro colunas dos cards, incluindo o prazo do SLA, que não é coluna;
 *  5. os recortes que ganharam controle de tela nesta fase: busca livre, faixa de valor, cliente;
 *  6. o card de tarefas saiu INTEIRO: a rota morreu, e morreu como rota e não como HTML da SPA;
 *  7. a régua do desempenho que o gráfico da Início desenha (D20 / resposta F).
 *
 *   PROVA_PASSWORD=… PAIR_KEY=… npx tsx scripts/cdc16-f10-provar-inicio.ts
 */
import "dotenv/config";
import { prisma } from "../src/prisma";
import { runWithTenant } from "../src/tenantContext";
import { lerChaveDoCrm } from "../server/utils/crmPort";
import { PAPEIS_DA_PROVA, chamarRota, entrarComo, papelDaProva } from "./cdc16-f5-comum";

const TENANT = process.env.PROVA_TENANT || "tenant_default";
const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const PORTA = `${BASE}/api/external/crm/v1`;
const PREFIXO = "prova-cdc16-f10-";
const CRM_BASE = process.env.CRM_BASE_URL || "https://192.168.3.197:3000";

let passou = 0;
let falhou = 0;
const linhas: string[] = [];

function checar(rotulo: string, condicao: boolean, detalhe: string) {
  if (condicao) {
    passou++;
    linhas.push(`  OK    ${rotulo} — ${detalhe}`);
  } else {
    falhou++;
    linhas.push(`  FALHA ${rotulo} — ${detalhe}`);
  }
}

let CHAVE = "";

async function bater(metodo: string, caminho: string, opcoes: { corpo?: unknown; idem?: string } = {}) {
  const cabecalhos: Record<string, string> = { "Content-Type": "application/json" };
  if (CHAVE) cabecalhos["X-Pair-Key"] = CHAVE;
  if (opcoes.idem) cabecalhos["Idempotency-Key"] = opcoes.idem;
  const r = await fetch(`${PORTA}${caminho}`, {
    method: metodo,
    headers: cabecalhos,
    body: opcoes.corpo === undefined ? undefined : JSON.stringify(opcoes.corpo),
  });
  const bruto = await r.text();
  let json: any = null;
  try {
    json = bruto ? JSON.parse(bruto) : null;
  } catch {
    json = null;
  }
  return { status: r.status, json, bruto };
}

/**
 * OITO demandas, e o número não é gratuito: a página é de cinco, e com oito
 * existem duas páginas de tamanhos diferentes — a segunda parcial é o que
 * prova que o botão de avançar desliga na hora certa em vez de nunca.
 * Valores, verticais, títulos, clientes e prazos diferentes de propósito: uma
 * ordenação só se prova quando a ordem pedida é diferente da de inserção, e um
 * filtro só se prova quando existe o que ele deve deixar de FORA.
 */
const CENARIO = [
  { n: 1, titulo: "Alfa videomonitoramento", vertical: "Segurança Pública", valor: 500_000, prazo: "2026-12-20", empresa: "Prefeitura Norte" },
  { n: 2, titulo: "Bravo rede hospitalar", vertical: "Saúde", valor: 120_000, prazo: "2026-09-10", empresa: "Hospital Central" },
  { n: 3, titulo: "Charlie datacenter", vertical: "TIC", valor: 900_000, prazo: "2026-11-05", empresa: "Autarquia Sul" },
  { n: 4, titulo: "Delta escolas conectadas", vertical: "Educação", valor: 45_000, prazo: "2026-10-01", empresa: "Prefeitura Norte" },
  { n: 5, titulo: "Echo laboratório", vertical: "Saúde", valor: null as number | null, prazo: "2026-09-25", empresa: "Hospital Central" },
  { n: 6, titulo: "Foxtrot iluminação", vertical: "Cidades", valor: 300_000, prazo: "2027-01-15", empresa: "Consórcio Leste" },
  { n: 7, titulo: "Golf saneamento", vertical: "Cidades", valor: 750_000, prazo: "2026-10-20", empresa: "Consórcio Leste" },
  { n: 8, titulo: "Hotel transporte urbano", vertical: "Mobilidade", valor: 220_000, prazo: "2026-11-28", empresa: "Autarquia Sul" },
];

function ref(n: number) {
  return `${PREFIXO}d${n}`;
}

function envelope(c: (typeof CENARIO)[number]) {
  return {
    demand_ref: ref(c.n),
    company: { crm_company_id: `${PREFIXO}cmp${c.n}`, name: `${PREFIXO}${c.empresa}` },
    opportunity: {
      crm_opportunity_id: `${PREFIXO}opp${c.n}`,
      name: `${PREFIXO}Pregão ${c.n}/2026`,
      currency: "BRL",
      ...(c.valor === null ? {} : { value: c.valor }),
      stage: "Proposta",
    },
    sheet: {
      title: `${PREFIXO}${c.titulo}`,
      vertical: c.vertical,
      description: `Objeto da demanda ${c.n} da prova da F10.`,
      deadline: c.prazo,
      proposal_validity_date: "2027-06-30",
      output_language: "Portuguese" as const,
      proposal_language: "Portuguese" as const,
      ai_orientation_mode: "Vendor-neutral" as const,
    },
    sent_by: { crm_user_id: "crm_u1", name: `${PREFIXO}Vendedor` },
    // Espaçados um minuto entre si: `queued_at` é o desempate do padrão e a base do prazo do SLA
    // na etapa de assumir. Com todos no mesmo instante, "ordenou por chegada" seria indistinguível
    // de "não ordenou".
    sent_at: new Date(Date.now() - (12 - c.n) * 60_000).toISOString(),
    crm_callback_base_url: `${CRM_BASE}/api/external/presales/v1`,
  };
}

async function limpar() {
  const demandas = await prisma.demand.findMany({
    where: { demandRef: { startsWith: PREFIXO } },
    select: { id: true, projectId: true },
  });
  const ids = demandas.map((d) => d.id);
  const projetos = demandas.map((d) => d.projectId).filter((p): p is string => Boolean(p));
  if (ids.length) {
    await prisma.demandUpdate.deleteMany({ where: { demandId: { in: ids } } });
    await prisma.demandOutboundEvent.deleteMany({ where: { demandId: { in: ids } } });
    await prisma.demandDocument.deleteMany({ where: { demandId: { in: ids } } });
    await prisma.demandSlaBreach.deleteMany({ where: { demandId: { in: ids } } });
    await prisma.demand.deleteMany({ where: { id: { in: ids } } });
  }
  if (projetos.length) {
    await prisma.documentContent.deleteMany({ where: { document: { projectId: { in: projetos } } } });
    await prisma.document.deleteMany({ where: { projectId: { in: projetos } } });
    await prisma.project.deleteMany({ where: { id: { in: projetos } } });
  }
  await prisma.project.deleteMany({ where: { name: { startsWith: PREFIXO } } });
  await prisma.idempotencyRecord.deleteMany({ where: { key: { startsWith: "f10-" } } });
}

/** Só as demandas DESTA prova, para as asserções não dependerem do que já havia no banco. */
function minhas(itens: any[]) {
  return (itens || []).filter((d) => String(d.demand_ref).startsWith(PREFIXO));
}

function titulos(itens: any[]) {
  return minhas(itens).map((d) => String(d.title).replace(PREFIXO, ""));
}

/**
 * Liga a bandeira de gestão de frota o tempo do poll de licença e a desliga.
 * O poll é um GET; nada é escrito no CMSaaS. Ver o comentário no ponto de uso.
 */
async function aquecerLicenca() {
  const { runLicenseStatusPollForTenant, getFleetLicenseStatus } = await import("../server/utils/fleetLicense");
  const antes = await getFleetLicenseStatus(TENANT);
  if (antes.installation_id) {
    checar("licença já reconhecida", true, `installation_id=${antes.installation_id}`);
    return;
  }
  await prisma.$executeRawUnsafe(
    "update platform_settings set fleet_manager_enabled = true where tenant_id = $1",
    TENANT
  );
  try {
    await runLicenseStatusPollForTenant(TENANT);
  } finally {
    await prisma.$executeRawUnsafe(
      "update platform_settings set fleet_manager_enabled = false where tenant_id = $1",
      TENANT
    );
  }
  const depois = await getFleetLicenseStatus(TENANT);
  checar("licença aquecida por leitura", !!depois.installation_id, `installation_id=${depois.installation_id}`);
}

async function main() {
  const senha = process.env.PROVA_PASSWORD;
  if (!senha) throw new Error("PROVA_PASSWORD ausente — a prova percorre as rotas com login real");

  await runWithTenant({ tenantId: TENANT, canSeeAllProjects: true }, async () => {
    linhas.push(`(base=${BASE}, tenant=${TENANT})`);

    const guardada = await lerChaveDoCrm(TENANT).catch(() => null);
    CHAVE = process.env.PAIR_KEY || (guardada as any)?.key || "";
    if (!CHAVE) throw new Error("PAIR_KEY ausente e nenhuma chave guardada — a porta não pode ser exercitada");

    // O banco de prova tem `fleet_manager_enabled = false`, e por isso o cache de licença fica
    // FRIO: sem licença, `getFleetLicenseStatus` devolve `installation_id: null` e a porta do par
    // recusa a chave BOA com `pair_not_for_this_installation` — que parece defeito do par e é do
    // ambiente. O aquecimento usa o caminho de LEITURA do próprio produto, nunca o heartbeat
    // completo, que POSTaria o retrato deste servidor de prova ao CMSaaS real.
    await aquecerLicenca();

    const ate = Date.now() + 120_000;
    let pronta = false;
    while (Date.now() < ate) {
      const r = await bater("GET", "/pair/verify");
      if (r.status === 200) { pronta = true; break; }
      await new Promise((res) => setTimeout(res, 3000));
    }
    checar("a porta reconhece a chave do par", pronta, pronta ? "/pair/verify respondeu 200" : "esgotou 120 s");
    if (!pronta) throw new Error("a porta não reconheceu a chave do par — sem ela não há o que provar");

    await limpar();
    // A política volta ao padrão antes de tudo: uma execução interrompida deixaria a instalação de
    // prova em `direcionamento`, e a seção 1 mediria outra coisa.
    await prisma.demandSlaSettings.deleteMany({ where: {} });

    for (const c of CENARIO) {
      const r = await bater("POST", "/demands", { corpo: envelope(c), idem: `f10-cria-${c.n}` });
      if (r.status !== 201) throw new Error(`não consegui criar ${ref(c.n)}: ${r.status} ${r.bruto}`);
    }
    checar("preparo", true, `${CENARIO.length} demandas criadas pela porta de máquina`);

    const papelEquipe = await papelDaProva(`${PREFIXO}equipe`, PAPEIS_DA_PROVA.equipe);
    const papelGerente = await papelDaProva(`${PREFIXO}gerente`, PAPEIS_DA_PROVA.gerente);
    const papelAdmin = await papelDaProva(`${PREFIXO}admin`, PAPEIS_DA_PROVA.admin);
    const ana = await entrarComo(`${PREFIXO}Ana`, "f10-ana@exemplo.invalid", papelEquipe.id, senha, checar);
    const bruno = await entrarComo(`${PREFIXO}Bruno`, "f10-bruno@exemplo.invalid", papelEquipe.id, senha, checar);
    const gina = await entrarComo(`${PREFIXO}Gina`, "f10-gina@exemplo.invalid", papelGerente.id, senha, checar);
    const admin = await entrarComo(`${PREFIXO}Alberto`, "f10-alberto@exemplo.invalid", papelAdmin.id, senha, checar);
    if (!ana || !bruno || !gina || !admin) throw new Error("login real falhou — sem sessão não há prova pelas rotas");

    /** O card "Novas demandas": o que ninguém assumiu, do jeito que a tela pede. */
    const novas = async (sessao: any, extra = "") =>
      chamarRota(sessao, "GET", `/api/demands?status=queued&assigned_user_id=none&limit=200${extra}`);
    /** O card "Minhas demandas": o mesmo endpoint, com um recorte a mais. */
    const meu = async (sessao: any, extra = "") =>
      chamarRota(sessao, "GET", `/api/demands?status=assigned,in_analysis,returned&assigned_user_id=me&limit=200${extra}`);

    // ── 1. OS DOIS CARDS E A D15 ─────────────────────────────────────────────
    linhas.push("\n[1] os dois cards, e a D15");
    const novasDaAna = await novas(ana);
    const novasDoBruno = await novas(bruno);
    checar("o card das novas traz as oito que ninguém assumiu", titulos(novasDaAna.corpo.items).length === 8,
      titulos(novasDaAna.corpo.items).join(", "));
    checar("D15: o card das novas é IGUAL para as duas pessoas — não virou fila por gente",
      JSON.stringify(minhas(novasDaAna.corpo.items).map((d: any) => d.id)) ===
        JSON.stringify(minhas(novasDoBruno.corpo.items).map((d: any) => d.id)),
      `${minhas(novasDaAna.corpo.items).length} de cada lado`);

    const porTitulo = (itens: any[], parte: string) => minhas(itens).find((d: any) => d.title.includes(parte));
    const alfa = porTitulo(novasDaAna.corpo.items, "Alfa");
    const bravo = porTitulo(novasDaAna.corpo.items, "Bravo");
    const charlie = porTitulo(novasDaAna.corpo.items, "Charlie");
    const a1 = await chamarRota(ana, "POST", `/api/demands/${alfa.id}/assume`, {});
    const a2 = await chamarRota(ana, "POST", `/api/demands/${bravo.id}/assume`, {});
    const b1 = await chamarRota(bruno, "POST", `/api/demands/${charlie.id}/assume`, {});
    checar("Ana assume duas e Bruno assume uma, pelas rotas",
      a1.status === 200 && a2.status === 200 && b1.status === 200,
      `${a1.status}/${a2.status}/${b1.status}`);

    const novasDepois = await novas(ana);
    const tNovas = titulos(novasDepois.corpo.items);
    checar("o card das novas NÃO mostra o que já tem dono",
      !tNovas.includes("Alfa videomonitoramento") && !tNovas.includes("Bravo rede hospitalar") &&
        !tNovas.includes("Charlie datacenter"),
      tNovas.join(", "));
    checar("e continua mostrando o que ninguém assumiu", tNovas.length === 5, `${tNovas.length} linhas`);

    const meuDaAna = await meu(ana);
    const tMeuAna = titulos(meuDaAna.corpo.items).sort();
    checar("Minhas demandas traz o MEU",
      tMeuAna.length === 2 && tMeuAna.includes("Alfa videomonitoramento") && tMeuAna.includes("Bravo rede hospitalar"),
      tMeuAna.join(", "));
    checar("e NÃO traz o do colega", !tMeuAna.includes("Charlie datacenter"), tMeuAna.join(", "));
    const meuDoBruno = await meu(bruno);
    checar("o outro lado da mesma regra: o card do colega traz o dele, e só",
      titulos(meuDoBruno.corpo.items).length === 1 && titulos(meuDoBruno.corpo.items)[0] === "Charlie datacenter",
      titulos(meuDoBruno.corpo.items).join(", "));

    // A D15 dita em voz alta: sem recorte de dono, a fila é a mesma para os dois.
    const filaAna = await chamarRota(ana, "GET", "/api/demands?status=queued,assigned,in_analysis,returned&limit=200&sort=title");
    const filaBruno = await chamarRota(bruno, "GET", "/api/demands?status=queued,assigned,in_analysis,returned&limit=200&sort=title");
    checar("D15: a fila inteira, sem recorte de dono, continua idêntica para a equipe",
      JSON.stringify(minhas(filaAna.corpo.items).map((d: any) => d.id)) ===
        JSON.stringify(minhas(filaBruno.corpo.items).map((d: any) => d.id)),
      `${minhas(filaAna.corpo.items).length} de cada lado`);

    // ── 2. A PÁGINA DE CINCO ─────────────────────────────────────────────────
    linhas.push("\n[2] cinco linhas por vez, com paginação");
    const p1 = await chamarRota(ana, "GET", "/api/demands?status=queued,assigned,in_analysis,returned&limit=5&offset=0&sort=title");
    const p2 = await chamarRota(ana, "GET", "/api/demands?status=queued,assigned,in_analysis,returned&limit=5&offset=5&sort=title");
    checar("a primeira página tem cinco linhas", p1.corpo.items.length === 5, `${p1.corpo.items.length} linhas`);
    checar("o total é o do RECORTE, e não o da página", p1.corpo.total >= 8 && p1.corpo.total === p2.corpo.total,
      `total=${p1.corpo.total} pagina=${p1.corpo.items.length}`);
    const ids1 = p1.corpo.items.map((d: any) => d.id);
    const ids2 = p2.corpo.items.map((d: any) => d.id);
    checar("a segunda página não repete nenhuma linha da primeira",
      ids1.every((i: string) => !ids2.includes(i)), `p1=${ids1.length} p2=${ids2.length}`);
    checar("as duas páginas juntas cobrem o recorte sem buraco",
      new Set([...ids1, ...ids2]).size === ids1.length + ids2.length &&
        ids1.length + ids2.length === Math.min(10, p1.corpo.total),
      `${ids1.length + ids2.length} de ${p1.corpo.total}`);
    checar("o eco confirma o que o servidor aplicou",
      p2.corpo.limit === 5 && p2.corpo.offset === 5, `limit=${p2.corpo.limit} offset=${p2.corpo.offset}`);
    const alem = await chamarRota(ana, "GET", "/api/demands?status=queued&assigned_user_id=none&limit=5&offset=500");
    checar("página além do fim vem vazia, e não em erro",
      alem.status === 200 && alem.corpo.items.length === 0 && alem.corpo.total > 0,
      `status=${alem.status} itens=${alem.corpo?.items?.length} total=${alem.corpo?.total}`);

    // ── 3. OS CONTADORES VÊM DO TOTAL DO RECORTE ─────────────────────────────
    //
    // O coração desta fase. Até a F9 a tela contava os avisos sobre as linhas CARREGADAS, e por
    // isso pedia `limit=200`: com uma página de cinco eles passariam a subcontar. Cada asserção
    // aqui é feita com a página DELIBERADAMENTE menor do que a contagem — é o único jeito de o
    // teste falhar contra o defeito antigo em vez de passar nos dois mundos.
    linhas.push("\n[3] os contadores vêm do TOTAL do recorte, não da página");
    for (const alvo of [alfa, bravo]) {
      const r = await bater("PATCH", `/demands/${alvo.demand_ref}`, {
        corpo: {
          opportunity: { crm_opportunity_id: alvo.opportunity.crm_opportunity_id, name: alvo.opportunity.name, value: 1_234_567, currency: "BRL" },
          changed_by: { crm_user_id: "crm_u1", name: `${PREFIXO}Vendedor` },
          changed_at: new Date().toISOString(),
          note: "Valor revisto depois do envio.",
        },
        idem: `f10-upd-${alvo.demand_ref}`,
      });
      if (r.status !== 202) throw new Error(`PATCH de ${alvo.demand_ref} devolveu ${r.status}: ${r.bruto}`);
    }
    const umaLinhaSo = await chamarRota(ana, "GET", "/api/demands?status=queued,assigned,in_analysis,returned&limit=1");
    checar("a página tem UMA linha, de propósito", umaLinhaSo.corpo.items.length === 1,
      `${umaLinhaSo.corpo.items.length} linha(s) em ${umaLinhaSo.corpo.total}`);
    checar("e mesmo assim o aviso conta DUAS atualizações pendentes minhas",
      umaLinhaSo.corpo.counts?.my_pending_updates === 2,
      `counts.my_pending_updates=${umaLinhaSo.corpo.counts?.my_pending_updates}`);
    // O outro lado, que é o que torna isto um recorte e não um total global.
    const doBrunoUmaLinha = await chamarRota(bruno, "GET", "/api/demands?status=queued,assigned,in_analysis,returned&limit=1");
    checar("o colega NÃO herda o aviso: a atualização pendente é de quem assumiu",
      doBrunoUmaLinha.corpo.counts?.my_pending_updates === 0,
      `counts.my_pending_updates=${doBrunoUmaLinha.corpo.counts?.my_pending_updates}`);

    const cancelou = await bater("POST", `/demands/${alfa.demand_ref}/cancel`, {
      corpo: {
        justification: "O cliente adiou a licitação por tempo indeterminado.",
        approved_by: { crm_user_id: "crm_u9", name: `${PREFIXO}Líder` },
      },
    });
    checar("o CRM pede o cancelamento de uma demanda já assumida", cancelou.status === 200, `status=${cancelou.status}`);
    const depoisDoCancel = await chamarRota(ana, "GET", "/api/demands?status=queued,assigned,in_analysis,returned&limit=1");
    checar("o aviso de cancelamento também vem do recorte, com a página em uma linha",
      depoisDoCancel.corpo.counts?.my_cancellations === 1,
      `counts.my_cancellations=${depoisDoCancel.corpo.counts?.my_cancellations}`);

    // Com gerente na instalação, devolver vira PEDIDO (D17) — e o pedido é o que o gerente conta.
    const pediu = await chamarRota(bruno, "POST", `/api/demands/${charlie.id}/return`, {
      reason: "Faltam os anexos técnicos citados no item 7 do edital.",
    });
    checar("Bruno pede a devolução, e com gerente na casa isso vira pedido (D17)",
      pediu.status === 200, `status=${pediu.status}`);
    const doGerenteUmaLinha = await chamarRota(gina, "GET", "/api/demands?status=queued,assigned,in_analysis,returned&limit=1");
    checar("o gerente vê a devolução esperando decisão, com a página em uma linha",
      doGerenteUmaLinha.corpo.counts?.return_pending === 1,
      `counts.return_pending=${doGerenteUmaLinha.corpo.counts?.return_pending}`);

    // E o contador ACOMPANHA o recorte: mudar o filtro muda o aviso junto.
    const recorteQueExclui = await chamarRota(ana, "GET", "/api/demands?status=queued&limit=1");
    checar("o contador acompanha o recorte: num filtro que exclui as minhas, ele zera",
      recorteQueExclui.corpo.counts?.my_pending_updates === 0,
      `counts.my_pending_updates=${recorteQueExclui.corpo.counts?.my_pending_updates} em status=queued`);

    // O caso que só aparece quando o recorte JÁ fixa o dono: o card "Novas
    // demandas" pede `assigned_user_id=none`, e "sem dono E minha" é zero por
    // definição. Uma implementação que espalhasse o recorte e sobrescrevesse a
    // chave do dono devolveria aqui o número do OUTRO card — um aviso sobre
    // demandas que esta lista não tem. Achado relendo a própria rota; só este
    // caso o pega, porque nos demais o recorte não fixa dono nenhum.
    const cardDasNovas = await chamarRota(ana, "GET", "/api/demands?status=queued,assigned,in_analysis,returned&assigned_user_id=none&limit=1");
    checar("no recorte SEM DONO os avisos de quem assumiu são zero — o contador é do recorte, não da pessoa",
      cardDasNovas.corpo.counts?.my_pending_updates === 0 && cardDasNovas.corpo.counts?.my_cancellations === 0,
      `atualizações=${cardDasNovas.corpo.counts?.my_pending_updates} cancelamentos=${cardDasNovas.corpo.counts?.my_cancellations}`);
    // O outro lado, no mesmo par de chamadas: no recorte que TEM as minhas, os
    // mesmos contadores continuam trazendo o número de verdade.
    const cardMinhas = await chamarRota(ana, "GET", "/api/demands?status=queued,assigned,in_analysis,returned&assigned_user_id=me&limit=1");
    checar("e no recorte de 'Minhas demandas' eles voltam a contar",
      cardMinhas.corpo.counts?.my_pending_updates === 2 && cardMinhas.corpo.counts?.my_cancellations === 1,
      `atualizações=${cardMinhas.corpo.counts?.my_pending_updates} cancelamentos=${cardMinhas.corpo.counts?.my_cancellations}`);

    // ── 4. A ORDENAÇÃO PELAS QUATRO COLUNAS DO CARD ─────────────────────────
    linhas.push("\n[4] a ordenação pelas quatro colunas do card");
    const semDono = "status=queued&assigned_user_id=none&limit=200";
    const porTituloAsc = await chamarRota(ana, "GET", `/api/demands?${semDono}&sort=title&dir=asc`);
    const porTituloDesc = await chamarRota(ana, "GET", `/api/demands?${semDono}&sort=title&dir=desc`);
    checar("título crescente", titulos(porTituloAsc.corpo.items)[0] === "Delta escolas conectadas",
      titulos(porTituloAsc.corpo.items).join(" < "));
    checar("título decrescente é o inverso",
      JSON.stringify(titulos(porTituloDesc.corpo.items)) === JSON.stringify([...titulos(porTituloAsc.corpo.items)].reverse()),
      titulos(porTituloDesc.corpo.items).join(" > "));

    const porValorDesc = await chamarRota(ana, "GET", `/api/demands?${semDono}&sort=value&dir=desc`);
    const vDesc = titulos(porValorDesc.corpo.items);
    checar("valor decrescente abre pelo maior — decisão consciente do dono, §8 item 33",
      vDesc[0] === "Golf saneamento", vDesc.join(" > "));
    checar("a demanda SEM valor vai para o fim, e não para o topo",
      vDesc[vDesc.length - 1] === "Echo laboratório", `último=${vDesc[vDesc.length - 1]}`);
    const porValorAsc = await chamarRota(ana, "GET", `/api/demands?${semDono}&sort=value&dir=asc`);
    const vAsc = titulos(porValorAsc.corpo.items);
    checar("valor crescente abre pelo menor E também empurra o nulo para o fim",
      vAsc[0] === "Delta escolas conectadas" && vAsc[vAsc.length - 1] === "Echo laboratório", vAsc.join(" < "));

    const porPrazo = await chamarRota(ana, "GET", `/api/demands?${semDono}&sort=deadline&dir=asc`);
    checar("prazo do edital crescente abre pelo mais próximo",
      titulos(porPrazo.corpo.items)[0] === "Echo laboratório", titulos(porPrazo.corpo.items).join(" < "));

    const ligarSla = await chamarRota(admin, "PUT", "/api/demands/sla-settings", {
      enabled: true, assume_hours: 8, analysis_hours: 24, proposal_hours: 120, assignment_policy: "auto_servico",
    });
    checar("SLA ligado para provar a coluna de prazo do SLA", ligarSla.status === 200, `status=${ligarSla.status}`);
    const porSla = await chamarRota(ana, "GET", `/api/demands?${semDono}&sort=sla_due&dir=asc`);
    const slaAsc = minhas(porSla.corpo.items);
    // O `due_at` PRECISA existir aqui: com o SLA desligado ele é nulo em todas as linhas, a
    // comparação `new Date(null) <= new Date(null)` é verdadeira e a asserção passaria sem ter
    // ordenado nada. Foi o que aconteceu na primeira execução da prova da F9.
    checar("as demandas têm prazo do SLA para ordenar",
      slaAsc.length > 1 && slaAsc.every((d: any) => !!d.due_at),
      `${slaAsc.filter((d: any) => !!d.due_at).length} de ${slaAsc.length} com due_at`);
    checar("a quarta coluna do card ordena de verdade",
      slaAsc.every((d: any, i: number) => i === 0 || new Date(slaAsc[i - 1].due_at) <= new Date(d.due_at)),
      slaAsc.map((d: any) => d.due_at).join(" < "));
    const slaPaginado = await chamarRota(ana, "GET", `/api/demands?status=queued&assigned_user_id=none&limit=5&offset=0&sort=sla_due&dir=asc`);
    checar("a página de cinco do prazo do SLA sai na mesma ordem da lista inteira",
      JSON.stringify(minhas(slaPaginado.corpo.items).map((d: any) => d.id)) ===
        JSON.stringify(slaAsc.slice(0, minhas(slaPaginado.corpo.items).length).map((d: any) => d.id)),
      `${slaPaginado.corpo.items.length} na página`);

    // ── 5. OS RECORTES QUE GANHARAM CONTROLE DE TELA ─────────────────────────
    linhas.push("\n[5] os recortes que ganharam tela nesta fase");
    const busca = await chamarRota(ana, "GET", `/api/demands?${semDono}&q=saneamento`);
    checar("busca livre acha pelo título",
      titulos(busca.corpo.items).length === 1 && titulos(busca.corpo.items)[0] === "Golf saneamento",
      titulos(busca.corpo.items).join(", "));
    checar("e deixa de fora o que não casa", !titulos(busca.corpo.items).includes("Foxtrot iluminação"),
      `${titulos(busca.corpo.items).length} linha(s)`);

    const faixa = await chamarRota(ana, "GET", `/api/demands?${semDono}&min_value=200000&max_value=400000`);
    const tFaixa = titulos(faixa.corpo.items);
    checar("faixa de valor inclui quem está dentro",
      tFaixa.includes("Foxtrot iluminação") && tFaixa.includes("Hotel transporte urbano"), tFaixa.join(", "));
    checar("faixa de valor exclui abaixo, acima e o sem valor",
      !tFaixa.includes("Delta escolas conectadas") && !tFaixa.includes("Golf saneamento") &&
        !tFaixa.includes("Echo laboratório"),
      `${tFaixa.length} linhas`);
    checar("e o total acompanha o recorte, e não a fila inteira",
      faixa.corpo.total < novasDepois.corpo.total, `${faixa.corpo.total} contra ${novasDepois.corpo.total}`);

    const porCliente = await chamarRota(ana, "GET", `/api/demands?${semDono}&company=Cons%C3%B3rcio%20Leste`);
    const tCliente = titulos(porCliente.corpo.items);
    checar("recorte por cliente inclui os dele",
      tCliente.includes("Foxtrot iluminação") && tCliente.includes("Golf saneamento"), tCliente.join(", "));
    checar("e exclui os dos outros clientes", tCliente.length === 2, `${tCliente.length} linhas`);

    // ── 6. O CARD DE TAREFAS SAIU INTEIRO ────────────────────────────────────
    //
    // A remoção só está feita se a ROTA morreu junto: card sem rota deixaria porta viva sem tela.
    // E é preciso separar "a rota morreu" de "a SPA responde qualquer coisa com 200" — daí a rota
    // de controle inventada e a conferência do content-type, e não só do status.
    linhas.push("\n[6] o card de tarefas saiu inteiro — a rota também");
    const chamarCru = async (caminho: string, metodo = "GET") => {
      const r = await fetch(`${BASE}${caminho}`, { method: metodo, headers: (ana as any).headers });
      return { status: r.status, tipo: r.headers.get("content-type") || "", corpo: await r.text() };
    };
    const tarefas = await chamarCru("/api/user-tasks");
    const controle = await chamarCru("/api/rota-que-nunca-existiu-f10");
    checar("GET /api/user-tasks não responde 200", tarefas.status !== 200, `status=${tarefas.status}`);
    checar("e responde como ROTA, não como HTML da SPA",
      !tarefas.tipo.includes("text/html"), `content-type=${tarefas.tipo}`);
    checar("a rota de controle inventada responde igual — é assim que se sabe que a comparação vale",
      controle.status === tarefas.status && !controle.tipo.includes("text/html"),
      `controle status=${controle.status} tipo=${controle.tipo}`);
    const criar = await chamarCru("/api/user-tasks", "POST");
    checar("e o POST também morreu", criar.status !== 200 && criar.status !== 201, `status=${criar.status}`);
    const tabela: any[] = await prisma.$queryRawUnsafe(
      "select to_regclass('public.tasks') is null as sumiu"
    );
    checar("a TABELA `tasks` não existe mais no banco de prova", tabela[0]?.sumiu === true,
      `to_regclass is null = ${tabela[0]?.sumiu}`);

    // ── 7. A RÉGUA DO DESEMPENHO QUE A INÍCIO DESENHA ────────────────────────
    linhas.push("\n[7] o gráfico de desempenho da Início, e a régua da D20");
    const desempenhoAna = await chamarRota(ana, "GET", "/api/demands/performance");
    const desempenhoGina = await chamarRota(gina, "GET", "/api/demands/performance");
    checar("o pré-vendas lê o próprio desempenho, que é o que o gráfico desenha",
      desempenhoAna.status === 200 && desempenhoAna.corpo.scope === "self",
      `status=${desempenhoAna.status} scope=${desempenhoAna.corpo?.scope}`);
    checar("e a linha que vem é a DELA",
      desempenhoAna.corpo.people.length === 1 && desempenhoAna.corpo.people[0].user_id === ana.userId,
      `${desempenhoAna.corpo.people.length} linha(s)`);
    checar("a do COLEGA não vem — o outro lado da mesma régua",
      !desempenhoAna.corpo.people.some((p: any) => p.user_id === bruno.userId),
      `ids=[${desempenhoAna.corpo.people.map((p: any) => p.user_id).join(",")}]`);
    checar("o gerente continua lendo o time", desempenhoGina.corpo.scope === "team",
      `scope=${desempenhoGina.corpo?.scope}`);
    checar("a média da EQUIPE chega aos dois — agregado não é recorte de gente (D20)",
      !!desempenhoAna.corpo.team && desempenhoAna.corpo.team.total === desempenhoGina.corpo.team.total,
      `ana=${desempenhoAna.corpo.team?.total} gina=${desempenhoGina.corpo.team?.total}`);
    checar("e o gráfico tem número para desenhar: a medição de assumir existe",
      desempenhoAna.corpo.team.amostraAteAssumir > 0,
      `amostraAteAssumir=${desempenhoAna.corpo.team.amostraAteAssumir}`);

    // devolve a instalação de prova ao padrão
    await prisma.demandSlaSettings.deleteMany({ where: {} });
  });
}

main()
  .then(async () => {
    console.log(linhas.join("\n"));
    console.log(`\n== ${passou} conferências OK, ${falhou} falhas`);
    await prisma.$disconnect();
    process.exit(falhou > 0 ? 1 : 0);
  })
  .catch(async (e) => {
    console.log(linhas.join("\n"));
    console.error("\nERRO:", e);
    await prisma.$disconnect();
    process.exit(1);
  });
