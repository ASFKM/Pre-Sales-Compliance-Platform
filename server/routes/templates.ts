import express, { Response, NextFunction } from "express";
import type { Request } from "../types/express";
import multer from "multer";
import path from "path";
import { z } from "zod";
import { dbStore } from "../../src/dbStore";
import { requireAuth, requirePermission } from "./auth";
import { requireUserId } from "../middleware/security";
import { createStorageAdapter, validateUploadedFile } from "../utils/storage";
import { extractTemplatePlaceholders } from "../utils/docxTemplateEngine";
import { TEMPLATE_VARIABLE_CATALOG, getAllKnownVariableNames } from "../utils/templateVariableCatalog";
import { PROPOSAL_TYPES } from "../utils/proposalTypes";
import { runWithTenant } from "../../src/tenantContext";

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

// Templates aren't tied to a project - grouped under a fixed namespace instead (mirrors
// resolveTemplatePath's old "uploads/templates" fallback in proposals.ts).
const TEMPLATE_STORAGE_NAMESPACE = "templates";

// multer puts every non-file field onto req.body as a plain string, so booleans arrive as the
// literal text "true"/"false" - z.coerce.boolean() would be wrong here (it just calls Boolean(),
// so the non-empty string "false" would coerce to true). Parse the actual text instead.
const formBoolean = (defaultValue: boolean) =>
  z.union([z.boolean(), z.string()]).optional().transform((v) => (v === undefined ? defaultValue : v === true || v === "true"));

const ProposalTemplateFormSchema = z.object({
  name: z.string().min(2, "Template name is required"),
  description: z.string().optional().default(""),
  template_type: z.enum(PROPOSAL_TYPES),
  language: z.enum(["Portuguese", "English", "Spanish"]).default("Portuguese"),
  variables_schema: z.string().optional().default("[]"),
  version: z.string().min(1).default("v1.0"),
  active: formBoolean(true),
  default_template: formBoolean(false),
  uploaded_by: z.string().optional().default("Admin")
});

// name/description/language/variables_schema/version/active/default_template only - deliberately
// excludes file_path/file_type. Letting a client set those directly from JSON was the actual bug
// (a fake path derived from a filename string, never real bytes) - a real file replacement needs
// its own multipart upload, not a field on this route.
const UpdateProposalTemplateSchema = z.object({
  name: z.string().min(2).optional(),
  description: z.string().optional(),
  language: z.enum(["Portuguese", "English", "Spanish"]).optional(),
  variables_schema: z.string().optional(),
  version: z.string().min(1).optional(),
  active: z.boolean().optional(),
  default_template: z.boolean().optional(),
});

function fileTypeFromExtension(originalFilename: string): "docx" | "doc" | "pdf" | null {
  const ext = path.extname(originalFilename).toLowerCase();
  if (ext === ".docx") return "docx";
  if (ext === ".doc") return "doc";
  if (ext === ".pdf") return "pdf";
  return null;
}

async function hasDuplicateTemplateName(name: string, ignoreId?: string) {
  const templates = await dbStore.getProposalTemplates();
  return templates.some(template =>
    template.id !== ignoreId &&
    template.name.toLowerCase().trim() === name.toLowerCase().trim()
  );
}

async function auditTemplateChange(req: Request, action: string, templateId: string, updates: any) {
  const userId = requireUserId(req);
  await dbStore.addAuditLog({
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

router.get("/proposals", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await dbStore.getProposalTemplates());
  } catch (err) {
    next(err);
  }
});

router.post("/proposals", requirePermission("template:manage"), upload.single("file"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ success: false, message: "A template file is required." });
    }

    const fileType = fileTypeFromExtension(file.originalname);
    if (!fileType) {
      return res.status(400).json({ success: false, message: "Only DOCX, DOC or PDF files are supported for proposal templates." });
    }

    const fileValidation = validateUploadedFile(file.originalname, file.mimetype, file.size);
    if (!fileValidation.valid) {
      return res.status(400).json({ success: false, message: fileValidation.error });
    }

    const validated = ProposalTemplateFormSchema.parse(req.body);

    // AsyncLocalStorage context set by requireAuth's middleware isn't reliably reaching this
    // handler through multer's upload.single() - same issue already fixed in documents.ts.
    // Rebuilt directly from the tenant id requireAuth also stashes on the request headers, a
    // plain object property not dependent on any async-context propagation.
    const tenantId = req.headers["x-tenant-id"] as string;
    const tenantContext = { tenantId };

    await runWithTenant(tenantContext, async () => {
      if (await hasDuplicateTemplateName(validated.name)) {
        return res.status(409).json({ success: false, message: "Template name already exists." });
      }

      const platformSettings = await dbStore.getSettings();
      const storageAdapter = createStorageAdapter(platformSettings);
      const filePath = await storageAdapter.uploadFile(TEMPLATE_STORAGE_NAMESPACE, file.buffer, file.originalname, file.mimetype);

      const tpl = await dbStore.createProposalTemplate({
        ...validated,
        file_type: fileType,
        file_path: filePath,
        storage_provider: platformSettings.storage_mode,
      });

      let result = tpl;
      if (validated.default_template) {
        result = (await dbStore.setDefaultProposalTemplate(tpl.id)) || tpl;
      }

      await auditTemplateChange(req, "Create Proposal Template", result.id, { ...validated, file_path: filePath });
      res.status(201).json(result);
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.issues[0].message });
    }
    next(err);
  }
});

