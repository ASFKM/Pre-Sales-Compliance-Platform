/**
 * CDC 16 — Fase 9. Prova por execução real: a fila lida PELAS ROTAS.
 *
 * Roda no host do PreSales, contra um servidor de prova em banco dedicado. As demandas entram
 * pela PORTA DE MÁQUINA real, com a chave real do par; tudo o que a fase entregou é exercitado
 * por HTTP, com login de verdade — nunca chamando a função direto, que é como uma fase inteira
 * desta casa já passou sem tocar no que entregava.
 *
 * SEIS seções:
 *
 *  1. paginação: `limit`, `offset`, `total`, e as páginas sem sobreposição;
 *  2. ordenação parametrizada, incluindo o prazo do SLA (que não é coluna) e a entrada inválida
 *     que precisa cair no padrão em vez de derrubar a rota;
 *  3. filtro por coluna: cada recorte provado pelos DOIS lados — o que entra e o que fica de fora;
 *  4. a régua de quem lê desempenho (resposta F do dono): o gerente vê o time, o pré-vendas vê só
 *     a própria linha — e não vê a do colega;
 *  5. a resposta I: numa fila direcionada, quem não é gerente não assume — a régua que a gaveta
 *     de detalhe passou a obedecer nesta fase;
 *  6. a fila continua sendo de TODA a equipe (D15): o que uma pessoa vê, a outra vê.
 *
 *   PROVA_PASSWORD=… PAIR_KEY=… npx tsx scripts/cdc16-f9-provar-fila.ts
 */
import "dotenv/config";
import crypto from "crypto";
import { prisma } from "../src/prisma";
import { runWithTenant } from "../src/tenantContext";
import { lerChaveDoCrm } from "../server/utils/crmPort";
import { PAPEIS_DA_PROVA, chamarRota, entrarComo, papelDaProva } from "./cdc16-f5-comum";

const TENANT = process.env.PROVA_TENANT || "tenant_default";
const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const PORTA = `${BASE}/api/external/crm/v1`;
const PREFIXO = "prova-cdc16-f9-";
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
 * As seis demandas da prova. Valores, verticais, títulos e prazos DIFERENTES de propósito: uma
 * ordenação só se prova quando a ordem pedida é diferente da ordem de inserção, e um filtro só se
 * prova quando existe o que ele deve deixar de fora.
 */
const CENARIO = [
  { n: 1, titulo: "Alfa videomonitoramento", vertical: "Segurança Pública", valor: 500_000, prazo: "2026-12-20", empresa: "Prefeitura Norte" },
  { n: 2, titulo: "Bravo rede hospitalar", vertical: "Saúde", valor: 120_000, prazo: "2026-09-10", empresa: "Hospital Central" },
  { n: 3, titulo: "Charlie datacenter", vertical: "TIC", valor: 900_000, prazo: "2026-11-05", empresa: "Autarquia Sul" },
  { n: 4, titulo: "Delta escolas conectadas", vertical: "Educação", valor: 45_000, prazo: "2026-10-01", empresa: "Prefeitura Norte" },
  { n: 5, titulo: "Echo laboratório", vertical: "Saúde", valor: null as number | null, prazo: "2026-09-25", empresa: "Hospital Central" },
  { n: 6, titulo: "Foxtrot iluminação", vertical: "Cidades", valor: 300_000, prazo: "2027-01-15", empresa: "Consórcio Leste" },
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
      description: `Objeto da demanda ${c.n} da prova da F9.`,
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
    sent_at: new Date(Date.now() - (10 - c.n) * 60_000).toISOString(),
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
  await prisma.idempotencyRecord.deleteMany({ where: { key: { startsWith: "f9-" } } });
}

