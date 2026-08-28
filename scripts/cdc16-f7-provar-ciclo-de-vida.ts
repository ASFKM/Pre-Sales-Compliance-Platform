/**
 * CDC 16 — Fase 7. Prova por execução real: o CICLO DE VIDA, do lado do PreSales.
 *
 * Roda no host do PreSales, contra um servidor de prova em banco dedicado, e fala com o CMCRM
 * VIVO pela rede quando o evento tem para onde ir. Sem mock em lugar nenhum: a porta é a real, a
 * chave é a do par real, e o CMSaaS é consultado de verdade a cada chamada.
 *
 * SETE seções, na ordem em que a fase as decidiu:
 *
 *  1. os TRÊS caminhos que a F1 provava responder 404 passam a existir — e a superfície da spec
 *     fecha em SEIS DE SEIS;
 *  2. o cancelamento (D18), estado por estado: na fila cancela; assumida vira pedido; encerrada
 *     ou concluída recusa;
 *  3. a atualização pós-envio (D27): a demanda muda, o PROJETO não, e a decisão é de gente;
 *  4. a oportunidade perdida (D29), que avisa e não decide — e que entra pelo PATCH, porque a
 *     spec não declara caminho próprio e inventar um seria mudar o contrato na implementação;
 *  5. o expurgo em cascata (D35), com arquivo de verdade no armazenamento, e o REGISTRO;
 *  6. o `cancellation_ack` chegando ao CRM vivo — o terceiro marco forte, que nunca tinha sido
 *     emitido por ninguém desde que nasceu no contrato, na F3;
 *  7. o CONGELAMENTO (D06): sem par, a porta fecha e a fila de saída para — e o que já chegou
 *     continua na tela, que é a metade que a D06 existe para garantir.
 *
 *   PROVA_PASSWORD=… PAIR_KEY=… npx tsx scripts/cdc16-f7-provar-ciclo-de-vida.ts
 */
import "dotenv/config";
import crypto from "crypto";
import { prisma } from "../src/prisma";
import { runWithTenant } from "../src/tenantContext";
import { lerChaveDoCrm } from "../server/utils/crmPort";
import { drenarFila } from "../server/utils/crmOutbox";
import { PAPEIS_DA_PROVA, chamarRota, entrarComo, esperarSaidaDe, papelDaProva } from "./cdc16-f5-comum";

const TENANT = process.env.PROVA_TENANT || "tenant_default";
const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const PORTA = `${BASE}/api/external/crm/v1`;
const PREFIXO = "prova-cdc16-f7-";
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

/** Uma chamada à porta de máquina. `chave: null` para provar o 401. */
async function bater(
  metodo: string,
  caminho: string,
  opcoes: { corpo?: unknown; idem?: string; chave?: string | null; binario?: Buffer } = {}
) {
  const headers: Record<string, string> = {};
  const chave = opcoes.chave === undefined ? CHAVE : opcoes.chave;
  if (chave) headers["X-Pair-Key"] = chave;
  if (opcoes.idem) headers["Idempotency-Key"] = opcoes.idem;
  let body: any;
  if (opcoes.binario) {
    headers["Content-Type"] = "application/octet-stream";
    body = opcoes.binario;
  } else if (opcoes.corpo !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opcoes.corpo);
  }
  const r = await fetch(`${PORTA}${caminho}`, { method: metodo, headers, body });
  const texto = await r.text();
  let json: any = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    json = texto;
  }
  return { status: r.status, corpo: json, bruto: texto.slice(0, 200) };
}

const FICHA = {
  title: `${PREFIXO}Videomonitoramento urbano`,
  vertical: "Segurança Pública",
  description: "Implantação de 40 pontos de monitoramento.",
  deadline: "2026-09-30",
  proposal_validity_date: "2026-10-30",
  output_language: "Portuguese" as const,
  proposal_language: "Portuguese" as const,
  ai_orientation_mode: "Vendor-neutral" as const,
};

function envelope(ref: string, over: Record<string, any> = {}) {
  return {
    demand_ref: ref,
    company: { crm_company_id: `${PREFIXO}cmp`, name: `${PREFIXO}Prefeitura` },
    opportunity: {
      crm_opportunity_id: `${PREFIXO}opp`,
      name: `${PREFIXO}Pregão 12/2026`,
      currency: "BRL",
      value: 250000,
      stage: "Proposta",
    },
    sheet: FICHA,
    sent_by: { crm_user_id: "crm_u1", name: `${PREFIXO}Vendedor` },
    sent_at: new Date().toISOString(),
    crm_callback_base_url: `${CRM_BASE}/api/external/presales/v1`,
    ...over,
  };
}

const APROVADOR = { crm_user_id: "crm_lider", name: `${PREFIXO}Líder Direto` };

