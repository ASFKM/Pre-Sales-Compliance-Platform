import express, { Response, NextFunction } from "express";
import type { Request } from "../types/express";
import { z } from "zod";
import { dbStore } from "../../src/dbStore";
import { requireAuth, requirePermission } from "./auth";
import { requireUserId } from "../middleware/security";
import { empurrarProposta, empurrarEventoDaProposta } from "../utils/crmOutbox";
import { validateApprovalDecisionComments } from "../utils/approvalDecision";
import { prisma } from "../../src/prisma";
import { apontamentosQueBarramEnvio, mensagemDoGateDeEnvio } from "../utils/proposalSubmissionGate";

const router = express.Router();

const ApprovalStageSchema = z.object({
  id: z.string().optional(),
  workflow_id: z.string().optional(),
  name: z.string().min(2, "Stage name is required"),
  order: z.number().optional(),
  approver_type: z.enum(["user", "role"]).default("role"),
  approver_user_id: z.string().optional(),
  approver_role_id: z.string().optional(),
  mandatory: z.boolean().default(true),
  conditions: z.string().optional().default("Always mandatory"),
  created_at: z.string().optional(),
  updated_at: z.string().optional()
});

const ApprovalWorkflowSchema = z.object({
  name: z.string().min(2, "Workflow name is required"),
  description: z.string().optional().default(""),
  active: z.boolean().default(true),
  applies_to: z.string().optional().default("all"),
  stages: z.array(ApprovalStageSchema).min(1, "At least one approval stage is required")
});

const UpdateApprovalWorkflowSchema = ApprovalWorkflowSchema.partial();

async function hasDuplicateWorkflowName(name: string, ignoreId?: string) {
  const workflows = await dbStore.getApprovalWorkflows();
  return workflows.some(workflow =>
    workflow.id !== ignoreId &&
    workflow.name.toLowerCase().trim() === name.toLowerCase().trim()
  );
}

async function validateApprovalWorkflowStages(stages: any[]) {
  const roles = await dbStore.getRoles();
  const users = await dbStore.getUsers();
  const stageNames = new Set<string>();

  for (const stage of stages || []) {
    const stageName = String(stage.name || "").trim().toLowerCase();

    if (stageNames.has(stageName)) {
      return { valid: false, message: "Approval workflow contains duplicate stage names." };
    }

    stageNames.add(stageName);

    if (stage.approver_type === "user") {
      if (!stage.approver_user_id) {
        return { valid: false, message: "User approver stage requires approver_user_id." };
      }

      if (!users.some(user => user.id === stage.approver_user_id)) {
        return { valid: false, message: "Approval stage user approver does not exist." };
      }
    } else {
      if (!stage.approver_role_id) {
        return { valid: false, message: "Role approver stage requires approver_role_id." };
      }

      if (!roles.some(role => role.id === stage.approver_role_id)) {
        return { valid: false, message: "Approval stage role approver does not exist." };
      }
    }
  }

  return { valid: true, message: "" };
}

async function auditApprovalChange(req: Request, action: string, entityType: string, entityId: string, metadata: any, projectId?: string) {
  const userId = requireUserId(req);
  await dbStore.addAuditLog({
    user_id: userId,
    action,
    entity_type: entityType,
    entity_id: entityId,
    project_id: projectId,
    ip_address: req.ip || "127.0.0.1",
    user_agent: req.headers["user-agent"] || "unknown",
    metadata: JSON.stringify(metadata || {})
  });
}

router.get("/approval-workflows", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await dbStore.getApprovalWorkflows());
  } catch (err) {
    next(err);
  }
});

router.post("/approval-workflows", requirePermission("approval:manage"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = ApprovalWorkflowSchema.parse(req.body);

    if (await hasDuplicateWorkflowName(validated.name)) {
      return res.status(409).json({ success: false, message: "Approval workflow name already exists." });
    }

    const stageValidation = await validateApprovalWorkflowStages(validated.stages);
    if (!stageValidation.valid) {
      return res.status(400).json({ success: false, message: stageValidation.message });
    }

    const workflow = await dbStore.createApprovalWorkflow(validated);

    await auditApprovalChange(req, "Create Approval Workflow", "ApprovalWorkflow", workflow.id, validated);

    res.status(201).json(workflow);
  } catch (err) {
    next(err);
  }
});

