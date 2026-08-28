import express, { Response, NextFunction } from "express";
import { z } from "zod";
import type { Request } from "../types/express";
import { prisma } from "../../src/prisma";
import { dbStore } from "../../src/dbStore";
import { requirePermission } from "./auth";
import { requireUserId } from "../middleware/security";
import {
  assumirDemanda,
  devolverDemanda,
  pedirDevolucao,
  recusarDevolucao,
  reatribuirDemanda,
} from "../utils/demands";
import { empurrarMarcoDaDemanda } from "../utils/crmOutbox";
import {
  incorporarAtualizacao,
  descartarAtualizacao,
  encerrarCancelamento,
} from "../utils/demandLifecycleService";
import { calcularDueAt, etapaPendente, medir, medirPorPessoa, type ConfiguracaoDeSla } from "../utils/demandSla";
// F9: a leitura da query da fila — ordem, recorte por coluna e paginação. Vive
// fora da rota para poder ser exercitada sem banco; ver o cabeçalho de lá.
import { lerConsultaDaFila, ordenarPorPrazoDoSla, ORDENS, ORDEM_SLA } from "../utils/demandQuery";
import { lerSla, gravarSla } from "../utils/demandSlaConfig";
import {
  PERMISSAO_DE_GERENTE,
  ROTULO_DA_ETAPA,
  eGerente,
  equipeDePreVendas,
  gerentesDePreVendas,
  varrerPrazos,
} from "../utils/demandSlaService";

// CDC 16 — Fase 1. A FILA, do lado de quem trabalha nela.
//
// D15: fila ÚNICA, visível para toda a equipe. Não há recorte por dono aqui, e
// isso é deliberado: a Demanda não passa pela regra de visibilidade por
// dono/gerente/aprovador que src/prisma.ts aplica a Project - quem não enxerga
// o trabalho disponível não pode se oferecer para fazê-lo.
//
// Estas rotas NÃO são gated por requireModule("integracao_crm_presales"), e a
// razão é a D06: desligar a integração CONGELA - "mantém o recebido, para de
// sincronizar", e o que já foi trocado continua visível como histórico. Um gate
// de módulo aqui faria a revogação do par apagar da tela demandas que já tinham
// sido recebidas e assumidas, que é exatamente o contrário do que D06 decide. O
// que o módulo governa é a porta de entrada (o par, no CMSaaS) e a descoberta da
// aba na interface, não o acesso ao que já chegou.
//
// CDC 16 — Fase 5 acrescentou aqui: o prazo de cada demanda (D19), a política de
// atribuição (D16), o papel de gerente de pré-vendas e a aprovação da devolução
// por ele (D17), os alertas de prazo vencido e a medição por pessoa (D20).
//
// F7: o cancelamento que vem do CRM (D18) e a atualização pós-envio (D27)
// entram pela PORTA DE MÁQUINA, não por aqui. O que estas rotas ganharam são as
// DECISÕES que a D27 e a D29 reservam para gente deste lado: incorporar ou
// descartar uma atualização, e encerrar a demanda depois de um pedido de
// cancelamento. Mais a leitura do registro de expurgo (D35), que é prova de
// conformidade e por isso não é apagável por rota nenhuma.
//
// UMA regra atravessa tudo o que a F5 acrescentou: o auto-serviço é o padrão e
// não pode quebrar. Toda instalação que existe hoje está nele e nenhuma
// configurou nada, então a ausência de configuração precisa produzir
// exatamente o comportamento da F1 — sem prazo, sem alerta, sem aprovação de
// devolução, com o botão de assumir para todo mundo.

const router = express.Router();

const ESTADOS_ABERTOS = ["queued", "assigned", "in_analysis"] as const;
const ESTADOS_VALIDOS = new Set(["queued", "assigned", "in_analysis", "returned", "cancelled", "completed"]);

/** As três pessoas que uma demanda pode citar. Um `include` só, usado em todo lugar. */
const RELACOES_DE_PESSOA = {
  assignedUser: { select: { name: true } },
  assignedBy: { select: { name: true } },
  returnRequestedBy: { select: { name: true } },
} as const;

/**
 * F7: as atualizações que AGUARDAM decisão (D27).
 *
 * Só as pendentes entram na listagem. As já decididas são histórico e vivem no
 * detalhe — trazer todas faria a fila carregar, a cada abertura, o diff inteiro
 * de toda atualização que já aconteceu na vida de cada demanda.
 */
const ATUALIZACOES_PENDENTES = {
  updates: { where: { status: "pending" as const }, orderBy: { changedAt: "asc" as const } },
} as const;

