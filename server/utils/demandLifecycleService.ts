import { prisma } from "../../src/prisma";
import { randomId } from "../../src/idGenerator";
import { materializarDocumentos, dataObrigatoria, type DemandPatchInput } from "./demands";
import {
  avaliarCancelamento,
  aceitaAtualizacao,
  precisaDeDecisao,
  diferencas,
  especieDaAtualizacao,
  type Diferenca,
  type EstadoDaDemanda,
} from "./demandLifecycle";

// CDC 16 — Fase 7. O que ESCREVE o ciclo de vida.
//
// A regra pura vive em `demandLifecycle.ts` e é ela que decide; aqui só se
// executa o que ela decidiu. A divisão é a mesma que a F5 fez entre
// `demandSla.ts` e `demandSlaService.ts`, e pelo mesmo motivo: a regra que
// decide o que acontece com o trabalho de alguém precisa ser lida sem um
// cliente de banco no meio.

// ─── A atualização pós-envio (D27) ──────────────────────────────────────────

/**
 * O retrato do que o CRM disse por último, nos nomes do CONTRATO.
 *
 * É contra este objeto que o diff é feito, e não contra o Projeto: o antes e o
 * depois que a D27 manda mostrar são os do CRM — o que o pré-vendas escreveu no
 * projeto é a outra metade, e comparar as duas produziria "mudou" toda vez que
 * alguém editasse o próprio trabalho.
 */
function retratoDaDemanda(d: any): Record<string, unknown> {
  return {
    "opportunity.name": d.opportunityName,
    "opportunity.stage": d.stage,
    "opportunity.deal_type": d.dealType,
    "opportunity.value": d.value,
    "opportunity.currency": d.currency,
    "opportunity.probability": d.probability,
    "opportunity.margin_percent": d.marginPercent,
    "opportunity.expected_close_date": d.expectedCloseDate,
    "opportunity.risks": d.risks,
    "opportunity.origin": d.origin,
    "sheet.title": d.title,
    "sheet.vertical": d.vertical,
    "sheet.description": d.description,
    "sheet.deadline": d.deadline,
    "sheet.proposal_validity_date": d.proposalValidityDate,
    "sheet.output_language": d.outputLanguage,
    "sheet.proposal_language": d.proposalLanguage,
    "sheet.ai_orientation_mode": d.aiOrientationMode,
    "sheet.ai_orientation_text": d.aiOrientationText,
    "sheet.procurement_modality": d.procurementModality,
    "sheet.procurement_subtype": d.procurementSubtype,
    objective: d.objective,
  };
}

/** O mesmo retrato, montado a partir do corpo do PATCH. Só o que veio. */
function retratoDoPatch(p: DemandPatchInput): Record<string, unknown> {
  const saida: Record<string, unknown> = {};
  if (p.opportunity) {
    const o = p.opportunity;
    // `crm_opportunity_id` fica de fora de propósito: um PATCH não repontam a
    // demanda para outra oportunidade — isso seria outra demanda (D26).
    saida["opportunity.name"] = o.name;
    saida["opportunity.stage"] = o.stage;
    saida["opportunity.deal_type"] = o.deal_type;
    saida["opportunity.value"] = o.value;
    saida["opportunity.currency"] = o.currency;
    saida["opportunity.probability"] = o.probability;
    saida["opportunity.margin_percent"] = o.margin_percent;
    saida["opportunity.expected_close_date"] = o.expected_close_date;
    saida["opportunity.risks"] = o.risks;
    saida["opportunity.origin"] = o.origin;
  }
  if (p.sheet) {
    const f = p.sheet;
    saida["sheet.title"] = f.title;
    saida["sheet.vertical"] = f.vertical;
    saida["sheet.description"] = f.description;
    saida["sheet.deadline"] = f.deadline;
    saida["sheet.proposal_validity_date"] = f.proposal_validity_date;
    saida["sheet.output_language"] = f.output_language;
    saida["sheet.proposal_language"] = f.proposal_language;
    saida["sheet.ai_orientation_mode"] = f.ai_orientation_mode;
    saida["sheet.ai_orientation_text"] = f.ai_orientation_text;
    saida["sheet.procurement_modality"] = f.procurement_modality;
    saida["sheet.procurement_subtype"] = f.procurement_subtype;
  }
  if (p.objective !== undefined) saida.objective = p.objective;
  return saida;
}