async function criarPelaPorta(ref: string, over: Record<string, any> = {}) {
  const r = await bater("POST", "/demands", { corpo: envelope(ref, over), idem: `f7-cria-${ref}` });
  if (r.status !== 201) throw new Error(`não consegui criar a demanda ${ref}: ${r.status} ${r.bruto}`);
  return r;
}

/** Apaga só o que ESTA prova cria, por prefixo. Sem isto ela não é reexecutável (lição da F6). */
async function limparPrefixo(preservar: string) {
  const demandas = await prisma.demand.findMany({
    // Os DOIS prefixos: o local e o da ETAPA 1 (`cdc16-f7-`), porque a demanda do ciclo vem de lá
    // e uma execução anterior deixaria projeto e atualizações para trás.
    //
    // Menos a demanda que ESTA execução vai usar. Sem o `preservar`, a limpeza apagava a demanda
    // que a etapa 1 acabara de entregar — e a prova morria na linha seguinte, procurando o que
    // ela mesma tinha removido. Aconteceu na primeira execução.
    where: {
      AND: [
        { OR: [{ demandRef: { startsWith: PREFIXO } }, { demandRef: { startsWith: "cdc16-f7" } }] },
        { demandRef: { not: preservar } },
      ],
    },
    select: { id: true, projectId: true },
  });
  const ids = demandas.map((d) => d.id);
  const projetos = demandas.map((d) => d.projectId).filter((p): p is string => Boolean(p));
  if (ids.length) {
    await prisma.demandUpdate.deleteMany({ where: { demandId: { in: ids } } });
    await prisma.demandOutboundEvent.deleteMany({ where: { demandId: { in: ids } } });
    await prisma.demandDocument.deleteMany({ where: { demandId: { in: ids } } });
    await prisma.demand.deleteMany({ where: { id: { in: ids } } });
  }
  if (projetos.length) {
    await prisma.documentContent.deleteMany({ where: { document: { projectId: { in: projetos } } } });
    await prisma.document.deleteMany({ where: { projectId: { in: projetos } } });
    await prisma.project.deleteMany({ where: { id: { in: projetos } } });
  }
  await prisma.project.deleteMany({ where: { name: { startsWith: PREFIXO } } });
  // Os registros de expurgo desta prova são achados pelo ALVO, e não pela instalação: o
  // `crm_installation_id` é o da instalação real do par, e filtrar por ele apagaria o registro de
  // um expurgo de verdade. `targets` é jsonb, então a peneira é sobre o texto dele — e o
  // `tenant_id` vai explícito no `where` porque consulta crua não passa pela extensão que recorta
  // por tenant.
  await prisma.$executeRawUnsafe(
    "delete from crm_purge_executions where tenant_id = $1 and targets::text like $2",
    TENANT,
    `%${PREFIXO}%`
  );
  await prisma.idempotencyRecord.deleteMany({ where: { key: { startsWith: "f7-" } } });
}

