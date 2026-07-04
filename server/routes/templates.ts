import express, { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { dbStore } from "../../src/dbStore";
import { requireAuth, requirePermission } from "./auth";

const router = express.Router();

const ProposalTemplateSchema = z.object({
  name: z.string().min(2, "Template name is required"),
  description: z.string().optional().default(""),
  template_type: z.enum(["technical", "commercial", "executive_summary", "risk_report", "bom_report", "questions_report"]),
  language: z.enum(["Portuguese", "English", "Spanish"]).default("Portuguese"),
  file_type: z.enum(["docx", "doc", "pdf"]).default("docx"),
  file_path: z.string().min(1, "File path is required"),
  variables_schema: z.string().optional().default("[]"),
  version: z.string().min(1).default("v1.0"),
  active: z.boolean().default(true),
  default_template: z.boolean().default(false),
  uploaded_by: z.string().optional().default("Admin")
});

const UpdateProposalTemplateSchema = ProposalTemplateSchema.partial();

function validateTemplateFilePath(filePath: string, fileType: string) {
  const normalizedPath = String(filePath || "").trim().toLowerCase();
  const normalizedType = String(fileType || "").trim().toLowerCase();

  if (!normalizedPath.endsWith(`.${normalizedType}`)) {
    return {
      valid: false,
      message: "Template file path must match the configured file type."
    };
  }

  return { valid: true, message: "" };
}

function hasDuplicateTemplateName(name: string, ignoreId?: string) {
  return dbStore.getProposalTemplates().some(template =>
    template.id !== ignoreId &&
    template.name.toLowerCase().trim() === name.toLowerCase().trim()
  );
}

function auditTemplateChange(req: Request, action: string, templateId: string, updates: any) {
  const userId = (req.headers["x-user-id"] as string) || "u1";
  dbStore.addAuditLog({
    user_id: userId,
    action,
    entity_type: "ProposalTemplate",
    entity_id: templateId,
    ip_address: req.ip || "127.0.0.1",
    user_agent: req.headers["user-agent"] || "unknown",
    metadata: JSON.stringify(updates)
  });
}

function extractTemplateVariables(rawSchema: string): string[] {
  try {
    const parsed = JSON.parse(rawSchema);
    if (Array.isArray(parsed)) return parsed.map(String);
    if (parsed && typeof parsed === "object") return Object.keys(parsed);
  } catch {
    // fallback below
  }

  const matches = rawSchema.match(/\{\{[^}]+\}\}/g) || [];
  return Array.from(new Set(matches));
}

router.get("/proposals", requireAuth, (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(dbStore.getProposalTemplates());
  } catch (err) {
    next(err);
  }
});

router.post("/proposals", requirePermission("template:manage"), (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = ProposalTemplateSchema.parse(req.body);

    if (hasDuplicateTemplateName(validated.name)) {
      return res.status(409).json({ success: false, message: "Template name already exists." });
    }

    const fileValidation = validateTemplateFilePath(validated.file_path, validated.file_type);
    if (!fileValidation.valid) {
      return res.status(400).json({ success: false, message: fileValidation.message });
    }

    const tpl = dbStore.createProposalTemplate(validated);

    let result = tpl;
    if (validated.default_template) {
      result = dbStore.setDefaultProposalTemplate(tpl.id) || tpl;
    }

    auditTemplateChange(req, "Create Proposal Template", result.id, validated);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

router.put("/proposals/:id", requirePermission("template:manage"), (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = UpdateProposalTemplateSchema.parse(req.body);
    const currentTemplate = dbStore.getProposalTemplates().find(t => t.id === req.params.id);

    if (!currentTemplate) {
      return res.status(404).json({ success: false, message: "Template not found" });
    }

    if (validated.name && hasDuplicateTemplateName(validated.name, req.params.id)) {
      return res.status(409).json({ success: false, message: "Template name already exists." });
    }

    const effectiveFilePath = validated.file_path || currentTemplate.file_path;
    const effectiveFileType = validated.file_type || currentTemplate.file_type;
    const fileValidation = validateTemplateFilePath(effectiveFilePath, effectiveFileType);
    if (!fileValidation.valid) {
      return res.status(400).json({ success: false, message: fileValidation.message });
    }

    let tpl = dbStore.updateProposalTemplate(req.params.id, validated);

    if (validated.default_template === true) {
      tpl = dbStore.setDefaultProposalTemplate(req.params.id) || tpl;
    }

    auditTemplateChange(req, "Update Proposal Template", req.params.id, validated);
    res.json(tpl);
  } catch (err) {
    next(err);
  }
});

router.delete("/proposals/:id", requirePermission("template:manage"), (req: Request, res: Response, next: NextFunction) => {
  try {
    const ok = dbStore.deleteProposalTemplate(req.params.id);

    if (!ok) {
      return res.status(400).json({
        success: false,
        message: "Template not found or currently used by a proposal."
      });
    }

    auditTemplateChange(req, "Delete Proposal Template", req.params.id, {});
    res.json({ success: true, message: "Template deleted successfully." });
  } catch (err) {
    next(err);
  }
});

router.post("/proposals/:id/validate", requirePermission("template:manage"), (req: Request, res: Response, next: NextFunction) => {
  try {
    const tpl = dbStore.getProposalTemplates().find(t => t.id === req.params.id);
    if (!tpl) {
      return res.status(404).json({ success: false, message: "Template not found" });
    }

    const variables = extractTemplateVariables(tpl.variables_schema || "[]");

    res.json({
      success: true,
      message: "Template schema matching successfully validated.",
      variables,
      variable_count: variables.length
    });
  } catch (err) {
    next(err);
  }
});

router.post("/proposals/:id/set-default", requirePermission("template:manage"), (req: Request, res: Response, next: NextFunction) => {
  try {
    const tpl = dbStore.setDefaultProposalTemplate(req.params.id);

    if (!tpl) {
      return res.status(404).json({ success: false, message: "Template not found" });
    }

    auditTemplateChange(req, "Set Default Proposal Template", req.params.id, { template_type: tpl.template_type });
    res.json({ success: true, message: "Default pre-sales template updated.", template: tpl });
  } catch (err) {
    next(err);
  }
});

export default router;
