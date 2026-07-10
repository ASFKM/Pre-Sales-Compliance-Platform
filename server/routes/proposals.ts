import express, { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { dbStore } from "../../src/dbStore";
import { requireAuth, requirePermission } from "./auth";
import { buildProposalText, writeProposalFiles } from "../utils/docx";
import { renderDocxFromTemplate } from "../utils/docxTemplateEngine";
import { createStorageAdapter } from "../utils/storage";
import { logDebugMessage, requireUserId } from "../middleware/security";
import { ProposalTemplate } from "../../src/types";
import { createTask, updateTaskProgress, completeTask, failTask } from "../../src/backgroundTasks";
import { runWithTenant } from "../../src/tenantContext";

const router = express.Router();

async function resolveRegisteredTemplate(
  templateId: string,
  proposalType: "technical" | "commercial"
): Promise<{ errorStatus: number; errorMessage: string } | { template: ProposalTemplate }> {
  const templates = await dbStore.getProposalTemplates();
  const template = templates.find(t => t.id === templateId);

  if (!template) {
    return { errorStatus: 404, errorMessage: "Proposal template not found." };
  }

  if (!template.active) {
    return { errorStatus: 400, errorMessage: "Proposal template is inactive." };
  }

  if (template.template_type !== proposalType) {
    return {
      errorStatus: 400,
      errorMessage: `Selected template type '${template.template_type}' is not valid for '${proposalType}' proposal.`
    };
  }

  return { template };
}

// Whether a registered template's file can actually be read right now, via whichever adapter
// wrote it. Replaces the old raw fs.existsSync(path.join(process.cwd(), filePath)) check, which
// built a filesystem path directly from a DB-stored string with no containment check - a path
// traversal risk - instead of delegating to the storage adapter's own safe path resolution.
async function checkTemplatePhysicalFile(template: ProposalTemplate, platformSettings: any): Promise<boolean> {
  try {
    const adapter = createStorageAdapter({ ...platformSettings, storage_mode: template.storage_provider });
    return await adapter.exists(template.file_path);
  } catch {
    return false;
  }
}


// Proposal validation schema
const CreateProposalSchema = z.object({
  template_id: z.string(),
  language: z.enum(["Portuguese", "English", "Spanish"]),
  manual_pricing_table: z.array(z.object({
    item_id: z.string(),
    product_or_service: z.string(),
    specification: z.string().optional().default(""),
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
  exclusions: z.string().optional(),
  editable_content: z.string().optional()
});

// GET all proposals for a project
router.get("/projects/:projectId/proposals", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const proposals = await dbStore.getProposals(req.params.projectId);
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
    const project = await dbStore.getProject(projectId);
    const analysis = await dbStore.getAnalysisResult(projectId);

    if (!project) {
      return res.status(404).json({ success: false, message: "Project not found." });
    }

    const templateResolution = await resolveRegisteredTemplate(validated.template_id, proposalType);
    if ("errorStatus" in templateResolution) {
      return res.status(templateResolution.errorStatus).json({ success: false, message: templateResolution.errorMessage });
    }

    const template = templateResolution.template;
    const platformSettings = await dbStore.getSettings();
    const physicalFileFound = await checkTemplatePhysicalFile(template, platformSettings);

    const userId = requireUserId(req);
    const tenantId = req.headers["x-tenant-id"] as string;
    const user = await dbStore.getUserById(userId);
    const userName = user ? user.name : "System User";

    // 1. Compile template data from projects, analysis result, and manual pricings
    const templateData = {
      template: {
        id: template.id,
        name: template.name,
        version: template.version,
        template_type: template.template_type,
        file_path: template.file_path,
        physical_file_found: physicalFileFound
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

    // Document generation runs in the background from here - respond immediately with the
    // task id, same pattern as document analysis (server/routes/analysis.ts).
    const task = await createTask({ userId, type: "proposal_generation", currentStep: "Gerando documento..." });
    res.status(202).json({ success: true, task_id: task.id });

    // Wrapped in runWithTenant like every other detached background block in this codebase -
    // without it, updateTaskProgress/completeTask/failTask/addAuditLog/createProposal below (all
    // tenant-scoped) would run with no tenant context at all.
    void runWithTenant({ tenantId }, async () => {
    try {
      // 2. Build the full proposal text - this same text becomes the proposal's editable_content,
      // so what the user reviews/edits on screen is exactly what's in the exported files
      // (regenerating both from the edited text is what saving an edit does later, in
      // PUT /proposals/:id).
      await updateTaskProgress(task.id, { status: "running", currentStep: "Compilando conteúdo da proposta", progressPct: 30 });
      const proposalContent = buildProposalText(templateData);

      // 3. If the registered template has a real, readable .docx file, merge into it directly
      // (preserves the template's own letterhead/styles) - otherwise fall back to the generic
      // generator, same as before this template engine existed. A merge failure fails the task
      // with a clear message rather than silently degrading to the generic document - the whole
      // point of choosing a template is the letterhead it produces.
      let docxBufferOverride: Buffer | undefined;
      if (physicalFileFound && template.file_type === "docx") {
        await updateTaskProgress(task.id, { currentStep: "Preenchendo template DOCX", progressPct: 55 });
        const templateAdapter = createStorageAdapter({ ...platformSettings, storage_mode: template.storage_provider });
        const templateBuffer = await templateAdapter.readFile(template.file_path);
        docxBufferOverride = renderDocxFromTemplate(templateBuffer, templateData);
      }

      // 4. Write DOCX/PDF through the storage adapter (local/S3/GCS, whatever the tenant has
      // configured) instead of a raw fs path under process.cwd() - survives a deploy without a
      // single persistent disk.
      await updateTaskProgress(task.id, { currentStep: "Gerando DOCX e PDF", progressPct: 65 });
      const outputAdapter = createStorageAdapter(platformSettings);
      const { docx_file_path, pdf_file_path } = await writeProposalFiles(outputAdapter, projectId, proposalType, proposalContent, docxBufferOverride);

      // 5. Save proposal to database
      await updateTaskProgress(task.id, { currentStep: "Salvando proposta", progressPct: 90 });
      const proposal = await dbStore.createProposal({
        project_id: projectId,
        proposal_type: proposalType,
        template_id: validated.template_id,
        template_version: template.version,
        status: "draft",
        language: validated.language,
        docx_file_path,
        pdf_file_path,
        storage_provider: platformSettings.storage_mode,
        version: 1,
        approval_workflow_id: project.selected_approval_workflow_id || "w1",
        generated_by: userName,
        manual_pricing_table: validated.manual_pricing_table,
        payment_terms: validated.payment_terms,
        delivery_terms: validated.delivery_terms,
        proposal_validity: validated.proposal_validity,
        commercial_assumptions: validated.commercial_assumptions,
        exclusions: validated.exclusions,
        editable_content: proposalContent
      });

      logDebugMessage({
        operation: "Proposal Generation",
        message: `Generated DOCX & PDF proposal using template ${template.id} for project ${projectId}`,
        status: "SUCCESS",
        durationMs: Date.now() - startTime,
        correlationId,
        projectId
      });

      await dbStore.addAuditLog({
        user_id: userName,
        action: "Generate Proposal Docs",
        entity_type: "Proposal",
        entity_id: proposal.id,
        project_id: projectId,
        ip_address: req.ip || "127.0.0.1",
        user_agent: req.headers["user-agent"] || "unknown",
        metadata: JSON.stringify({ type: proposalType, template_id: template.id, template_version: template.version, docx: proposal.docx_file_path })
      });

      await completeTask(task.id, { resultType: "proposal", resultId: proposal.id });
    } catch (genErr: any) {
      console.error("Proposal generation failed:", genErr);
      logDebugMessage({
        operation: "Proposal Generation Failure",
        message: `Proposal generation failed: ${genErr.message}`,
        status: "ERROR",
        durationMs: Date.now() - startTime,
        correlationId,
        projectId,
        error: genErr
      });
      await failTask(task.id, genErr.message || "Unknown error during proposal generation");
    }
    });

  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.issues[0].message });
    }
    next(err);
  }
});

// UPDATE proposal metadata/manually edited pricing
router.put("/proposals/:id", requirePermission("proposal:edit"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = CreateProposalSchema.partial().parse(req.body);
    const existingProposal = await dbStore.getProposal(req.params.id);

    if (!existingProposal) {
      return res.status(404).json({ success: false, message: "Proposal not found" });
    }

    if (existingProposal.status !== "draft") {
      return res.status(400).json({
        success: false,
        message: `Only draft proposals can be edited. Current status is '${existingProposal.status}'.`
      });
    }

    let proposal = await dbStore.updateProposal(req.params.id, validated);

    // If the user edited the proposal's text, the exported DOCX/PDF must match what's on
    // screen - regenerate both from the edited text through the storage adapter (regeneration
    // always creates freshly-named storage paths), delete the now-orphaned old files, then point
    // the proposal row at the new ones - rather than leaving the exports as a stale snapshot of
    // the original AI-generated content. Always the generic (non-template) generator here, even
    // if the proposal was originally created from a real template: editable_content is one flat
    // text blob, not the structured {{cliente}}/{{bom}}/... fields the template engine needs, so
    // there's no correct way to re-merge it - the DOCX intentionally reverts to the generic layout
    // once the free text is edited.
    if (validated.editable_content !== undefined && proposal) {
      const platformSettings = await dbStore.getSettings();
      const outputAdapter = createStorageAdapter(platformSettings);
      const { docx_file_path, pdf_file_path } = await writeProposalFiles(
        outputAdapter,
        existingProposal.project_id,
        existingProposal.proposal_type,
        validated.editable_content
      );

      const oldAdapter = createStorageAdapter({ ...platformSettings, storage_mode: existingProposal.storage_provider });
      await oldAdapter.deleteFile(existingProposal.docx_file_path);
      await oldAdapter.deleteFile(existingProposal.pdf_file_path);

      proposal = await dbStore.updateProposal(req.params.id, {
        docx_file_path,
        pdf_file_path,
        storage_provider: platformSettings.storage_mode,
      });
    }

    const userId = requireUserId(req);
    await dbStore.addAuditLog({
      user_id: userId,
      action: validated.editable_content !== undefined ? "Edit Proposal Content" : "Update Proposal Pricing Details",
      entity_type: "Proposal",
      entity_id: req.params.id,
      project_id: proposal?.project_id,
      ip_address: req.ip || "127.0.0.1",
      user_agent: req.headers["user-agent"] || "unknown",
      metadata: JSON.stringify({ ...validated, editable_content: validated.editable_content ? "[edited]" : undefined })
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
router.post("/proposals/:id/release", requirePermission("proposal:approve"), async (req: Request, res: Response, next: NextFunction) => {
  const correlationId = (req.headers["x-correlation-id"] as string) || "corr-proposal-release";
  const startTime = Date.now();

  try {
    const proposal = await dbStore.getProposal(req.params.id);

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
    const settings = await dbStore.getSettings();
    const adapter = createStorageAdapter({ ...settings, storage_mode: proposal.storage_provider });

    if (!(await adapter.exists(proposal.docx_file_path))) {
      return res.status(400).json({ success: false, message: "Cannot release proposal because the DOCX file is missing." });
    }

    if (!(await adapter.exists(proposal.pdf_file_path))) {
      return res.status(400).json({ success: false, message: "Cannot release proposal because the PDF file is missing." });
    }

    const releasedProposal = await dbStore.updateProposalStatus(req.params.id, "released");

    logDebugMessage({
      operation: "Proposal Release",
      message: `Released proposal ${req.params.id} as final customer-ready version`,
      status: "SUCCESS",
      durationMs: Date.now() - startTime,
      correlationId,
      projectId: proposal.project_id
    });

    const userId = requireUserId(req);
    await dbStore.addAuditLog({
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

// SERVE proposal files for download/export - reads through the storage adapter that actually
// wrote them (local/S3/GCS) rather than assuming a local disk path, which would already be wrong
// for S3/GCS-backed proposals (docx_file_path/pdf_file_path are storage-scheme paths, not
// filesystem paths relative to process.cwd()).
router.get("/proposals/:id/export/docx", requirePermission("proposal:export"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const proposal = await dbStore.getProposal(req.params.id);
    if (!proposal) {
      return res.status(404).json({ success: false, message: "Proposal not found" });
    }
    const settings = await dbStore.getSettings();
    const adapter = createStorageAdapter({ ...settings, storage_mode: proposal.storage_provider });

    let buffer: Buffer;
    try {
      buffer = await adapter.readFile(proposal.docx_file_path);
    } catch {
      return res.status(404).json({ success: false, message: "Physical document file not found." });
    }

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="${proposal.proposal_type}_proposal_${proposal.id}.docx"`);
    res.send(buffer);
  } catch (err) {
    next(err);
  }
});

router.get("/proposals/:id/export/pdf", requirePermission("proposal:export"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const proposal = await dbStore.getProposal(req.params.id);
    if (!proposal) {
      return res.status(404).json({ success: false, message: "Proposal not found" });
    }
    const settings = await dbStore.getSettings();
    const adapter = createStorageAdapter({ ...settings, storage_mode: proposal.storage_provider });

    let buffer: Buffer;
    try {
      buffer = await adapter.readFile(proposal.pdf_file_path);
    } catch {
      return res.status(404).json({ success: false, message: "Physical PDF file not found." });
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${proposal.proposal_type}_proposal_${proposal.id}.pdf"`);
    res.send(buffer);
  } catch (err) {
    next(err);
  }
});

export default router;
