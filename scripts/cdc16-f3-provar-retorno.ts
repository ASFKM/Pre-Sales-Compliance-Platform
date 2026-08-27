/**
 * CDC 16 — Fase 3. Prova por execução real, ETAPA 2: o PreSales EMPURRANDO.
 *
 * Roda no host do PreSales, contra o servidor de prova (porta 3010, banco
 * dedicado), e fala com o CMCRM VIVO — a porta que a etapa 1 acabou de publicar,
 * pela rede, com TLS verificado.
 *
 * O que ela exercita é o produto, não uma cópia: `assumirDemanda`,
 * `devolverDemanda` e `dbStore.updateProject` são as mesmas funções que as rotas
 * chamam, e o `in_analysis` sai da ROTA de análise de verdade, com login real —
 * é ela quem carimba, e provar o carimbo por outro caminho provaria outro
 * caminho.
 *
 *   DEMANDA_CONCLUSAO=... DEMANDA_DEVOLUCAO=... npx tsx scripts/cdc16-f3-provar-retorno.ts
 */
import "dotenv/config";
import { prisma } from "../src/prisma";
import { runWithTenant } from "../src/tenantContext";
import { drenarFila } from "../server/utils/crmOutbox";
import { lerChaveDoCrm, resolverDestino } from "../server/utils/crmPort";

const SUFIXO_BANCO_DE_PROVA = "_cdc16f1";
const TENANT = "tenant_default";
const BASE = process.env.BASE_URL || "http://127.0.0.1:3010";

let passou = 0;
let falhou = 0;
const linhas: string[] = [];

function checar(rotulo: string, condicao: boolean, detalhe: string) {
  if (condicao) {
    passou++;
    linhas.push(`  OK   ${rotulo} — ${detalhe}`);
  } else {
    falhou++;
    linhas.push(`  FALHA ${rotulo} — ${detalhe}`);
  }
}

function travaDeDestino() {
  const db = new URL(process.env.DATABASE_URL || "postgres://x/x");
  if (!db.pathname.endsWith(SUFIXO_BANCO_DE_PROVA)) {
    throw new Error(`RECUSADO: DATABASE_URL aponta para "${db.pathname}".`);
  }
}

async function esperarSaida(demandId: string, kind: string, tentativas = 20) {
  for (let i = 0; i < tentativas; i++) {
    const linha = await prisma.demandOutboundEvent.findFirst({
      where: { demandId, kind },
      orderBy: { createdAt: "desc" },
    });
    if (linha && linha.status !== "pendente") return linha;
    await new Promise((r) => setTimeout(r, 500));
  }
  return prisma.demandOutboundEvent.findFirst({ where: { demandId, kind }, orderBy: { createdAt: "desc" } });
}

