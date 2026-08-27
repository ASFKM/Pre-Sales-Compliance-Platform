import express, { Response, NextFunction } from "express";
import { z } from "zod";
import type { Request } from "../types/express";
import { prisma } from "../../src/prisma";
import { dbStore } from "../../src/dbStore";
import { requirePermission } from "./auth";
import { requireUserId } from "../middleware/security";
import { assumirDemanda, devolverDemanda } from "../utils/demands";

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
// Fora do escopo desta fase, por decisão do plano: SLA e política de atribuição
// (F5), papel de gerente de pré-vendas e a aprovação da devolução por ele (F5),
// cancelamento vindo do CRM (F7).

const router = express.Router();

const ESTADOS_ABERTOS = ["queued", "assigned", "in_analysis"] as const;
const ESTADOS_VALIDOS = new Set(["queued", "assigned", "in_analysis", "returned", "cancelled", "completed"]);

function mapDemand(d: any) {
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
    const filtro = typeof req.query.status === "string" ? req.query.status.trim() : "";
    // Peneirado contra a lista real do enum: um valor inventado na query chegaria
    // ao Prisma e sairia como 500, que é erro de servidor para o que é entrada
    // inválida. Filtro que sobra vazio volta ao padrão em vez de devolver nada.
    const pedidos = filtro ? filtro.split(",").map((s) => s.trim()).filter((s) => ESTADOS_VALIDOS.has(s)) : [];
    const status = pedidos.length > 0 ? pedidos : [...ESTADOS_ABERTOS, "returned"];

    const demandas = await prisma.demand.findMany({
      where: { status: { in: status as any } },
      include: { documents: true, assignedUser: { select: { name: true } } },
      // Prazo primeiro: numa fila de auto-serviço, a ordem em que as coisas
      // aparecem é a política de atribuição de fato enquanto a F5 não chega.
      orderBy: [{ deadline: "asc" }, { queuedAt: "asc" }],
    });
    res.json(demandas.map(mapDemand));
  } catch (err) {
    next(err);
  }
});

router.get("/:id", requirePermission("demand:read"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const demanda = await prisma.demand.findUnique({
      where: { id: req.params.id },
      include: { documents: true, assignedUser: { select: { name: true } } },
    });
    if (!demanda) return res.status(404).json({ success: false, message: "Demanda não encontrada." });
    res.json(mapDemand(demanda));
  } catch (err) {
    next(err);
  }
});

// O ato de assumir: a Demanda vira Projeto com dono e a análise segue como já
// funciona hoje (§2.2, passo 7 do plano).
router.post("/:id/assume", requirePermission("demand:assume"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = requireUserId(req);
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

    res.json({
      success: true,
      demand: mapDemand(resultado.demand),
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
    // demanda de alguém que saiu da equipe. A aprovação do gerente é F5.
    const role = await dbStore.getRoleById(req.headers["x-role-id"] as string);
    const podeQualquer = role?.permissions.includes("project:read_all") ?? false;
    if (atual.assignedUserId !== userId && !podeQualquer) {
      return res.status(403).json({ success: false, message: "Só quem assumiu a demanda pode devolvê-la." });
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

    res.json({ success: true, demand: mapDemand(resultado.demand) });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.issues[0].message });
    }
    next(err);
  }
});

export default router;