/** As colunas da `Demand` que cada campo do contrato alimenta. */
function colunasDaDemanda(p: DemandPatchInput): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  if (p.opportunity) {
    const o = p.opportunity;
    d.opportunityName = o.name;
    d.stage = o.stage ?? null;
    d.dealType = o.deal_type ?? null;
    d.value = o.value ?? null;
    d.currency = o.currency || "BRL";
    d.probability = o.probability ?? null;
    d.marginPercent = o.margin_percent ?? null;
    d.expectedCloseDate = o.expected_close_date
      ? dataObrigatoria(o.expected_close_date, "opportunity.expected_close_date")
      : null;
    d.risks = o.risks ?? [];
    d.origin = o.origin ?? null;
  }
  if (p.sheet) {
    const f = p.sheet;
    d.title = f.title;
    d.vertical = f.vertical;
    d.description = f.description;
    d.deadline = dataObrigatoria(f.deadline, "sheet.deadline");
    d.proposalValidityDate = dataObrigatoria(f.proposal_validity_date, "sheet.proposal_validity_date");
    d.outputLanguage = f.output_language;
    d.proposalLanguage = f.proposal_language;
    d.aiOrientationMode = f.ai_orientation_mode;
    d.aiOrientationText = f.ai_orientation_text ?? "";
    d.procurementModality = f.procurement_modality ?? null;
    d.procurementSubtype = f.procurement_subtype ?? null;
  }
  if (p.objective !== undefined) d.objective = p.objective;
  return d;
}

export type ResultadoAtualizacao =
  | { ok: true; pendingUpdates: number; mudancas: Diferenca[]; decidida: boolean }
  | { ok: false; motivo: "not_found" }
  | { ok: false; motivo: "encerrada"; status: string };

/**
 * O PATCH do contrato: a demanda passa a dizer o que o CRM diz, e o projeto não
 * é tocado (D27).
 *
 * O corpo é aplicado à DEMANDA na hora. Ela existe para espelhar o CRM, e uma
 * demanda que continuasse anunciando na fila um prazo que foi impugnado seria
 * pior do que uma demanda que muda. O que não é tocado é o PROJETO — e é ali
 * que mora o trabalho que a D27 protege.
 *
 * Um PATCH que não muda nada não vira linha: registrar uma atualização vazia
 * encheria a tela de quem assumiu com avisos que não pedem decisão nenhuma.
 */
export async function registrarAtualizacao(
  demandaId: string,
  entrada: DemandPatchInput
): Promise<ResultadoAtualizacao> {
  return prisma.$transaction(async (tx) => {
    const demanda = await tx.demand.findUnique({ where: { id: demandaId }, include: { documents: true } });
    if (!demanda) return { ok: false, motivo: "not_found" } as ResultadoAtualizacao;
    if (!aceitaAtualizacao(demanda.status as EstadoDaDemanda)) {
      return { ok: false, motivo: "encerrada", status: demanda.status } as ResultadoAtualizacao;
    }

    const mudancas = diferencas(retratoDaDemanda(demanda), retratoDoPatch(entrada));

    // Documentos: o que chega e ainda não foi declarado é ADENDO. Documento já
    // declarado com o mesmo `document_ref` não é redeclarado — a spec diz que
    // ausência é "não mudou", e presença repetida também não é "apagar e criar".
    const jaDeclarados = new Set(demanda.documents.map((d) => d.documentRef));
    const novos = (entrada.documents ?? []).filter((d) => !jaDeclarados.has(d.document_ref));
    for (const doc of novos) {
      await tx.demandDocument.create({
        data: {
          id: randomId("dd"),
          tenantId: demanda.tenantId,
          demandId: demanda.id,
          documentRef: doc.document_ref,
          crmDocumentId: doc.crm_document_id ?? null,
          filename: doc.filename,
          mimeType: doc.mime_type,
          sizeBytes: doc.size_bytes,
          sha256: doc.sha256.toLowerCase(),
          extractedText: doc.extracted_text ?? null,
        },
      });
    }
    if (novos.length > 0) {
      mudancas.push({
        campo: "documents",
        rotulo: "Documentos",
        antes: `${demanda.documents.length} documento(s)`,
        depois: `${demanda.documents.length + novos.length} documento(s)`,
      });
    }

    const colunas = colunasDaDemanda(entrada);
    if (Object.keys(colunas).length > 0) {
      await tx.demand.update({ where: { id: demanda.id }, data: colunas as any });
    }

    let decidida = false;
    if (mudancas.length > 0) {
      // Na fila, sem dono, não há a quem perguntar e não há projeto onde
      // incorporar: o projeto vai NASCER da demanda já atualizada. A linha é
      // gravada mesmo assim, porque ela é o histórico do que o CRM mandou — o
      // que muda é que ela já nasce decidida.
      decidida = !precisaDeDecisao(demanda.status as EstadoDaDemanda);
      const agora = new Date();
      await tx.demandUpdate.create({
        data: {
          id: randomId("du"),
          tenantId: demanda.tenantId,
          demandId: demanda.id,
          payload: entrada as any,
          changes: mudancas as any,
          kind: especieDaAtualizacao(mudancas),
          note: entrada.note ?? null,
          changedByCrmUserId: entrada.changed_by?.crm_user_id ?? null,
          changedByName: entrada.changed_by?.name ?? null,
          changedAt: entrada.changed_at ? dataObrigatoria(entrada.changed_at, "changed_at") : agora,
          status: decidida ? "incorporated" : "pending",
          decidedAt: decidida ? agora : null,
          decisionNote: decidida
            ? "Aplicada na fila: a demanda ainda não tinha sido assumida, e o projeto nasce dela já atualizada."
            : null,
        },
      });
    }

    const pendingUpdates = await tx.demandUpdate.count({
      where: { demandId: demanda.id, status: "pending" },
    });
    return { ok: true, pendingUpdates, mudancas, decidida } as ResultadoAtualizacao;
  });
}

