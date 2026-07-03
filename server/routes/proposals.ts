import express, { Request, Response, NextFunction } from "express";
import { z } from "zod";
import path from "path";
import fs from "fs";
import { dbStore } from "../../src/dbStore";
import { requireAuth, requirePermission } from "./auth";
import { generateDocxFromTemplate, generatePdfFromProposal } from "../utils/docx";
import { logDebugMessage } from "../middleware/security";
import { Proposal } from "../../src/types";

const router = express.Router();

function resolveRegisteredTemplate(templateId: string, proposalType: "technical" | "commercial") {
  const template = dbStore.getProposalTemplates().find(t => t.id === templateId);

  if (!template) {
    return { errorStatus: 404, errorMessage: "Proposal template not found." } as const;
  }

  if (!template.active) {
    return { errorStatus: 400, errorMessage: "Proposal template is inactive." } as const;
  }

  if (template.template_type !== proposalType) {
    return {
      errorStatus: 400,
      errorMessage: `Selected template type '${template.template_type}' is not valid for '${proposalType}' proposal.`
    } as const;
  }

  return { template } as const;
}

function resolveTemplatePath(filePath: string): string {
  const cleaned = String(filePath || "").replace(/^\/+/, "");
  const candidate = path.isAbsolute(filePath)
    ? filePath
    : path.join(process.cwd(), cleaned);

  if (fs.existsSync(candidate)) {
    return candidate;
  }

  return path.join(process.cwd(), "uploads", "templates", "standard.docx");
}


// Proposal validation schema
const CreateProposalSchema = z.object({
  template_id: z.string(),
  language: z.enum(["Portuguese", "English", "Spanish"]),
  manual_pricing_table: z.array(z.object({
    item_id: z.string(),
    product_or_service: z.string(),
    quantity: z.number(),
    unit: z.string(),
    unit_price: z.number(),
    total_price: z.number(),
    currency: z.string(),
    is_optional: z.boolean(),
    discount: z.number()
  })).optional(),
  payment_terms: z.string().optional(),
  delivery_terms: z.string().optional(),
  proposal_validity: z.string().optional(),
  commercial_assumptions: z.string().optional(),
  exclusions: z.string().optional()
});

// GET all proposals for a project
router.get("/projects/:projectId/proposals", requireAuth, (req: Request, res: Response, next: NextFunction) => {
  try {
    const proposals = dbStore.getProposals(req.params.projectId);
    res.json(proposals);
  } catch (err) {
    next(err);
  }
});

// CREATE & GENERATE a proposal using real DOCX templating
router.post("/projects/:projectId/proposals/:type", requirePermission("proposal:generate"), async (req: Request, res: Response, next: NextFunction) => {
  const correlationId = (req.headers["x-correlation-id"] as string) || "corr-proposal";
  const startTime = Date.now();
  const projectId = req.params.projectId;
  const proposalType = req.params.type as "technical" | "commercial";

  if (!["technical", "commercial"].includes(proposalType)) {
    return res.status(400).json({ success: false, message: "Invalid proposal type." });
  }

  try {
    const validated = CreateProposalSchema.parse(req.body);
    const project = dbStore.getProject(projectId);
    const analysis = dbStore.getAnalysisResult(projectId);

    if (!project) {
      return res.status(404).json({ success: false, message: "Project not found." });
    }

    const templateResolution = resolveRegisteredTemplate(validated.template_id, proposalType);
    if ("errorStatus" in templateResolution) {
      return res.status(templateResolution.errorStatus).json({ success: false, message: templateResolution.errorMessage });
    }

    const template = templateResolution.template;
    const templateFile = resolveTemplatePath(template.file_path);

    const userId = (req.headers["x-user-id"] as string) || "u1";
    const user = dbStore.getData().users.find(u => u.id === userId);
    const userName = user ? user.name : "System User";

    const uuid = Math.random().toString(36).substring(2, 11);
    const docxFilename = `${proposalType}_proposal_${uuid}.docx`;
    const pdfFilename = `${proposalType}_proposal_${uuid}.pdf`;

    const docxPath = path.join(process.cwd(), "uploads", projectId, docxFilename);
    const pdfPath = path.join(process.cwd(), "uploads", projectId, pdfFilename);

    // 1. Compile template data from projects, analysis result, and manual pricings
    const templateData = {
      template: {
        id: template.id,
        name: template.name,
        version: template.version,
        template_type: template.template_type,
        file_path: template.file_path,
        physical_file_found: fs.existsSync(templateFile)
      },
      project: {
        name: project.name,
        customer_name: project.customer_name,
        description: project.description,
        vertical: project.vertical
      },
      analysis: analysis ? {
        executive_summary: analysis.executive_summary,
        critical_requirements: analysis.critical_requirements,
        risks: analysis.risks,
        bom: analysis.bom
      } : undefined,
      proposal: {
        manual_pricing_table: validated.manual_pricing_table,
        payment_terms: validated.payment_terms,
        delivery_terms: validated.delivery_terms,
        proposal_validity: validated.proposal_validity,
        commercial_assumptions: validated.commercial_assumptions,
        exclusions: validated.exclusions
      }
    };

    // 2. Generate a valid DOCX package from the selected registered template metadata
    await generateDocxFromTemplate(templateFile, docxPath, templateData);

    // 3. Render PDF companion file from the same proposal data
    await generatePdfFromProposal(docxPath, pdfPath, templateData);

    // 4. Save proposal to database
    const proposal = dbStore.createProposal({
      project_id: projectId,
      proposal_type: proposalType,
      template_id: validated.template_id,
      template_version: template.version,
      status: "draft",
      language: validated.language,
      docx_file_path: `/uploads/${projectId}/${docxFilename}`,
      pdf_file_path: `/uploads/${projectId}/${pdfFilename}`,
      version: 1,
      approval_workflow_id: project.selected_approval_workflow_id || "w1",
      generated_by: userName,
      manual_pricing_table: validated.manual_pricing_table,
      payment_terms: validated.payment_terms,
      delivery_terms: validated.delivery_terms,
      proposal_validity: validated.proposal_validity,
      commercial_assumptions: validated.commercial_assumptions,
      exclusions: validated.exclusions
    });

    logDebugMessage({
      operation: "Proposal Generation",
      message: `Generated DOCX & PDF proposal using template ${template.id} for project ${projectId}`,
      status: "SUCCESS",
      durationMs: Date.now() - startTime,
      correlationId,
      projectId
    });

    dbStore.addAuditLog({
      user_id: userName,
      action: "Generate Proposal Docs",
      entity_type: "Proposal",
      entity_id: proposal.id,
      project_id: projectId,
      ip_address: req.ip || "127.0.0.1",
      user_agent: req.headers["user-agent"] || "unknown",
      metadata: JSON.stringify({ type: proposalType, template_id: template.id, template_version: template.version, docx: proposal.docx_file_path })
    });

    res.status(211).json(proposal);

  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.issues[0].message });
    }
    next(err);
  }
});