function mapDemand(d: any, sla: (ConfiguracaoDeSla & { assignmentPolicy: string }) | null = null) {
  const due = sla ? calcularDueAt(d, sla) : null;
  const etapa = etapaPendente(d);
  return {
    id: d.id,
    demand_ref: d.demandRef,
    sequence: d.sequence,
    status: d.status,
    company: {
      crm_company_id: d.crmCompanyId,
      name: d.companyName,
      legal_name: d.companyLegalName,
      tax_id: d.companyTaxId,
      cnpj_root: d.companyCnpjRoot,
      sector: d.companySector,
      segment: d.companySegment,
      type: d.companyType,
    },
    opportunity: {
      crm_opportunity_id: d.crmOpportunityId,
      name: d.opportunityName,
      deal_type: d.dealType,
      stage: d.stage,
      value: d.value,
      currency: d.currency,
      probability: d.probability,
      margin_percent: d.marginPercent,
      expected_close_date: d.expectedCloseDate,
      risks: d.risks,
      origin: d.origin,
    },
    title: d.title,
    vertical: d.vertical,
    description: d.description,
    objective: d.objective,
    deadline: d.deadline,
    proposal_validity_date: d.proposalValidityDate,
    output_language: d.outputLanguage,
    proposal_language: d.proposalLanguage,
    ai_orientation_mode: d.aiOrientationMode,
    ai_orientation_text: d.aiOrientationText,
    procurement_modality: d.procurementModality,
    procurement_subtype: d.procurementSubtype,
    sent_by: { crm_user_id: d.sentByCrmUserId, name: d.sentByName, email: d.sentByEmail },
    sent_at: d.sentAt,
    cross_environment: d.pairCrossEnvironment,
    crm_installation_id: d.pairCrmInstallationId,
    queued_at: d.queuedAt,
    assigned_at: d.assignedAt,
    analysis_started_at: d.analysisStartedAt,
    returned_at: d.returnedAt,
    completed_at: d.completedAt,
    assigned_user_id: d.assignedUserId,
    assigned_to: d.assignedUser?.name ?? null,
    returned_reason: d.returnedReason,
    // ── F5 ──────────────────────────────────────────────────────────────────
    // `due_at` é nulo em duas situações que a tela precisa distinguir do
    // "vencido": instalação sem SLA, e demanda em estado terminal, que não deve
    // etapa nenhuma. Por isso `sla_stage` vai junto: sem ele, um traço na
    // coluna de prazo seria lido como prazo perdido.
    due_at: due ? due.toISOString() : null,
    sla_stage: due ? etapa : null,
    sla_stage_label: due && etapa ? ROTULO_DA_ETAPA[etapa] : null,
    assignment_source: d.assignmentSource ?? null,
    assigned_by: d.assignedBy?.name ?? null,
    return_requested_at: d.returnRequestedAt ?? null,
    return_requested_by: d.returnRequestedBy?.name ?? null,
    return_request_reason: d.returnRequestReason ?? null,
    return_decided_at: d.returnDecidedAt ?? null,
    return_rejection_reason: d.returnRejectionReason ?? null,
    // ── F7 ──────────────────────────────────────────────────────────────────
    // O pedido de cancelamento que veio do CRM (D18) e ainda não foi encerrado.
    // `cancellation_outcome` preenchido significa que já acabou, e diz COMO:
    // `cancelled` se quem assumiu encerrou, `completed` se preferiu concluir.
    cancellation_requested_at: d.cancellationRequestedAt ?? null,
    cancellation_justification: d.cancellationJustification ?? null,
    cancellation_approved_by: d.cancellationApprovedByName ?? null,
    cancellation_closed_at: d.cancellationClosedAt ?? null,
    cancellation_closed_by: d.cancellationClosedBy?.name ?? null,
    cancellation_outcome: d.cancellationOutcome ?? null,
    pending_updates: (d.updates || []).map((u: any) => ({
      id: u.id,
      kind: u.kind,
      note: u.note,
      changed_at: u.changedAt,
      received_at: u.receivedAt,
      changed_by: u.changedByName,
      changes: u.changes,
    })),
    project_id: d.projectId,
    documents: (d.documents || []).map((doc: any) => ({
      id: doc.id,
      document_ref: doc.documentRef,
      filename: doc.filename,
      mime_type: doc.mimeType,
      size_bytes: doc.sizeBytes,
      sha256: doc.sha256,
      has_content: Boolean(doc.storagePath),
      has_extracted_text: Boolean(doc.extractedText),
      content_received_at: doc.contentReceivedAt,
      document_id: doc.documentId,
    })),
  };
}