export type ResultadoDecisao =
  | { ok: true; aplicadasAoProjeto: number; documentosMaterializados: number; cobertas: number }
  | { ok: false; motivo: "not_found" }
  | { ok: false; motivo: "ja_decidida"; status: string }
  | { ok: false; motivo: "sem_projeto" };

/** As colunas do Projeto que cada campo do contrato alimenta, quando incorporado. */
function colunasDoProjeto(p: DemandPatchInput): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  if (p.opportunity) d.opportunityName = p.opportunity.name;
  if (p.sheet) {
    const f = p.sheet;
    d.name = f.title;
    d.vertical = f.vertical;
    d.description = f.description;
    d.deadline = dataObrigatoria(f.deadline, "sheet.deadline");
    d.proposalValidityDate = dataObrigatoria(f.proposal_validity_date, "sheet.proposal_validity_date");
    d.outputLanguage = f.output_language;
    d.proposalLanguage = f.proposal_language;
    d.aiOrientationMode = f.ai_orientation_mode;
    d.aiOrientationText = f.ai_orientation_text ?? "";
    d.procurementModality = f.procurement_modality ?? null;
    d.procurementSubtype = f.procurement_subtype ?? null;
  }
  return d;
}

/**
 * Levar a atualização para o Projeto — a decisão que a D27 reserva para gente.
 *
 * Aplica o payload DESTA atualização, e não o estado corrente da demanda: o
 * botão diz "incorporar esta", e aplicar outra coisa seria mentir no rótulo.
 *
 * E marca como incorporadas as pendentes ANTERIORES a esta. O motivo é a forma
 * do contrato: `opportunity` e `sheet` viajam INTEIROS, então uma atualização
 * mais nova descreve, campo a campo, tudo o que a anterior descrevia. Sem esta
 * regra, incorporar a mais nova e depois a mais antiga escreveria no projeto um
 * valor que o CRM já corrigiu — e a pessoa não teria como saber.
 */