/** Só as demandas DESTA prova, para as asserções não dependerem do que já havia no banco. */
function minhas(itens: any[]) {
  return itens.filter((d) => String(d.demand_ref).startsWith(PREFIXO));
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

    // O banco de prova tem `fleet_manager_enabled = false`, e por isso o cache
    // de licença fica FRIO: sem licença, `getFleetLicenseStatus` devolve
    // `installation_id: null` e a porta do par recusa a chave BOA com
    // `pair_not_for_this_installation` — que parece defeito do par e não é.
    // As fases anteriores não tropeçaram nisto porque encontraram o cache ainda
    // quente de uma execução antiga; ele expira em 24 h e expirou.
    //
    // O aquecimento usa o caminho de LEITURA do próprio produto — o poll de
    // status da licença, um GET a `/api/heartbeat/license-status` —, e não o
    // heartbeat completo, que POSTaria o retrato deste servidor de prova ao
    // CMSaaS real sob a chave da instalação Demo. A bandeira é ligada, o poll
    // roda, e a bandeira volta a `false` no mesmo bloco: o `.sh` já esperou
    // passar o instante em que `server.ts` avalia a bandeira para o heartbeat
    // completo, então nenhuma escrita sai daqui para o CMSaaS.
    await aquecerLicenca();

    const ateAsDemandas = Date.now() + 120_000;
    let pronta = false;
    while (Date.now() < ateAsDemandas) {
      const r = await bater("GET", "/pair/verify");
      if (r.status === 200) { pronta = true; break; }
      await new Promise((res) => setTimeout(res, 3000));
    }
    checar("a porta reconhece a chave do par", pronta, pronta ? "/pair/verify respondeu 200" : "esgotou 120 s");
    if (!pronta) throw new Error("a porta não reconheceu a chave do par — sem ela não há o que provar");

    await limpar();
    // A política volta ao padrão antes de tudo: a seção 5 a muda, e uma execução interrompida
    // deixaria a instalação de prova em `direcionamento`, fazendo a seção 1 medir outra coisa.
    await prisma.demandSlaSettings.deleteMany({ where: {} });

    // ── preparo: as seis demandas entram pela PORTA REAL ──────────────────────
    for (const c of CENARIO) {
      const r = await bater("POST", "/demands", { corpo: envelope(c), idem: `f9-cria-${c.n}` });
      if (r.status !== 201) throw new Error(`não consegui criar ${ref(c.n)}: ${r.status} ${r.bruto}`);
    }
    checar("preparo", true, `${CENARIO.length} demandas criadas pela porta de máquina`);

    const papelEquipe = await papelDaProva(`${PREFIXO}equipe`, PAPEIS_DA_PROVA.equipe);
    const papelGerente = await papelDaProva(`${PREFIXO}gerente`, PAPEIS_DA_PROVA.gerente);
    // Quem CONFIGURA o prazo é `admin:settings` (D19), e o gerente de pré-vendas
    // não o tem — a primeira execução desta prova levou 403 tentando pela Gina, e
    // o 403 estava certo. São dois papéis diferentes de propósito.
    const papelAdmin = await papelDaProva(`${PREFIXO}admin`, PAPEIS_DA_PROVA.admin);
    const ana = await entrarComo(`${PREFIXO}Ana`, `f9-ana@exemplo.invalid`, papelEquipe.id, senha, checar);
    const bruno = await entrarComo(`${PREFIXO}Bruno`, `f9-bruno@exemplo.invalid`, papelEquipe.id, senha, checar);
    const gina = await entrarComo(`${PREFIXO}Gina`, `f9-gina@exemplo.invalid`, papelGerente.id, senha, checar);
    const admin = await entrarComo(`${PREFIXO}Alberto`, `f9-alberto@exemplo.invalid`, papelAdmin.id, senha, checar);
    if (!ana || !bruno || !gina || !admin) throw new Error("login real falhou — sem sessão não há prova pelas rotas");

    const listar = async (sessao: any, query: string) =>
      chamarRota(sessao, "GET", `/api/demands?status=queued,assigned,in_analysis,returned&${query}`);

    // ── 1. PAGINAÇÃO ─────────────────────────────────────────────────────────
    linhas.push("\n[1] paginação");
    const tudo = await listar(ana, "limit=200");
    checar("envelope", Array.isArray(tudo.corpo?.items) && typeof tudo.corpo?.total === "number",
      `items=${Array.isArray(tudo.corpo?.items)} total=${tudo.corpo?.total}`);
    const totalGeral = tudo.corpo.total;
    checar("total conta o recorte inteiro", minhas(tudo.corpo.items).length === 6,
      `${minhas(tudo.corpo.items).length} das minhas em ${totalGeral} do recorte`);

    const p1 = await listar(ana, "limit=2&offset=0&sort=title");
    const p2 = await listar(ana, "limit=2&offset=2&sort=title");
    checar("limit corta a página", p1.corpo.items.length === 2 && p2.corpo.items.length === 2,
      `p1=${p1.corpo.items.length} p2=${p2.corpo.items.length}`);
    checar("total NÃO é o tamanho da página", p1.corpo.total === totalGeral,
      `total=${p1.corpo.total} pagina=${p1.corpo.items.length}`);
    const ids1 = p1.corpo.items.map((d: any) => d.id);
    const ids2 = p2.corpo.items.map((d: any) => d.id);
    checar("offset avança sem repetir", ids1.every((i: string) => !ids2.includes(i)),
      `p1=[${ids1.join(",")}] p2=[${ids2.join(",")}]`);
    checar("o eco confirma o que o servidor aplicou", p2.corpo.limit === 2 && p2.corpo.offset === 2 && p2.corpo.sort === "title",
      `limit=${p2.corpo.limit} offset=${p2.corpo.offset} sort=${p2.corpo.sort}`);

    const teto = await listar(ana, "limit=100000");
    checar("limit acima do teto é aparado", teto.corpo.limit === 200, `limit=${teto.corpo.limit}`);
    const lixoLimite = await listar(ana, "limit=abacaxi&offset=-5");
    checar("limit e offset inválidos caem no padrão, sem 500",
      lixoLimite.status === 200 && lixoLimite.corpo.limit === 50 && lixoLimite.corpo.offset === 0,
      `status=${lixoLimite.status} limit=${lixoLimite.corpo?.limit} offset=${lixoLimite.corpo?.offset}`);
    const alem = await listar(ana, "limit=2&offset=999");
    checar("offset além do fim devolve página vazia, e não erro",
      alem.status === 200 && alem.corpo.items.length === 0 && alem.corpo.total === totalGeral,
      `status=${alem.status} itens=${alem.corpo?.items?.length} total=${alem.corpo?.total}`);

    // ── 2. ORDENAÇÃO ─────────────────────────────────────────────────────────
    linhas.push("\n[2] ordenação parametrizada");
    const padrao = await listar(ana, "limit=200");
    checar("sem `sort` a ordem é a da F1 (prazo do edital)",
      padrao.corpo.sort === "deadline" && padrao.corpo.dir === "asc" &&
        titulos(padrao.corpo.items)[0] === "Bravo rede hospitalar",
      `sort=${padrao.corpo.sort} primeiro=${titulos(padrao.corpo.items)[0]}`);

    const porTituloAsc = await listar(ana, "limit=200&sort=title&dir=asc");
    const porTituloDesc = await listar(ana, "limit=200&sort=title&dir=desc");
    checar("título crescente", titulos(porTituloAsc.corpo.items)[0] === "Alfa videomonitoramento",
      titulos(porTituloAsc.corpo.items).join(" < "));
    checar("título decrescente é o inverso",
      JSON.stringify(titulos(porTituloDesc.corpo.items)) === JSON.stringify([...titulos(porTituloAsc.corpo.items)].reverse()),
      titulos(porTituloDesc.corpo.items).join(" > "));

    const porValorDesc = await listar(ana, "limit=200&sort=value&dir=desc");
    const vDesc = titulos(porValorDesc.corpo.items);
    checar("valor decrescente abre pelo maior", vDesc[0] === "Charlie datacenter", vDesc.join(" > "));
    checar("a demanda SEM valor vai para o fim, e não para o topo",
      vDesc[vDesc.length - 1] === "Echo laboratório", `último=${vDesc[vDesc.length - 1]}`);
    const porValorAsc = await listar(ana, "limit=200&sort=value&dir=asc");
    const vAsc = titulos(porValorAsc.corpo.items);
    checar("valor crescente abre pelo menor E também empurra o nulo para o fim",
      vAsc[0] === "Delta escolas conectadas" && vAsc[vAsc.length - 1] === "Echo laboratório",
      vAsc.join(" < "));

    const porVertical = await listar(ana, "limit=200&sort=vertical&dir=asc");
    checar("vertical crescente", titulos(porVertical.corpo.items)[0] === "Foxtrot iluminação",
      minhas(porVertical.corpo.items).map((d: any) => d.vertical).join(" < "));
    const porEmpresa = await listar(ana, "limit=200&sort=company&dir=asc");
    const empresas = minhas(porEmpresa.corpo.items).map((d: any) => String(d.company.name).replace(PREFIXO, ""));
    checar("cliente crescente é ordem alfabética de verdade",
      JSON.stringify(empresas) === JSON.stringify([...empresas].sort((x, y) => x.localeCompare(y, "pt-BR"))),
      empresas.join(" < "));

    // O prazo do SLA não é coluna: é calculado. Ligar o SLA e ordenar por ele é o único jeito de
    // provar que a segunda passada existe e devolve a página na ordem certa.
    const ligarSla = await chamarRota(admin, "PUT", "/api/demands/sla-settings", {
      enabled: true, assume_hours: 8, analysis_hours: 24, proposal_hours: 120, assignment_policy: "auto_servico",
    });
    checar("SLA ligado para provar a ordem por prazo do SLA", ligarSla.status === 200, `status=${ligarSla.status}`);
    const porSlaAsc = await listar(ana, "limit=200&sort=sla_due&dir=asc");
    const slaAsc = minhas(porSlaAsc.corpo.items);
    // O `due_at` PRECISA existir aqui: com o SLA desligado ele é nulo em todas as
    // linhas, a comparação `new Date(null) <= new Date(null)` é verdadeira e o
    // teste passaria sem ter ordenado nada. Foi o que aconteceu na primeira
    // execução, quando o PUT do SLA levou 403 e ninguém percebeu.
    checar("as demandas têm prazo do SLA para ordenar",
      slaAsc.length > 1 && slaAsc.every((d: any) => !!d.due_at),
      `${slaAsc.filter((d: any) => !!d.due_at).length} de ${slaAsc.length} com due_at`);
    checar("ordem por prazo do SLA é crescente de verdade",
      slaAsc.every((d: any, i: number) => i === 0 || new Date(slaAsc[i - 1].due_at) <= new Date(d.due_at)),
      slaAsc.map((d: any) => d.due_at).join(" < "));
    const porSlaDesc = await listar(ana, "limit=200&sort=sla_due&dir=desc");
    checar("e decrescente inverte",
      JSON.stringify(minhas(porSlaDesc.corpo.items).map((d: any) => d.id)) ===
        JSON.stringify(slaAsc.map((d: any) => d.id).reverse()),
      `${minhas(porSlaDesc.corpo.items).length} linhas`);
    const slaPaginado = await listar(ana, "limit=2&offset=0&sort=sla_due&dir=asc");
    checar("a página do prazo do SLA sai na mesma ordem da lista inteira",
      JSON.stringify(minhas(slaPaginado.corpo.items).map((d: any) => d.id)) ===
        JSON.stringify(slaAsc.slice(0, minhas(slaPaginado.corpo.items).length).map((d: any) => d.id)),
      `${slaPaginado.corpo.items.length} na página`);

    const inventada = await listar(ana, "limit=200&sort=preco_do_dolar");
    checar("ordem inventada cai no padrão em vez de devolver erro",
      inventada.status === 200 && inventada.corpo.sort === "deadline",
      `status=${inventada.status} sort=${inventada.corpo?.sort}`);
    // O caso que o teste de unidade achou: `in` caminharia o protótipo e a rota chamaria
    // `ORDENS["__proto__"](dir)`, que não é função. Aqui ele é exercitado pela ROTA.
    const proto = await listar(ana, "limit=200&sort=__proto__");
    checar("`sort=__proto__` responde 200 no padrão, e não 500",
      proto.status === 200 && proto.corpo.sort === "deadline",
      `status=${proto.status} sort=${proto.corpo?.sort}`);

    // ── 3. FILTRO POR COLUNA ─────────────────────────────────────────────────
    linhas.push("\n[3] filtro por coluna");
    const saude = await listar(ana, "limit=200&vertical=Sa%C3%BAde");
    const tSaude = titulos(saude.corpo.items);
    checar("vertical INCLUI o que é dela", tSaude.includes("Bravo rede hospitalar") && tSaude.includes("Echo laboratório"),
      tSaude.join(", "));
    checar("vertical EXCLUI o que não é dela", !tSaude.includes("Charlie datacenter") && tSaude.length === 2,
      `${tSaude.length} linhas`);
    checar("o total acompanha o recorte, e não a fila inteira", saude.corpo.total < totalGeral,
      `total do recorte=${saude.corpo.total} contra ${totalGeral}`);

    const duas = await listar(ana, "limit=200&vertical=Sa%C3%BAde,TIC");
    checar("duas verticais somam em vez de se anularem", titulos(duas.corpo.items).length === 3,
      titulos(duas.corpo.items).join(", "));

    const faixa = await listar(ana, "limit=200&min_value=100000&max_value=600000");
    const tFaixa = titulos(faixa.corpo.items);
    checar("faixa de valor inclui quem está dentro",
      tFaixa.includes("Alfa videomonitoramento") && tFaixa.includes("Bravo rede hospitalar"), tFaixa.join(", "));
    checar("faixa de valor exclui abaixo, acima e o sem valor",
      !tFaixa.includes("Delta escolas conectadas") && !tFaixa.includes("Charlie datacenter") && !tFaixa.includes("Echo laboratório"),
      `${tFaixa.length} linhas`);

    const busca = await listar(ana, "limit=200&q=datacenter");
    checar("busca livre acha pelo título e deixa o resto de fora",
      titulos(busca.corpo.items).length === 1 && titulos(busca.corpo.items)[0] === "Charlie datacenter",
      titulos(busca.corpo.items).join(", "));

    const facetas = tudo.corpo.verticals;
    checar("as opções do filtro vêm do servidor, com a contagem",
      Array.isArray(facetas) && facetas.some((f: any) => f.vertical === "Saúde" && f.count >= 2),
      JSON.stringify(facetas?.slice(0, 6)));
    // A faceta NÃO pode encolher com o próprio filtro de vertical, senão a pessoa não volta.
    checar("as opções continuam completas mesmo com uma vertical filtrada",
      saude.corpo.verticals.length === facetas.length,
      `${saude.corpo.verticals.length} contra ${facetas.length}`);

    const semDono = await listar(ana, "limit=200&assigned_user_id=none");
    checar("`none` traz a fila sem dono", minhas(semDono.corpo.items).length === 6,
      `${minhas(semDono.corpo.items).length} sem dono`);

    // Ana assume uma; a partir daqui `me` tem o que devolver — e Bruno não.
    const alvo = minhas(padrao.corpo.items).find((d: any) => d.title.includes("Bravo"));
    const assumiu = await chamarRota(ana, "POST", `/api/demands/${alvo.id}/assume`, {});
    checar("Ana assume uma demanda pela rota", assumiu.status === 200, `status=${assumiu.status}`);
    const minhasDaAna = await listar(ana, "limit=200&assigned_user_id=me");
    checar("`me` traz o que ESTA pessoa assumiu",
      titulos(minhasDaAna.corpo.items).length === 1 && titulos(minhasDaAna.corpo.items)[0] === "Bravo rede hospitalar",
      titulos(minhasDaAna.corpo.items).join(", "));
    const minhasDoBruno = await listar(bruno, "limit=200&assigned_user_id=me");
    checar("e para quem não assumiu nada, `me` vem vazio",
      minhas(minhasDoBruno.corpo.items).length === 0,
      `${minhas(minhasDoBruno.corpo.items).length} linhas`);
    const semDono2 = await listar(ana, "limit=200&assigned_user_id=none");
    checar("a assumida SAI da fila sem dono", minhas(semDono2.corpo.items).length === 5,
      `${minhas(semDono2.corpo.items).length} sem dono`);

    // ── 4. A RÉGUA DE QUEM LÊ DESEMPENHO (resposta F) ────────────────────────
    linhas.push("\n[4] a régua de quem vê desempenho");
    // Bruno também assume, para que o time tenha DUAS pessoas medidas: com uma só, "vê o time" e
    // "vê a si mesmo" seriam a mesma resposta e a régua não estaria provada.
    const alvoBruno = minhas(padrao.corpo.items).find((d: any) => d.title.includes("Delta"));
    const assumiuBruno = await chamarRota(bruno, "POST", `/api/demands/${alvoBruno.id}/assume`, {});
    checar("Bruno assume outra", assumiuBruno.status === 200, `status=${assumiuBruno.status}`);

    const doGerente = await chamarRota(gina, "GET", "/api/demands/performance");
    checar("o gerente lê o time", doGerente.status === 200 && doGerente.corpo.scope === "team",
      `status=${doGerente.status} scope=${doGerente.corpo?.scope}`);
    const idsDoTime = (doGerente.corpo.people || []).map((p: any) => p.user_id);
    checar("e o time tem as duas pessoas",
      idsDoTime.includes(ana.userId) && idsDoTime.includes(bruno.userId),
      `${idsDoTime.length} pessoas`);

    const daAna = await chamarRota(ana, "GET", "/api/demands/performance");
    checar("o pré-vendas lê o próprio desempenho", daAna.status === 200 && daAna.corpo.scope === "self",
      `status=${daAna.status} scope=${daAna.corpo?.scope}`);
    checar("e a linha que vem é a DELA",
      daAna.corpo.people.length === 1 && daAna.corpo.people[0].user_id === ana.userId,
      `${daAna.corpo.people.length} linha(s), user=${daAna.corpo.people[0]?.user_id}`);
    // O outro lado da mesma regra, que é o que a torna uma régua e não um rótulo.
    checar("e a do COLEGA não vem",
      !daAna.corpo.people.some((p: any) => p.user_id === bruno.userId),
      `ids=[${daAna.corpo.people.map((p: any) => p.user_id).join(",")}]`);
    checar("a média da EQUIPE continua chegando aos dois (D20, agregado não é recorte de gente)",
      !!daAna.corpo.team && !!doGerente.corpo.team &&
        daAna.corpo.team.total === doGerente.corpo.team.total,
      `ana=${daAna.corpo.team?.total} gina=${doGerente.corpo.team?.total}`);

    const doBruno = await chamarRota(bruno, "GET", "/api/demands/performance");
    checar("e o mesmo vale para a outra pessoa da equipe, com a linha dela",
      doBruno.corpo.scope === "self" && doBruno.corpo.people.length === 1 &&
        doBruno.corpo.people[0].user_id === bruno.userId,
      `scope=${doBruno.corpo?.scope} user=${doBruno.corpo?.people?.[0]?.user_id}`);

    // ── 5. A RESPOSTA I: fila direcionada e o ato de assumir ─────────────────
    linhas.push("\n[5] resposta I — assumir na fila direcionada");
    const direcionar = await chamarRota(admin, "PUT", "/api/demands/sla-settings", {
      enabled: true, assume_hours: 8, analysis_hours: 24, proposal_hours: 120, assignment_policy: "direcionamento",
    });
    checar("a fila vira direcionada", direcionar.status === 200 &&
      direcionar.corpo.assignment_policy === "direcionamento", `policy=${direcionar.corpo?.assignment_policy}`);
    const livre = minhas(semDono2.corpo.items).find((d: any) => d.title.includes("Foxtrot"));
    const tentativa = await chamarRota(bruno, "POST", `/api/demands/${livre.id}/assume`, {});
    checar("quem não é gerente NÃO assume — é a régua que a gaveta passou a obedecer",
      tentativa.status === 403, `status=${tentativa.status}`);
    const doGerenteAgora = await chamarRota(gina, "POST", `/api/demands/${livre.id}/assume`, {});
    checar("e o gerente continua podendo — o outro lado da mesma regra",
      doGerenteAgora.status === 200, `status=${doGerenteAgora.status}`);
    const cfg = await chamarRota(bruno, "GET", "/api/demands/sla-settings");
    checar("a tela sabe que a fila é direcionada sem precisar levar um 403 na cara",
      cfg.corpo.assignment_policy === "direcionamento", `policy=${cfg.corpo?.assignment_policy}`);

    // ── 6. D15: a fila continua sendo de toda a equipe ───────────────────────
    linhas.push("\n[6] D15 — a fila continua única e visível para a equipe");
    const pelaAna = await listar(ana, "limit=200&sort=title");
    const peloBruno = await listar(bruno, "limit=200&sort=title");
    checar("o que uma pessoa vê, a outra vê — mudar de lugar não recortou a fila",
      JSON.stringify(minhas(pelaAna.corpo.items).map((d: any) => d.id)) ===
        JSON.stringify(minhas(peloBruno.corpo.items).map((d: any) => d.id)),
      `${minhas(pelaAna.corpo.items).length} de cada lado`);

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