// Contadores da fila. Serve ao emblema da aba e, mais importante, a decidir se a
// aba aparece quando o par já foi revogado: sem par não há módulo, mas o
// histórico do que chegou continua tendo de ser alcançável (D06).
router.get("/summary", requirePermission("demand:read"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const porStatus = await prisma.demand.groupBy({ by: ["status"], _count: { _all: true } });
    const contagem: Record<string, number> = {};
    for (const linha of porStatus) contagem[linha.status] = linha._count._all;
    const total = Object.values(contagem).reduce((a, b) => a + b, 0);
    res.json({
      total,
      queued: contagem.queued || 0,
      assigned: contagem.assigned || 0,
      in_analysis: contagem.in_analysis || 0,
      returned: contagem.returned || 0,
      cancelled: contagem.cancelled || 0,
      completed: contagem.completed || 0,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/", requirePermission("demand:read"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const usuarioAtual = requireUserId(req);
    const filtro = typeof req.query.status === "string" ? req.query.status.trim() : "";
    // Peneirado contra a lista real do enum: um valor inventado na query chegaria
    // ao Prisma e sairia como 500, que é erro de servidor para o que é entrada
    // inválida. Filtro que sobra vazio volta ao padrão em vez de devolver nada.
    const pedidos = filtro ? filtro.split(",").map((s) => s.trim()).filter((s) => ESTADOS_VALIDOS.has(s)) : [];
    const status = pedidos.length > 0 ? pedidos : [...ESTADOS_ABERTOS, "returned"];

    // Mesma régua do filtro de estado, e pelo mesmo motivo: ordem inventada não
    // vira 500 nem devolve lista vazia — cai no padrão. Uma tela que peça
    // `sort=preco` deve mostrar a fila, não um erro.
    const { sort: ordem, dir, limit: limite, offset: deslocamento, filtros } = lerConsultaDaFila(req.query, usuarioAtual);

    const where = { status: { in: status as any }, ...filtros };

    const sla = await lerSla();

    // `total` é do recorte inteiro, não da página: sem ele a tela não sabe se há
    // uma próxima, e "5 por vez e pagina as antigas" vira botão que não desliga.
    const total = await prisma.demand.count({ where });

    // F10 — OS CONTADORES DOS AVISOS, do RECORTE e não da página.
    //
    // Até a F9 a tela contava os avisos sobre as linhas que tinha carregado, e
    // por isso pedia a fila inteira (`limit=200`): com uma página de cinco, um
    // aviso que diz "3 demandas suas com atualização" passaria a dizer "1", e
    // aviso que subconta é pior do que aviso nenhum, porque parece resolvido.
    // A F9 registrou isso como dívida desta fase, com o conserto já nomeado:
    // os contadores vêm do total do recorte. São três `count` sobre o MESMO
    // `where` da listagem — mudar o filtro muda o aviso junto, que é o que
    // torna o número dele verdadeiro.
    //
    // Dois são recortados por QUEM PERGUNTA, e não por engano: atualização
    // pendente e cancelamento aberto são trabalho de quem assumiu. Um contador
    // global faria cada pessoa ver a pendência de todo mundo, que é o oposto de
    // um aviso acionável. O terceiro — devolução esperando decisão — é do
    // gerente, e por isso é do recorte inteiro.
    //
    // `AND`, e NÃO espalhar o `where` com a condição por cima. O recorte da
    // listagem pode já fixar `assignedUserId` — o card "Novas demandas" pede
    // `assigned_user_id=none`, que vira `assignedUserId: null` —, e sobrescrever
    // aquela chave por `usuarioAtual` produziria um contador que NÃO pertence ao
    // recorte que a tela está mostrando: um aviso sobre demandas que aquela
    // lista não tem. Com `AND`, "sem dono E minha" é zero, que é a resposta
    // certa e a única coerente com o número ao lado.
    const eDoRecorte = (extra: any) => ({ AND: [where, extra] });
    const [devolucoesPendentes, minhasComAtualizacao, minhasComCancelamento] = await Promise.all([
      prisma.demand.count({ where: eDoRecorte({ returnRequestedAt: { not: null }, returnDecidedAt: null }) }),
      prisma.demand.count({
        where: eDoRecorte({ assignedUserId: usuarioAtual, updates: { some: { status: "pending" } } }),
      }),
      prisma.demand.count({
        where: eDoRecorte({
          assignedUserId: usuarioAtual,
          cancellationRequestedAt: { not: null },
          cancellationClosedAt: null,
        }),
      }),
    ]);

    // As verticais do recorte ATUAL (menos o próprio filtro de vertical, senão
    // o controle de coluna se estreitaria a cada clique e a pessoa não teria
    // como voltar). É o que um filtro por coluna precisa para oferecer opções
    // sem carregar a fila inteira na tela.
    const semVertical = { ...where };
    delete (semVertical as any).vertical;
    const verticaisDoRecorte = (
      await prisma.demand.groupBy({ by: ["vertical"], where: semVertical, _count: { _all: true } })
    )
      .map((linha) => ({ vertical: linha.vertical, count: linha._count._all }))
      .sort((a, b) => a.vertical.localeCompare(b.vertical, "pt-BR"));

    let pagina: any[];
    if (ordem === ORDEM_SLA) {
      // Duas passadas, pelo motivo comentado em `ORDEM_SLA`. A primeira é magra
      // de propósito: só o que `calcularDueAt` lê.
      const leves = await prisma.demand.findMany({
        where,
        select: {
          id: true,
          status: true,
          queuedAt: true,
          assignedAt: true,
          analysisStartedAt: true,
          deadline: true,
        },
      });
      const idsDaPagina = ordenarPorPrazoDoSla(leves as any, sla, dir).slice(deslocamento, deslocamento + limite);
      const linhas = await prisma.demand.findMany({
        where: { id: { in: idsDaPagina } },
        include: { documents: true, ...RELACOES_DE_PESSOA, ...ATUALIZACOES_PENDENTES },
      });
      // O `in` do Prisma não preserva a ordem pedida; reordenar aqui é o que
      // impede a página de sair embaralhada dentro de si mesma.
      const porId = new Map(linhas.map((l) => [l.id, l]));
      pagina = idsDaPagina.map((id) => porId.get(id)).filter(Boolean) as any[];
    } else {
      pagina = await prisma.demand.findMany({
        where,
        include: { documents: true, ...RELACOES_DE_PESSOA, ...ATUALIZACOES_PENDENTES },
        orderBy: ORDENS[ordem](dir),
        take: limite,
        skip: deslocamento,
      });
    }

    res.json({
      items: pagina.map((d) => mapDemand(d, sla)),
      total,
      limit: limite,
      offset: deslocamento,
      sort: ordem,
      dir,
      verticals: verticaisDoRecorte,
      counts: {
        return_pending: devolucoesPendentes,
        my_pending_updates: minhasComAtualizacao,
        my_cancellations: minhasComCancelamento,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── F5: a configuração de prazo da instalação (D19) ────────────────────────

const SlaSchema = z.object({
  enabled: z.boolean(),
  // Um teto existe, e não é decoração: `assume_hours` de 100000 produziria um
  // prazo no ano 2037 e um SLA que nunca vence — configuração que parece ligada
  // e não cobra nada é pior do que SLA desligado, porque ninguém desconfia dela.
  assume_hours: z.number().int().min(1).max(8760),
  analysis_hours: z.number().int().min(1).max(8760),
  proposal_hours: z.number().int().min(1).max(8760),
  assignment_policy: z.enum(["auto_servico", "direcionamento", "automatico"]),
});

function mapSla(linha: Awaited<ReturnType<typeof lerSla>>) {
  return {
    // `configured: false` é o estado de toda instalação que existe hoje, e a
    // tela precisa dele para dizer "ninguém configurou" em vez de mostrar os
    // padrões como se fossem escolha de alguém.
    configured: linha !== null,
    enabled: linha?.enabled ?? false,
    assume_hours: linha?.assumeHours ?? 8,
    analysis_hours: linha?.analysisHours ?? 24,
    proposal_hours: linha?.proposalHours ?? 120,
    assignment_policy: linha?.assignmentPolicy ?? "auto_servico",
  };
}

// Leitura com `demand:read`, e não com `admin:settings`: quem trabalha na fila
// precisa saber qual é o prazo dela. Quem MUDA é o administrador (D19).
router.get("/sla-settings", requirePermission("demand:read"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const [linha, gerentes] = await Promise.all([lerSla(), gerentesDePreVendas()]);
    res.json({
      ...mapSla(linha),
      // A tela precisa dizer em voz alta se existe gerente: é isso que decide
      // se a devolução passa por aprovação (D17) e para quem vai o alerta (D19).
      managers: gerentes.map((g) => ({ id: g.id, name: g.name })),
      manager_permission: PERMISSAO_DE_GERENTE,
    });
  } catch (err) {
    next(err);
  }
});

router.put("/sla-settings", requirePermission("admin:settings"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const corpo = SlaSchema.parse(req.body);
    const tenantId = req.headers["x-tenant-id"] as string;
    await gravarSla(tenantId, {
      enabled: corpo.enabled,
      assumeHours: corpo.assume_hours,
      analysisHours: corpo.analysis_hours,
      proposalHours: corpo.proposal_hours,
      assignmentPolicy: corpo.assignment_policy,
    });
    await dbStore.addAuditLog({
      user_id: requireUserId(req),
      action: "Update Demand SLA Settings",
      entity_type: "DemandSlaSettings",
      entity_id: tenantId,
      ip_address: req.ip || "127.0.0.1",
      user_agent: req.headers["user-agent"] || "unknown",
      metadata: JSON.stringify(corpo),
    });
    const [linha, gerentes] = await Promise.all([lerSla(), gerentesDePreVendas()]);
    res.json({ success: true, ...mapSla(linha), managers: gerentes.map((g) => ({ id: g.id, name: g.name })), manager_permission: PERMISSAO_DE_GERENTE });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.issues[0].message });
    }
    next(err);
  }
});

/** Quem pode receber uma demanda: a lista que alimenta o direcionamento (D16). */
router.get("/team", requirePermission("demand:read"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await equipeDePreVendas());
  } catch (err) {
    next(err);
  }
});

// ─── F5: os alertas de prazo vencido (D19) ──────────────────────────────────

