/**
 * CDC 16 — Fase 5. Prova por execução real, ETAPA 2: o SLA, o alerta e o gerente.
 *
 * Roda no host do PreSales, contra um servidor de prova em banco dedicado, e fala com o CMCRM
 * vivo pela rede. As demandas vêm da ETAPA 1 — foram criadas no CRM e entregues aqui pelo código
 * do worker, e é por isso que os eventos que saem daqui têm para onde chegar.
 *
 * O que ela exercita é o PRODUTO: as demandas são assumidas, devolvidas e direcionadas pelas
 * ROTAS, com login real de cada pessoa que o fluxo exige. Os ganchos desta fase vivem nos
 * handlers, depois da transação; chamar as funções de domínio direto pularia exatamente o trecho
 * que a F5 acrescentou. A F3 pagou esse erro e ele está registrado.
 *
 * UMA coisa é simulada, e vale estar dita em voz alta: o RELÓGIO. O SLA é medido em horas, e uma
 * demanda criada há trinta segundos não estoura prazo nenhum. A prova ENVELHECE a demanda — move
 * `queued_at` para trás no banco — e nada mais. A varredura roda de verdade, o índice único
 * decide de verdade, o destinatário é resolvido de verdade e o `sla_breached` sai de verdade pela
 * fila e chega ao CRM vivo. O que a prova falsifica é o insumo da regra, não a regra.
 *
 *   PROVA_PASSWORD=… REF_PRAZO=… REF_DEVOLUCAO=… REF_DIRECIONAR=… REF_COM_GERENTE=… \
 *     npx tsx scripts/cdc16-f5-provar-sla.ts
 */
import "dotenv/config";
import { prisma } from "../src/prisma";
import { runWithTenant } from "../src/tenantContext";
import { lerChaveDoCrm } from "../server/utils/crmPort";

const TENANT = process.env.PROVA_TENANT || "tenant_default";
const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const PREFIXO = "prova-cdc16-f5-";

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

import {
  PAPEIS_DA_PROVA,
  chamarRota,
  entrarComo,
  esperarSaidaDe,
  papelDaProva,
} from "./cdc16-f5-comum";