// UPDATE proposal metadata/manually edited pricing
router.put("/proposals/:id", requirePermission("proposal:edit"), (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = CreateProposalSchema.partial().parse(req.body);
    const proposal = dbStore.updateProposal(req.params.id, validated);

    if (!proposal) {
      return res.status(404).json({ success: false, message: "Proposal not found" });
    }

    const userId = (req.headers["x-user-id"] as string) || "u1";
    dbStore.addAuditLog({
      user_id: userId,
      action: "Update Proposal Pricing Details",
      entity_type: "Proposal",
      entity_id: req.params.id,
      project_id: proposal.project_id,
      ip_address: req.ip || "127.0.0.1",
      user_agent: req.headers["user-agent"] || "unknown",
      metadata: JSON.stringify(validated)
    });

    res.json(proposal);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.issues[0].message });
    }
    next(err);
  }
});

// RELEASE an approved proposal as the final customer-ready version
router.post("/proposals/:id/release", requirePermission("proposal:approve"), (req: Request, res: Response, next: NextFunction) => {
  const correlationId = (req.headers["x-correlation-id"] as string) || "corr-proposal-release";
  const startTime = Date.now();

  try {
    const proposal = dbStore.getProposal(req.params.id);

    if (!proposal) {
      return res.status(404).json({ success: false, message: "Proposal not found." });
    }

    if (proposal.status !== "approved") {
      return res.status(400).json({
        success: false,
        message: `Only approved proposals can be released. Current status is '${proposal.status}'.`
      });
    }

    const previousStatus = proposal.status;
    const docxFullPath = path.join(process.cwd(), proposal.docx_file_path);
    const pdfFullPath = path.join(process.cwd(), proposal.pdf_file_path);

    if (!fs.existsSync(docxFullPath)) {
      return res.status(400).json({ success: false, message: "Cannot release proposal because the DOCX file is missing." });
    }

    if (!fs.existsSync(pdfFullPath)) {
      return res.status(400).json({ success: false, message: "Cannot release proposal because the PDF file is missing." });
    }

    const releasedProposal = dbStore.updateProposalStatus(req.params.id, "released");

    logDebugMessage({
      operation: "Proposal Release",
      message: `Released proposal ${req.params.id} as final customer-ready version`,
      status: "SUCCESS",
      durationMs: Date.now() - startTime,
      correlationId,
      projectId: proposal.project_id
    });

    const userId = (req.headers["x-user-id"] as string) || "u1";
    dbStore.addAuditLog({
      user_id: userId,
      action: "Release Final Proposal",
      entity_type: "Proposal",
      entity_id: proposal.id,
      project_id: proposal.project_id,
      ip_address: req.ip || "127.0.0.1",
      user_agent: req.headers["user-agent"] || "unknown",
      metadata: JSON.stringify({
        previous_status: previousStatus,
        next_status: "released",
        docx_file_path: proposal.docx_file_path,
        pdf_file_path: proposal.pdf_file_path
      })
    });

    res.json({ success: true, proposal: releasedProposal });
  } catch (err) {
    next(err);
  }
});

// SERVE proposal files for download/export (fully compliant paths)
router.get("/proposals/:id/export/docx", requireAuth, (req: Request, res: Response, next: NextFunction) => {
  try {
    const proposal = dbStore.getProposal(req.params.id);
    if (!proposal) {
      return res.status(404).json({ success: false, message: "Proposal not found" });
    }
    const fullPath = path.join(process.cwd(), proposal.docx_file_path);
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ success: false, message: "Physical document file not found." });
    }
    res.download(fullPath, path.basename(proposal.docx_file_path));
  } catch (err) {
    next(err);
  }
});

router.get("/proposals/:id/export/pdf", requireAuth, (req: Request, res: Response, next: NextFunction) => {
  try {
    const proposal = dbStore.getProposal(req.params.id);
    if (!proposal) {
      return res.status(404).json({ success: false, message: "Proposal not found" });
    }
    const fullPath = path.join(process.cwd(), proposal.pdf_file_path);
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ success: false, message: "Physical PDF file not found." });
    }
    res.setHeader("Content-Type", "application/pdf");
    res.sendFile(fullPath);
  } catch (err) {
    next(err);
  }
});

export default router;