router.get("/alerts", requirePermission("demand:read"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const abertos = req.query.all === "1" ? {} : { acknowledgedAt: null };
    const alertas = await prisma.demandSlaBreach.findMany({
      where: abertos,
      orderBy: [{ dueAt: "asc" }],
      take: 200,
      include: {
        demand: {
          select: { id: true, demandRef: true, title: true, companyName: true, status: true, deadline: true, assignedUser: { select: { name: true } } },
        },
      },
    });
    res.json(
      alertas.map((a) => ({
        id: a.id,
        demand_id: a.demandId,
        demand_ref: a.demand.demandRef,
        title: a.demand.title,
        company_name: a.demand.companyName,
        demand_status: a.demand.status,
        assigned_to: a.demand.assignedUser?.name ?? null,
        stage: a.stage,
        stage_label: ROTULO_DA_ETAPA[a.stage],
        due_at: a.dueAt,
        detected_at: a.detectedAt,
        recipient_kind: a.recipientKind,
        recipient_user_ids: a.recipientUserIds,
        acknowledged_at: a.acknowledgedAt,
      }))
    );
  } catch (err) {
    next(err);
  }
});

/**
 * Dar o alerta por visto.
 *
 * Quem pode: o gerente, ou — quando não há gerente e o alerta foi para a equipe
 * — qualquer destinatário dele. É a mesma regra da D19 lida do outro lado: quem
 * é avisado é quem responde.
 */
router.post("/alerts/:id/ack", requirePermission("demand:read"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = requireUserId(req);
    const alerta = await prisma.demandSlaBreach.findUnique({ where: { id: req.params.id } });
    if (!alerta) return res.status(404).json({ success: false, message: "Alerta não encontrado." });
    const gerente = await eGerente(req.headers["x-role-id"] as string);
    if (!gerente && !alerta.recipientUserIds.includes(userId)) {
      return res.status(403).json({ success: false, message: "Este alerta não foi endereçado a você." });
    }
    if (alerta.acknowledgedAt) return res.json({ success: true, already: true });
    await prisma.demandSlaBreach.update({
      where: { id: alerta.id },
      data: { acknowledgedAt: new Date(), acknowledgedByUserId: userId },
    });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

/**
 * Varrer os prazos AGORA.
 *
 * O verificador roda sozinho a cada minuto; esta rota existe para o
 * administrador que acabou de configurar o SLA não precisar esperar para ver o
 * efeito — e para a prova poder exercitar o alerta sem depender de relógio.
 */
router.post("/sla/scan", requirePermission("admin:settings"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.headers["x-tenant-id"] as string;
    res.json({ success: true, ...(await varrerPrazos(tenantId)) });
  } catch (err) {
    next(err);
  }
});

// ─── F5: a medição de tempo de resposta (D20) ───────────────────────────────

/**
 * O desempenho, agregado e POR PESSOA.
 *
 * O recorte por pessoa existe SÓ deste lado, e essa fronteira é decisão do dono
 * (D20): o CRM vê o tempo da demanda dele e a média da equipe, e nunca o
 * recorte por gente — ele não vira ranking de gente de outro time. Se algum dia
 * alguém precisar do número por pessoa no CRM, a conversa é sobre mudar a D20,
 * não sobre acrescentar um campo no envelope.
 */
router.get("/performance", requirePermission("demand:read"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dias = Number.parseInt(String(req.query.days ?? ""), 10);
    // 180 dias por padrão, pelo mesmo motivo do KPI da F4 no CRM: o ciclo deste
    // negócio é medido em meses, e uma janela de 30 dias devolveria "nenhuma
    // demanda" na maioria das instalações — o que pareceria defeito.
    const janela = Number.isFinite(dias) && dias > 0 && dias <= 1095 ? dias : 180;
    const desde = new Date(Date.now() - janela * 24 * 60 * 60 * 1000);

    const demandas = await prisma.demand.findMany({
      where: { sentAt: { gte: desde } },
      select: {
        assignedUserId: true,
        sentAt: true,
        queuedAt: true,
        assignedAt: true,
        analysisStartedAt: true,
        completedAt: true,
        returnedAt: true,
      },
    });

    // F9 — a RÉGUA DE QUEM LÊ, decidida pelo dono na F8 (resposta F): "o
    // prevendas ve o desempenho dele, das demanda que ele esta trabalhando. o
    // gerente ve o do time."
    //
    // Até aqui a rota devolvia a lista de TODAS as pessoas para qualquer um com
    // `demand:read` — ou seja, quem trabalha na fila via o número individual de
    // todo mundo. Passa a valer:
    //
    //  - GERENTE (`demand:manage`, a mesma permissão que aprova devolução e
    //    direciona a fila desde a F5): vê o time, pessoa por pessoa;
    //  - QUALQUER OUTRA PESSOA com `demand:read`: vê só a linha dela.
    //
    // A média da EQUIPE (`team`) continua indo para os dois, e isso é
    // deliberado: é agregado, não é recorte por gente, e a própria D20 já
    // manda essa média até para o CRM. O que a D20 proíbe — o desempenho por
    // PESSOA sair deste produto — segue proibido, palavra por palavra.
    //
    // `scope` viaja no corpo porque a tela precisa saber qual das duas coisas
    // está desenhando: sem ele, "uma linha só" seria indistinguível de "o time
    // tem uma pessoa só", e o rótulo mentiria.
    const souGerente = await eGerente(req.headers["x-role-id"] as string);
    const usuarioAtual = requireUserId(req);
    const todas = medirPorPessoa(demandas);
    const pessoas = souGerente ? todas : todas.filter((p) => p.userId === usuarioAtual);
    const nomes = new Map(
      (await prisma.user.findMany({ where: { id: { in: pessoas.map((p) => p.userId) } }, select: { id: true, name: true } })).map(
        (u) => [u.id, u.name]
      )
    );

    res.json({
      days: janela,
      since: desde.toISOString(),
      scope: souGerente ? "team" : "self",
      team: medir(demandas),
      people: pessoas.map((p) => ({ user_id: p.userId, name: nomes.get(p.userId) ?? p.userId, ...p.medicao })),
    });
  } catch (err) {
    next(err);
  }
});