async function main() {
  travaDeDestino();
  const refConclusao = process.env.DEMANDA_CONCLUSAO;
  const refDevolucao = process.env.DEMANDA_DEVOLUCAO;
  if (!refConclusao || !refDevolucao) {
    throw new Error("DEMANDA_CONCLUSAO e DEMANDA_DEVOLUCAO são obrigatórias (saem da etapa 1).");
  }
  linhas.push(`(banco=${new URL(process.env.DATABASE_URL!).pathname.slice(1)}, base=${BASE})`);

  await runWithTenant({ tenantId: TENANT, canSeeAllProjects: true }, async () => {
    // ───────────────────────────────────── 1. a chave e o endereço de retorno
    linhas.push("== 1. A chave do par foi guardada quando o CMCRM chamou ==");
    const chave = await lerChaveDoCrm(TENANT);
    checar(
      "a chave apresentada pelo CMCRM ficou guardada",
      !!chave,
      `hint=${chave?.keyHint ?? "-"} instalação=${chave?.crmInstallationId ?? "-"}`,
    );
    checar(
      "e o endereço de retorno veio no envelope da demanda",
      !!chave?.callbackBaseUrl,
      `callback=${chave?.callbackBaseUrl ?? "(nenhum)"}`,
    );
    const linhaBruta = await prisma.crmPairKey.findUnique({ where: { tenantId: TENANT } });
    checar(
      "a chave NÃO está em claro no banco",
      !!linhaBruta && !linhaBruta.keyEncrypted.includes(chave?.key ?? "impossivel"),
      `formato=${linhaBruta?.keyEncrypted.slice(0, 3)}...`,
    );

    linhas.push("== 2. O endereço de retorno é conferido contra o par, não aceito como veio ==");
    const destino = await resolverDestino(TENANT);
    checar(
      "o /pair/verify do CMCRM confirma que o endereço é do par",
      destino.ok,
      destino.ok ? `base=${destino.base}` : `motivo=${destino.motivo}`,
    );

    // Um endereço que RESPONDE, mas não é a porta do par: o CMSaaS. Ele fala
    // HTTPS, tem certificado válido e não é o CRM — é o caso que a conferência
    // existe para pegar, e o único jeito de prová-la é apontar para lá.
    const original = linhaBruta!.callbackBaseUrl;
    await prisma.crmPairKey.update({
      where: { tenantId: TENANT },
      data: { callbackBaseUrl: "https://192.168.3.182/api/pair/v1", verifiedAt: null },
    });
    const impostor = await resolverDestino(TENANT);
    checar(
      "um endereço que responde mas não é a porta do CRM é recusado, e em definitivo",
      !impostor.ok && impostor.permanente,
      impostor.ok ? "aceitou (errado)" : `motivo=${impostor.motivo.slice(0, 90)}`,
    );
    await prisma.crmPairKey.update({
      where: { tenantId: TENANT },
      data: { callbackBaseUrl: original, verifiedAt: null, verifyError: null },
    });

    // ───────────────────────────────────── 3. assumir empurra o marco
    //
    // Pelas ROTAS, e não pelas funções de domínio: o empurrão vive no handler, depois da
    // transação e depois da auditoria — chamar `assumirDemanda` direto pularia justamente o
    // trecho que esta fase acrescentou, e a prova passaria sem provar nada. A primeira versão
    // deste script cometeu esse erro, e ele só apareceu porque o CRM recusou os marcos seguintes
    // com 409 "fora de ordem": o `assigned` nunca tinha sido enfileirado.
    linhas.push("== 3. Assumir a demanda conta ao CRM, com o instante do fato ==");
    const senhaDaProva = process.env.PROVA_PASSWORD;
    if (!senhaDaProva) throw new Error("PROVA_PASSWORD ausente — a prova percorre as rotas com login real.");
    const entrada = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "prova-cdc16-f1@local.invalid", password: senhaDaProva }),
    });
    const corpoEntrada: any = await entrada.json().catch(() => ({}));
    const token = corpoEntrada?.token || corpoEntrada?.session_token || corpoEntrada?.data?.token;
    checar("login real do usuário de pré-vendas", entrada.status === 200 && !!token, `status=${entrada.status}`);
    if (!token) return;
    const comSessao = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    const paraConcluir = await prisma.demand.findFirst({ where: { demandRef: refConclusao } });
    checar("a demanda da etapa 1 chegou pela porta", !!paraConcluir, `ref=${refConclusao.slice(0, 40)}...`);
    if (!paraConcluir) return;

    const usuario = await prisma.user.findFirst({ where: { email: "prova-cdc16-f1@local.invalid" } });
    if (!usuario) throw new Error("usuário da prova não encontrado");

    const respAssumir = await fetch(`${BASE}/api/demands/${paraConcluir.id}/assume`, {
      method: "POST",
      headers: comSessao,
    });
    const corpoRespAssumir: any = await respAssumir.json().catch(() => ({}));
    const projetoId: string | undefined = corpoRespAssumir?.project_id;
    checar(
      "assumir pela rota cria o projeto com dono",
      respAssumir.status === 200 && !!projetoId,
      `status=${respAssumir.status} projeto=${projetoId}`,
    );
    if (!projetoId) return;
    const assumida = { ok: true as const, projectId: projetoId };

    const saidaAssumir = await esperarSaida(paraConcluir.id, "event");
    checar(
      "o marco `assigned` foi ENTREGUE ao CRM (202)",
      saidaAssumir?.status === "enviado" && saidaAssumir?.lastStatus === 202,
      `status=${saidaAssumir?.status} http=${saidaAssumir?.lastStatus} erro=${saidaAssumir?.lastError ?? "-"}`,
    );
    const corpoAssumir = (saidaAssumir?.payload ?? {}) as any;
    // Comparado contra a demanda RECARREGADA: `paraConcluir` foi lido antes de assumir, quando
    // `assignedAt` ainda era nulo — comparar com ele deixaria a asserção passar com dois
    // `undefined`, que é o modo clássico de um teste afirmar nada.
    const depoisDeAssumir = await prisma.demand.findUnique({ where: { id: paraConcluir.id } });
    checar(
      "e o corpo leva o instante do FATO, não o do envio",
      !!corpoAssumir.occurred_at &&
        corpoAssumir.occurred_at === depoisDeAssumir?.assignedAt?.toISOString(),
      `occurred_at=${corpoAssumir.occurred_at} assignedAt=${depoisDeAssumir?.assignedAt?.toISOString()}`,
    );
    checar(
      "com a medição de tempo desde o envio (D20)",
      typeof corpoAssumir.elapsed?.since_sent_seconds === "number",
      `elapsed=${JSON.stringify(corpoAssumir.elapsed)}`,
    );
    checar(
      "e com quem assumiu, por nome e referência externa (D34)",
      corpoAssumir.actor?.name === usuario.name && corpoAssumir.actor?.presales_user_id === usuario.id,
      `actor=${JSON.stringify(corpoAssumir.actor)}`,
    );

    const saidaRetrato = await esperarSaida(paraConcluir.id, "project_state");
    checar(
      "o retrato do projeto foi junto, e também entregue (200)",
      saidaRetrato?.status === "enviado" && saidaRetrato?.lastStatus === 200,
      `status=${saidaRetrato?.status} http=${saidaRetrato?.lastStatus} erro=${saidaRetrato?.lastError ?? "-"}`,
    );
    const corpoRetrato = (saidaRetrato?.payload ?? {}) as any;
    checar(
      "o retrato traz o projeto real, com dono e status",
      corpoRetrato.presales_project_id === assumida.projectId && corpoRetrato.status === "draft",
      `projeto=${corpoRetrato.presales_project_id} status=${corpoRetrato.status} dono=${corpoRetrato.owner?.name}`,
    );

    // ───────────────────────────────────── 4. a análise, pela rota real
    linhas.push("== 4. A análise técnica: o carimbo e o marco saem da rota real ==");
    const analise = await fetch(`${BASE}/api/projects/${assumida.projectId}/analyze`, {
      method: "POST",
      headers: comSessao,
      body: JSON.stringify({}),
    });
    const disparou = analise.status === 202 || analise.status === 200;
    checar("a rota de análise aceita o disparo", disparou, `status=${analise.status}`);

    if (disparou) {
      let emAnalise = null;
      for (let i = 0; i < 20; i++) {
        emAnalise = await prisma.demandOutboundEvent.findFirst({
          where: { demandId: paraConcluir.id, event: "in_analysis" },
        });
        if (emAnalise && emAnalise.status !== "pendente") break;
        await new Promise((r) => setTimeout(r, 500));
      }
      checar(
        "a rota carimbou a demanda e o marco `in_analysis` foi entregue",
        emAnalise?.status === "enviado" && emAnalise?.lastStatus === 202,
        `status=${emAnalise?.status ?? "(nenhum)"} http=${emAnalise?.lastStatus ?? "-"} erro=${emAnalise?.lastError ?? "-"}`,
      );
    }

    // ───────────────────────────────────── 5. concluir
    linhas.push("== 5. Concluir o projeto conclui a demanda, e o CRM fica sabendo ==");
    const respConcluir = await fetch(`${BASE}/api/projects/${assumida.projectId}`, {
      method: "PUT",
      headers: comSessao,
      body: JSON.stringify({ status: "completed" }),
    });
    checar("concluir o projeto pela rota é aceito", respConcluir.status === 200, `status=${respConcluir.status}`);
    const concluida = await prisma.demand.findUnique({ where: { id: paraConcluir.id } });
    checar(
      "a demanda foi para `completed`, com carimbo",
      concluida?.status === "completed" && !!concluida?.completedAt,
      `status=${concluida?.status} completedAt=${concluida?.completedAt?.toISOString()}`,
    );
    let saidaConcluir = null;
    for (let i = 0; i < 20; i++) {
      saidaConcluir = await prisma.demandOutboundEvent.findFirst({
        where: { demandId: paraConcluir.id, event: "completed" },
      });
      if (saidaConcluir && saidaConcluir.status !== "pendente") break;
      await new Promise((r) => setTimeout(r, 500));
    }
    checar(
      "e o marco `completed` foi entregue ao CRM",
      saidaConcluir?.status === "enviado" && saidaConcluir?.lastStatus === 202,
      `status=${saidaConcluir?.status ?? "(nenhum)"} http=${saidaConcluir?.lastStatus ?? "-"} erro=${saidaConcluir?.lastError ?? "-"}`,
    );

    // ───────────────────────────────────── 6. devolver
    linhas.push("== 6. Devolver: o marco forte, com motivo (D30) ==");
    const paraDevolver = await prisma.demand.findFirst({ where: { demandRef: refDevolucao } });
    checar("a segunda demanda também chegou", !!paraDevolver, `ref=${refDevolucao.slice(0, 40)}...`);
    if (paraDevolver) {
      const respAssumir2 = await fetch(`${BASE}/api/demands/${paraDevolver.id}/assume`, {
        method: "POST",
        headers: comSessao,
      });
      checar("assumida pela rota", respAssumir2.status === 200, `status=${respAssumir2.status}`);
      await esperarSaida(paraDevolver.id, "event");

      const motivo = "A ficha não traz o quantitativo por unidade; sem ele não dá para dimensionar.";
      const respDevolver = await fetch(`${BASE}/api/demands/${paraDevolver.id}/return`, {
        method: "POST",
        headers: comSessao,
        body: JSON.stringify({ reason: motivo }),
      });
      checar("devolver com motivo é aceito", respDevolver.status === 200, `status=${respDevolver.status}`);

      let saidaDevolver = null;
      for (let i = 0; i < 20; i++) {
        saidaDevolver = await prisma.demandOutboundEvent.findFirst({
          where: { demandId: paraDevolver.id, event: "returned" },
        });
        if (saidaDevolver && saidaDevolver.status !== "pendente") break;
        await new Promise((r) => setTimeout(r, 500));
      }
      checar(
        "o marco `returned` foi entregue ao CRM",
        saidaDevolver?.status === "enviado" && saidaDevolver?.lastStatus === 202,
        `status=${saidaDevolver?.status ?? "(nenhum)"} http=${saidaDevolver?.lastStatus ?? "-"} erro=${saidaDevolver?.lastError ?? "-"}`,
      );
      checar(
        "e o motivo viajou junto",
        ((saidaDevolver?.payload ?? {}) as any).reason === motivo,
        `reason=${String(((saidaDevolver?.payload ?? {}) as any).reason).slice(0, 60)}...`,
      );
    }

    // ───────────────────────────────────── 7. a fila é honesta sobre o que não sai
    linhas.push("== 7. O que o CRM recusa em definitivo não fica retentando para sempre ==");
    const orfa = await prisma.demandOutboundEvent.create({
      data: {
        id: `doe_orfao_${Date.now()}`,
        tenantId: TENANT,
        demandId: paraConcluir.id,
        kind: "event",
        event: "assigned",
        occurredAt: new Date(),
        // Uma transição que o CRM já não aceita: a demanda está `completed` lá.
        payload: { event: "assigned", occurred_at: new Date().toISOString() } as never,
        idempotencyKey: `orfao-${Date.now()}`,
      },
    });
    await drenarFila(TENANT);
    const depois = await prisma.demandOutboundEvent.findUnique({ where: { id: orfa.id } });
    checar(
      "evento fora de ordem é descartado com o motivo escrito, e não repetido para sempre",
      depois?.status === "descartado" && depois?.lastStatus === 409,
      `status=${depois?.status} http=${depois?.lastStatus} erro=${String(depois?.lastError).slice(0, 70)}`,
    );

    const resumo = await prisma.demandOutboundEvent.groupBy({ by: ["status"], _count: { _all: true } });
    linhas.push(`  (fila de saída: ${resumo.map((r) => `${r.status}=${r._count._all}`).join(" ")})`);
  });

  console.log(linhas.join("\n"));
  console.log(`\nETAPA 2: ${passou} passaram, ${falhou} falharam.`);
  await prisma.$disconnect();
  process.exit(falhou === 0 ? 0 : 1);
}

main().catch((err) => {
  console.log(linhas.join("\n"));
  console.error("FALHOU:", err?.stack || err?.message || err);
  process.exit(1);
});