export async function incorporarAtualizacao(
  updateId: string,
  userId: string
): Promise<ResultadoDecisao> {
  return prisma.$transaction(async (tx) => {
    const atualizacao = await tx.demandUpdate.findUnique({ where: { id: updateId } });
    if (!atualizacao) return { ok: false, motivo: "not_found" } as ResultadoDecisao;
    if (atualizacao.status !== "pending") {
      return { ok: false, motivo: "ja_decidida", status: atualizacao.status } as ResultadoDecisao;
    }
    const demanda = await tx.demand.findUnique({
      where: { id: atualizacao.demandId },
      include: { documents: true },
    });
    if (!demanda) return { ok: false, motivo: "not_found" } as ResultadoDecisao;
    if (!demanda.projectId) return { ok: false, motivo: "sem_projeto" } as ResultadoDecisao;

    const payload = atualizacao.payload as unknown as DemandPatchInput;
    const colunas = colunasDoProjeto(payload);
    if (Object.keys(colunas).length > 0) {
      await tx.project.update({ where: { id: demanda.projectId }, data: colunas as any });
    }

    const materializacao = await materializarDocumentos(tx, {
      tenantId: demanda.tenantId,
      projectId: demanda.projectId,
      uploadedBy: demanda.sentByName ?? "Pré-vendas",
      documentos: demanda.documents,
    });

    const agora = new Date();
    await tx.demandUpdate.update({
      where: { id: updateId },
      data: { status: "incorporated", decidedAt: agora, decidedByUserId: userId },
    });

    const cobertas = await tx.demandUpdate.updateMany({
      where: {
        demandId: demanda.id,
        status: "pending",
        changedAt: { lt: atualizacao.changedAt },
      },
      data: {
        status: "incorporated",
        decidedAt: agora,
        decidedByUserId: userId,
        decisionNote: `Coberta pela atualização de ${atualizacao.changedAt.toISOString()}, que traz o retrato completo.`,
      },
    });

    return {
      ok: true,
      aplicadasAoProjeto: Object.keys(colunas).length,
      documentosMaterializados: materializacao.materializados,
      cobertas: cobertas.count,
    } as ResultadoDecisao;
  });
}

export async function descartarAtualizacao(
  updateId: string,
  userId: string,
  nota: string
): Promise<ResultadoDecisao> {
  const atualizacao = await prisma.demandUpdate.findUnique({ where: { id: updateId } });
  if (!atualizacao) return { ok: false, motivo: "not_found" };
  if (atualizacao.status !== "pending") return { ok: false, motivo: "ja_decidida", status: atualizacao.status };
  await prisma.demandUpdate.update({
    where: { id: updateId },
    data: { status: "dismissed", decidedAt: new Date(), decidedByUserId: userId, decisionNote: nota },
  });
  return { ok: true, aplicadasAoProjeto: 0, documentosMaterializados: 0, cobertas: 0 };
}

// ─── O cancelamento (D18) ───────────────────────────────────────────────────

export interface PedidoDeCancelamento {
  justificativa: string;
  aprovadorCrmUserId: string;
  aprovadorNome: string;
}

export type ResultadoCancelamento =
  | { ok: true; desfecho: "cancelled"; demanda: any; jaEstava: boolean }
  | { ok: true; desfecho: "cancellation_requested"; demanda: any }
  | { ok: false; motivo: "not_found" }
  | { ok: false; motivo: "encerrada"; status: string; mensagem: string };

/**
 * O cancelamento que chega do CRM, já aprovado pelo líder direto (D18).
 *
 * Este lado NÃO confere a aprovação, e é decisão: quem sabe quem é o líder de
 * quem é o CRM — as equipes, a hierarquia e o papel de administrador vivem lá.
 * O que chega aqui é `approved_by`, e guardá-lo é o que torna a decisão
 * auditável dos dois lados. Exigir daqui uma prova de alçada de uma organização
 * cujo organograma este produto não conhece seria teatro de controle.
 */