// ─── F7: o registro do expurgo em cascata (D35) ─────────────────────────────
//
// Leitura, e só leitura. Não há rota que apague uma linha desta tabela, e a
// ausência é a decisão: "sem o registro, apagar de um lado só é conformidade de
// mentira" — e um registro que o próprio produto sabe apagar é a mesma mentira
// com mais passos. `demand:read` porque quem trabalha na fila é quem vai
// procurar o documento que sumiu.
//
// Declarada ANTES de `GET /:id`: o Express casa por ordem, e `/purges` cairia
// no parâmetro `:id` se viesse depois — devolvendo "demanda não encontrada"
// sobre uma rota que existe.
router.get("/purges", requirePermission("demand:read"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const execucoes = await prisma.crmPurgeExecution.findMany({
      orderBy: { executedAt: "desc" },
      take: 100,
    });
    res.json(
      execucoes.map((e) => ({
        id: e.id,
        reason: e.reason,
        crm_installation_id: e.crmInstallationId,
        targets: e.targets,
        results: e.results,
        documents_deleted: e.documentsDeleted,
        demands_deleted: e.demandsDeleted,
        files_deleted: e.filesDeleted,
        projects_unlinked: e.projectsUnlinked,
        executed_at: e.executedAt,
      }))
    );
  } catch (err) {
    next(err);
  }
});

router.get("/:id", requirePermission("demand:read"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const demanda = await prisma.demand.findUnique({
      where: { id: req.params.id },
      include: {
        documents: true,
        ...RELACOES_DE_PESSOA,
        cancellationClosedBy: { select: { name: true } },
        // No detalhe vêm TODAS, e não só as pendentes: a decisão já tomada é
        // parte do histórico da demanda, e é ela que responde "por que o prazo
        // do projeto é outro" meses depois.
        updates: { orderBy: { changedAt: "desc" } },
      },
    });
    if (!demanda) return res.status(404).json({ success: false, message: "Demanda não encontrada." });
    res.json(mapDemand(demanda, await lerSla()));
  } catch (err) {
    next(err);
  }
});

// O ato de assumir: a Demanda vira Projeto com dono e a análise segue como já
// funciona hoje (§2.2, passo 7 do plano).
router.post("/:id/assume", requirePermission("demand:assume"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = requireUserId(req);

    // D16, política `direcionamento`: numa fila direcionada, assumir é
    // justamente o ato que a política existe para tirar. O gerente continua
    // podendo — ele direciona por esta mesma rota quando quer ficar com a
    // demanda —, e a mensagem diz o motivo em vez de sumir com o botão sem
    // explicação, porque um 403 mudo aqui parece defeito.
    const sla = await lerSla();
    if (sla?.assignmentPolicy === "direcionamento" && !(await eGerente(req.headers["x-role-id"] as string))) {
      return res.status(403).json({
        success: false,
        message: "Nesta instalação as demandas são direcionadas pelo gerente de pré-vendas; não é possível assumir da fila.",
      });
    }

    const resultado = await assumirDemanda(req.params.id, userId);

    if (!resultado.ok) {
      if (resultado.motivo === "not_found") {
        return res.status(404).json({ success: false, message: "Demanda não encontrada." });
      }
      if (resultado.motivo === "ja_assumida") {
        return res.status(409).json({ success: false, message: "Esta demanda já foi assumida por outra pessoa." });
      }
      return res.status(409).json({ success: false, message: `Uma demanda com status "${resultado.status}" não pode ser assumida.` });
    }

    await dbStore.addAuditLog({
      user_id: userId,
      action: "Assume Demand",
      entity_type: "Demand",
      entity_id: req.params.id,
      project_id: resultado.projectId,
      ip_address: req.ip || "127.0.0.1",
      user_agent: req.headers["user-agent"] || "unknown",
      metadata: JSON.stringify({
        demand_ref: resultado.demand.demandRef,
        project_id: resultado.projectId,
        documentos_materializados: resultado.documentosMaterializados,
        documentos_sem_conteudo: resultado.documentosSemConteudo,
      }),
    });

    // F3: o CRM fica sabendo que alguém assumiu. DEPOIS da transação e depois
    // da auditoria, nunca dentro: um evento enfileirado numa transação que
    // depois desfaz contaria ao vendedor um fato que não aconteceu.
    const quemAssumiu = await dbStore.getUserById(userId);
    await empurrarMarcoDaDemanda({
      tenantId: resultado.demand.tenantId,
      demanda: resultado.demand,
      event: "assigned",
      // O instante do FATO: o carimbo que a própria transação gravou, e não o
      // `new Date()` de agora — entre um e outro cabe a latência desta rota.
      occurredAt: resultado.demand.assignedAt ?? new Date(),
      actor: { name: quemAssumiu?.name ?? "Pré-vendas", presales_user_id: userId },
      projectId: resultado.projectId,
    });

    res.json({
      success: true,
      demand: mapDemand(resultado.demand, await lerSla()),
      project_id: resultado.projectId,
      documents_materialized: resultado.documentosMaterializados,
      documents_without_content: resultado.documentosSemConteudo,
    });
  } catch (err) {
    next(err);
  }
});

const DevolucaoSchema = z.object({
  // Mesma régua da justificativa de cancelamento na spec: motivo curto demais
  // não é motivo, e o vendedor do outro lado precisa saber o que corrigir.
  reason: z.string().trim().min(10, "O motivo da devolução precisa ter ao menos 10 caracteres."),
});