router.put("/proposals/:id", requirePermission("template:manage"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = UpdateProposalTemplateSchema.parse(req.body);
    const templates = await dbStore.getProposalTemplates();
    const currentTemplate = templates.find(t => t.id === req.params.id);

    if (!currentTemplate) {
      return res.status(404).json({ success: false, message: "Template not found" });
    }

    if (validated.name && (await hasDuplicateTemplateName(validated.name, req.params.id))) {
      return res.status(409).json({ success: false, message: "Template name already exists." });
    }

    let tpl = await dbStore.updateProposalTemplate(req.params.id, validated);

    if (validated.default_template === true) {
      tpl = (await dbStore.setDefaultProposalTemplate(req.params.id)) || tpl;
    }

    await auditTemplateChange(req, "Update Proposal Template", req.params.id, validated);
    res.json(tpl);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.issues[0].message });
    }
    next(err);
  }
});

router.delete("/proposals/:id", requirePermission("template:manage"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const templates = await dbStore.getProposalTemplates();
    const tpl = templates.find(t => t.id === req.params.id);
    if (!tpl) {
      return res.status(404).json({ success: false, message: "Template not found" });
    }

    const ok = await dbStore.deleteProposalTemplate(req.params.id);

    if (!ok) {
      return res.status(400).json({
        success: false,
        message: "Template not found or currently used by a proposal."
      });
    }

    // Remove the physical file too, now that uploads are real bytes rather than a fake path -
    // otherwise every deleted template would still leak its file in storage forever.
    const settings = await dbStore.getSettings();
    const storageAdapter = createStorageAdapter({ ...settings, storage_mode: tpl.storage_provider });
    await storageAdapter.deleteFile(tpl.file_path);

    await auditTemplateChange(req, "Delete Proposal Template", req.params.id, {});
    res.json({ success: true, message: "Template deleted successfully." });
  } catch (err) {
    next(err);
  }
});

// Canonical glossary of every variable buildTemplateVariables() can fill in a real template -
// used by the Admin Console's reference panel next to the upload form, and by the cross-check in
// /validate below. GET, not requirePermission("template:manage"): any authenticated user who can
// see the upload form should be able to see what variables exist.
router.get("/proposals/variables", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, variables: TEMPLATE_VARIABLE_CATALOG });
  } catch (err) {
    next(err);
  }
});

router.post("/proposals/:id/validate", requirePermission("template:manage"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const templates = await dbStore.getProposalTemplates();
    const tpl = templates.find(t => t.id === req.params.id);
    if (!tpl) {
      return res.status(404).json({ success: false, message: "Template not found" });
    }

    const knownVariables = getAllKnownVariableNames();
    // A placeholder in the file that isn't in the canonical catalog will always render empty -
    // usually a typo (e.g. {{preco}} instead of {{preco_total}}) or a variable the author assumed
    // exists but doesn't. Flagged here instead of only failing silently at generation time.
    const flagUnknown = (variables: string[]) => ({
      variables,
      unknown_variables: variables.filter((v) => !knownVariables.has(v)),
    });

    // Real placeholders found in the actual uploaded file (docxtemplater's own parser) - only
    // possible for .docx (a real OOXML zip); .doc/.pdf templates fall back to whatever variables
    // the admin manually registered, since this engine can't introspect those formats.
    if (tpl.file_type === "docx") {
      try {
        const settings = await dbStore.getSettings();
        const adapter = createStorageAdapter({ ...settings, storage_mode: tpl.storage_provider });
        const buffer = await adapter.readFile(tpl.file_path);
        const { variables, unknown_variables } = flagUnknown(extractTemplatePlaceholders(buffer));

        return res.json({
          success: true,
          message: unknown_variables.length > 0
            ? `Variáveis extraídas do arquivo real do template. ${unknown_variables.length} não reconhecida(s) - vão aparecer em branco no documento gerado.`
            : "Variáveis extraídas do arquivo real do template.",
          variables,
          variable_count: variables.length,
          unknown_variables,
        });
      } catch (err: any) {
        return res.status(400).json({ success: false, message: err.message || "Não foi possível ler as variáveis do arquivo do template." });
      }
    }

    const { variables, unknown_variables } = flagUnknown(extractTemplateVariables(tpl.variables_schema || "[]"));

    res.json({
      success: true,
      message: `Arquivo .${tpl.file_type} não pode ser inspecionado diretamente - variáveis registradas manualmente.`,
      variables,
      variable_count: variables.length,
      unknown_variables,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/proposals/:id/set-default", requirePermission("template:manage"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tpl = await dbStore.setDefaultProposalTemplate(req.params.id);

    if (!tpl) {
      return res.status(404).json({ success: false, message: "Template not found" });
    }

    await auditTemplateChange(req, "Set Default Proposal Template", req.params.id, { template_type: tpl.template_type });
    res.json({ success: true, message: "Default pre-sales template updated.", template: tpl });
  } catch (err) {
    next(err);
  }
});

export default router;