export async function aplicarCancelamento(
  demandaId: string,
  pedido: PedidoDeCancelamento
): Promise<ResultadoCancelamento> {
  return prisma.$transaction(async (tx) => {
    const demanda = await tx.demand.findUnique({ where: { id: demandaId } });
    if (!demanda) return { ok: false, motivo: "not_found" } as ResultadoCancelamento;

    const veredito = avaliarCancelamento(demanda.status as EstadoDaDemanda);
    if (veredito.desfecho === "recusado") {
      return {
        ok: false,
        motivo: "encerrada",
        status: demanda.status,
        mensagem: veredito.motivo,
      } as ResultadoCancelamento;
    }

    const agora = new Date();
    const carimbos = {
      cancellationRequestedAt: demanda.cancellationRequestedAt ?? agora,
      cancellationJustification: pedido.justificativa,
      cancellationApprovedByCrmUserId: pedido.aprovadorCrmUserId,
      cancellationApprovedByName: pedido.aprovadorNome,
    };

    if (veredito.desfecho === "cancelled" && "jaEstava" in veredito) {
      // Repetir não é erro (a regra que a F3 escreveu para os eventos, aplicada
      // aqui): a demanda já está no estado que o CRM quer, e reescrever o
      // carimbo faria a hora do cancelamento andar a cada retentativa.
      return { ok: true, desfecho: "cancelled", demanda, jaEstava: true } as ResultadoCancelamento;
    }

    if (veredito.desfecho === "cancelled") {
      // Reivindicação condicional: entre a leitura e a escrita alguém pode ter
      // assumido a demanda pela tela. Quem chega depois não cancela o trabalho
      // de quem já começou — vira pedido, que é o que teria acontecido se a
      // chamada tivesse chegado um segundo mais tarde.
      const efetivado = await tx.demand.updateMany({
        where: { id: demandaId, status: "queued" },
        data: {
          ...carimbos,
          status: "cancelled",
          cancelledAt: agora,
          cancellationClosedAt: agora,
          cancellationOutcome: "cancelled",
        },
      });
      if (efetivado.count === 1) {
        const atual = await tx.demand.findUnique({ where: { id: demandaId } });
        return { ok: true, desfecho: "cancelled", demanda: atual, jaEstava: false } as ResultadoCancelamento;
      }
    }

    // Já assumida: pedido de encerramento. Uma segunda chamada com outra
    // justificativa REESCREVE a justificativa e o aprovador, de propósito — é a
    // palavra mais recente do CRM sobre o mesmo pedido, e é ela que quem assumiu
    // vai ler antes de decidir.
    await tx.demand.updateMany({
      where: { id: demandaId, status: { in: ["assigned", "in_analysis"] } },
      data: carimbos,
    });
    const atual = await tx.demand.findUnique({ where: { id: demandaId } });
    if (!atual) return { ok: false, motivo: "not_found" } as ResultadoCancelamento;
    if (atual.status === "cancelled") {
      return { ok: true, desfecho: "cancelled", demanda: atual, jaEstava: true } as ResultadoCancelamento;
    }
    return { ok: true, desfecho: "cancellation_requested", demanda: atual } as ResultadoCancelamento;
  });
}

export type ResultadoEncerramento =
  | { ok: true; demanda: any }
  | { ok: false; motivo: "not_found" }
  | { ok: false; motivo: "sem_pedido" }
  | { ok: false; motivo: "estado_invalido"; status: string };

/**
 * Quem assumiu encerra a demanda depois do pedido de cancelamento.
 *
 * O PROJETO sobrevive, pelo mesmo motivo pelo qual sobrevive à devolução (F1):
 * ele pode já ter análise, precificação e proposta em cima, e apagar trabalho
 * porque o negócio morreu é decisão de gente, não efeito colateral de um
 * cancelamento. A D29 diz isso com todas as letras para o caso vizinho — "às
 * vezes o trabalho serve para outro edital do mesmo cliente".
 */
export async function encerrarCancelamento(
  demandaId: string,
  userId: string
): Promise<ResultadoEncerramento> {
  return prisma.$transaction(async (tx) => {
    const demanda = await tx.demand.findUnique({ where: { id: demandaId } });
    if (!demanda) return { ok: false, motivo: "not_found" } as ResultadoEncerramento;
    if (!demanda.cancellationRequestedAt || demanda.cancellationClosedAt) {
      return { ok: false, motivo: "sem_pedido" } as ResultadoEncerramento;
    }
    const agora = new Date();
    const fechado = await tx.demand.updateMany({
      where: { id: demandaId, status: { in: ["assigned", "in_analysis"] } },
      data: {
        status: "cancelled",
        cancelledAt: agora,
        cancellationClosedAt: agora,
        cancellationClosedByUserId: userId,
        cancellationOutcome: "cancelled",
      },
    });
    if (fechado.count !== 1) {
      return { ok: false, motivo: "estado_invalido", status: demanda.status } as ResultadoEncerramento;
    }
    const atual = await tx.demand.findUnique({
      where: { id: demandaId },
      include: { assignedUser: { select: { name: true } } },
    });
    return { ok: true, demanda: atual } as ResultadoEncerramento;
  });
}