router.post("/:id/return", requirePermission("demand:assume"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = requireUserId(req);
    const { reason } = DevolucaoSchema.parse(req.body);

    const atual = await prisma.demand.findUnique({ where: { id: req.params.id } });
    if (!atual) return res.status(404).json({ success: false, message: "Demanda não encontrada." });

    // Devolve quem assumiu. Quem enxerga todos os projetos (o administrador,
    // por project:read_all) também pode, que é o caminho para destravar uma
    // demanda de alguém que saiu da equipe.
    const role = await dbStore.getRoleById(req.headers["x-role-id"] as string);
    const podeQualquer = role?.permissions.includes("project:read_all") ?? false;
    if (atual.assignedUserId !== userId && !podeQualquer) {
      return res.status(403).json({ success: false, message: "Só quem assumiu a demanda pode devolvê-la." });
    }

    // D17, e a metade que a F1 deixou escrita para cá: "o gerente aprova a
    // devolução QUANDO HOUVER gerente". Havendo, o que este clique produz é um
    // PEDIDO; não havendo — o estado de toda instalação no ar —, a devolução
    // continua direta, exatamente como a F1 a entregou. O gerente que devolve
    // uma demanda não pede aprovação a si mesmo.
    const gerentes = await gerentesDePreVendas();
    const souGerente = role?.permissions.includes(PERMISSAO_DE_GERENTE) ?? false;
    if (gerentes.length > 0 && !souGerente) {
      const pedido = await pedirDevolucao(req.params.id, userId, reason.trim());
      if (!pedido.ok) {
        if (pedido.motivo === "not_found") return res.status(404).json({ success: false, message: "Demanda não encontrada." });
        if (pedido.motivo === "ja_pedida") {
          return res.status(409).json({ success: false, message: "Já existe um pedido de devolução aguardando o gerente." });
        }
        return res.status(409).json({ success: false, message: `Uma demanda com status "${pedido.status}" não pode ser devolvida.` });
      }

      await dbStore.addAuditLog({
        user_id: userId,
        action: "Request Demand Return",
        entity_type: "Demand",
        entity_id: req.params.id,
        ip_address: req.ip || "127.0.0.1",
        user_agent: req.headers["user-agent"] || "unknown",
        metadata: JSON.stringify({ demand_ref: pedido.demand.demandRef, reason: reason.trim(), managers: gerentes.length }),
      });

      // NADA é empurrado ao CRM aqui, e é de propósito: `returned` é marco forte
      // e manda e-mail ao vendedor (D30). Contar uma devolução que o gerente
      // ainda pode recusar faria o vendedor receber a má notícia de um fato que
      // talvez nunca aconteça — e não existe evento de "desdevolvida".
      return res.json({
        success: true,
        pending_approval: true,
        demand: mapDemand(pedido.demand, await lerSla()),
      });
    }

    const resultado = await devolverDemanda(req.params.id, reason.trim());
    if (!resultado.ok) {
      if (resultado.motivo === "not_found") {
        return res.status(404).json({ success: false, message: "Demanda não encontrada." });
      }
      return res.status(409).json({ success: false, message: `Uma demanda com status "${resultado.status}" não pode ser devolvida.` });
    }

    await dbStore.addAuditLog({
      user_id: userId,
      action: "Return Demand",
      entity_type: "Demand",
      entity_id: req.params.id,
      ip_address: req.ip || "127.0.0.1",
      user_agent: req.headers["user-agent"] || "unknown",
      metadata: JSON.stringify({ demand_ref: resultado.demand.demandRef, reason: reason.trim() }),
    });

    // F3: devolvida é um dos três MARCOS FORTES (D30) — o CRM manda e-mail ao
    // vendedor, além do aviso no sino. O motivo viaja junto: sem ele, o vendedor
    // descobre que voltou e não por quê.
    const quemDevolveu = await dbStore.getUserById(userId);
    await empurrarMarcoDaDemanda({
      tenantId: resultado.demand.tenantId,
      demanda: resultado.demand,
      event: "returned",
      occurredAt: resultado.demand.returnedAt ?? new Date(),
      actor: { name: quemDevolveu?.name ?? "Pré-vendas", presales_user_id: userId },
      reason: reason.trim(),
      // Sem `projectId`: o projeto continua existindo (ele pode já ter trabalho
      // em cima), mas a demanda desencostou dele. Mandar o retrato de um projeto
      // que já não representa esta demanda seria pior que não mandar.
    });

    res.json({ success: true, pending_approval: false, demand: mapDemand(resultado.demand, await lerSla()) });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.issues[0].message });
    }
    next(err);
  }
});

// ─── F5: o que só o gerente de pré-vendas faz (D16, D17) ────────────────────

const DirecionamentoSchema = z.object({ user_id: z.string().min(1, "Escolha para quem direcionar.") });

/**
 * Direcionar a demanda para alguém (D16).
 *
 * Um caminho só para os dois casos, porque para quem usa é o mesmo ato: uma
 * demanda na fila é ASSUMIDA em nome da pessoa escolhida, e uma demanda que já
 * está com alguém é REATRIBUÍDA. Os dois produzem eventos diferentes no CRM
 * (`assigned` e `reassigned`), que é como o vendedor lê a diferença.
 */
router.post("/:id/direct", requirePermission(PERMISSAO_DE_GERENTE), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const gerenteId = requireUserId(req);
    const { user_id: destinoId } = DirecionamentoSchema.parse(req.body);

    const elegiveis = await equipeDePreVendas();
    const destino = elegiveis.find((u) => u.id === destinoId);
    if (!destino) {
      // Recusado com nome: direcionar para quem não pode trabalhar na fila
      // produziria uma demanda parada com dono que não a enxerga.
      return res.status(422).json({ success: false, message: "Esta pessoa não pode receber demandas: falta a permissão demand:assume, ou o usuário não está ativo." });
    }

    const atual = await prisma.demand.findUnique({ where: { id: req.params.id } });
    if (!atual) return res.status(404).json({ success: false, message: "Demanda não encontrada." });

    const gerente = await dbStore.getUserById(gerenteId);
    const sla = await lerSla();

    if (atual.status === "queued") {
      const resultado = await assumirDemanda(req.params.id, destinoId, { byUserId: gerenteId, source: "manager" });
      if (!resultado.ok) {
        if (resultado.motivo === "not_found") return res.status(404).json({ success: false, message: "Demanda não encontrada." });
        if (resultado.motivo === "ja_assumida") return res.status(409).json({ success: false, message: "Esta demanda já foi assumida por outra pessoa." });
        return res.status(409).json({ success: false, message: `Uma demanda com status "${resultado.status}" não pode ser direcionada.` });
      }

      await dbStore.addAuditLog({
        user_id: gerenteId,
        action: "Direct Demand",
        entity_type: "Demand",
        entity_id: req.params.id,
        project_id: resultado.projectId,
        ip_address: req.ip || "127.0.0.1",
        user_agent: req.headers["user-agent"] || "unknown",
        metadata: JSON.stringify({ demand_ref: resultado.demand.demandRef, to_user_id: destinoId, to_name: destino.name }),
      });

      await empurrarMarcoDaDemanda({
        tenantId: resultado.demand.tenantId,
        demanda: resultado.demand,
        event: "assigned",
        occurredAt: resultado.demand.assignedAt ?? new Date(),
        // O ATOR é quem assumiu, e a nota diz quem decidiu. Pôr o gerente como
        // ator faria a timeline do vendedor dizer que o gerente está fazendo o
        // trabalho — e quem responde pela demanda é quem a recebeu.
        actor: { name: destino.name, presales_user_id: destinoId },
        note: `Direcionada por ${gerente?.name ?? "gerente de pré-vendas"}.`,
        projectId: resultado.projectId,
      });

      return res.json({ success: true, action: "assigned", demand: mapDemand(resultado.demand, sla), project_id: resultado.projectId });
    }

    const resultado = await reatribuirDemanda(req.params.id, destinoId, gerenteId);
    if (!resultado.ok) {
      if (resultado.motivo === "not_found") return res.status(404).json({ success: false, message: "Demanda não encontrada." });
      if (resultado.motivo === "mesma_pessoa") return res.status(409).json({ success: false, message: "Esta demanda já está com essa pessoa." });
      return res.status(409).json({ success: false, message: `Uma demanda com status "${resultado.status}" não pode ser direcionada.` });
    }

    await dbStore.addAuditLog({
      user_id: gerenteId,
      action: "Reassign Demand",
      entity_type: "Demand",
      entity_id: req.params.id,
      project_id: resultado.demand.projectId,
      ip_address: req.ip || "127.0.0.1",
      user_agent: req.headers["user-agent"] || "unknown",
      metadata: JSON.stringify({ demand_ref: resultado.demand.demandRef, from_user_id: resultado.anteriorUserId, to_user_id: destinoId }),
    });

    await empurrarMarcoDaDemanda({
      tenantId: resultado.demand.tenantId,
      demanda: resultado.demand,
      event: "reassigned",
      occurredAt: new Date(),
      actor: { name: destino.name, presales_user_id: destinoId },
      note: `Reatribuída por ${gerente?.name ?? "gerente de pré-vendas"}.`,
      projectId: resultado.demand.projectId,
    });

    res.json({ success: true, action: "reassigned", demand: mapDemand(resultado.demand, sla) });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.issues[0].message });
    }
    next(err);
  }
});