async function main() {
  const senha = process.env.PROVA_PASSWORD;
  if (!senha) throw new Error("PROVA_PASSWORD ausente — a prova percorre as rotas com login real");

  await runWithTenant({ tenantId: TENANT, canSeeAllProjects: true }, async () => {
    linhas.push(`(base=${BASE}, tenant=${TENANT}, crm=${CRM_BASE})`);
    const refCiclo = process.env.REF_CICLO;
    if (!refCiclo) throw new Error("REF_CICLO ausente — é a demanda que a ETAPA 1 criou no CRM e entregou aqui");
    await limparPrefixo(refCiclo);

    const guardada = await lerChaveDoCrm(TENANT);
    CHAVE = process.env.PAIR_KEY || guardada?.key || "";
    if (!CHAVE) throw new Error("PAIR_KEY ausente e nenhuma chave guardada — a porta não pode ser exercitada");

    const papelEquipe = await papelDaProva(`${PREFIXO}equipe`, PAPEIS_DA_PROVA.equipe);
    const ana = await entrarComo(`${PREFIXO}Ana`, `${PREFIXO}ana@teste.invalid`, papelEquipe.id, senha, (r, ok, d) =>
      checar(r, ok, d)
    );
    if (!ana) throw new Error("o login da prova falhou");

    // ═══ 1. Os três caminhos passam a EXISTIR ═══════════════════════════════
    linhas.push("== 1. os três caminhos da F7, que a F1 provava não existirem ==");

    await criarPelaPorta(`${PREFIXO}d1`);

    const semChave = [
      ["PATCH", `/demands/${PREFIXO}d1`],
      ["POST", `/demands/${PREFIXO}d1/cancel`],
      ["POST", "/purge"],
    ] as const;
    for (const [metodo, caminho] of semChave) {
      const r = await bater(metodo, caminho, { chave: null, corpo: {} });
      checar(`${metodo} ${caminho} sem chave: 401 antes de resolver a rota`, r.status === 401, `status=${r.status}`);
    }

    const patchSemChaveIdem = await bater("PATCH", `/demands/${PREFIXO}d1`, { corpo: { note: "x" } });
    checar("PATCH sem Idempotency-Key: 400", patchSemChaveIdem.status === 400, `status=${patchSemChaveIdem.status} ${patchSemChaveIdem.corpo?.error}`);

    const patchInexistente = await bater("PATCH", "/demands/nao-existe-mesmo", { corpo: {}, idem: "f7-inexistente-1" });
    checar("PATCH em demanda inexistente: 404", patchInexistente.status === 404, `status=${patchInexistente.status}`);

    const cancelInexistente = await bater("POST", "/demands/nao-existe-mesmo/cancel", {
      corpo: { justification: "qualquer motivo com dez", approved_by: APROVADOR },
    });
    checar("POST /cancel em demanda inexistente: 404", cancelInexistente.status === 404, `status=${cancelInexistente.status}`);

    const cancelCurto = await bater("POST", `/demands/${PREFIXO}d1/cancel`, {
      corpo: { justification: "curta", approved_by: APROVADOR },
    });
    checar("POST /cancel com justificativa curta: 422", cancelCurto.status === 422, `status=${cancelCurto.status}`);

    const cancelSemAprovador = await bater("POST", `/demands/${PREFIXO}d1/cancel`, {
      corpo: { justification: "uma justificativa suficientemente longa" },
    });
    checar("POST /cancel sem approved_by: 422 (D18 exige o líder)", cancelSemAprovador.status === 422, `status=${cancelSemAprovador.status}`);

    const purgeSemAlvo = await bater("POST", "/purge", { corpo: { reason: "retention", targets: [] } });
    checar("POST /purge sem alvo: 422", purgeSemAlvo.status === 422, `status=${purgeSemAlvo.status}`);

    const purgeMotivoInvalido = await bater("POST", "/purge", {
      corpo: { reason: "porque sim", targets: [{ kind: "document", crm_id: "x" }] },
    });
    checar("POST /purge com motivo fora do enum: 422", purgeMotivoInvalido.status === 422, `status=${purgeMotivoInvalido.status}`);

    // ═══ 2. O cancelamento, estado por estado (D18) ═════════════════════════
    linhas.push("== 2. o cancelamento (D18): na fila cancela, assumida vira pedido ==");

    const cancelNaFila = await bater("POST", `/demands/${PREFIXO}d1/cancel`, {
      corpo: { justification: "O cliente cancelou o edital inteiro.", approved_by: APROVADOR },
    });
    checar(
      "cancelar na FILA: 200 outcome=cancelled",
      cancelNaFila.status === 200 && cancelNaFila.corpo?.outcome === "cancelled",
      `status=${cancelNaFila.status} outcome=${cancelNaFila.corpo?.outcome}`
    );
    checar(
      "a resposta traz o ESTADO da demanda, e ele diz cancelled",
      cancelNaFila.corpo?.state?.status === "cancelled",
      `state.status=${cancelNaFila.corpo?.state?.status}`
    );

    const cancelRepetido = await bater("POST", `/demands/${PREFIXO}d1/cancel`, {
      corpo: { justification: "Outra justificativa, e não deve reescrever.", approved_by: { crm_user_id: "outro", name: "Outro" } },
    });
    checar(
      "cancelar de novo: 200 idempotente, sem Idempotency-Key nenhuma",
      cancelRepetido.status === 200 && cancelRepetido.corpo?.outcome === "cancelled",
      `status=${cancelRepetido.status}`
    );
    const d1 = await prisma.demand.findFirstOrThrow({ where: { demandRef: `${PREFIXO}d1` } });
    checar(
      "a repetição NÃO reescreveu o aprovador nem o carimbo",
      d1.cancellationApprovedByName === APROVADOR.name,
      `aprovador=${d1.cancellationApprovedByName}`
    );

    const patchEmCancelada = await bater("PATCH", `/demands/${PREFIXO}d1`, {
      corpo: { note: "tarde demais" },
      idem: "f7-patch-cancelada",
    });
    checar(
      "PATCH em demanda cancelada: 409 demand_closed",
      patchEmCancelada.status === 409 && patchEmCancelada.corpo?.error === "demand_closed",
      `status=${patchEmCancelada.status} error=${patchEmCancelada.corpo?.error}`
    );

    // A demanda do CICLO vem da ETAPA 1: foi criada no CRM e entregue aqui pelo
    // código do worker. É o que dá ao `cancellation_ack` da seção 6 um
    // destinatário de verdade — um evento sobre uma demanda que o CRM não
    // conhece volta 404, e provar entrega contra 404 não prova entrega nenhuma.
    const d2 = await prisma.demand.findFirstOrThrow({ where: { demandRef: refCiclo } });
    checar("a demanda da ETAPA 1 chegou aqui pela entrega do worker", d2.status === "queued", `ref=${refCiclo} status=${d2.status}`);
    const assumir = await chamarRota(ana, "POST", `/api/demands/${d2.id}/assume`, {});
    checar("assumir pela ROTA, com login real", assumir.status === 200, `status=${assumir.status}`);
    const projetoDoD2 = assumir.corpo?.project_id as string;

    const cancelAssumida = await bater("POST", `/demands/${refCiclo}/cancel`, {
      corpo: { justification: "O cliente desistiu da contratação.", approved_by: APROVADOR },
    });
    checar(
      "cancelar demanda ASSUMIDA: 200 outcome=cancellation_requested",
      cancelAssumida.status === 200 && cancelAssumida.corpo?.outcome === "cancellation_requested",
      `outcome=${cancelAssumida.corpo?.outcome}`
    );
    checar(
      "o estado NÃO mudou: quem está trabalhando decide quando parar",
      cancelAssumida.corpo?.state?.status === "assigned",
      `state.status=${cancelAssumida.corpo?.state?.status}`
    );

    // ═══ 3. A atualização pós-envio (D27) ═══════════════════════════════════
    linhas.push("== 3. a atualização pós-envio (D27): a demanda muda, o projeto NÃO ==");

    const PATCH_PRAZO = {
      sheet: { ...FICHA, deadline: "2026-10-15", proposal_validity_date: "2026-11-15" },
      changed_by: { crm_user_id: "crm_u1", name: `${PREFIXO}Vendedor` },
      changed_at: new Date().toISOString(),
      note: "Prazo alterado por impugnação.",
    };

    // O prazo "de antes" é lido do PROJETO, e não escrito à mão: a demanda veio da ETAPA 1, com a
    // ficha que ela montou. Uma data fixa aqui compararia com o cenário de OUTRO script — e foi
    // exatamente o que a primeira execução fez, acusando o produto de um defeito que era da prova.
    const prazoDeAntes = (await prisma.project.findFirstOrThrow({ where: { id: projetoDoD2 } })).deadline
      .toISOString()
      .substring(0, 10);

    const patch1 = await bater("PATCH", `/demands/${refCiclo}`, { corpo: PATCH_PRAZO, idem: "f7-patch-prazo-1" });
    checar(
      "PATCH: 202 com pending_updates",
      patch1.status === 202 && patch1.corpo?.pending_updates === 1,
      `status=${patch1.status} pending=${patch1.corpo?.pending_updates}`
    );

    const patchReplay = await bater("PATCH", `/demands/${refCiclo}`, { corpo: PATCH_PRAZO, idem: "f7-patch-prazo-1" });
    checar(
      "PATCH repetido com a MESMA chave e o mesmo corpo: mesma resposta, sem segunda atualização",
      patchReplay.status === 202 && patchReplay.corpo?.pending_updates === 1,
      `status=${patchReplay.status} pending=${patchReplay.corpo?.pending_updates}`
    );

    const patchConflito = await bater("PATCH", `/demands/${refCiclo}`, {
      corpo: { ...PATCH_PRAZO, note: "outro corpo" },
      idem: "f7-patch-prazo-1",
    });
    checar(
      "PATCH com a mesma chave e corpo DIFERENTE: 409",
      patchConflito.status === 409,
      `status=${patchConflito.status} error=${patchConflito.corpo?.error}`
    );

    const patchInvalido = await bater("PATCH", `/demands/${refCiclo}`, {
      corpo: { sheet: { title: "só o título" } },
      idem: "f7-patch-invalido",
    });
    checar(
      "PATCH com ficha pela metade: 422 (a spec referencia o ProjectSheet inteiro)",
      patchInvalido.status === 422,
      `status=${patchInvalido.status}`
    );

    const demandaDepois = await prisma.demand.findFirstOrThrow({ where: { demandRef: refCiclo } });
    checar(
      "a DEMANDA já mostra o prazo novo: ela existe para espelhar o CRM",
      demandaDepois.deadline.toISOString().substring(0, 10) === "2026-10-15",
      `deadline=${demandaDepois.deadline.toISOString().substring(0, 10)}`
    );
    const projetoAntes = await prisma.project.findFirstOrThrow({ where: { id: projetoDoD2 } });
    checar(
      "o PROJETO continua com o prazo de antes — é o coração da D27",
      projetoAntes.deadline.toISOString().substring(0, 10) === prazoDeAntes,
      `deadline=${projetoAntes.deadline.toISOString().substring(0, 10)}`
    );

    const naFila = await chamarRota(ana, "GET", "/api/demands?status=assigned");
    const naFilaD2 = (naFila.corpo as any[]).find((d) => d.demand_ref === refCiclo);
    checar(
      "a fila mostra a atualização pendente, com o antes e o depois",
      Array.isArray(naFilaD2?.pending_updates) &&
        naFilaD2.pending_updates.length === 1 &&
        naFilaD2.pending_updates[0].changes.some((c: any) => c.antes === prazoDeAntes && c.depois === "2026-10-15"),
      `pendentes=${naFilaD2?.pending_updates?.length}`
    );
    checar(
      "a fila mostra o pedido de cancelamento, com a justificativa e o aprovador",
      naFilaD2?.cancellation_requested_at && naFilaD2?.cancellation_approved_by === APROVADOR.name,
      `aprovador=${naFilaD2?.cancellation_approved_by}`
    );

    const updateId = naFilaD2.pending_updates[0].id as string;
    const incorporar = await chamarRota(ana, "POST", `/api/demands/${d2.id}/updates/${updateId}/incorporate`, {});
    checar("incorporar pela ROTA: 200", incorporar.status === 200, `status=${incorporar.status}`);
    const projetoDepois = await prisma.project.findFirstOrThrow({ where: { id: projetoDoD2 } });
    checar(
      "só AGORA o projeto mudou de prazo",
      projetoDepois.deadline.toISOString().substring(0, 10) === "2026-10-15",
      `deadline=${projetoDepois.deadline.toISOString().substring(0, 10)}`
    );

    const decidirDeNovo = await chamarRota(ana, "POST", `/api/demands/${d2.id}/updates/${updateId}/incorporate`, {});
    checar("decidir duas vezes a mesma atualização: 409", decidirDeNovo.status === 409, `status=${decidirDeNovo.status}`);

    // ═══ 4. A oportunidade perdida avisa, e não decide (D29) ════════════════
    linhas.push("== 4. a oportunidade perdida (D29): avisa, e não fecha nada ==");

    /*
     * A oportunidade JÁ foi movida para "Perdida" pela ETAPA 1, pelo `moveStage` real do CRM — e
     * é ESSA a atualização que interessa. Mandar aqui um PATCH sintético com a etapa perdida não
     * provaria nada: o campo já estaria igual dos dois lados, o diff sairia vazio de `stage`, e a
     * espécie seria calculada sobre outra coisa. Foi o que a primeira execução fez, e ela
     * "descobriu" um defeito que não existia.
     */
    const perdaReal = await prisma.demandUpdate.findFirst({
      where: { demandId: d2.id, kind: "oportunidade_perdida" },
      orderBy: { changedAt: "desc" },
    });
    checar(
      "a perda que o CRM produziu de verdade está rotulada como oportunidade_perdida",
      perdaReal !== null,
      `kind=${perdaReal?.kind ?? "(nenhuma)"} nota=${(perdaReal?.note ?? "").slice(0, 60)}`
    );
    const mudancasDaPerda = (perdaReal?.changes ?? []) as Array<{ campo: string; depois: string | null }>;
    checar(
      "e o que mudou nela é a ETAPA no funil, com o nome que a organização deu",
      mudancasDaPerda.some((m) => m.campo === "opportunity.stage" && (m.depois ?? "").toLowerCase().includes("perdid")),
      `campos=${mudancasDaPerda.map((m) => m.campo).join(", ")}`
    );
    const d2AposPerda = await prisma.demand.findFirstOrThrow({ where: { id: d2.id } });
    checar(
      "e o CICLO da demanda NÃO se mexeu: quem assumiu decide encerrar ou concluir",
      d2AposPerda.status === "assigned",
      `status=${d2AposPerda.status}`
    );

    // Uma atualização NOVA, só para exercitar o descarte: o valor renegociado é o caso mais
    // comum da D27 depois do prazo.
    const patchValor = await bater("PATCH", `/demands/${refCiclo}`, {
      corpo: {
        opportunity: {
          crm_opportunity_id: d2.crmOpportunityId,
          name: d2.opportunityName,
          currency: "BRL",
          value: (d2.value ?? 0) + 12345,
        },
        changed_by: { crm_user_id: "crm_u1", name: `${PREFIXO}Vendedor` },
        changed_at: new Date().toISOString(),
        note: "Valor renegociado com o cliente.",
      },
      idem: "f7-patch-valor",
    });
    checar("PATCH com o valor renegociado: 202", patchValor.status === 202, `status=${patchValor.status}`);
    const paraDescartar = await prisma.demandUpdate.findFirstOrThrow({
      where: { demandId: d2.id, status: "pending" },
      orderBy: { changedAt: "desc" },
    });
    checar(
      "ela é rotulada como mudança COMERCIAL, e não como perda",
      paraDescartar.kind === "comercial",
      `kind=${paraDescartar.kind}`
    );

    const descartar = await chamarRota(ana, "POST", `/api/demands/${d2.id}/updates/${paraDescartar.id}/dismiss`, {
      note: "O trabalho serve para o outro edital do mesmo cliente.",
    });
    checar("descartar exige motivo e registra quem decidiu", descartar.status === 200, `status=${descartar.status}`);
    const descarteSemMotivo = await chamarRota(ana, "POST", `/api/demands/${d2.id}/updates/${paraDescartar.id}/dismiss`, { note: "x" });
    checar("descartar sem motivo de verdade: recusado", descarteSemMotivo.status === 400, `status=${descarteSemMotivo.status}`);

    // ═══ 5. O expurgo em cascata, com arquivo de verdade (D35) ══════════════
    linhas.push("== 5. o expurgo em cascata (D35), com arquivo real no armazenamento ==");

    const conteudo = Buffer.from(`edital de prova ${Date.now()}`, "utf-8");
    const sha = crypto.createHash("sha256").update(conteudo).digest("hex");
    await criarPelaPorta(`${PREFIXO}d3`, {
      company: { crm_company_id: `${PREFIXO}cmp-expurgo`, name: `${PREFIXO}Prefeitura B` },
      documents: [
        {
          document_ref: "doc_1",
          filename: `${PREFIXO}edital.txt`,
          mime_type: "text/plain",
          size_bytes: conteudo.length,
          sha256: sha,
          extracted_text: "TEXTO EXTRAÍDO PELO CRM",
          crm_document_id: `${PREFIXO}crmdoc-1`,
        },
      ],
    });
    const subiu = await bater("PUT", `/demands/${PREFIXO}d3/documents/doc_1/content`, { binario: conteudo });
    checar("o binário do documento subiu: 201", subiu.status === 201, `status=${subiu.status}`);

    const d3 = await prisma.demand.findFirstOrThrow({ where: { demandRef: `${PREFIXO}d3` } });
    const assumirD3 = await chamarRota(ana, "POST", `/api/demands/${d3.id}/assume`, {});
    checar("assumir a d3 materializa o documento no projeto", assumirD3.status === 200, `status=${assumirD3.status}`);
    const materializado = await prisma.demandDocument.findFirstOrThrow({ where: { demandId: d3.id } });
    checar("o documento tem Document e arquivo no armazenamento", Boolean(materializado.documentId && materializado.storagePath), `documentId=${materializado.documentId}`);
    const caminhoDoArquivo = materializado.storagePath as string;

    const expurgo = await bater("POST", "/purge", {
      corpo: { reason: "retention", targets: [{ kind: "document", crm_id: `${PREFIXO}crmdoc-1` }] },
    });
    checar(
      "POST /purge de documento: 200 com purged e executed_at",
      expurgo.status === 200 && Array.isArray(expurgo.corpo?.purged) && Boolean(expurgo.corpo?.executed_at),
      `status=${expurgo.status} purged=${JSON.stringify(expurgo.corpo?.purged)}`
    );
    checar(
      "a cópia sumiu dos DOIS lugares: a declaração e o Document materializado",
      (await prisma.demandDocument.count({ where: { demandId: d3.id } })) === 0 &&
        (await prisma.document.count({ where: { id: materializado.documentId as string } })) === 0,
      "contagens zeradas"
    );
    checar(
      "o texto extraído sumiu junto (DocumentContent cai por cascade)",
      (await prisma.documentContent.count({ where: { documentId: materializado.documentId as string } })) === 0,
      "0 linhas"
    );
    const projetoD3 = await prisma.project.findFirstOrThrow({ where: { id: assumirD3.corpo?.project_id } });
    checar(
      "o PROJETO sobrevive ao expurgo do documento: cópia é uma coisa, trabalho é outra",
      Boolean(projetoD3),
      `projeto=${projetoD3.id}`
    );

    const repetido = await bater("POST", "/purge", {
      corpo: { reason: "retention", targets: [{ kind: "document", crm_id: `${PREFIXO}crmdoc-1` }] },
    });
    checar(
      "expurgar de novo apaga ZERO, e responde 200 do mesmo jeito",
      repetido.status === 200 && repetido.corpo?.purged?.[0]?.deleted === 0,
      `deleted=${repetido.corpo?.purged?.[0]?.deleted}`
    );

    const registros = await chamarRota(ana, "GET", "/api/demands/purges");
    const meus = (registros.corpo as any[]).filter((e) =>
      JSON.stringify(e.targets).includes(`${PREFIXO}crmdoc-1`)
    );
    checar("as DUAS execuções ficaram registradas, e a rota humana as lê", meus.length === 2, `execuções=${meus.length}`);
    checar(
      "o registro NÃO guarda o nome do arquivo nem o texto extraído",
      !JSON.stringify(meus).includes(`${PREFIXO}edital.txt`) && !JSON.stringify(meus).includes("TEXTO EXTRAÍDO"),
      "nenhum dos dois aparece"
    );
    checar("e guarda o sha256, que identifica sem reproduzir", JSON.stringify(meus).includes(sha), "sha presente");

    const expurgoEmpresa = await bater("POST", "/purge", {
      corpo: { reason: "data_subject_request", targets: [{ kind: "company", crm_id: `${PREFIXO}cmp-expurgo` }] },
    });
    checar("POST /purge de empresa: 200", expurgoEmpresa.status === 200, `status=${expurgoEmpresa.status}`);
    checar(
      "a demanda daquela empresa sumiu",
      (await prisma.demand.count({ where: { id: d3.id } })) === 0,
      "0 demandas"
    );
    const projetoSemReferencia = await prisma.project.findFirstOrThrow({ where: { id: projetoD3.id } });
    checar(
      "o projeto ficou, e perdeu a REFERÊNCIA ao cliente que deixou de existir lá",
      projetoSemReferencia.crmCompanyId === null && projetoSemReferencia.customerName.includes("expurgada"),
      `customerName=${projetoSemReferencia.customerName}`
    );

    // ═══ 6. O cancellation_ack chegando ao CRM vivo ═════════════════════════
    linhas.push("== 6. o cancellation_ack, o terceiro marco forte, emitido pela primeira vez ==");

    const encerrar = await chamarRota(ana, "POST", `/api/demands/${d2.id}/cancel/close`, {});
    checar("encerrar pela ROTA depois do pedido: 200", encerrar.status === 200, `status=${encerrar.status}`);
    const d2Final = await prisma.demand.findFirstOrThrow({ where: { id: d2.id } });
    checar(
      "a demanda ficou cancelled, com o desfecho e quem encerrou",
      d2Final.status === "cancelled" && d2Final.cancellationOutcome === "cancelled" && Boolean(d2Final.cancellationClosedByUserId),
      `status=${d2Final.status} outcome=${d2Final.cancellationOutcome}`
    );
    checar(
      "o PROJETO sobreviveu ao encerramento (a regra da devolução, aplicada aqui)",
      (await prisma.project.count({ where: { id: projetoDoD2 } })) === 1,
      "projeto intacto"
    );

    const saida = await esperarSaidaDe(d2.id, "cancellation_ack");
    checar(
      "o cancellation_ack foi ENFILEIRADO e entregue ao CRM vivo",
      saida?.status === "enviado",
      `status=${saida?.status} lastStatus=${saida?.lastStatus} erro=${(saida?.lastError ?? "").slice(0, 120)}`
    );
    const envelopeAck = (saida?.payload ?? {}) as any;
    checar(
      "e ele leva ATOR: alguém deste lado encerrou, ao contrário do cancelamento na fila",
      Boolean(envelopeAck?.actor?.name),
      `actor=${envelopeAck?.actor?.name}`
    );

    const ackDaFila = await prisma.demandOutboundEvent.findFirst({ where: { demandId: d1.id, event: "cancellation_ack" } });
    const envelopeFila = (ackDaFila?.payload ?? {}) as any;
    checar(
      "o ack do cancelamento NA FILA sai SEM ator: ninguém daqui agiu",
      Boolean(ackDaFila) && !envelopeFila?.actor,
      `actor=${JSON.stringify(envelopeFila?.actor ?? null)}`
    );

    const cancelConcluida = await bater("POST", `/demands/${refCiclo}/cancel`, {
      corpo: { justification: "tentando cancelar o que já acabou", approved_by: APROVADOR },
    });
    checar(
      "cancelar o que já foi encerrado: 200 idempotente",
      cancelConcluida.status === 200 && cancelConcluida.corpo?.outcome === "cancelled",
      `status=${cancelConcluida.status}`
    );

    // ═══ 7. O CONGELAMENTO (D06) ════════════════════════════════════════════
    //
    // Esta seção APAGA a chave do par por alguns segundos, e a devolve num `finally`. No banco de
    // prova isso é inofensivo; contra a instalação PUBLICADA não é — enquanto a chave não está
    // lá, a fila de saída não tem para onde entregar. É recuperável (o CRM a reapresenta na
    // primeira chamada de entrada seguinte), mas é um efeito que uma prova não precisa causar
    // numa instalação viva para provar uma coisa que ela já prova melhor no servidor de prova.
    // Mesmo gênero e mesmo motivo do `PULAR_STANDALONE` que a F6 teve de parametrizar.
    if (process.env.PULAR_CONGELAMENTO === "1") {
      linhas.push("== 7. congelar (D06): PULADA nesta rodada (PULAR_CONGELAMENTO=1) ==");
      return;
    }
    linhas.push("== 7. congelar (D06): mantém o recebido, para de sincronizar ==");

    const chaveInventada = "pk_" + crypto.randomBytes(24).toString("hex");
    const portaComChaveMorta = await bater("GET", "/pair/verify", { chave: chaveInventada });
    checar(
      "chave que o CMSaaS não conhece: 401 invalid_pair_key — o mesmo que a revogada produz",
      portaComChaveMorta.status === 401 && portaComChaveMorta.corpo?.error === "invalid_pair_key",
      `status=${portaComChaveMorta.status} error=${portaComChaveMorta.corpo?.error}`
    );

    const antesDeCongelar = await chamarRota(ana, "GET", "/api/demands?status=queued,assigned,in_analysis,returned,cancelled,completed");
    const quantasRecebidas = (antesDeCongelar.corpo as any[]).length;
    const resumoAntes = await chamarRota(ana, "GET", "/api/demands/summary");

    // O congelamento de verdade é a revogação no CMSaaS, que apaga o hash e a
    // cópia cifrada da chave. Deste lado o efeito observável é o mesmo de apagar
    // a `CrmPairKey` guardada: a fila de saída deixa de ter para onde entregar.
    // A chave é DEVOLVIDA no `finally`, e é por isso que a instalação publicada
    // pode rodar esta seção sem ficar sem par.
    const backup = await prisma.crmPairKey.findUnique({ where: { tenantId: TENANT } });
    try {
      await prisma.crmPairKey.deleteMany({ where: { tenantId: TENANT } });

      const congelada = await chamarRota(ana, "GET", "/api/demands?status=queued,assigned,in_analysis,returned,cancelled,completed");
      checar(
        "a fila humana continua respondendo, com TUDO o que já tinha chegado",
        congelada.status === 200 && (congelada.corpo as any[]).length === quantasRecebidas,
        `antes=${quantasRecebidas} depois=${(congelada.corpo as any[]).length}`
      );
      const resumoDepois = await chamarRota(ana, "GET", "/api/demands/summary");
      checar(
        "o contador que faz a ABA aparecer continua > 0 (D06: sem par, o histórico não some da tela)",
        resumoDepois.corpo?.total === resumoAntes.corpo?.total && resumoDepois.corpo?.total > 0,
        `total=${resumoDepois.corpo?.total}`
      );

      await criarPelaPorta(`${PREFIXO}d4`);
      const d4 = await prisma.demand.findFirstOrThrow({ where: { demandRef: `${PREFIXO}d4` } });
      // A criação REGRAVA a chave apresentada — é o que `guardarChaveApresentada`
      // faz desde a F3. Apagamos de novo para que a drenagem encontre o estado
      // congelado, que é o que esta seção existe para exercitar.
      await prisma.crmPairKey.deleteMany({ where: { tenantId: TENANT } });
      const assumirCongelada = await chamarRota(ana, "POST", `/api/demands/${d4.id}/assume`, {});
      checar(
        "assumir continua funcionando sem par: a fila NÃO é gated por módulo (a decisão da F1)",
        assumirCongelada.status === 200,
        `status=${assumirCongelada.status}`
      );

      await drenarFila(TENANT).catch(() => undefined);
      const parada = await prisma.demandOutboundEvent.findFirst({
        where: { demandId: d4.id, event: "assigned" },
        orderBy: { createdAt: "desc" },
      });
      checar(
        "e a SINCRONIZAÇÃO parou, com o motivo escrito em vez de retentativa infinita",
        parada?.status === "descartado" && (parada?.lastError ?? "").includes("chave do par"),
        `status=${parada?.status} motivo=${(parada?.lastError ?? "").slice(0, 90)}`
      );
    } finally {
      if (backup) {
        await prisma.crmPairKey.deleteMany({ where: { tenantId: TENANT } });
        await prisma.crmPairKey.create({ data: { ...backup } });
      }
    }
    const devolvida = await prisma.crmPairKey.findUnique({ where: { tenantId: TENANT } });
    checar("a chave do par foi DEVOLVIDA ao fim da seção", Boolean(devolvida), `presente=${Boolean(devolvida)}`);
  });
}

main()
  .then(async () => {
    console.log(linhas.join("\n"));
    console.log(`\n== F7 (PreSales): ${passou} OK, ${falhou} FALHA ==`);
    await prisma.$disconnect();
    process.exit(falhou === 0 ? 0 : 1);
  })
  .catch(async (err) => {
    console.log(linhas.join("\n"));
    console.error("\nERRO:", err);
    await prisma.$disconnect();
    process.exit(2);
  });
