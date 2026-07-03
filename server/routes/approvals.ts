import express, { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { dbStore } from "../../src/dbStore";
import { requireAuth, requirePermission } from "./auth";

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

function auditApprovalChange(req: Request, action: string, entityType: string, entityId: string, metadata: any, projectId?: string) {
  const userId = (req.headers["x-user-id"] as string) || "u1";
  dbStore.addAuditLog({
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

router.get("/approval-workflows", requireAuth, (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(dbStore.getApprovalWorkflows());
  } catch (err) {
    next(err);
  }
});

router.post("/approval-workflows", requirePermission("approval:manage"), (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = ApprovalWorkflowSchema.parse(req.body);
    const workflow = dbStore.createApprovalWorkflow(validated);

    auditApprovalChange(req, "Create Approval Workflow", "ApprovalWorkflow", workflow.id, validated);

    res.status(201).json(workflow);
  } catch (err) {
    next(err);
  }
});

router.put("/approval-workflows/:id", requirePermission("approval:manage"), (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = UpdateApprovalWorkflowSchema.parse(req.body);
    const workflow = dbStore.updateApprovalWorkflow(req.params.id, validated);

    if (!workflow) {
      return res.status(404).json({ success: false, message: "Approval workflow not found." });
    }

    auditApprovalChange(req, "Update Approval Workflow", "ApprovalWorkflow", req.params.id, validated);

    res.json(workflow);
  } catch (err) {
    next(err);
  }
});

router.delete("/approval-workflows/:id", requirePermission("approval:manage"), (req: Request, res: Response, next: NextFunction) => {
  try {
    const ok = dbStore.deleteApprovalWorkflow(req.params.id);

    if (!ok) {
      return res.status(400).json({
        success: false,
        message: "Approval workflow not found or currently used by a project/proposal."
      });
    }

    auditApprovalChange(req, "Delete Approval Workflow", "ApprovalWorkflow", req.params.id, {});

    res.json({ success: true, message: "Approval workflow deleted successfully." });
  } catch (err) {
    next(err);
  }
});

router.post("/proposals/:proposalId/approval/submit", requirePermission("approval:manage"), (req: Request, res: Response, next: NextFunction) => {
  try {
    const currentProposal = dbStore.getProposal(req.params.proposalId);

    if (!currentProposal) {
      return res.status(404).json({ success: false, message: "Proposal not found" });
    }

    if (currentProposal.status !== "draft") {
      return res.status(400).json({
        success: false,
        message: `Only draft proposals can be submitted for approval. Current status is '${currentProposal.status}'.`
      });
    }

    const workflow = dbStore.getApprovalWorkflows().find(w => w.id === currentProposal.approval_workflow_id);

    if (!workflow || !workflow.active) {
      return res.status(400).json({ success: false, message: "Active approval workflow not found for this proposal." });
    }

    const proposal = dbStore.updateProposalStatus(req.params.proposalId, "submitted");

    auditApprovalChange(
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

router.post("/proposals/:proposalId/approval/decision", requireAuth, (req: Request, res: Response, next: NextFunction) => {
  try {
    const { decision, comments, stage_id } = req.body;
    const proposal = dbStore.getProposal(req.params.proposalId);

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

    const workflow = dbStore.getApprovalWorkflows().find(w => w.id === proposal.approval_workflow_id);

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
    const currentUser = dbStore.getData().users.find(u => u.id === userId);
    const currentRole = dbStore.getData().roles.find(r => r.id === roleId);

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

    const existingDecision = dbStore.getData().approvalDecisions.find(d =>
      d.proposal_id === req.params.proposalId && d.stage_id === targetStageId
    );

    if (existingDecision) {
      return res.status(409).json({
        success: false,
        message: "An approval decision already exists for this proposal stage."
      });
    }

    const savedDecision = dbStore.createApprovalDecision({
      proposal_id: req.params.proposalId,
      stage_id: targetStageId,
      approver_user_id: userId,
      decision,
      comments: comments || ""
    });

    let nextStatus: "submitted" | "approved" | "rejected" = "submitted";

    if (decision === "rejected") {
      nextStatus = "rejected";
    } else {
      const allDecisions = [...dbStore.getData().approvalDecisions, savedDecision];
      const requiredStageIds = workflow.stages.filter(s => s.mandatory !== false).map(s => s.id);
      const allRequiredApproved = requiredStageIds.every(id =>
        allDecisions.some(d => d.proposal_id === req.params.proposalId && d.stage_id === id && d.decision === "approved")
      );
      nextStatus = allRequiredApproved ? "approved" : "submitted";
    }

    const updatedProposal = dbStore.updateProposalStatus(req.params.proposalId, nextStatus);

    auditApprovalChange(
      req,
      `Review Decision - ${decision}`,
      "Proposal",
      req.params.proposalId,
      {
        decision,
        comments,
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

router.get("/approval-decisions", requireAuth, (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(dbStore.getData().approvalDecisions);
  } catch (err) {
    next(err);
  }
});

export default router;
