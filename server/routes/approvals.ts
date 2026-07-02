import express, { Request, Response, NextFunction } from "express";
import { dbStore } from "../../src/dbStore";
import { requireAuth, requirePermission } from "./auth";

const router = express.Router();

router.get("/approval-workflows", requireAuth, (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(dbStore.getApprovalWorkflows());
  } catch (err) {
    next(err);
  }
});

router.post("/proposals/:proposalId/approval/submit", requirePermission("approval:manage"), (req: Request, res: Response, next: NextFunction) => {
  try {
    const proposal = dbStore.getProposal(req.params.proposalId);
    if (!proposal) {
      return res.status(404).json({ success: false, message: "Proposal not found" });
    }

    proposal.status = "submitted";

    const userId = (req.headers["x-user-id"] as string) || "u1";
    const user = dbStore.getData().users.find(u => u.id === userId);
    dbStore.addAuditLog({
      user_id: user?.name || "Pre-Sales Engineer",
      action: "Submit Proposal for Approval",
      entity_type: "Proposal",
      entity_id: req.params.proposalId,
      project_id: proposal.project_id,
      ip_address: req.ip || "127.0.0.1",
      user_agent: req.headers["user-agent"] || "unknown",
      metadata: JSON.stringify({ status: "submitted" })
    });

    res.json({ success: true, proposal });
  } catch (err) {
    next(err);
  }
});

router.post("/proposals/:proposalId/approval/decision", requirePermission("proposal:approve"), (req: Request, res: Response, next: NextFunction) => {
  try {
    const { decision, comments, stage_id } = req.body;
    const proposal = dbStore.getProposal(req.params.proposalId);

    if (!proposal) {
      return res.status(404).json({ success: false, message: "Proposal not found" });
    }

    proposal.status = decision === "approved" ? "approved" : "rejected";

    const userId = (req.headers["x-user-id"] as string) || "u1";
    const user = dbStore.getData().users.find(u => u.id === userId);
    
    // Save decision to store
    dbStore.getData().approvalDecisions.push({
      id: "dec_" + Math.random().toString(36).substring(2, 11),
      proposal_id: req.params.proposalId,
      stage_id: stage_id || "s1",
      approver_user_id: userId,
      decision,
      comments: comments || "",
      created_at: new Date().toISOString()
    });

    dbStore.addAuditLog({
      user_id: user?.name || "Approver",
      action: `Review Decision - ${decision}`,
      entity_type: "Proposal",
      entity_id: req.params.proposalId,
      project_id: proposal.project_id,
      ip_address: req.ip || "127.0.0.1",
      user_agent: req.headers["user-agent"] || "unknown",
      metadata: JSON.stringify({ decision, comments })
    });

    res.json({ success: true, proposal });
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