/** O gerente APROVA a devolução pedida (D17): a demanda volta ao vendedor. */
router.post("/:id/return/approve", requirePermission(PERMISSAO_DE_GERENTE), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const gerenteId = requireUserId(req);
    const atual = await prisma.demand.findUnique({ where: { id: req.params.id }, include: { returnRequestedBy: { select: { name: true } } } });
    if (!atual) return res.status(404).json({ success: false, message: "Demanda não encontrada." });
    if (!atual.returnRequestedAt || atual.returnDecidedAt) {
      return res.status(409).json({ success: false, message: "Não há pedido de devolução aguardando decisão nesta demanda." });
    }

    // O motivo que vai ao CRM é o de QUEM PEDIU, e não um texto do gerente: é o
    // que o vendedor precisa para corrigir a ficha. A aprovação é a decisão, e
    // ela fica no registro de auditoria e nas colunas da demanda.
    const motivo = atual.returnRequestReason ?? "Devolvida.";
    const resultado = await devolverDemanda(req.params.id, motivo);
    if (!resultado.ok) {
      if (resultado.motivo === "not_found") return res.status(404).json({ success: false, message: "Demanda não encontrada." });
      return res.status(409).json({ success: false, message: `Uma demanda com status "${resultado.status}" não pode ser devolvida.` });
    }
    await prisma.demand.update({
      where: { id: req.params.id },
      data: { returnDecidedAt: new Date(), returnDecidedByUserId: gerenteId, returnRejectionReason: null },
    });

    await dbStore.addAuditLog({
      user_id: gerenteId,
      action: "Approve Demand Return",
      entity_type: "Demand",
      entity_id: req.params.id,
      ip_address: req.ip || "127.0.0.1",
      user_agent: req.headers["user-agent"] || "unknown",
      metadata: JSON.stringify({ demand_ref: resultado.demand.demandRef, requested_by: atual.returnRequestedByUserId, reason: motivo }),
    });

    const gerente = await dbStore.getUserById(gerenteId);
    await empurrarMarcoDaDemanda({
      tenantId: resultado.demand.tenantId,
      demanda: resultado.demand,
      event: "returned",
      occurredAt: resultado.demand.returnedAt ?? new Date(),
      actor: { name: gerente?.name ?? "Pré-vendas", presales_user_id: gerenteId },
      reason: motivo,
      note: atual.returnRequestedBy?.name ? `Devolução pedida por ${atual.returnRequestedBy.name} e aprovada pelo gerente.` : "Devolução aprovada pelo gerente.",
    });

    res.json({ success: true, demand: mapDemand(resultado.demand, await lerSla()) });
  } catch (err) {
    next(err);
  }
});

const RecusaSchema = z.object({
  reason: z.string().trim().min(10, "O motivo da recusa precisa ter ao menos 10 caracteres."),
});

/** O gerente RECUSA a devolução (D17): a demanda continua com quem a assumiu. */
router.post("/:id/return/reject", requirePermission(PERMISSAO_DE_GERENTE), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const gerenteId = requireUserId(req);
    const { reason } = RecusaSchema.parse(req.body);
    const resultado = await recusarDevolucao(req.params.id, gerenteId, reason.trim());
    if (!resultado.ok) {
      if (resultado.motivo === "not_found") return res.status(404).json({ success: false, message: "Demanda não encontrada." });
      return res.status(409).json({ success: false, message: "Não há pedido de devolução aguardando decisão nesta demanda." });
    }

    await dbStore.addAuditLog({
      user_id: gerenteId,
      action: "Reject Demand Return",
      entity_type: "Demand",
      entity_id: req.params.id,
      ip_address: req.ip || "127.0.0.1",
      user_agent: req.headers["user-agent"] || "unknown",
      metadata: JSON.stringify({ demand_ref: resultado.demand.demandRef, reason: reason.trim() }),
    });

    // Nada viaja ao CRM: a devolução NÃO aconteceu, e o vendedor não precisa
    // saber que alguém aqui dentro pensou em devolver e foi impedido.
    res.json({ success: true, demand: mapDemand(resultado.demand, await lerSla()) });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.issues[0].message });
    }
    next(err);
  }
});

// ─── F7: as decisões que a D27 e a D29 reservam para gente daqui ────────────

/**
 * Quem pode decidir sobre uma demanda que tem dono.
 *
 * Mesma régua da devolução, e pela mesma razão: quem assumiu decide sobre o
 * próprio trabalho, e quem enxerga todos os projetos (o administrador, por
 * `project:read_all`) ou é gerente de pré-vendas (`demand:manage`, F5) pode
 * destravar o de alguém que saiu da equipe.
 */
async function podeDecidirSobre(req: Request, demanda: { assignedUserId: string | null }, userId: string) {
  if (demanda.assignedUserId === userId) return true;
  const role = await dbStore.getRoleById(req.headers["x-role-id"] as string);
  return Boolean(
    role?.permissions.includes("project:read_all") || role?.permissions.includes(PERMISSAO_DE_GERENTE)
  );
}