async function main() {
  const senha = process.env.PROVA_PASSWORD;
  if (!senha) throw new Error("PROVA_PASSWORD ausente — a prova percorre as rotas com login real");
  const refPrazo = process.env.REF_PRAZO;
  const refDevolucao = process.env.REF_DEVOLUCAO;
  const refDirecionar = process.env.REF_DIRECIONAR;
  const refComGerente = process.env.REF_COM_GERENTE;
  if (!refPrazo || !refDevolucao || !refDirecionar || !refComGerente) {
    throw new Error("as quatro referências de demanda da ETAPA 1 são obrigatórias");
  }
  linhas.push(`(base=${BASE}, tenant=${TENANT})`);

  await runWithTenant({ tenantId: TENANT, canSeeAllProjects: true }, async () => {
    const chaveDoPar = await lerChaveDoCrm(TENANT);
    checar("a chave do par está guardada deste lado (F3)", !!chaveDoPar, `hint=${chaveDoPar?.keyHint ?? "-"}`);
    if (!chaveDoPar) return;

    // Cenário limpo do PRÓPRIO script: sem isto, uma reexecução herdaria a configuração da
    // anterior e a primeira conferência — a de que ninguém configurou nada — mentiria.
    await prisma.demandSlaSettings.deleteMany({});
    await prisma.demandSlaBreach.deleteMany({});

    const papelAdmin = await papelDaProva("Prova F5 — administrador", PAPEIS_DA_PROVA.admin);
    const papelEquipe = await papelDaProva("Prova F5 — equipe", PAPEIS_DA_PROVA.equipe);
    // O papel de gerente nasce SEM a permissão: a primeira metade da prova precisa de uma
    // instalação sem gerente nenhum, que é o estado de todas hoje.
    await papelDaProva("Prova F5 — gerente de pré-vendas", PAPEIS_DA_PROVA.equipe);

    const admin = await entrarComo("Admin da prova F5", `${PREFIXO}admin@local.invalid`, papelAdmin.id, senha, checar);
    const ana = await entrarComo("Ana da prova F5", `${PREFIXO}ana@local.invalid`, papelEquipe.id, senha, checar);
    const bruno = await entrarComo("Bruno da prova F5", `${PREFIXO}bruno@local.invalid`, papelEquipe.id, senha, checar);
    if (!admin || !ana || !bruno) return;

    const demandaDoPrazo = await prisma.demand.findFirstOrThrow({ where: { demandRef: refPrazo } });
    const demandaDevolucao = await prisma.demand.findFirstOrThrow({ where: { demandRef: refDevolucao } });
    const demandaDirecionar = await prisma.demand.findFirstOrThrow({ where: { demandRef: refDirecionar } });
    const demandaComGerente = await prisma.demand.findFirstOrThrow({ where: { demandRef: refComGerente } });
    checar("as quatro demandas da ETAPA 1 chegaram pela porta", true, `prazo=${refPrazo.slice(-12)} …`);

    // ═══════════════════════════════════════════════ 1. o estado de HOJE, que não pode quebrar
    linhas.push("== 1. Sem SLA e sem gerente: exatamente o que a F1 entregou ==");
    const semSla = await chamarRota(admin, "GET", "/api/demands/sla-settings");
    checar(
      "nenhuma configuração existe, e a tela sabe disso",
      semSla.status === 200 && semSla.corpo?.configured === false && semSla.corpo?.assignment_policy === "auto_servico",
      `configured=${semSla.corpo?.configured} policy=${semSla.corpo?.assignment_policy}`,
    );
    checar(
      "e não há gerente de pré-vendas nenhum",
      Array.isArray(semSla.corpo?.managers) && semSla.corpo.managers.length === 0,
      `managers=${JSON.stringify(semSla.corpo?.managers)}`,
    );

    const semPrazoPelaPorta = await fetch(`${BASE}/api/external/crm/v1/demands/${encodeURIComponent(refPrazo)}`, {
      headers: { "X-Pair-Key": chaveDoPar.key },
    });
    const corpoSemPrazo: any = await semPrazoPelaPorta.json().catch(() => ({}));
    checar(
      "a porta de máquina NÃO inventa due_at enquanto não há SLA",
      semPrazoPelaPorta.status === 200 && corpoSemPrazo?.due_at === undefined,
      `status=${semPrazoPelaPorta.status} due_at=${JSON.stringify(corpoSemPrazo?.due_at)}`,
    );

    const naFila = await chamarRota(admin, "GET", "/api/demands?status=queued");
    const doPrazo = (naFila.corpo as any[]).find((d) => d.demand_ref === refPrazo);
    checar(
      "na fila, a demanda aparece sem prazo de SLA — e não com prazo vencido",
      !!doPrazo && doPrazo.due_at === null && doPrazo.sla_stage === null,
      `due_at=${doPrazo?.due_at} stage=${doPrazo?.sla_stage}`,
    );

    // Auto-serviço, intocado: Ana se oferece, e a devolução dela é DIRETA porque não há gerente.
    const assumeAna = await chamarRota(ana, "POST", `/api/demands/${demandaDevolucao.id}/assume`);
    checar("auto-serviço: qualquer pessoa da equipe assume da fila", assumeAna.status === 200, `status=${assumeAna.status}`);
    const devolveDireto = await chamarRota(ana, "POST", `/api/demands/${demandaDevolucao.id}/return`, {
      reason: "o edital anexado está incompleto e falta o anexo técnico",
    });
    checar(
      "sem gerente, a devolução continua DIRETA (D17)",
      devolveDireto.status === 200 &&
        devolveDireto.corpo?.pending_approval === false &&
        devolveDireto.corpo?.demand?.status === "returned",
      `status=${devolveDireto.status} pendente=${devolveDireto.corpo?.pending_approval} estado=${devolveDireto.corpo?.demand?.status}`,
    );

    // ═══════════════════════════════════════════════ 2. o SLA ligado (D19)
    linhas.push("== 2. O administrador liga o SLA, e o prazo passa a existir ==");
    const gravar = await chamarRota(admin, "PUT", "/api/demands/sla-settings", {
      enabled: true,
      assume_hours: 1,
      analysis_hours: 2,
      proposal_hours: 8,
      assignment_policy: "auto_servico",
    });
    checar("configuração salva pelo administrador", gravar.status === 200 && gravar.corpo?.configured === true, `status=${gravar.status}`);

    const semPermissao = await chamarRota(ana, "PUT", "/api/demands/sla-settings", {
      enabled: false,
      assume_hours: 1,
      analysis_hours: 2,
      proposal_hours: 8,
      assignment_policy: "auto_servico",
    });
    checar("quem não é administrador não configura (403)", semPermissao.status === 403, `status=${semPermissao.status}`);

    const foraDaRegua = await chamarRota(admin, "PUT", "/api/demands/sla-settings", {
      enabled: true,
      assume_hours: 0,
      analysis_hours: 2,
      proposal_hours: 8,
      assignment_policy: "auto_servico",
    });
    checar("prazo de zero hora é recusado (400)", foraDaRegua.status === 400, `status=${foraDaRegua.status}`);

    const comSla = await chamarRota(admin, "GET", "/api/demands?status=queued");
    const prazoAgora = (comSla.corpo as any[]).find((d) => d.demand_ref === refPrazo);
    checar(
      "a demanda na fila ganhou prazo para ASSUMIR",
      !!prazoAgora?.due_at && prazoAgora.sla_stage === "assume",
      `due_at=${prazoAgora?.due_at} stage=${prazoAgora?.sla_stage}`,
    );
    const esperado = new Date(demandaDoPrazo.queuedAt.getTime() + 3600_000).toISOString();
    checar(
      "e o prazo é a entrada na fila + as horas configuradas, não um palpite",
      prazoAgora?.due_at === esperado,
      `esperado=${esperado} veio=${prazoAgora?.due_at}`,
    );

    const pelaPorta = await fetch(`${BASE}/api/external/crm/v1/demands/${encodeURIComponent(refPrazo)}`, {
      headers: { "X-Pair-Key": chaveDoPar.key },
    });
    const corpoPorta: any = await pelaPorta.json().catch(() => ({}));
    checar(
      "e a porta de máquina passa a devolvê-lo ao CRM (D19)",
      pelaPorta.status === 200 && corpoPorta?.due_at === esperado,
      `status=${pelaPorta.status} due_at=${corpoPorta?.due_at}`,
    );

    // A etapa devida muda quando o estado muda, e o prazo muda com ela. Uma demanda em análise
    // não deve mais "assumir".
    const emAnalise = await prisma.demand.findFirstOrThrow({ where: { demandRef: refDirecionar } });
    const listaToda = await chamarRota(admin, "GET", "/api/demands?status=queued,assigned,in_analysis,returned");
    const devolvida = (listaToda.corpo as any[]).find((d) => d.demand_ref === refDevolucao);
    checar(
      "demanda em estado terminal NÃO ganha prazo: quem já devolveu não deve etapa nenhuma",
      devolvida?.due_at === null && devolvida?.sla_stage === null,
      `estado=${devolvida?.status} due_at=${devolvida?.due_at}`,
    );

    // ═══════════════════════════════════════════════ 3. o prazo vence e alerta (D19)
    linhas.push("== 3. O prazo vence: a equipe é alertada e o CRM recebe `sla_breached` ==");
    const queuedAtVelho = new Date(Date.now() - 3 * 3600_000);
    await prisma.demand.update({
      where: { id: demandaDoPrazo.id },
      data: { queuedAt: queuedAtVelho, sentAt: queuedAtVelho },
    });

    // A conta olha a DEMANDA desta prova, e não o total: este banco de prova tem a fila
    // acumulada das fases anteriores, e ligar o SLA numa instalação com fila parada alerta a
    // fila inteira de uma vez. Isso é o comportamento certo — o prazo passou a valer para todo
    // mundo —, mas usá-lo como denominador faria a conferência medir o histórico, não a regra.
    const antesDaVarredura = await prisma.demandSlaBreach.count({ where: { demandId: demandaDoPrazo.id } });
    const varredura = await chamarRota(admin, "POST", "/api/demands/sla/scan");
    const depoisDaVarredura = await prisma.demandSlaBreach.count({ where: { demandId: demandaDoPrazo.id } });
    checar(
      "a varredura encontra o prazo vencido e registra o alerta desta demanda",
      varredura.status === 200 && antesDaVarredura === 0 && depoisDaVarredura === 1 && varredura.corpo?.novas >= 1,
      `abertas=${varredura.corpo?.demandasAbertas} vencidas=${varredura.corpo?.vencidas} novas=${varredura.corpo?.novas} desta=${depoisDaVarredura}`,
    );

    const denovo = await chamarRota(admin, "POST", "/api/demands/sla/scan");
    checar(
      "e a segunda varredura NÃO alerta de novo nenhum prazo já alertado",
      denovo.corpo?.vencidas >= 1 && denovo.corpo?.novas === 0,
      `vencidas=${denovo.corpo?.vencidas} novas=${denovo.corpo?.novas}`,
    );

    const alertas = await chamarRota(ana, "GET", "/api/demands/alerts");
    const alerta = (alertas.corpo as any[]).find((a) => a.demand_ref === refPrazo);
    checar(
      "o alerta existe, nomeia a etapa e diz quando venceu",
      !!alerta && alerta.stage === "assume" && !!alerta.due_at,
      `stage=${alerta?.stage} due_at=${alerta?.due_at}`,
    );
    checar(
      "sem gerente nomeado, o alerta vai para a EQUIPE (D19)",
      alerta?.recipient_kind === "team" && Array.isArray(alerta?.recipient_user_ids) && alerta.recipient_user_ids.length >= 2,
      `kind=${alerta?.recipient_kind} destinatarios=${alerta?.recipient_user_ids?.length}`,
    );

    const saida = await esperarSaidaDe(demandaDoPrazo.id, "sla_breached");
    checar(
      "`sla_breached` foi ENTREGUE ao CMCRM vivo — o evento que nunca tinha sido emitido",
      saida?.status === "enviado" && saida?.lastStatus === 202,
      `status=${saida?.status} http=${saida?.lastStatus} erro=${saida?.lastError ?? "-"}`,
    );
    const corpoDoEvento = (saida?.payload ?? {}) as any;
    checar(
      "e o instante do fato é o VENCIMENTO, não o da varredura",
      corpoDoEvento.occurred_at === new Date(queuedAtVelho.getTime() + 3600_000).toISOString(),
      `occurred_at=${corpoDoEvento.occurred_at}`,
    );
    checar(
      "o prazo viaja junto, e o evento não tem ator: quem venceu o prazo foi o relógio",
      !!corpoDoEvento.due_at && corpoDoEvento.actor === undefined,
      `due_at=${corpoDoEvento.due_at} actor=${JSON.stringify(corpoDoEvento.actor)}`,
    );

    const darPorVisto = await chamarRota(ana, "POST", `/api/demands/alerts/${alerta.id}/ack`);
    checar("um destinatário do alerta pode dá-lo por visto", darPorVisto.status === 200, `status=${darPorVisto.status}`);
    const depoisDoAck = await chamarRota(ana, "GET", "/api/demands/alerts");
    checar(
      "e ele sai da lista de abertos",
      !(depoisDoAck.corpo as any[]).some((a) => a.id === alerta.id),
      `abertos=${(depoisDoAck.corpo as any[]).length}`,
    );

    // ═══════════════════════════════════════════════ 4. o gerente de pré-vendas (D17)
    linhas.push("== 4. Nomeado o gerente, a devolução passa a precisar dele ==");
    const papelGerente = await papelDaProva("Prova F5 — gerente de pré-vendas", PAPEIS_DA_PROVA.gerente);
    const gina = await entrarComo("Gina da prova F5", `${PREFIXO}gina@local.invalid`, papelGerente.id, senha, checar);
    if (!gina) return;

    const comGerente = await chamarRota(admin, "GET", "/api/demands/sla-settings");
    checar(
      "a tela passa a dizer quem é o gerente",
      comGerente.corpo?.managers?.length === 1 && comGerente.corpo.managers[0].name === "Gina da prova F5",
      `managers=${JSON.stringify(comGerente.corpo?.managers)}`,
    );

    await chamarRota(ana, "POST", `/api/demands/${demandaComGerente.id}/assume`);
    const antesDoPedido = await prisma.demandOutboundEvent.count({
      where: { demandId: demandaComGerente.id, event: "returned" },
    });
    const pedido = await chamarRota(ana, "POST", `/api/demands/${demandaComGerente.id}/return`, {
      reason: "o quantitativo do lote 2 não fecha com o memorial descritivo",
    });
    checar(
      "a devolução de quem não é gerente vira PEDIDO, e não devolução",
      pedido.status === 200 && pedido.corpo?.pending_approval === true && pedido.corpo?.demand?.status === "assigned",
      `pendente=${pedido.corpo?.pending_approval} estado=${pedido.corpo?.demand?.status}`,
    );
    checar(
      "e NADA é contado ao CRM: `returned` é marco forte e manda e-mail ao vendedor",
      (await prisma.demandOutboundEvent.count({ where: { demandId: demandaComGerente.id, event: "returned" } })) === antesDoPedido,
      `saídas returned=${antesDoPedido}`,
    );

    const pedidoDuplo = await chamarRota(ana, "POST", `/api/demands/${demandaComGerente.id}/return`, {
      reason: "outro motivo qualquer com mais de dez caracteres",
    });
    checar("um segundo pedido no mesmo estado é recusado (409)", pedidoDuplo.status === 409, `status=${pedidoDuplo.status}`);

    const anaTentaAprovar = await chamarRota(ana, "POST", `/api/demands/${demandaComGerente.id}/return/approve`);
    checar("quem pediu não aprova a própria devolução (403)", anaTentaAprovar.status === 403, `status=${anaTentaAprovar.status}`);

    const recusa = await chamarRota(gina, "POST", `/api/demands/${demandaComGerente.id}/return/reject`, {
      reason: "os anexos estão no portal da licitação; baixe de lá antes de devolver",
    });
    checar(
      "o gerente recusa: a demanda continua com quem a assumiu, e o motivo volta",
      recusa.status === 200 &&
        recusa.corpo?.demand?.status === "assigned" &&
        String(recusa.corpo?.demand?.return_rejection_reason ?? "").includes("portal da licitação"),
      `estado=${recusa.corpo?.demand?.status} motivo=${String(recusa.corpo?.demand?.return_rejection_reason).slice(0, 30)}`,
    );

    const segundoPedido = await chamarRota(ana, "POST", `/api/demands/${demandaComGerente.id}/return`, {
      reason: "o portal também não tem os anexos; conferido com a comissão",
    });
    checar(
      "depois da recusa, um pedido NOVO é aceito",
      segundoPedido.status === 200 && segundoPedido.corpo?.pending_approval === true,
      `status=${segundoPedido.status}`,
    );

    const aprova = await chamarRota(gina, "POST", `/api/demands/${demandaComGerente.id}/return/approve`);
    checar(
      "o gerente aprova: agora sim a demanda volta ao vendedor",
      aprova.status === 200 && aprova.corpo?.demand?.status === "returned",
      `estado=${aprova.corpo?.demand?.status}`,
    );
    const saidaReturned = await esperarSaidaDe(demandaComGerente.id, "returned");
    checar(
      "e SÓ agora o `returned` sai para o CRM, com o motivo de quem PEDIU",
      saidaReturned?.status === "enviado" && String((saidaReturned.payload as any)?.reason ?? "").includes("portal também não tem"),
      `status=${saidaReturned?.status} reason=${String((saidaReturned?.payload as any)?.reason ?? "").slice(0, 40)}`,
    );

    // O alerta seguinte vai para o GERENTE, e não mais para a equipe.
    await prisma.demand.update({
      where: { id: emAnalise.id },
      data: { queuedAt: new Date(Date.now() - 3 * 3600_000), sentAt: new Date(Date.now() - 3 * 3600_000) },
    });
    await chamarRota(admin, "POST", "/api/demands/sla/scan");
    const alertasComGerente = await chamarRota(gina, "GET", "/api/demands/alerts");
    const alertaDoGerente = (alertasComGerente.corpo as any[]).find((a) => a.demand_ref === refDirecionar);
    checar(
      "com gerente nomeado, o alerta passa a ser endereçado a ELE (D19)",
      alertaDoGerente?.recipient_kind === "manager" && alertaDoGerente.recipient_user_ids.length === 1,
      `kind=${alertaDoGerente?.recipient_kind} destinatarios=${JSON.stringify(alertaDoGerente?.recipient_user_ids)}`,
    );

    // ═══════════════════════════════════════════════ 5. direcionamento e reatribuição (D16)
    linhas.push("== 5. A política de direcionamento: o gerente aponta quem trabalha ==");
    await chamarRota(admin, "PUT", "/api/demands/sla-settings", {
      enabled: true,
      assume_hours: 1,
      analysis_hours: 2,
      proposal_hours: 8,
      assignment_policy: "direcionamento",
    });

    const anaTentaAssumir = await chamarRota(ana, "POST", `/api/demands/${demandaDirecionar.id}/assume`);
    checar(
      "numa fila direcionada, quem não é gerente não assume da fila (403 com o motivo escrito)",
      anaTentaAssumir.status === 403 && String(anaTentaAssumir.corpo?.message).includes("direcionadas"),
      `status=${anaTentaAssumir.status} msg=${String(anaTentaAssumir.corpo?.message).slice(0, 60)}`,
    );

    const direciona = await chamarRota(gina, "POST", `/api/demands/${demandaDirecionar.id}/direct`, { user_id: bruno.userId });
    checar(
      "o gerente direciona: a demanda é assumida em nome de quem ele escolheu",
      direciona.status === 200 && direciona.corpo?.action === "assigned" && direciona.corpo?.demand?.assigned_user_id === bruno.userId,
      `acao=${direciona.corpo?.action} para=${direciona.corpo?.demand?.assigned_to}`,
    );
    checar(
      "e a demanda registra QUEM decidiu, não só quem recebeu",
      direciona.corpo?.demand?.assignment_source === "manager" && direciona.corpo?.demand?.assigned_by === "Gina da prova F5",
      `origem=${direciona.corpo?.demand?.assignment_source} por=${direciona.corpo?.demand?.assigned_by}`,
    );
    const projetoDirecionado = direciona.corpo?.project_id;
    const donoInicial = await prisma.project.findUniqueOrThrow({ where: { id: projetoDirecionado } });
    checar("o projeto nasce com a pessoa escolhida como dona", donoInicial.ownerUserId === bruno.userId, `dono=${donoInicial.ownerUserId}`);

    const saidaAssigned = await esperarSaidaDe(demandaDirecionar.id, "assigned");
    checar(
      "o CRM recebe `assigned` com o ATOR sendo quem trabalha, e a nota dizendo quem direcionou",
      saidaAssigned?.status === "enviado" &&
        (saidaAssigned.payload as any)?.actor?.name === "Bruno da prova F5" &&
        String((saidaAssigned.payload as any)?.note ?? "").includes("Direcionada por"),
      `ator=${(saidaAssigned?.payload as any)?.actor?.name} nota=${(saidaAssigned?.payload as any)?.note}`,
    );
    checar(
      "e o prazo da etapa NOVA viaja junto: assumir fechou, a análise abriu",
      typeof (saidaAssigned?.payload as any)?.due_at === "string",
      `due_at=${(saidaAssigned?.payload as any)?.due_at}`,
    );

    const reatribui = await chamarRota(gina, "POST", `/api/demands/${demandaDirecionar.id}/direct`, { user_id: ana.userId });
    checar(
      "reatribuir move a demanda para outra pessoa",
      reatribui.status === 200 && reatribui.corpo?.action === "reassigned" && reatribui.corpo?.demand?.assigned_user_id === ana.userId,
      `acao=${reatribui.corpo?.action} para=${reatribui.corpo?.demand?.assigned_to}`,
    );
    const donoDepois = await prisma.project.findUniqueOrThrow({ where: { id: projetoDirecionado } });
    checar(
      "e o DONO DO PROJETO vai junto — sem isso, quem recebe não enxerga o trabalho",
      donoDepois.ownerUserId === ana.userId,
      `dono=${donoDepois.ownerUserId}`,
    );
    const saidaReassigned = await esperarSaidaDe(demandaDirecionar.id, "reassigned");
    checar("o CRM recebe `reassigned`, e não um segundo `assigned`", saidaReassigned?.status === "enviado", `status=${saidaReassigned?.status}`);

    const mesmaPessoa = await chamarRota(gina, "POST", `/api/demands/${demandaDirecionar.id}/direct`, { user_id: ana.userId });
    checar("direcionar para quem já está com ela é recusado (409)", mesmaPessoa.status === 409, `status=${mesmaPessoa.status}`);

    const paraQuemNaoPode = await chamarRota(gina, "POST", `/api/demands/${demandaDirecionar.id}/direct`, { user_id: admin.userId });
    checar(
      "direcionar para quem NÃO pode assumir é recusado com o motivo (422)",
      paraQuemNaoPode.status === 422,
      `status=${paraQuemNaoPode.status} msg=${String(paraQuemNaoPode.corpo?.message).slice(0, 50)}`,
    );

    const anaTentaDirecionar = await chamarRota(ana, "POST", `/api/demands/${demandaDirecionar.id}/direct`, { user_id: bruno.userId });
    checar("quem não é gerente não direciona (403)", anaTentaDirecionar.status === 403, `status=${anaTentaDirecionar.status}`);

    // ═══════════════════════════════════════════════ 6. liga a política automática e para aqui
    linhas.push("== 6. Ligada a política automática; a ETAPA 1b entrega a próxima demanda ==");
    const ligaAuto = await chamarRota(admin, "PUT", "/api/demands/sla-settings", {
      enabled: true,
      assume_hours: 1,
      analysis_hours: 2,
      proposal_hours: 8,
      assignment_policy: "automatico",
    });
    checar(
      "política automática ligada",
      ligaAuto.status === 200 && ligaAuto.corpo?.assignment_policy === "automatico",
      `policy=${ligaAuto.corpo?.assignment_policy}`,
    );
    // A carga de agora, que é o que a régua da D40 vai pesar quando a próxima demanda chegar.
    const abertas = await prisma.demand.findMany({
      where: { status: { in: ["assigned", "in_analysis"] } },
      select: { assignedUserId: true, deadline: true, assignedUser: { select: { name: true } } },
    });
    linhas.push(
      `  (carga no momento: ${abertas.map((d) => `${d.assignedUser?.name ?? "?"} até ${d.deadline.toISOString().slice(0, 10)}`).join("; ") || "ninguém"})`,
    );

    console.log(linhas.join("\n"));
    console.log(`\nETAPA 2: ${passou} passaram, ${falhou} falharam.`);
    console.log(`BRUNO_ID=${bruno.userId}`);
    console.log(`ANA_ID=${ana.userId}`);
  });

  await prisma.$disconnect();
  process.exit(falhou === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.log(linhas.join("\n"));
  console.error("FALHOU:", err?.stack || err?.message || err);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