router.put("/approval-workflows/:id", requirePermission("approval:manage"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = UpdateApprovalWorkflowSchema.parse(req.body);
    const workflows = await dbStore.getApprovalWorkflows();
    const currentWorkflow = workflows.find(w => w.id === req.params.id);

    if (!currentWorkflow) {
      return res.status(404).json({ success: false, message: "Approval workflow not found." });
    }

    if (validated.name && (await hasDuplicateWorkflowName(validated.name, req.params.id))) {
      return res.status(409).json({ success: false, message: "Approval workflow name already exists." });
    }

    const effectiveStages = validated.stages || currentWorkflow.stages || [];
    const stageValidation = await validateApprovalWorkflowStages(effectiveStages);
    if (!stageValidation.valid) {
      return res.status(400).json({ success: false, message: stageValidation.message });
    }

    const workflow = await dbStore.updateApprovalWorkflow(req.params.id, validated);

    await auditApprovalChange(req, "Update Approval Workflow", "ApprovalWorkflow", req.params.id, validated);

    res.json(workflow);
  } catch (err) {
    next(err);
  }
});

router.delete("/approval-workflows/:id", requirePermission("approval:manage"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ok = await dbStore.deleteApprovalWorkflow(req.params.id);

    if (!ok) {
      return res.status(400).json({
        success: false,
        message: "Approval workflow not found or currently used by a project/proposal."
      });
    }

    await auditApprovalChange(req, "Delete Approval Workflow", "ApprovalWorkflow", req.params.id, {});

    res.json({ success: true, message: "Approval workflow deleted successfully." });
  } catch (err) {
    next(err);
  }
});

router.post("/proposals/:proposalId/approval/submit", requirePermission("approval:manage"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const currentProposal = await dbStore.getProposal(req.params.proposalId);

    if (!currentProposal) {
      return res.status(404).json({ success: false, message: "Proposal not found" });
    }

    if (currentProposal.status !== "draft") {
      return res.status(400).json({
        success: false,
        message: `Only draft proposals can be submitted for approval. Current status is '${currentProposal.status}'.`
      });
    }

    const workflows = await dbStore.getApprovalWorkflows();
    const workflow = workflows.find(w => w.id === currentProposal.approval_workflow_id);

    if (!workflow || !workflow.active) {
      return res.status(400).json({ success: false, message: "Active approval workflow not found for this proposal." });
    }

    /*
     * F7 (rodada 09/2026): o GATE RIGIDO DE ENVIO.
     *
     * Nenhum apontamento CRITICO da ultima rodada de pareceres pode estar "aberto" ou "em
     * tratativa". Seguir mesmo assim continua possivel - e essa e a diferenca entre um gate e uma
     * proibicao - mas exige marcar cada critico como "aceito com risco" COM justificativa, pelo
     * PATCH /proposals/:id/apontamentos/:findingId, que carimba autor e instante.
     *
     * A regra mora AQUI, no servidor e antes do updateProposalStatus, e nao no botao da tela: um
     * gate cuja unica trava e validacao de formulario nao e um gate, basta uma chamada direta a
     * rota para atravessa-lo. Foi exatamente por isto que a F6 pos a exigencia de justificativa no
     * servidor - ela e a peca que sustenta esta.
     *
     * Escopo: so a ULTIMA rodada. Uma proposta revisada tres vezes nao deve ser barrada por um
     * critico da primeira rodada que ja nao aparece na terceira - a rodada nova E a resposta sobre
     * o que continua de pe, e e o vinculo entre rodadas desta mesma fase que torna isso legivel.
     */
    if (currentProposal.latest_opinion_run_id) {
      const apontamentosDaRodada = await prisma.proposalOpinionFinding.findMany({
        where: { opinion: { runId: currentProposal.latest_opinion_run_id } },
        select: { id: true, title: true, severity: true, status: true, resolutionNote: true, targetKey: true },
      });
      const barrando = apontamentosQueBarramEnvio(apontamentosDaRodada);
      if (barrando.length > 0) {
        return res.status(409).json({
          success: false,
          // A mensagem NOMEIA cada apontamento que esta barrando. Ela chega ao usuario por um
          // alert que o front ja exibe (handleSubmitProposalApproval, src/hooks/useProposals.ts),
          // e a F8 vai exibi-la ao aprovador - entao ela precisa ser legivel por quem nao abriu o
          // painel de pareceres.
          message: mensagemDoGateDeEnvio(barrando),
          apontamentos_bloqueantes: barrando.map((a) => ({ id: a.id, title: a.title, status: a.status, target_key: a.targetKey })),
        });
      }
    }

    const proposal = await dbStore.updateProposalStatus(req.params.proposalId, "submitted");

    // CDC 16 F4: `submitted` daqui é `in_approval` no contrato. O CRM registra a versão e NÃO
    // aplica o valor dela ao funil (D24/D21): uma proposta em aprovação ainda não é compromisso de
    // preço, e deixá-la mexer no pipeline faria o número do vendedor dançar a cada etapa interna
    // do nosso fluxo.
    void empurrarProposta(req.params.proposalId);

    await auditApprovalChange(
      req,
      "Submit Proposal for Approval",
      "Proposal",
      req.params.proposalId,
      { status: "submitted", workflow_id: proposal?.approval_workflow_id },
      currentProposal.project_id
    );

    res.json({ success: true, proposal });
  } catch (err) {
    next(err);
  }
});