// Incorporar: levar a atualização para o PROJETO (D27). Até aqui ela só existia
// na demanda, que é o que o CRM diz; o projeto é o que o pré-vendas faz, e a
// travessia entre os dois é uma decisão, não um efeito.
router.post("/:id/updates/:updateId/incorporate", requirePermission("demand:assume"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = requireUserId(req);
    const demanda = await prisma.demand.findUnique({ where: { id: req.params.id } });
    if (!demanda) return res.status(404).json({ success: false, message: "Demanda não encontrada." });
    if (!(await podeDecidirSobre(req, demanda, userId))) {
      return res.status(403).json({ success: false, message: "Só quem assumiu a demanda pode decidir sobre as atualizações dela." });
    }

    const resultado = await incorporarAtualizacao(req.params.updateId, userId);
    if (!resultado.ok) {
      if (resultado.motivo === "not_found") return res.status(404).json({ success: false, message: "Atualização não encontrada." });
      if (resultado.motivo === "sem_projeto") {
        return res.status(409).json({ success: false, message: "Esta demanda ainda não tem projeto; a atualização já está na demanda e o projeto nascerá dela." });
      }
      return res.status(409).json({ success: false, message: `Esta atualização já foi ${resultado.status === "incorporated" ? "incorporada" : "descartada"}.` });
    }

    await dbStore.addAuditLog({
      user_id: userId,
      action: "Incorporate Demand Update",
      entity_type: "Demand",
      entity_id: req.params.id,
      project_id: demanda.projectId ?? undefined,
      ip_address: req.ip || "127.0.0.1",
      user_agent: req.headers["user-agent"] || "unknown",
      metadata: JSON.stringify({
        demand_ref: demanda.demandRef,
        update_id: req.params.updateId,
        campos_aplicados: resultado.aplicadasAoProjeto,
        documentos_materializados: resultado.documentosMaterializados,
        atualizacoes_cobertas: resultado.cobertas,
      }),
    });

    const atual = await prisma.demand.findUnique({
      where: { id: req.params.id },
      include: { documents: true, ...RELACOES_DE_PESSOA, ...ATUALIZACOES_PENDENTES },
    });
    res.json({
      success: true,
      documents_materialized: resultado.documentosMaterializados,
      covered_updates: resultado.cobertas,
      demand: mapDemand(atual, await lerSla()),
    });
  } catch (err) {
    next(err);
  }
});

const DescarteSchema = z.object({
  note: z.string().trim().min(10, "Diga em uma frase por que a atualização não vai para o projeto (mínimo 10 caracteres)."),
});

// Descartar: a pessoa VIU o que mudou e decidiu não levar para o projeto. Exige
// motivo pelo mesmo motivo que a devolução exige (D17): sem ele, meses depois,
// ninguém sabe se a atualização foi recusada ou se alguém clicou sem ler.
router.post("/:id/updates/:updateId/dismiss", requirePermission("demand:assume"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = requireUserId(req);
    const { note } = DescarteSchema.parse(req.body);
    const demanda = await prisma.demand.findUnique({ where: { id: req.params.id } });
    if (!demanda) return res.status(404).json({ success: false, message: "Demanda não encontrada." });
    if (!(await podeDecidirSobre(req, demanda, userId))) {
      return res.status(403).json({ success: false, message: "Só quem assumiu a demanda pode decidir sobre as atualizações dela." });
    }

    const resultado = await descartarAtualizacao(req.params.updateId, userId, note.trim());
    if (!resultado.ok) {
      if (resultado.motivo === "not_found") return res.status(404).json({ success: false, message: "Atualização não encontrada." });
      return res.status(409).json({ success: false, message: "Esta atualização já foi decidida." });
    }

    await dbStore.addAuditLog({
      user_id: userId,
      action: "Dismiss Demand Update",
      entity_type: "Demand",
      entity_id: req.params.id,
      ip_address: req.ip || "127.0.0.1",
      user_agent: req.headers["user-agent"] || "unknown",
      metadata: JSON.stringify({ demand_ref: demanda.demandRef, update_id: req.params.updateId, note: note.trim() }),
    });

    const atual = await prisma.demand.findUnique({
      where: { id: req.params.id },
      include: { documents: true, ...RELACOES_DE_PESSOA, ...ATUALIZACOES_PENDENTES },
    });
    res.json({ success: true, demand: mapDemand(atual, await lerSla()) });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.issues[0].message });
    }
    next(err);
  }
});

// Encerrar depois do pedido de cancelamento (D18). A outra saída é CONCLUIR o
// projeto pelo caminho de sempre — a D29 nomeia as duas, e é `crmOutbox` quem
// fecha o pedido naquele caso.
router.post("/:id/cancel/close", requirePermission("demand:assume"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = requireUserId(req);
    const demanda = await prisma.demand.findUnique({ where: { id: req.params.id } });
    if (!demanda) return res.status(404).json({ success: false, message: "Demanda não encontrada." });
    if (!(await podeDecidirSobre(req, demanda, userId))) {
      return res.status(403).json({ success: false, message: "Só quem assumiu a demanda pode encerrá-la." });
    }

    const resultado = await encerrarCancelamento(req.params.id, userId);
    if (!resultado.ok) {
      if (resultado.motivo === "not_found") return res.status(404).json({ success: false, message: "Demanda não encontrada." });
      if (resultado.motivo === "sem_pedido") {
        return res.status(409).json({ success: false, message: "Não há pedido de cancelamento aberto nesta demanda." });
      }
      return res.status(409).json({ success: false, message: `Uma demanda com status "${resultado.status}" não pode ser encerrada.` });
    }

    await dbStore.addAuditLog({
      user_id: userId,
      action: "Close Demand Cancellation",
      entity_type: "Demand",
      entity_id: req.params.id,
      project_id: demanda.projectId ?? undefined,
      ip_address: req.ip || "127.0.0.1",
      user_agent: req.headers["user-agent"] || "unknown",
      metadata: JSON.stringify({ demand_ref: demanda.demandRef, justification: demanda.cancellationJustification }),
    });

    // Agora sim o `cancellation_ack`, com ATOR: alguém deste lado encerrou, e a
    // timeline do vendedor precisa dizer quem — ao contrário do cancelamento na
    // fila, onde ninguém daqui agiu.
    const quem = await dbStore.getUserById(userId);
    await empurrarMarcoDaDemanda({
      tenantId: resultado.demanda.tenantId,
      demanda: resultado.demanda,
      event: "cancellation_ack",
      occurredAt: resultado.demanda.cancelledAt ?? new Date(),
      actor: { name: quem?.name ?? "Pré-vendas", presales_user_id: userId },
      note: "Encerrada pelo pré-vendas depois do pedido de cancelamento aprovado no CRM.",
      projectId: resultado.demanda.projectId,
    });

    res.json({ success: true, demand: mapDemand(resultado.demanda, await lerSla()) });
  } catch (err) {
    next(err);
  }
});

export default router;