router.post("/proposals/:proposalId/approval/decision", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { decision, comments, stage_id } = req.body;
    const proposal = await dbStore.getProposal(req.params.proposalId);

    if (!proposal) {
      return res.status(404).json({ success: false, message: "Proposal not found" });
    }

    if (proposal.status !== "submitted") {
      return res.status(400).json({
        success: false,
        message: `Approval decisions can only be recorded for submitted proposals. Current status is '${proposal.status}'.`
      });
    }

    if (decision !== "approved" && decision !== "rejected") {
      return res.status(400).json({ success: false, message: "Decision must be approved or rejected." });
    }

    /*
     * PreSales F8 (PARTE A): o MOTIVO da rejeição passa a ser obrigatório de verdade - a regra
     * mora em server/utils/approvalDecision.ts (pura, provada por teste unitário sem banco).
     *
     * A chamada é feita AQUI, e não num schema Zod no topo do handler, de propósito: a ordem das
     * respostas desta rota (404 inexistente -> 400 status errado -> 400 decisão inválida -> 403
     * aprovador errado -> 409 decisão duplicada) já é contrato exercitado por
     * scripts/regression-approval-rbac.sh, e um parse no topo mudaria essa ordem para qualquer
     * corpo malformado.
     */
    const commentsValidation = validateApprovalDecisionComments(decision, comments);
    if (!commentsValidation.valid) {
      return res.status(400).json({ success: false, message: commentsValidation.message });
    }
    const normalizedComments = commentsValidation.comments;

    const workflows = await dbStore.getApprovalWorkflows();
    const workflow = workflows.find(w => w.id === proposal.approval_workflow_id);

    if (!workflow || !workflow.active || !workflow.stages?.length) {
      return res.status(400).json({ success: false, message: "Active approval workflow with stages not found for this proposal." });
    }

    const targetStageId = stage_id || workflow.stages[0].id;
    const targetStage = workflow.stages.find(s => s.id === targetStageId);

    if (!targetStage) {
      return res.status(400).json({ success: false, message: "Approval stage does not belong to this proposal workflow." });
    }

    const userId = (req.headers["x-user-id"] as string) || "";
    const roleId = (req.headers["x-role-id"] as string) || "";
    const currentUser = await dbStore.getUserById(userId);
    const currentRole = await dbStore.getRoleById(roleId);

    if (!currentUser || !currentRole) {
      return res.status(403).json({ success: false, message: "Authenticated approver context was not found." });
    }

    const stageTargetConfigured =
      targetStage.approver_type === "user"
        ? Boolean(targetStage.approver_user_id)
        : Boolean(targetStage.approver_role_id);

    if (!stageTargetConfigured) {
      return res.status(400).json({ success: false, message: "Approval stage approver target is not configured." });
    }

    const canApproveTargetStage =
      targetStage.approver_type === "user"
        ? targetStage.approver_user_id === userId
        : targetStage.approver_role_id === roleId;

    if (!canApproveTargetStage) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: You are not the configured approver for this approval stage.",
        required_approver: {
          approver_type: targetStage.approver_type,
          approver_user_id: targetStage.approver_user_id,
          approver_role_id: targetStage.approver_role_id
        },
        current_user: {
          user_id: userId,
          role_id: roleId
        }
      });
    }

    const existingDecision = await dbStore.getApprovalDecision(req.params.proposalId, targetStageId);

    if (existingDecision) {
      return res.status(409).json({
        success: false,
        message: "An approval decision already exists for this proposal stage."
      });
    }

    const savedDecision = await dbStore.createApprovalDecision({
      proposal_id: req.params.proposalId,
      stage_id: targetStageId,
      approver_user_id: userId,
      decision,
      comments: normalizedComments
    });

    let nextStatus: "submitted" | "approved" | "rejected";

    if (decision === "rejected") {
      nextStatus = "rejected";
    } else {
      const allDecisions = await dbStore.getApprovalDecisionsForProposal(req.params.proposalId);
      const requiredStageIds = workflow.stages.filter(s => s.mandatory !== false).map(s => s.id);
      const allRequiredApproved = requiredStageIds.every(id =>
        allDecisions.some(d => d.stage_id === id && d.decision === "approved")
      );
      nextStatus = allRequiredApproved ? "approved" : "submitted";
    }

    const updatedProposal = await dbStore.updateProposalStatus(req.params.proposalId, nextStatus);

    /*
     * CDC 16 F4: a decisão vai ao CRM, aprovando ou recusando.
     *
     * Aprovada, o envelope leva o CARIMBO de quem aprovou e quando (D24) — é ele que impede a
     * alçada de desconto do CRM de reabrir o assunto do lado de lá. Recusada, o CRM registra a
     * versão com `rejected`, que no vocabulário deste produto significa "a aprovação INTERNA
     * recusou" e não "o cliente disse não"; o CRM sabe da diferença e não a mostra como negócio
     * perdido.
     *
     * `submitted` (faltam etapas obrigatórias) também viaja: uma proposta que anda no fluxo é
     * notícia, e o CRM devolve a mesma resposta na repetição em vez de duplicar.
     */
    void empurrarProposta(req.params.proposalId);

    /*
     * F9: o EVENTO de timeline (D30) que acompanha o envelope acima, para a oportunidade animar
     * na hora (SSE) e não só quando alguém abrir a aba de propostas. `submitted` (falta etapa)
     * não tem marco correspondente no vocabulário do CMCRM e não dispara nada aqui.
     */
    if (nextStatus === "approved") {
      void empurrarEventoDaProposta(req.params.proposalId, "proposal_ready");
    } else if (nextStatus === "rejected") {
      void empurrarEventoDaProposta(req.params.proposalId, "proposal_rejected");
    }

    await auditApprovalChange(
      req,
      `Review Decision - ${decision}`,
      "Proposal",
      req.params.proposalId,
      {
        decision,
        comments: normalizedComments,
        stage_id: targetStageId,
        next_status: nextStatus,
        approver_user_id: userId,
        approver_role_id: roleId,
        approver_role_name: currentRole.name,
        stage_approver_type: targetStage.approver_type,
        stage_approver_user_id: targetStage.approver_user_id,
        stage_approver_role_id: targetStage.approver_role_id
      },
      proposal.project_id
    );

    res.json({ success: true, proposal: updatedProposal, decision: savedDecision });
  } catch (err) {
    next(err);
  }
});

router.get("/approval-decisions", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await dbStore.getApprovalDecisions());
  } catch (err) {
    next(err);
  }
});

export default router;
