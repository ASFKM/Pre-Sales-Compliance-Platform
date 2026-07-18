import express, { Response, NextFunction } from "express";
import type { Request } from "../types/express";
import { z } from "zod";
import { dbStore } from "../../src/dbStore";
import { requirePermission } from "./auth";
import { logDebugMessage, requireUserId } from "../middleware/security";
import { logger } from "../utils/logger";
import { AnalysisResult, KnowledgeBaseEntry } from "../../src/types";
import { createTask, updateTaskProgress, completeTask, failTask } from "../../src/backgroundTasks";
import { generateJsonWithProvider, generateTextWithProvider, searchWebWithProvider, ConnectedProvider, ProviderFileInput } from "../utils/aiProviders";
import { createStorageAdapter } from "../utils/storage";
import { estimateCostUsd } from "../utils/aiPricing";
import { resolveProvider, checkCostCap, recordProviderFallback, recordAiUsage } from "../../src/aiOrchestrator";
import { runWithTenant } from "../../src/tenantContext";
import { prisma } from "../../src/prisma";
import { FACTORY_DEFAULT_ANALYSIS_PROMPT } from "../utils/promptDefaults";
import { buildDocxBuffer } from "../utils/docx";
import { randomId } from "../../src/idGenerator";
import { LOGIC_VERSIONS } from "../../src/aiLogicVersions";

const router = express.Router();

// The prompt explicitly tells the model these enum fields are fixed English codes, not prose to
// translate - but in practice models (especially when the rest of the prompt insists everything
// be in Portuguese) sometimes translate them anyway, confirmed twice in a row on a real document
// ("compliance" coming back as a Portuguese word instead of one of the four English options).
// Rather than keep tightening prompt wording and hoping, normalize common Portuguese synonyms
// back to the expected English value before validation - a defensive layer, not a replacement for
// the prompt instruction.
const ENUM_SYNONYMS: Record<string, string> = {
  // compliance / compliance_status
  "conforme": "compliant", "compativel": "compliant", "totalmente conforme": "compliant", "atende": "compliant",
  "parcialmente conforme": "partially_compliant", "parcialmente compativel": "partially_compliant", "atende parcialmente": "partially_compliant",
  "nao conforme": "non_compliant", "incompativel": "non_compliant", "nao atende": "non_compliant",
  "informacao insuficiente": "not_enough_information", "informacoes insuficientes": "not_enough_information", "sem informacao suficiente": "not_enough_information",
  // priority / severity / probability
  "alta": "high", "alto": "high", "media": "medium", "medio": "medium", "baixa": "low", "baixo": "low", "critica": "critical", "critico": "critical",
  // mandatory_or_optional
  "obrigatorio": "mandatory", "obrigatoria": "mandatory", "opcional": "optional",
  // category (CriticalRequirement)
  "tecnico": "technical", "tecnica": "technical", "comercial": "commercial", "contratual": "contractual",
  "operacional": "operational", "seguranca": "security", "integracao": "integration", "infraestrutura": "infrastructure",
  "prazo": "deadline", "suporte": "support", "sla": "support", "manutencao": "maintenance", "documentacao": "documentation", "treinamento": "training",
  // evidence_type
  "diretamente suportado": "directly_supported", "inferido dos documentos": "inferred_from_documents",
  "instrucao do usuario": "user_provided_instruction", "suposicao": "assumption", "informacao ausente": "missing_information",
  "requer confirmacao do cliente": "requires_customer_confirmation",
};

function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// z.preprocess wrapper around z.enum that maps a Portuguese synonym (or a case/accent variant of
// a correct English option) back to the expected value before Zod validates it. Falls back to the
// first listed option rather than ever letting an unrecognized value reach z.enum() and fail the
// whole analysis - confirmed on a real document that the model occasionally returns a value this
// synonym map doesn't cover for one or two items out of dozens; losing the entire real analysis
// (every other correctly-extracted requirement, the whole BOM, the whole matrix) over one
// mis-categorized item is a worse outcome than that one item defaulting to a reasonable category.
function normalizedEnum<T extends [string, ...string[]]>(options: T) {
  return z.preprocess((val) => {
    if (typeof val !== "string") return options[0];
    const normalized = stripAccents(val.toLowerCase().trim());
    const exactOption = options.find((opt) => stripAccents(opt.toLowerCase()) === normalized);
    if (exactOption) return exactOption;
    if (ENUM_SYNONYMS[normalized]) return ENUM_SYNONYMS[normalized];
    const partialMatch = options.find((opt) => normalized.includes(stripAccents(opt.toLowerCase())));
    if (partialMatch) return partialMatch;
    logger.warn({ value: val, defaultedTo: options[0], validOptions: options }, "normalizedEnum: unrecognized value");
    return options[0];
  }, z.enum(options));
}

const KEYWORD_STOPWORDS = new Set([
  "para", "com", "sem", "que", "uma", "um", "de", "da", "do", "das", "dos", "em", "no", "na",
  "nos", "nas", "por", "sobre", "entre", "este", "esta", "esse", "essa", "aquele", "aquela",
  "ser", "sao", "foi", "sera", "deve", "devem", "pode", "podem", "nao", "sim", "mais",
  "menos", "muito", "pouco", "todo", "toda", "todos", "todas", "qualquer", "cada", "outro",
  "outra", "the", "and", "for", "with", "without", "that", "this", "these", "those", "from",
  "into", "onto", "than", "then", "also", "will", "shall", "must", "have", "has", "had",
  "documento", "document", "start", "end", "secao", "section", "pagina", "page", "anexo",
  "termo", "referencia", "edital", "licitacao", "contrato", "objeto", "item", "itens",
  "project", "projeto", "description", "descricao", "customer", "cliente", "vertical",
]);

// Cheap term-frequency keyword extraction (no vector/embedding search infra in this codebase yet)
// - used to narrow the accumulated-knowledge lookup (see searchApprovedKnowledgeBase) to entries
// actually relevant to this document, instead of handing the model every approved entry regardless
// of topic. Keywords keep their original accents (unlike stripAccents elsewhere in this file) since
// they're matched via a plain ILIKE `contains` against trigger/knowledge text that isn't
// accent-folded - only the stopword comparison itself is accent-insensitive.
// minLength defaults to 4 (unchanged whole-document behavior). The per-item BOM lookup (see
// enrichBomWithWebSearch) passes 3 instead - equipment specs in this domain are full of short,
// highly-distinguishing acronyms (PTZ, DAI, DVR, LPR, VMS) that a 4-char floor silently drops,
// while the frequency ranking below (ties broken by first-seen order, since most terms in a spec
// list appear only once) then surfaces whatever generic words happen to come first in the text
// instead - confirmed on a real item ("Câmera IP tipo PTZ com DAI...") extracting only generic
// filler ("mínimo", "zoom", "tipo", "suporte"...) and none of PTZ/DAI/Hikvision/IP66/IK10, so the
// Knowledge Base search that follows had nothing distinctive to match against.
export function extractKnowledgeBaseKeywords(text: string, maxKeywords = 40, minLength = 4): string[] {
  const counts = new Map<string, number>();
  for (const raw of text.toLowerCase().split(/[^\p{L}\p{N}-]+/u)) {
    const word = raw.trim();
    if (word.length < minLength || KEYWORD_STOPWORDS.has(stripAccents(word))) continue;
    counts.set(word, (counts.get(word) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, maxKeywords).map(([w]) => w);
}

// The main analysis prompt asks for raw JSON, but on large outputs (e.g. a project with a long
// BOM array, many similar objects in a row) the model occasionally emits a trailing comma before
// a closing `}`/`]` - invalid JSON that fails the whole analysis (confirmed on a real run: a
// SyntaxError several minutes into a job, after the AI call had already succeeded and been
// billed, wasting the whole attempt). Strip a code fence first (existing behavior), then retry
// once with trailing commas removed before giving up - if the repaired text still doesn't parse,
// re-throw the ORIGINAL error so a genuinely different syntax problem is never masked.
export function parseAiJson(rawText: string): any {
  const stripped = rawText.trim().replace(/^```json\s*|```\s*$/g, "");
  try {
    return JSON.parse(stripped);
  } catch (err) {
    const repaired = stripped.replace(/,(\s*[}\]])/g, "$1");
    try {
      return JSON.parse(repaired);
    } catch {
      throw err;
    }
  }
}

// 1. Zod Schema for Structured Output Validation
const ExecutiveSummarySchema = z.object({
  project_overview: z.string(),
  customer_context: z.string(),
  main_requirements: z.string(),
  main_risks: z.string(),
  main_opportunities: z.string(),
  recommended_strategy: z.string(),
  assumptions: z.string(),
  next_steps: z.string()
});

const CriticalRequirementSchema = z.object({
  requirement_id: z.string(),
  category: normalizedEnum(["technical", "commercial", "contractual", "operational", "security", "integration", "infrastructure", "deadline", "support", "maintenance", "documentation", "training"]),
  description: z.string(),
  source_document: z.string(),
  source_page_or_section: z.string(),
  source_snippet: z.string(),
  priority: normalizedEnum(["high", "medium", "low"]),
  mandatory_or_optional: normalizedEnum(["mandatory", "optional"]),
  compliance_status: normalizedEnum(["not_enough_information", "compliant", "partially_compliant", "non_compliant"]),
  evidence_type: normalizedEnum(["directly_supported", "inferred_from_documents", "user_provided_instruction", "assumption", "missing_information", "requires_customer_confirmation"]),
  confidence: z.number().min(0).max(1),
  // Real run on a large tender (22+ critical requirements) had the model omit "notes" entirely on
  // several items instead of returning an empty string - a required z.string() then failed the
  // WHOLE analysis on a Zod error, even though every other field parsed fine and notes is genuinely
  // optional commentary. Tolerate a missing/null value as "no additional notes" instead.
  notes: z.string().optional().nullable().default("")
});

const ProjectRiskSchema = z.object({
  risk_id: z.string(),
  title: z.string(),
  description: z.string(),
  severity: normalizedEnum(["low", "medium", "high", "critical"]),
  probability: normalizedEnum(["low", "medium", "high"]),
  impact: z.string(),
  source_document: z.string(),
  source_page_or_section: z.string(),
  source_snippet: z.string(),
  mitigation: z.string(),
  owner_area: z.string(),
  requires_customer_clarification: z.boolean(),
  evidence_type: z.string(),
  confidence: z.number()
});

const ProjectOpportunitySchema = z.object({
  opportunity_id: z.string(),
  title: z.string(),
  description: z.string(),
  business_value: z.string(),
  source_document: z.string(),
  source_page_or_section: z.string(),
  suggested_solution: z.string(),
  sales_strategy: z.string(),
  priority: normalizedEnum(["high", "medium", "low"]),
  evidence_type: z.string(),
  confidence: z.number()
});

const BOMItemSchema = z.object({
  item_id: z.string(),
  sku: z.string(),
  part_number: z.string(),
  equipment_name: z.string(),
  manufacturer: z.string(),
  quantity: z.number(),
  unit: z.string(),
  category: z.string(),
  specification: z.string(),
  source_reference: z.string(),
  // True when sku/part_number/manufacturer were filled by the web-search lookup step below
  // rather than found in the source document - the two have very different reliability, and the
  // user needs to know which is which before quoting a part number in a real proposal.
  sourced_via_web_search: z.boolean().optional().default(false),
  // True when the same lookup step instead resolved the item from an approved Knowledge Base
  // entry (human-reviewed, from a past project) - checked before falling back to a live web
  // search, so this is the more trustworthy of the two provenance flags. Mutually exclusive with
  // sourced_via_web_search.
  sourced_via_knowledge_base: z.boolean().optional().default(false),
  // Set client-side the moment a user hand-edits sku/part_number/manufacturer - takes over from
  // sourced_via_web_search/sourced_via_knowledge_base in the UI badge once a person has verified/
  // corrected the value.
  edited_by: z.string().optional(),
  // Roadmap item (customer_request): deterministic-enough brand-policy compliance signal, on top
  // of the prompt-only instruction already given to enrichBomWithWebSearch (project.ai_orientation_text,
  // e.g. "Hikvision"). A prompt instruction alone increases compliance but doesn't guarantee it
  // item-by-item since generation is probabilistic - confirmed this session (21-item real BOM test:
  // 0 real violations, but a naive "manufacturer != policy -> flag" check would have produced 2
  // false positives on VMS/analytics software licenses the mandated camera brand doesn't make).
  // applicable/compliant/note are the model's own structured self-report (formalizing what the
  // prompt already asked it to explain in prose); confidence is computed afterward in
  // computeBrandPolicyCrossCheck, never by the model itself. All optional/nullable - absent on
  // BOMs saved before this existed, and on items where no brand policy applies at all.
  brand_policy_applicable: z.boolean().optional().nullable(),
  brand_policy_compliant: z.boolean().optional().nullable(),
  brand_policy_note: z.string().optional().nullable(),
  brand_policy_confidence: z.enum(["high", "medium", "low"]).optional().nullable(),
});

// The point-to-point technical matrix is domain-aware rather than one fixed set of columns for
// every project: a CFTV-only tender gets one matrix with camera/protocol-shaped columns, a
// CFTV+network tender gets two matrices (one per discipline), each with the columns that actually
// make sense for that discipline (network wants source/destination/port/protocol, CFTV wants
// camera/resolution/coverage, electrical wants voltage/load, etc.) - the AI decides both which
// disciplines are present and which columns each one needs, since a fixed schema can't anticipate
// every kind of tender this platform will see. Rows are a flexible key/value object keyed by each
// column's own `key` - not validated field-by-field (there's no fixed field list to validate
// against), only that the overall shape (columns are {key,label} pairs, rows are string/number/
// bool/null-valued objects) is well-formed.
const DynamicMatrixColumnSchema = z.object({
  key: z.string(),
  label: z.string(),
});

const DynamicMatrixSchema = z.object({
  discipline: z.string(),
  columns: z.array(DynamicMatrixColumnSchema),
  rows: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))),
});

const PreliminarySchedulePhaseSchema = z.object({
  phase_id: z.string(),
  phase_name: z.string(),
  activities: z.array(z.string()),
  estimated_duration: z.string(),
  dependencies: z.array(z.string()),
  responsible_area: z.string(),
  assumptions: z.string(),
  risks: z.string()
});

const ClarificationQuestionSchema = z.object({
  question_id: z.string(),
  question: z.string(),
  reason: z.string(),
  source_reference: z.string(),
  related_requirement_or_risk: z.string(),
  priority: normalizedEnum(["high", "medium", "low"]),
  target_audience: z.string()
});

const AnalysisResultSchema = z.object({
  executive_summary: ExecutiveSummarySchema,
  critical_requirements: z.array(CriticalRequirementSchema),
  risks: z.array(ProjectRiskSchema),
  opportunities: z.array(ProjectOpportunitySchema),
  bom: z.array(BOMItemSchema),
  point_to_point_table: z.array(DynamicMatrixSchema),
  preliminary_schedule: z.array(PreliminarySchedulePhaseSchema),
  clarification_questions: z.array(ClarificationQuestionSchema),
  technical_proposal_draft: z.string(),
  commercial_proposal_draft: z.string()
});


// Computed server-side (not duplicated in the frontend) so LOGIC_VERSIONS stays the single
// source of truth - null means "legacy/unknown" (row predates this column, or this particular
// logic unit was never run for it), distinct from both true (stale) and false (up to date), so
// old rows don't get flagged en masse as "outdated" the moment this feature ships.
function computeLogicStaleness(result: AnalysisResult): { is_document_analysis_stale: boolean | null; is_bom_enrichment_stale: boolean | null } {
  const stored = result.logic_versions;
  const staleFor = (key: keyof typeof LOGIC_VERSIONS): boolean | null => {
    const storedVersion = stored?.[key];
    if (storedVersion === undefined || storedVersion === null) return null;
    return storedVersion < LOGIC_VERSIONS[key];
  };
  return {
    is_document_analysis_stale: staleFor("document_analysis"),
    is_bom_enrichment_stale: staleFor("bom_enrichment"),
  };
}

// GET latest analysis result
router.get("/projects/:projectId/analysis-result", requirePermission("analysis:read"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await dbStore.getAnalysisResult(req.params.projectId);
    if (!result) {
      return res.status(404).json({ success: false, message: "No analysis result exists for this project." });
    }
    res.json({ ...result, ...computeLogicStaleness(result) });
  } catch (err) {
    next(err);
  }
});

// UPDATE or SAVE analysis result manually (human-in-the-loop edits)
router.post("/projects/:projectId/analysis-result", requirePermission("analysis:edit"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const projectId = req.params.projectId;
    // Callers only ever send the one field they're editing (e.g. just critical_requirements for
    // a notes/status edit) - saveAnalysisResult merges that into the existing row, so start from
    // the current full record rather than req.body alone, or every other field (bom, risks,
    // executive_summary...) would be missing from what's saved.
    const existing = await dbStore.getAnalysisResult(projectId);
    const result = { ...existing, ...req.body, project_id: projectId, updated_at: new Date().toISOString() };

    await dbStore.saveAnalysisResult(result);

    const userId = requireUserId(req);
    await dbStore.addAuditLog({
      user_id: userId,
      action: "Update AI Analysis Content",
      entity_type: "AnalysisResult",
      entity_id: result.id || "ar_manual",
      project_id: projectId,
      ip_address: req.ip || "127.0.0.1",
      user_agent: req.headers["user-agent"] || "unknown",
      metadata: JSON.stringify({ review_status: result.review_status })
    });

    // Return the full, freshly-saved record - not req.body (which only ever has the one field
    // the caller edited) - so the frontend's setAnalysisResult(response) never wipes out every
    // other field, which is exactly what was crashing the page (bom.map/.length on undefined)
    // right after any requirement/risk edit.
    const fullResult = await dbStore.getAnalysisResult(projectId);
    res.json({ success: true, result: fullResult });
  } catch (err) {
    next(err);
  }
});

// Roadmap item (customer_request): focused single-section re-run of an already-completed
// analysis (e.g. just the BOM, if it came out unsatisfactory) instead of rerunning the whole
// 8-section analysis and hoping. Reuses document_analysis's own provider/model config
// (resolveProvider("document_analysis", ...)) - same AI capability, just a narrower prompt with
// the section's entire output budget to itself instead of splitting it with the other 7 sections.
const SECTION_CONFIG: Record<string, { schema: z.ZodTypeAny; label: string; shapeHint: string; needsBomEnrichment?: boolean }> = {
  critical_requirements: {
    schema: z.array(CriticalRequirementSchema),
    label: "Requisitos Críticos",
    shapeHint: `[{ "requirement_id": string, "category": "technical"|"commercial"|"contractual"|"operational"|"security"|"integration"|"infrastructure"|"deadline"|"support"|"maintenance"|"documentation"|"training", "description": string, "source_document": string, "source_page_or_section": string, "source_snippet": string, "priority": "high"|"medium"|"low", "mandatory_or_optional": "mandatory"|"optional", "compliance_status": "not_enough_information"|"compliant"|"partially_compliant"|"non_compliant", "evidence_type": "directly_supported"|"inferred_from_documents"|"user_provided_instruction"|"assumption"|"missing_information"|"requires_customer_confirmation", "confidence": number (0-1), "notes": string }]`,
  },
  risks: {
    schema: z.array(ProjectRiskSchema),
    label: "Riscos",
    shapeHint: `[{ "risk_id": string, "title": string, "description": string, "severity": "low"|"medium"|"high"|"critical", "probability": "low"|"medium"|"high", "impact": string, "source_document": string, "source_page_or_section": string, "source_snippet": string, "mitigation": string, "owner_area": string, "requires_customer_clarification": boolean, "evidence_type": string, "confidence": number }]`,
  },
  opportunities: {
    schema: z.array(ProjectOpportunitySchema),
    label: "Oportunidades",
    shapeHint: `[{ "opportunity_id": string, "title": string, "description": string, "business_value": string, "source_document": string, "source_page_or_section": string, "suggested_solution": string, "sales_strategy": string, "priority": "high"|"medium"|"low", "evidence_type": string, "confidence": number }]`,
  },
  bom: {
    schema: z.array(BOMItemSchema),
    label: "BOM (Lista de Materiais)",
    shapeHint: `[{ "item_id": string, "sku": string, "part_number": string, "equipment_name": string, "manufacturer": string, "quantity": number, "unit": string, "category": string, "specification": string, "source_reference": string }]`,
    needsBomEnrichment: true,
  },
};

router.post("/projects/:projectId/analysis-result/reanalyze-section", requirePermission("analysis:run"), async (req: Request, res: Response, next: NextFunction) => {
  const correlationId = (req.headers["x-correlation-id"] as string) || "corr-section-reanalysis";
  const startTime = Date.now();
  const projectId = req.params.projectId;
  const tenantId = req.headers["x-tenant-id"] as string;
  const tenantContext = { tenantId };

  const section = req.body?.section as string;
  const sectionConfig = SECTION_CONFIG[section];
  if (!sectionConfig) {
    return res.status(400).json({ success: false, message: `Seção inválida para reanálise: "${section}".` });
  }

  let project, platformSettings, providerResolution, userId, task;
  try {
    project = await dbStore.getProject(projectId);
    if (!project) {
      return res.status(404).json({ success: false, message: "Project not found." });
    }

    platformSettings = await dbStore.getSettings();
    providerResolution = await resolveProvider("document_analysis", platformSettings);

    const costCap = await checkCostCap(tenantId, platformSettings.monthly_cost_cap_usd ?? null);
    if (costCap.blocked) {
      return res.status(402).json({
        success: false,
        message: `Monthly AI cost cap reached ($${costCap.currentSpendUsd.toFixed(2)} of $${costCap.capUsd?.toFixed(2)}). Reanalysis blocked until next month or the cap is raised in Admin > AI, Prompts e Custos.`
      });
    }

    userId = requireUserId(req);
    if (providerResolution.isFallback) {
      await recordProviderFallback({ tenantId, taskType: "document_analysis", intendedProvider: providerResolution.intendedProvider, userId });
    }

    task = await createTask({ userId, type: "section_reanalysis", currentStep: `Reanalisando: ${sectionConfig.label}`, resultId: projectId });
    res.status(202).json({ success: true, task_id: task.id });
  } catch (err) {
    return next(err);
  }

  // Everything from here runs detached, same pattern as POST /projects/:projectId/analyze above.
  void runWithTenant(tenantContext, async () => {
  try {
    await updateTaskProgress(task.id, { status: "running", currentStep: "Lendo documentos", progressPct: 15 });

    // Same document-gathering logic as the full analysis handler above (POST /projects/:projectId/
    // analyze) - duplicated rather than extracted into a shared helper, deliberately: that handler
    // is real, tested production code, and this endpoint is new - safer to leave it untouched than
    // risk a refactor regression on the primary analysis path.
    const docs = await dbStore.getDocuments(projectId);
    const VISION_MIME_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);
    let combinedExtractedText = "";
    const documentFiles: ProviderFileInput[] = [];
    const storageAdapterForDocs = createStorageAdapter(platformSettings);

    for (let idx = 0; idx < docs.length; idx++) {
      const doc = docs[idx];
      if (VISION_MIME_TYPES.has(doc.mime_type)) {
        try {
          const buffer = await storageAdapterForDocs.readFile(doc.storage_path);
          documentFiles.push({ mimeType: doc.mime_type, base64Data: buffer.toString("base64") });
          combinedExtractedText += `\n--- DOCUMENT ${idx + 1}: ${doc.filename} (${doc.detected_document_type}) - sent as a real file below, read it directly ---\n`;
        } catch (err) {
          logger.error({ err, documentId: doc.id, filename: doc.filename }, "Failed to read document file for section reanalysis");
        }
        continue;
      }
      const text = await dbStore.getDocumentContent(doc.id);
      if (text) {
        combinedExtractedText += `\n--- START DOCUMENT ${idx + 1}: ${doc.filename} (${doc.detected_document_type}) ---\n`;
        combinedExtractedText += text.substring(0, 10000);
        combinedExtractedText += `\n--- END DOCUMENT ${idx + 1} ---\n`;
      }
    }
    if (!combinedExtractedText) {
      combinedExtractedText = "No document text was extracted. Standard project description fallback is used.";
    }

    await updateTaskProgress(task.id, { currentStep: "Analisando com IA", progressPct: 40 });

    const knowledgeBaseKeywords = extractKnowledgeBaseKeywords(
      [project.name, project.customer_name, project.vertical, project.description, project.ai_orientation_text, combinedExtractedText]
        .filter(Boolean)
        .join(" ")
    );
    const approvedKnowledge = await dbStore.searchApprovedKnowledgeBase(knowledgeBaseKeywords);
    const knowledgeBaseSection = approvedKnowledge.length > 0
      ? `\nACCUMULATED KNOWLEDGE FROM PAST PROJECTS (human-reviewed and approved - apply only the
entries that are actually relevant to this document; ignore anything that doesn't clearly match):
${approvedKnowledge.map((k) => `- [${k.category}] Se: ${k.trigger} → Então: ${k.knowledge}`).join("\n")}\n`
      : "";

    // The whole point of a per-section reanalysis: this prompt asks for ONLY this one section,
    // with the entire output token budget available to it instead of splitting it 8 ways like the
    // full analysis does - explicitly told to use that room for real thoroughness (every distinct
    // item, not a summarized/collapsed version), and to flag ambiguity rather than guess, matching
    // the rigor already confirmed on a real BOM extraction reviewed this session (precise
    // source_reference per item, no invented values).
    const prompt = `You are running a FOCUSED, SPECIALIST reanalysis of ONE section of a pre-sales tender
analysis: "${sectionConfig.label}" (JSON key: "${section}"). This is NOT the full multi-section
analysis - the entire output budget is available for this one section alone, so take the time to
be exhaustive and precise instead of summarizing or collapsing similar items together. Extract
EVERY distinct item the source material actually supports - do not merge similar-looking items
into one, do not omit an item because it seems redundant with another, and do not invent a value
(quantity, spec, reference) that isn't actually stated - if the source text is ambiguous about
something, say so in the relevant text/notes field rather than guessing.
${knowledgeBaseSection}
PROJECT METADATA:
- Name: ${project.name}
- Customer: ${project.customer_name}
- Vertical: ${project.vertical}
- Description: ${project.description || "N/A"}

REAL EXTRACTED DOCUMENT TEXT:
${combinedExtractedText}

Respond with ONLY a JSON array (no markdown, no extra text) matching this exact shape:
${sectionConfig.shapeHint}`;

    let rawText: string, inputTokens: number, outputTokens: number, billedCostUsd: number | undefined;
    ({ text: rawText, inputTokens, outputTokens, billedCostUsd } = await generateJsonWithProvider(providerResolution.provider as ConnectedProvider, providerResolution.model, prompt, documentFiles));
    const realEstimatedCostUsd = billedCostUsd ?? estimateCostUsd(providerResolution.model, inputTokens, outputTokens);

    const parsedJson = parseAiJson(rawText);
    let validatedSection: any = sectionConfig.schema.parse(parsedJson);

    if (sectionConfig.needsBomEnrichment) {
      await updateTaskProgress(task.id, { currentStep: "Buscando equipamentos reais para o BOM", progressPct: 85 });
      validatedSection = await enrichBomWithWebSearch(validatedSection, platformSettings, project.proposal_language, tenantId, project.ai_orientation_text || "");
    }

    // Same merge-on-save pattern as POST /projects/:projectId/analysis-result (the manual-edit
    // endpoint) - read the existing full row, overwrite only this one field, save the whole thing
    // back. Every other section (and the two proposal drafts) is left exactly as it was.
    await updateTaskProgress(task.id, { currentStep: "Salvando resultado", progressPct: 95 });
    const existing = await dbStore.getAnalysisResult(projectId);
    const updatedLogicVersions = { ...(existing?.logic_versions || {}) };
    if (section === "bom") updatedLogicVersions.bom_enrichment = LOGIC_VERSIONS.bom_enrichment;
    const merged = { ...existing, [section]: validatedSection, project_id: projectId, updated_at: new Date().toISOString(), logic_versions: updatedLogicVersions };
    await dbStore.saveAnalysisResult(merged as AnalysisResult);

    await dbStore.addAuditLog({
      user_id: userId,
      action: "Section Reanalysis (AI)",
      entity_type: "AnalysisResult",
      entity_id: existing?.id || "ar_section_reanalysis",
      project_id: projectId,
      ip_address: "127.0.0.1",
      user_agent: "section-reanalysis",
      metadata: JSON.stringify({ section, provider: providerResolution.provider, model: providerResolution.model }),
    });

    logDebugMessage({
      operation: "Section Reanalysis",
      message: `Successfully reanalyzed section "${section}" for project ${projectId}.`,
      status: "SUCCESS",
      durationMs: Date.now() - startTime,
      correlationId,
      projectId,
    });

    await completeTask(task.id, {
      resultType: "analysis_result",
      resultId: projectId,
      estimatedCostUsd: realEstimatedCostUsd,
      aiProvider: providerResolution.provider,
      intendedProvider: providerResolution.intendedProvider,
      isProviderFallback: providerResolution.isFallback,
    });
    await recordAiUsage({
      tenantId,
      taskType: "document_analysis",
      provider: providerResolution.provider,
      model: providerResolution.model,
      estimatedCostUsd: realEstimatedCostUsd,
      backgroundTaskId: task.id,
    });
  } catch (err: any) {
    logger.error({ err, projectId, section }, "Section reanalysis failed");
    await failTask(task.id, err.message || "Unknown error during section reanalysis");
  }
  });
});

// Looks up a real part number/manufacturer for BOM items the document itself didn't specify
// (sku/part_number left blank by the main analysis, per its own "never invent" instruction).
// Consults the approved Knowledge Base per item FIRST - the document-wide KB pass earlier in the
// analysis (see knowledgeBaseKeywords above) is keyed off the whole document's keywords and can
// miss an item whose own name/category/spec never surfaced there - and only falls back to a real,
// live web search (via the configured web_grounding provider's native search tool) for items the
// KB doesn't confidently cover. Never throws: if the provider isn't configured for web search, the
// API errors, or the response isn't parsable JSON, the original BOM is returned unchanged and the
// failure is only logged - this is an enrichment step, losing it should never fail (or even flag
// as failed) an otherwise-successful analysis.
function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

// Deterministic pass over the model's own brand_policy_applicable/compliant self-report
// (enrichBomWithWebSearch's prompt asks for this per item) - never calls AI itself, no I/O. Groups
// items by a normalized "category" (trim/lowercase - no formal taxonomy, see roadmap discussion)
// and, for groups with enough members (>= MIN_GROUP_SIZE_FOR_CROSSCHECK) where the majority
// already reports non-compliant with the SAME alternate manufacturer, treats that as a signal the
// category is legitimately outside the mandated brand's product line (confidence stays as
// reported, since the model itself already said "not applicable" in that case - most groups never
// even reach this branch) rather than a real violation. Small groups (below the threshold) fall
// back to the model's own self-report as-is, with confidence downgraded to "low" since there's no
// same-BOM evidence to corroborate or contradict it either way.
const MIN_GROUP_SIZE_FOR_CROSSCHECK = 3;
export function computeBrandPolicyCrossCheck<T extends { category?: string; manufacturer?: string; brand_policy_applicable?: boolean | null; brand_policy_compliant?: boolean | null }>(items: T[]): (T & { brand_policy_confidence?: "high" | "medium" | "low" | null })[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = (item.category || "").trim().toLowerCase();
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }

  return items.map((item) => {
    if (item.brand_policy_applicable == null) return item;
    const key = (item.category || "").trim().toLowerCase();
    const group = groups.get(key) || [item];

    if (group.length < MIN_GROUP_SIZE_FOR_CROSSCHECK) {
      return { ...item, brand_policy_confidence: "low" as const };
    }

    const nonCompliant = group.filter((g) => g.brand_policy_applicable && g.brand_policy_compliant === false);
    const majorityNonCompliant = nonCompliant.length > group.length / 2;
    // Same alternate manufacturer across the non-compliant majority - a coincidental single
    // outlier isn't the same signal as a whole category consistently landing on one other brand.
    const alternateManufacturers = new Set(nonCompliant.map((g) => (g.manufacturer || "").trim().toLowerCase()).filter(Boolean));

    if (item.brand_policy_applicable && item.brand_policy_compliant === false && majorityNonCompliant && alternateManufacturers.size === 1) {
      return { ...item, brand_policy_confidence: "high" as const };
    }
    return { ...item, brand_policy_confidence: (item as { brand_policy_confidence?: string }).brand_policy_confidence ?? "medium" };
  });
}

// Mesmo padrão de corroboração estatística determinística (sem IA, dentro do mesmo BOM) de
// computeBrandPolicyCrossCheck acima, mas pra correspondência de equipamento em geral - a única
// validação cruzada que existia antes era exclusiva de política de marca. Sinaliza quando o
// fabricante de um item destoa da maioria dos itens da mesma categoria neste BOM; nunca eleva
// confiança sozinho, só rebaixa (nunca sobrescreve um "high" já vindo do prompt).
const MIN_GROUP_SIZE_FOR_MATCH_CROSSCHECK = 3;
export function computeEquipmentMatchCrossCheck<T extends { category?: string; manufacturer?: string; match_confidence?: "high" | "medium" | "low" | null }>(items: T[]): (T & { manufacturer_outlier?: boolean })[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = (item.category || "").trim().toLowerCase();
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }

  return items.map((item) => {
    const key = (item.category || "").trim().toLowerCase();
    const group = groups.get(key) || [item];
    if (group.length < MIN_GROUP_SIZE_FOR_MATCH_CROSSCHECK || !item.manufacturer?.trim()) {
      return { ...item, manufacturer_outlier: false };
    }

    const manufacturerCounts = new Map<string, number>();
    for (const g of group) {
      const m = (g.manufacturer || "").trim().toLowerCase();
      if (m) manufacturerCounts.set(m, (manufacturerCounts.get(m) || 0) + 1);
    }
    const itemManufacturer = item.manufacturer.trim().toLowerCase();
    const itemCount = manufacturerCounts.get(itemManufacturer) || 0;
    const majorityCount = Math.max(...manufacturerCounts.values());
    // Só marca outlier quando a maioria é de fato maioria (mais da metade do grupo) - evita
    // sinalizar um BOM legitimamente multi-marca (câmeras de um fabricante + switches de outro)
    // como suspeito.
    const isOutlier = itemCount < majorityCount && majorityCount > group.length / 2;
    const downgraded = isOutlier && item.match_confidence === "high" ? "medium" : item.match_confidence;
    return { ...item, manufacturer_outlier: isOutlier, match_confidence: downgraded };
  });
}

async function enrichBomWithWebSearch(bom: any[], platformSettings: any, proposalLanguage: string, tenantId: string, orientationText: string): Promise<any[]> {
  // Only a missing part_number is treated as "needs lookup" here. A part_number already present
  // (e.g. filled from an approved Knowledge Base entry) but missing manufacturer used to also
  // trigger a search - confirmed on a real run that this can find a *different*, unrelated real
  // product's manufacturer for that same part_number (the search has no way to know the number
  // was already meant to be authoritative), silently attaching a wrong manufacturer to an
  // otherwise-correct part_number. Still passing the known part_number in the query below so the
  // manufacturer-only case is a targeted "who makes this exact part number" lookup instead of a
  // generic specification search that can drift to a different product.
  const itemsNeedingLookup = bom.filter((item) => !item.part_number?.trim());
  if (itemsNeedingLookup.length === 0) return bom;

  try {
    // Per-item KB pass: same heuristic keyword match used for the document-wide pass earlier
    // (extractKnowledgeBaseKeywords), scoped this time to just each item's own equipment_name/
    // category/specification, so an item can match approved knowledge even if its terms never
    // made the cut in the whole-document keyword extraction.
    // manufacturer included too (when the base analysis already guessed one, e.g. "Hikvision") -
    // it's an unusually strong signal for this kind of lookup on its own. maxKeywords raised and
    // minLength lowered to 3 vs. the whole-document pass's defaults - see extractKnowledgeBaseKeywords'
    // own comment for why a per-item equipment spec needs both.
    // One searchApprovedKnowledgeBase call PER ITEM (not a single query over the union of every
    // item's keywords) - a shared top-N slice let one item's generic keywords crowd out another
    // item's genuinely relevant candidates (confirmed: a pole-mounted camera's correct KB matches
    // nearly missed the cut once other BOM items' keywords joined the same ranked pool). The KB is
    // small enough (low hundreds of approved entries) for one query per item to be cheap.
    const itemKeywordSets = itemsNeedingLookup.map((item) =>
      extractKnowledgeBaseKeywords(
        [item.equipment_name, item.category, item.specification, item.manufacturer].filter(Boolean).join(" "),
        25,
        3
      )
    );
    const relevantKnowledgeSets = await Promise.all(
      itemKeywordSets.map((itemKeywords) => (itemKeywords.length > 0 ? dbStore.searchApprovedKnowledgeBase(itemKeywords, 30) : []))
    );

    // Some equipment categories exist in both a fixed pole/wall-mounted variant and a portable/
    // vehicle-mounted variant with near-identical specs (PTZ, zoom, IP rating) - keyword relevance
    // ranking alone can't tell them apart, and confirmed in production that instructing the model
    // (see the prompt below) isn't reliable either: it kept picking whichever known_knowledge entry
    // had the most complete-looking spec sheet, not the one actually matching the item's stated
    // installation context, even when the correct one was present in known_knowledge too. Filtering
    // out the context-mismatched candidates here means the model never sees them as a tempting
    // "complete" but wrong alternative in the first place, instead of hoping it rejects them itself.
    const FIXED_INSTALL_TERMS = ["poste", "parede", "mastro"];
    // "embarcad" was here as a bare substring and had to go - "DAI/processamento embarcado" (onboard/
    // edge AI processing) is common phrasing on the FIXED-camera items themselves, and matched the
    // same substring as "veículo embarcado" (vehicle-mounted), silently defeating this whole filter
    // on any item whose own spec happened to mention onboard/edge processing.
    const MOBILE_VEHICLE_TERMS = ["portátil", "portatil", "veicular", "veículo embarcado", "veiculo embarcado", "viatura", "fiscalização móvel", "fiscalizacao movel", "mobile enforcement", "mobile surveillance"];
    const hasAny = (text: string, terms: string[]) => {
      const lower = text.toLowerCase();
      return terms.some((t) => lower.includes(t));
    };
    const isContextMismatch = (itemText: string, candidateText: string) => {
      const itemWantsFixed = hasAny(itemText, FIXED_INSTALL_TERMS);
      const itemWantsMobile = hasAny(itemText, MOBILE_VEHICLE_TERMS);
      const candidateIsFixed = hasAny(candidateText, FIXED_INSTALL_TERMS);
      const candidateIsMobile = hasAny(candidateText, MOBILE_VEHICLE_TERMS);
      if (itemWantsFixed && !itemWantsMobile && candidateIsMobile && !candidateIsFixed) return true;
      if (itemWantsMobile && !itemWantsFixed && candidateIsFixed && !candidateIsMobile) return true;
      return false;
    };

    const providerResolution = await resolveProvider("web_grounding", platformSettings);
    const lookupList = await Promise.all(itemsNeedingLookup.map(async (item, idx) => {
      const itemText = [item.equipment_name, item.specification].filter(Boolean).join(" ");

      // The mismatch check runs per PRODUCT (grouped by source document), not per individual row -
      // a product's mobile/vehicle-mounted nature is often stated in only SOME of its many atomic
      // KB entries (one entry says "câmera portátil...", a sibling entry about just its lens specs
      // doesn't repeat that word) - checking row-by-row let those undisclosed sibling rows slip
      // through untouched (confirmed: several iDS-TCC246/iDS-MCD202 rows without the word
      // "portátil"/"veicular" in their own text survived a per-row version of this same filter).
      // Even grouping just the rows already retrieved AS CANDIDATES for this item isn't enough -
      // the one sibling entry that actually discloses "sistema de fiscalização móvel... viaturas
      // policiais" can describe the whole multi-component system rather than the camera alone, so
      // it may not itself match this item's own camera-specific keywords and never even enters the
      // candidate set. Re-fetching every approved entry for each candidate's source document (a
      // handful of extra rows, not a full extra table scan) gets that product's FULL disclosed
      // context regardless of which of its own entries this item's keywords happened to hit.
      const groups = new Map<string, KnowledgeBaseEntry[]>();
      for (const k of relevantKnowledgeSets[idx]) {
        const key = k.source_document_id ?? `row:${k.id}`;
        const group = groups.get(key);
        if (group) group.push(k);
        else groups.set(key, [k]);
      }
      const documentIds = [...groups.keys()].filter((key) => !key.startsWith("row:"));
      const fullDocumentEntries = documentIds.length > 0 ? await dbStore.getApprovedKnowledgeBaseEntriesByDocument(documentIds) : [];
      const fullContextByDocument = new Map<string, string>();
      for (const entry of fullDocumentEntries) {
        if (!entry.source_document_id) continue;
        const existing = fullContextByDocument.get(entry.source_document_id) ?? "";
        fullContextByDocument.set(entry.source_document_id, `${existing} ${entry.trigger} ${entry.knowledge}`);
      }

      // Capped to the top 12 entries (already ranked by relevance from searchApprovedKnowledgeBase)
      // and each entry's own text truncated - a real run on an 18-item BOM with ~500 approved KB
      // entries built a SINGLE 57k-token request (every item's uncapped known_knowledge, several
      // KB entries deep each) against a provider whose org-level rate limit was 6000 TPM, so the
      // whole batch 429'd and the outer catch below silently discarded the entire enrichment -
      // every item was left with an empty part_number and nothing ever told the user why. Capping
      // here (in addition to the batching below) attacks the actual size driver instead of just
      // the symptom.
      const relevantKnowledge = [...groups.entries()]
        .filter(([key, group]) => {
          const contextText = fullContextByDocument.get(key) ?? group.map((k) => `${k.trigger} ${k.knowledge}`).join(" ");
          return !isContextMismatch(itemText, contextText);
        })
        .flatMap(([, group]) => group)
        .slice(0, 12);

      return {
        item_id: item.item_id,
        equipment_name: item.equipment_name,
        category: item.category,
        specification: item.specification,
        known_part_number: item.part_number?.trim() || null,
        known_knowledge: relevantKnowledge.length > 0
          ? relevantKnowledge.map((k) => `Se: ${truncate(k.trigger, 200)} → Então: ${truncate(k.knowledge, 300)}`)
          : null,
      };
    }));

    const orientationBlock = orientationText.trim()
      ? `MANDATORY PROJECT POLICY (from the project's own registered technical orientation - this is not a suggestion, it is a requirement that overrides an otherwise-plausible match from a different brand): "${orientationText.trim()}". If this names a required manufacturer/brand, every item below MUST be matched to a real product from that manufacturer whenever one exists that satisfies the item's stated specification - do not accept a different manufacturer's product just because it also clears the minimum numeric specs, even if it was the first or most obvious candidate found. Only deviate from the mandated manufacturer if you genuinely cannot find any real product from them that plausibly satisfies this specific item, and if you do deviate, say so explicitly in the item's "note".\n\n`
      : "";
    const promptFor = (chunk: typeof lookupList) => `${orientationBlock}For each item below, first check "known_knowledge" - human-approved internal knowledge from past projects, already vetted by a person. If it clearly states a concrete real manufacturer and/or part number/SKU for this exact item, use that value instead of searching the web, and set "source" to "knowledge_base". known_knowledge entries were retrieved by keyword overlap and can include a product that is technically similar but actually the wrong product line for this item's stated use - e.g. a vehicle-mounted/portable/mobile-enforcement camera is NOT a match for an item that specifies a fixed pole/wall-mounted installation, and vice-versa, even when general specs (PTZ, zoom, IP rating, resolution) look alike. Before accepting a known_knowledge match, check that its stated application/mounting/context actually matches this item's own description; if it doesn't, treat known_knowledge as not applicable for that item and fall back to web search or not_found instead. IMPORTANT: numeric specs in a BOM item (zoom, IR range, resolution, IP/IK rating, etc.) are virtually always MINIMUM requirements from a technical reference document, not exact targets - a candidate that MEETS OR EXCEEDS a stated number (e.g. 48x zoom for an item asking for 30x, IP67 for an item asking for IP66) is a VALID match on that spec, not a mismatch - only reject on a spec if the candidate is BELOW what the item asks for, or if the installation context itself is wrong (see above). CRITICAL: the product you find must match the item's own fundamental equipment type - "equipment_name" is the ultimate authority on what kind of product this line item actually IS (e.g. an item named "Armario tecnico"/technical cabinet is a physical enclosure, never a network switch, camera, or PoE injector - even when its specification text lists one of those as a component that must be bundled INSIDE or WITH it, e.g. a cabinet spec requiring "switch industrial 8 portas" as contents is still asking for the CABINET/ENCLOSURE itself, not the switch; find and return the cabinet/enclosure product, never the accessory component only mentioned as part of its required contents). If you cannot find a real product matching the item's own equipment type specifically (as opposed to one of its bundled accessories), leave sku/part_number/manufacturer empty and set source to "not_found" rather than substituting an accessory's part number for the item's own. If an item's specification states it is a spare, backup, or replacement unit with "the same specification" as another item (e.g. "para reposicao", "mesma especificacao", "backup", "reserva"), apply the EXACT same matching rigor and standards as for any other item - being a spare does NOT license accepting a different manufacturer or a lower-tier product just because it merely meets the minimum numeric specs; a spare described as identical to another camera/equipment item should end up as the same manufacturer and product family as that other item whenever the specification genuinely matches, not a different brand that happens to also clear the numeric bar. known_knowledge can list several different products - evaluate every distinct product mentioned by name before concluding none match; do not stop at the first plausible-looking one, and do not default to a web search just because more than one candidate is present. Only actually search the web for items where known_knowledge is null or doesn't give a confident, context-matching manufacturer/part number, and set "source" to "web_search" for those found that way. If "known_part_number" is set for an item, that part number is already correct/authoritative - only search for (or find in known_knowledge) which real manufacturer makes that exact part number, do not substitute a different product. If neither known_knowledge nor a web search yields a confident real match, leave sku/part_number/manufacturer as empty strings and set "source" to "not_found" rather than guessing. Never use a literal double-quote character (") inside any string value in your JSON response (e.g. inside "note") - it breaks JSON parsing for the entire response; write a quoted term or measurement without quote marks instead (e.g. 3 inch, not 3"). For each item, also self-report on the mandatory brand policy above (if one was given): set "brand_policy_applicable" to false if this item's equipment type is not something the mandated brand actually makes (e.g. a generic cabinet/enclosure, a server, a third-party VMS software license - the mandated camera brand not making that kind of product is a legitimate, correct reason to use a different manufacturer, NOT a policy violation); set it to true otherwise. When true, set "brand_policy_compliant" to whether the manufacturer you actually used matches the mandated brand, and always fill "brand_policy_note" with a one-sentence reason in ${proposalLanguage} either way (why the policy applies or doesn't, and why the match does or doesn't comply). If no brand policy was given above, set "brand_policy_applicable" to false for every item and leave the other two fields empty.

ITEMS TO LOOK UP:
${JSON.stringify(chunk, null, 2)}

For each item, also self-report "match_confidence" for the equipment match itself (independent of the brand policy fields above): "high" if the source (known_knowledge or web search) explicitly and unambiguously names this exact product/part number for this exact use case; "medium" if you're confident about the manufacturer/product family but had to infer the specific part number/variant, or the match required judgment calls on ambiguous specs; "low" if you found a plausible but not clearly confirmed match (e.g. only a category/family match, conflicting information between sources, or a stretch on the "meets or exceeds" spec reasoning). If source is "not_found", set match_confidence to "low".

Respond with ONLY a JSON array (no markdown, no extra text), one object per item_id above, in this exact shape:
[{ "item_id": "...", "sku": "real SKU or empty string", "part_number": "real part number or empty string", "manufacturer": "real manufacturer name or empty string", "source": "knowledge_base" | "web_search" | "not_found", "match_confidence": "high" | "medium" | "low", "note": "one short sentence in ${proposalLanguage} - what you found and its source, or why nothing confident was found", "brand_policy_applicable": true or false, "brand_policy_compliant": true or false, "brand_policy_note": "one short sentence in ${proposalLanguage}" }]`;

    // Sent as one request per chunk (not the whole BOM at once) - see the 57k-token/6000-TPM
    // incident above. Chunk boundaries are picked by a rough token estimate (chars/4) against a
    // conservative budget, so even a tenant on a low-tier rate limit gets SOME items enriched
    // instead of an all-or-nothing failure, and processed sequentially (not Promise.all) since a
    // TPM limit is shared across concurrent requests too.
    const CHUNK_TOKEN_BUDGET = 3000;
    const estimateTokens = (value: unknown) => Math.ceil(JSON.stringify(value).length / 4);
    const chunks: (typeof lookupList)[] = [];
    let current: typeof lookupList = [];
    let currentTokens = 0;
    for (const entry of lookupList) {
      const entryTokens = estimateTokens(entry);
      if (current.length > 0 && currentTokens + entryTokens > CHUNK_TOKEN_BUDGET) {
        chunks.push(current);
        current = [];
        currentTokens = 0;
      }
      current.push(entry);
      currentTokens += entryTokens;
    }
    if (current.length > 0) chunks.push(current);

    const resultsByItemId = new Map<string, { item_id: string; sku: string; part_number: string; manufacturer: string; source?: string; match_confidence?: "high" | "medium" | "low"; note: string; brand_policy_applicable?: boolean; brand_policy_compliant?: boolean; brand_policy_note?: string }>();
    for (const chunk of chunks) {
      // One retry on an actual rate-limit error, after a delay long enough to clear a per-minute
      // window - anything else (a real parsing/auth/network failure) fails this chunk immediately,
      // same fail-soft behavior as before, just scoped to one chunk instead of the whole BOM.
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const { text, inputTokens, outputTokens, billedCostUsd } = await searchWebWithProvider(providerResolution.provider as ConnectedProvider, providerResolution.model, promptFor(chunk));
          await recordAiUsage({
            tenantId,
            taskType: "bom_web_search",
            provider: providerResolution.provider,
            model: providerResolution.model,
            estimatedCostUsd: billedCostUsd ?? estimateCostUsd(providerResolution.model, inputTokens, outputTokens),
          });
          // The model prefaces the JSON with explanatory prose that can itself contain stray
          // "[...]" (e.g. citing "[16:9]" resolution), and a web-search-grounded model (gpt-5-search-api)
          // also APPENDS a trailing citation/source list after the real array (e.g. "[camcentral.com]",
          // "[hikvision.com]") - so neither "first [" nor "last [" is a safe anchor. Anchor on "[{"
          // instead (the real array is always an array of objects, never of bare citation strings),
          // then walk forward counting bracket/brace depth (skipping the contents of quoted strings)
          // until it returns to zero, to get exactly the real array and nothing appended after it.
          const fenceMatch = text.match(/```json\s*([\s\S]*?)```/);
          const source = fenceMatch ? fenceMatch[1] : text;
          const arrayStart = source.search(/\[\s*\{/);
          if (arrayStart === -1) throw new Error("Web search response did not contain a JSON array of objects");
          let depth = 0;
          let inString = false;
          let escaped = false;
          let arrayEnd = -1;
          for (let i = arrayStart; i < source.length; i++) {
            const ch = source[i];
            if (inString) {
              if (escaped) escaped = false;
              else if (ch === "\\") escaped = true;
              else if (ch === '"') inString = false;
              continue;
            }
            if (ch === '"') { inString = true; continue; }
            if (ch === "[" || ch === "{") depth++;
            else if (ch === "]" || ch === "}") {
              depth--;
              if (depth === 0) { arrayEnd = i; break; }
            }
          }
          if (arrayEnd === -1) throw new Error("Web search response JSON array was not properly closed");
          const rawJsonText = source.slice(arrayStart, arrayEnd + 1).trim();
          let chunkResults: Array<{ item_id: string; sku: string; part_number: string; manufacturer: string; source?: string; match_confidence?: "high" | "medium" | "low"; note: string; brand_policy_applicable?: boolean; brand_policy_compliant?: boolean; brand_policy_note?: string }>;
          try {
            chunkResults = JSON.parse(rawJsonText);
          } catch (firstParseErr) {
            // Trailing-comma repair (same technique as parseAiJson elsewhere in this file) - a
            // distinct malformation from the citation-bracket issue the scanner above already
            // handles, worth one cheap local repair attempt before falling through to a full retry.
            chunkResults = JSON.parse(rawJsonText.replace(/,(\s*[}\]])/g, "$1"));
          }
          for (const r of chunkResults) resultsByItemId.set(r.item_id, r);
          break;
        } catch (chunkErr: any) {
          const isRateLimit = chunkErr?.status === 429 || /rate.?limit|429/i.test(String(chunkErr?.message || ""));
          // A malformed-JSON response (e.g. the model emitting a literal unescaped quote inside a
          // string value - confirmed on a real chunk: "Expected ',' or '}' after property value")
          // is not deterministic - a second attempt at the exact same prompt often comes back
          // clean, same reasoning as the existing rate-limit retry, just a different trigger.
          const isParseError = chunkErr instanceof SyntaxError;
          if ((isRateLimit || isParseError) && attempt === 0) {
            logger.warn({ err: chunkErr, tenantId, chunkSize: chunk.length, reason: isRateLimit ? "rate_limit" : "malformed_json" }, "BOM web search chunk failed, retrying once");
            if (isRateLimit) await new Promise((resolve) => setTimeout(resolve, 20000));
            continue;
          }
          logger.warn({ err: chunkErr, tenantId, chunkSize: chunk.length }, "BOM web search chunk failed, leaving its items unenriched");
          break;
        }
      }
    }

    const enrichedItems = bom.map((item) => {
      const found = resultsByItemId.get(item.item_id);
      if (!found) return item;
      const brandPolicyFields = {
        brand_policy_applicable: found.brand_policy_applicable ?? null,
        brand_policy_compliant: found.brand_policy_applicable ? (found.brand_policy_compliant ?? null) : null,
        brand_policy_note: found.brand_policy_note ?? null,
      };
      // Auto-reportado pelo mesmo prompt/chamada que já roda acima - sem custo de IA adicional,
      // mesma ideia do brand_policy_confidence, mas sobre a correspondência do equipamento em si
      // (não existia nenhum sinal de confiança pra isso antes, só as flags binárias de origem).
      const matchConfidence = found.match_confidence ?? null;
      if (!found.part_number?.trim() && !found.manufacturer?.trim()) {
        return { ...item, ...brandPolicyFields, match_confidence: matchConfidence ?? "low" };
      }
      const fromKnowledgeBase = found.source === "knowledge_base";
      return {
        ...item,
        ...brandPolicyFields,
        match_confidence: matchConfidence,
        sku: item.sku?.trim() || found.sku || item.sku,
        part_number: item.part_number?.trim() || found.part_number || item.part_number,
        // manufacturer is DIFFERENT from sku/part_number above: an item only enters
        // itemsNeedingLookup because its part_number was empty, but its manufacturer field can
        // already be pre-filled with a GUESS from the original document_analysis pass (e.g.
        // inferred from a nearby item's brand) even while part_number stayed empty - confirmed on
        // a real BOM where a spare camera kept a stale "Hikvision" guess even after the web search
        // confirmed the real product was made by LILIN, and a main camera kept "Hikvision" even
        // after the real match was an i-PRO model. Once a search actually confirms a real product
        // (found.manufacturer is non-empty - the not_found case leaves it empty per the prompt),
        // that confirmed manufacturer is authoritative and must win over the earlier guess -
        // "existing wins if non-empty" was backwards specifically for this field.
        manufacturer: found.manufacturer?.trim() || item.manufacturer,
        specification: found.note ? `${item.specification} (${found.note})` : item.specification,
        sourced_via_knowledge_base: fromKnowledgeBase,
        sourced_via_web_search: !fromKnowledgeBase,
      };
    });
    return computeEquipmentMatchCrossCheck(computeBrandPolicyCrossCheck(enrichedItems));
  } catch (err: any) {
    logger.warn({ err, tenantId }, "BOM web search enrichment failed, keeping original BOM");
    return bom;
  }
}

// TRIGGER AI analysis using Gemini with real extracted content
router.post("/projects/:projectId/analyze", requirePermission("analysis:run"), async (req: Request, res: Response, next: NextFunction) => {
  const correlationId = (req.headers["x-correlation-id"] as string) || "corr-ai";
  const startTime = Date.now();
  const projectId = req.params.projectId;

  // AsyncLocalStorage context set by requireAuth's middleware isn't reliably reaching route
  // handlers on this server (confirmed on the document upload route) - rebuilt directly from the
  // tenant id requireAuth also stashes on the request headers, a plain object property not
  // dependent on any async-context propagation. Captured now so it's available for the whole
  // detached background block below.
  const tenantId = req.headers["x-tenant-id"] as string;
  const tenantContext = { tenantId };

  // Everything through the 202 response was previously outside any try/catch - a failure in any
  // of these setup steps (DB error, provider resolution, etc.) threw as an unhandled rejection
  // that bypassed Express's error middleware entirely, leaving the client's request hanging with
  // no response ever sent instead of a clean error.
  let project, platformSettings, providerResolution, userId, job, task, analysisInstructions;
  try {
    project = await dbStore.getProject(projectId);
    if (!project) {
      return res.status(404).json({ success: false, message: "Project not found." });
    }

    platformSettings = await dbStore.getSettings();
    providerResolution = await resolveProvider("document_analysis", platformSettings);

    // Phase 5 (AI orchestrator): the monthly cap is a real block, not just a number on a
    // dashboard - checked before any AI-calling task starts, not just tracked after the fact.
    const costCap = await checkCostCap(tenantId, platformSettings.monthly_cost_cap_usd ?? null);
    if (costCap.blocked) {
      return res.status(402).json({
        success: false,
        message: `Monthly AI cost cap reached ($${costCap.currentSpendUsd.toFixed(2)} of $${costCap.capUsd?.toFixed(2)}). Analysis blocked until next month or the cap is raised in Admin > AI, Prompts e Custos.`
      });
    }

    // 1. Create Background AI Analysis Job and log it
    userId = requireUserId(req);
    const user = await dbStore.getUserById(userId);
    const userName = user ? user.name : "System User";

    if (providerResolution.isFallback) {
      await recordProviderFallback({
        tenantId,
        taskType: "document_analysis",
        intendedProvider: providerResolution.intendedProvider,
        userId,
      });
    }

    // Fetched here (not just inside the detached block below) so the job record's
    // prompt_template_version reflects which version was really active for this run, instead of a
    // hardcoded placeholder - this is the historical audit trail admins rely on to know which
    // prompt text actually produced a given analysis.
    const analysisPromptRow = await prisma.promptTemplate.findFirst({ where: { type: "analysis", isActive: true } });
    analysisInstructions = analysisPromptRow?.content?.trim() || FACTORY_DEFAULT_ANALYSIS_PROMPT;

    job = await dbStore.createJob({
      project_id: projectId,
      status: "running",
      ai_provider: providerResolution.provider,
      ai_model: providerResolution.model,
      prompt_template_version: analysisPromptRow?.version || "factory-default",
      started_at: new Date().toISOString(),
      created_by: userName,
      correlation_id: correlationId
    });

    await dbStore.addAuditLog({
      user_id: userName,
      action: "Trigger AI Document Analysis",
      entity_type: "AIAnalysisJob",
      entity_id: job.id,
      project_id: projectId,
      ip_address: req.ip || "127.0.0.1",
      user_agent: req.headers["user-agent"] || "unknown",
      metadata: JSON.stringify({ ai_model: job.ai_model, prompt_template: job.prompt_template_version })
    });

    // Analysis runs in the background from here - respond immediately with the task id and
    // let the frontend watch progress over the Phase 1 SSE stream instead of holding the
    // request open for the whole Gemini call.
    task = await createTask({ userId, type: "document_analysis", currentStep: "Iniciando análise...", resultId: projectId });
    res.status(202).json({ success: true, task_id: task.id, job_id: job.id });
  } catch (err) {
    return next(err);
  }

  // Everything from here runs detached from the request/response cycle - re-enter the tenant
  // context captured at the top of this handler for the whole background block.
  void runWithTenant(tenantContext, async () => {
  try {
    await updateTaskProgress(task.id, { status: "running", currentStep: "Lendo documentos", progressPct: 15 });

    // 2. Fetch all project documents and retrieve their real extracted text
    const docs = await dbStore.getDocuments(projectId);

    // PDFs and images are sent as real file binaries to the AI's native vision/OCR instead of
    // pre-extracted text - some real-world PDFs (scanned documents, or ones using a font encoding
    // with no ToUnicode map) have no text any local extractor can ever recover, confirmed on a
    // real government tender document that even Poppler's pdftotext (the market-standard tool)
    // couldn't read. Other formats (txt/csv/docx/xlsx) keep using the already-reliable local
    // extraction.
    const VISION_MIME_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);
    let combinedExtractedText = "";
    const documentFiles: ProviderFileInput[] = [];
    const platformSettingsForDocs = await dbStore.getSettings();
    const storageAdapterForDocs = createStorageAdapter(platformSettingsForDocs);

    for (let idx = 0; idx < docs.length; idx++) {
      const doc = docs[idx];
      if (VISION_MIME_TYPES.has(doc.mime_type)) {
        try {
          const buffer = await storageAdapterForDocs.readFile(doc.storage_path);
          documentFiles.push({ mimeType: doc.mime_type, base64Data: buffer.toString("base64") });
          combinedExtractedText += `\n--- DOCUMENT ${idx + 1}: ${doc.filename} (${doc.detected_document_type}) - sent as a real file below, read it directly ---\n`;
        } catch (err) {
          req.log?.error({ err, documentId: doc.id, filename: doc.filename }, "Failed to read document file for vision analysis");
        }
        continue;
      }

      const text = await dbStore.getDocumentContent(doc.id);
      if (text) {
        combinedExtractedText += `\n--- START DOCUMENT ${idx + 1}: ${doc.filename} (${doc.detected_document_type}) ---\n`;
        combinedExtractedText += text.substring(0, 10000); // Send first 10,000 characters per document to avoid token overflow in basic tier
        combinedExtractedText += `\n--- END DOCUMENT ${idx + 1} ---\n`;
      }
    }

    if (!combinedExtractedText) {
      combinedExtractedText = "No document text was extracted. Standard project description fallback is used.";
    }

    await updateTaskProgress(task.id, { currentStep: "Analisando com IA", progressPct: 40 });

    // analysisPromptRow/analysisInstructions were already fetched above (before creating the job,
    // so its prompt_template_version reflects reality) - reused here via closure instead of
    // querying again.

    // Human-approved corrections/reference knowledge from past projects (Base de Conhecimento -
    // see server/routes/knowledgeBase.ts) - only ever entries a person has explicitly reviewed
    // and approved, never a raw/unreviewed AI suggestion. The approved set has already grown past
    // a hundred entries in real use, so handing the model every single one (the original approach)
    // was starting to blow the prompt's context budget on mostly-irrelevant entries. Instead,
    // extract candidate keywords from the project metadata and whatever document text was locally
    // extracted, and only pull entries whose trigger/knowledge actually mention one of them - still
    // a heuristic (no vector/embedding search infra here), but bounded and targeted instead of
    // unconditional.
    const knowledgeBaseKeywords = extractKnowledgeBaseKeywords(
      [project.name, project.customer_name, project.vertical, project.description, project.ai_orientation_text, combinedExtractedText]
        .filter(Boolean)
        .join(" ")
    );
    const approvedKnowledge = await dbStore.searchApprovedKnowledgeBase(knowledgeBaseKeywords);
    logDebugMessage({
      operation: "Knowledge Base Retrieval",
      message: `Extracted ${knowledgeBaseKeywords.length} keywords (${knowledgeBaseKeywords.slice(0, 10).join(", ")}${knowledgeBaseKeywords.length > 10 ? ", ..." : ""}); matched ${approvedKnowledge.length} approved entries for the analysis prompt.`,
      status: "INFO",
      durationMs: Date.now() - startTime,
      correlationId,
      projectId
    });
    const knowledgeBaseSection = approvedKnowledge.length > 0
      ? `\nACCUMULATED KNOWLEDGE FROM PAST PROJECTS (human-reviewed and approved - apply only the
entries that are actually relevant to this document; ignore anything that doesn't clearly match):
${approvedKnowledge.map((k) => `- [${k.category}] Se: ${k.trigger} → Então: ${k.knowledge}`).join("\n")}\n`
      : "";

    const prompt = `${analysisInstructions}
Analyze the following project description and real extracted document texts:

PROJECT METADATA:
- Name: ${project.name}
- Customer: ${project.customer_name}
- Vertical: ${project.vertical}
- Tech Orientation Mode: ${project.ai_orientation_mode}
- Technical Guidelines: ${project.ai_orientation_text || "None provided"}
- Target Language: ${project.proposal_language}
${knowledgeBaseSection}
REAL EXTRACTED DOCUMENT TEXTS:
${combinedExtractedText}

Perform a rigorous pre-sales extraction.
CRITICAL: every free-text value you write in the JSON below - not just the two draft fields at the
end - MUST be written in ${project.proposal_language}. The field NAMES (keys) stay in English
exactly as shown; only the free-text VALUES you generate change language. Do not default to
English for free text.
EXCEPTION - enum/fixed-value fields: some fields only accept one of a small fixed set of English
words shown in that field's own instruction below (e.g. category, priority, severity,
mandatory_or_optional, compliance_status, compliance, evidence_type, risk_level). These are
internal codes, not prose - always return them exactly as one of the listed English options,
never translated, never invented.
You MUST respond with a strictly parsable JSON object. No markdown, no formatting blocks, only valid JSON matching this schema:
{
  "executive_summary": {
    "project_overview": "A concise summary of the bid's core scope",
    "customer_context": "The strategic motivation, key stakeholders, and procurement parameters",
    "main_requirements": "High-level technical and operational deliverables required",
    "main_risks": "Top commercial, technical, and SLA risks",
    "main_opportunities": "Value-add upsell options, premium SLAs, and software upgrades",
    "recommended_strategy": "The pre-sales positioning and architectural direction to secure the win",
    "assumptions": "Underlying technological or civil engineering assumptions",
    "next_steps": "Critical engineering actions for pre-sales"
  },
  "critical_requirements": [
    {
      "requirement_id": "req_1",
      "category": "technical",
      "description": "Requirement description",
      "source_document": "Document filename or source",
      "source_page_or_section": "Section number",
      "source_snippet": "Actual quote snippet",
      "priority": "high",
      "mandatory_or_optional": "mandatory",
      "compliance_status": "compliant",
      "evidence_type": "directly_supported",
      "confidence": 0.95,
      "notes": "Pre-sales design notes"
    }
  ],
  "risks": [
    {
      "risk_id": "risk_1",
      "title": "Risk title",
      "description": "Detailed explanation of risk",
      "severity": "high",
      "probability": "medium",
      "impact": "Concrete impact",
      "source_document": "Source filename",
      "source_page_or_section": "Section info",
      "source_snippet": "Quote snippet",
      "mitigation": "Technical or legal mitigation steps",
      "owner_area": "Legal, Delivery, or Engineering",
      "requires_customer_clarification": true,
      "evidence_type": "directly_supported",
      "confidence": 0.90
    }
  ],
  "opportunities": [
    {
      "opportunity_id": "opp_1",
      "title": "Opportunity title",
      "description": "Value expansion explanation",
      "business_value": "ROI or margin justification",
      "source_document": "Filename",
      "source_page_or_section": "Section info",
      "suggested_solution": "Recommended product, upgrade, or support package",
      "sales_strategy": "SLA packaging",
      "priority": "medium",
      "evidence_type": "inferred_from_documents",
      "confidence": 0.85
    }
  ],
  "bom": [
    {
      "item_id": "bom_1",
      "sku": "Internal SKU code if the document provides one, otherwise a short stable code you generate from the equipment name",
      "part_number": "Manufacturer part number exactly as written in the source document - never invent one, leave empty string if not stated",
      "equipment_name": "Real equipment/material name as required by the document (e.g. 'Switch PoE 24 portas Gigabit')",
      "manufacturer": "Manufacturer name if the document states or implies a standard (e.g. via a referenced norm/certification), otherwise empty string - never invent a brand",
      "quantity": 5,
      "unit": "un",
      "category": "Hardware, Software, Serviço, Licença, etc.",
      "specification": "Real technical specification/requirement for this item exactly as demanded by the source document (throughput, protocol, certification, dimensions, etc.), aligned with Tech Orientation: ${project.ai_orientation_text}",
      "source_reference": "Section/page/item number in the source document this line item came from"
    }
  ],
  "point_to_point_table": [
    /* One object per TECHNICAL DISCIPLINE actually present in the source document (e.g. CFTV,
       Rede, Controle de Acesso, Elétrica, Automação, Civil, Telecom - in Portuguese, whatever
       fits what you actually find, do not force disciplines that aren't there and do not merge
       unrelated disciplines into one). A document that only covers CFTV produces exactly one
       object here; a document covering CFTV and network infrastructure produces two.
       For EACH discipline, design the columns that make sense for THAT discipline's point-to-point
       technical connectivity - who connects to whom, over what, carrying what data, who's
       responsible, what's the acceptance criteria. Reference ideas (pick and adapt what fits,
       don't dump all of these into every discipline): ID do ponto, origem, destino, tipo de
       ponto, equipamento de origem/destino, localização física, endereço lógico, meio de
       comunicação, protocolo/interface, portas utilizadas, sentido da comunicação, tipo/formato
       do dado trafegado, frequência de envio, requisitos de desempenho/rede/elétricos/instalação,
       dependências, responsável pela origem/destino, prioridade, criticidade operacional, risco
       técnico, critério de aceite. A CFTV discipline's columns will look different from a Rede
       discipline's, which will look different from an Elétrica discipline's - that's expected.
       Every row must use the exact same "key" values declared in that table's own "columns" array.
       Leave a cell blank/null rather than inventing a value the document doesn't support. */
    {
      "discipline": "CFTV",
      "columns": [
        { "key": "id_ponto", "label": "ID do Ponto" },
        { "key": "camera", "label": "Câmera / Equipamento" },
        { "key": "resolucao", "label": "Resolução" },
        { "key": "protocolo", "label": "Protocolo" },
        { "key": "localizacao", "label": "Localização" },
        { "key": "responsavel", "label": "Responsável" },
        { "key": "status", "label": "Status" },
        { "key": "criterio_aceite", "label": "Critério de Aceite" }
      ],
      "rows": [
        { "id_ponto": "P2P-001", "camera": "Câmera IP 4MP bullet, área externa", "resolucao": "4MP", "protocolo": "ONVIF Profile S / RTSP", "localizacao": "Seção 3.1", "responsavel": null, "status": "não iniciado", "criterio_aceite": "Imagem nítida a 30m no período noturno" }
      ]
    }
  ],
  "preliminary_schedule": [
    {
      "phase_id": "ph_1",
      "phase_name": "Site Survey & Design Phase",
      "activities": ["Topographical mapping", "RF survey"],
      "estimated_duration": "3 weeks",
      "dependencies": ["Site access permit"],
      "responsible_area": "Field Engineering Team",
      "assumptions": "Clear weather conditions",
      "risks": "Permit delays"
    }
  ],
  "clarification_questions": [
    {
      "question_id": "q_1",
      "question": "A technical, specific question grounded in the actual document - name the exact item/section/parameter in question, not a vague topic. Never write a generic question a pre-sales engineer could ask about any project regardless of the source document.",
      "reason": "Why this specific answer is needed - what engineering/commercial decision depends on it (e.g. which transceiver to spec, which compliance box to check, which BOM quantity to commit to).",
      "source_reference": "Exact section/page/clause of the source document this question refers to - never leave this empty if the question references a document requirement.",
      "related_requirement_or_risk": "req_1",
      "priority": "high",
      "target_audience": "Customer Tech Board"
    }
  ],
  "technical_proposal_draft": "<h1>TECHNICAL PROPOSAL</h1><p>Draft detailed technical solution alignment text in ${project.proposal_language} following orientation.</p>",
  "commercial_proposal_draft": "<h1>COMMERCIAL FRAMEWORK</h1><p>Draft commercial proposal framework with payment stages in ${project.proposal_language}.</p>"
}

Write all generated content fields strictly in ${project.proposal_language}. Maintain an expert, formal pre-sales engineering tone.
`;

    // The AI call itself is a single request that can take several minutes on a large real
    // document (vision-based reading + a big output budget) with no real sub-progress to report -
    // stuck at a flat 40% the whole time reads as "frozen" to the user. Simulate gradual movement
    // up to a ceiling while waiting, so there's visible motion even though it isn't measuring
    // anything real; jumps to 85% the moment the actual response comes back.
    let simulatedProgress = 40;
    const progressTicker = setInterval(() => {
      simulatedProgress = Math.min(simulatedProgress + 2, 78);
      updateTaskProgress(task.id, { currentStep: "Analisando com IA", progressPct: simulatedProgress }).catch(() => {});
    }, 10000);

    let rawText: string, inputTokens: number, outputTokens: number, billedCostUsd: number | undefined;
    try {
      ({ text: rawText, inputTokens, outputTokens, billedCostUsd } = await generateJsonWithProvider(providerResolution.provider as ConnectedProvider, providerResolution.model, prompt, documentFiles));
    } finally {
      clearInterval(progressTicker);
    }
    const realEstimatedCostUsd = billedCostUsd ?? estimateCostUsd(providerResolution.model, inputTokens, outputTokens);

    // 3. Add Structured Output Validation using Zod
    // Every provider is explicitly told to respond with raw JSON only, but Claude in particular
    // still sometimes wraps it in a markdown code fence anyway - strip it defensively rather than
    // fail the whole analysis over formatting. parseAiJson also tolerates a trailing comma before
    // a closing brace/bracket (see its own comment) - the other formatting slip seen in practice.
    const parsedJson = parseAiJson(rawText);
    const validatedJson = AnalysisResultSchema.parse(parsedJson);

    // 4. Look up real part numbers/manufacturers for any BOM item the document itself didn't
    // specify - a real web search (see enrichBomWithWebSearch), not the model guessing. Failure
    // here never fails the analysis - see that function's own error handling.
    await updateTaskProgress(task.id, { currentStep: "Buscando equipamentos reais para o BOM", progressPct: 88 });
    const enrichedBom = await enrichBomWithWebSearch(validatedJson.bom, platformSettings, project.proposal_language, tenantId, project.ai_orientation_text || "");

    // Save final Analysis Result
    const analysisResult: AnalysisResult = {
      id: randomId("ar"),
      project_id: projectId,
      job_id: job.id,
      executive_summary: validatedJson.executive_summary,
      critical_requirements: validatedJson.critical_requirements as any,
      risks: validatedJson.risks as any,
      opportunities: validatedJson.opportunities as any,
      bom: enrichedBom as any,
      point_to_point_table: validatedJson.point_to_point_table as any,
      preliminary_schedule: validatedJson.preliminary_schedule as any,
      clarification_questions: validatedJson.clarification_questions as any,
      technical_proposal_draft: validatedJson.technical_proposal_draft,
      commercial_proposal_draft: validatedJson.commercial_proposal_draft,
      review_status: "pending",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      // Staleness signal (src/aiLogicVersions.ts) - a full analysis regenerates both the
      // document-extraction and the BOM-enrichment output, so both keys are set fresh here.
      logic_versions: { document_analysis: LOGIC_VERSIONS.document_analysis, bom_enrichment: LOGIC_VERSIONS.bom_enrichment }
    };

    await updateTaskProgress(task.id, { currentStep: "Salvando resultado", progressPct: 95 });
    await dbStore.saveAnalysisResult(analysisResult);

    // Update job to completed
    await dbStore.updateJob(job.id, {
      status: "completed",
      completed_at: new Date().toISOString(),
      token_input: inputTokens,
      token_output: outputTokens,
      estimated_cost: realEstimatedCostUsd
    });

    logDebugMessage({
      operation: "AI Analysis",
      message: `Successfully analyzed documents and saved validated pre-sales model.`,
      status: "SUCCESS",
      durationMs: Date.now() - startTime,
      correlationId,
      projectId
    });

    await completeTask(task.id, {
      resultType: "analysis_result",
      resultId: projectId,
      estimatedCostUsd: realEstimatedCostUsd,
      aiProvider: providerResolution.provider,
      intendedProvider: providerResolution.intendedProvider,
      isProviderFallback: providerResolution.isFallback,
    });
    await recordAiUsage({
      tenantId,
      taskType: "document_analysis",
      provider: providerResolution.provider,
      model: providerResolution.model,
      estimatedCostUsd: realEstimatedCostUsd,
      backgroundTaskId: task.id,
    });

  } catch (err: any) {
    // 4. Proper error handling. No mock fallback silently marked as complete.
    await dbStore.updateJob(job.id, {
      status: "failed", // Real failed status, no silent mock completed status!
      completed_at: new Date().toISOString(),
      error_message: err.message || "Unknown error during AI synthesis"
    });

    logDebugMessage({
      operation: "AI Analysis Failure",
      message: `AI Analysis failed: ${err.message}`,
      status: "ERROR",
      durationMs: Date.now() - startTime,
      correlationId,
      projectId,
      error: err
    });

    await failTask(task.id, err.message || "Unknown error during AI synthesis");
  }
  });
});

// GET persistent job history
router.get("/projects/:projectId/jobs", requirePermission("analysis:read"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const jobs = await dbStore.getJobs();
    res.json(jobs.filter(j => j.project_id === req.params.projectId));
  } catch (err) {
    next(err);
  }
});

// GET persisted specification chat history for a project
router.get("/projects/:projectId/chat", requirePermission("analysis:read"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const history = await dbStore.getConversationHistory(req.params.projectId);
    res.json(history.map(m => ({ role: m.role, message: m.message })));
  } catch (err) {
    next(err);
  }
});

// POST a question to the real Gemini-backed specification copilot chat
router.post("/projects/:projectId/chat", requirePermission("analysis:read"), async (req: Request, res: Response, next: NextFunction) => {
  const projectId = req.params.projectId;
  const userMessage = String(req.body?.message || "").trim();

  try {
    if (!userMessage) {
      return res.status(400).json({ success: false, message: "Message is required." });
    }

    const project = await dbStore.getProject(projectId);
    if (!project) {
      return res.status(404).json({ success: false, message: "Project not found." });
    }

    const analysis = await dbStore.getAnalysisResult(projectId);
    const docs = await dbStore.getDocuments(projectId);
    const platformSettings = await dbStore.getSettings();

    // Same vision fallback as the main analysis pipeline (see the /analyze route above) - a
    // scanned PDF or one with no ToUnicode map has no text any local extractor can recover, so
    // the copilot was silently unable to answer questions about it, always saying the material
    // "isn't covered" even when the document genuinely has the answer. Sending the real file
    // lets the model's own vision/OCR read it directly instead.
    const VISION_MIME_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);
    const storageAdapterForDocs = createStorageAdapter(platformSettings);
    let combinedExtractedText = "";
    const documentFiles: ProviderFileInput[] = [];
    for (const doc of docs) {
      if (VISION_MIME_TYPES.has(doc.mime_type)) {
        try {
          const buffer = await storageAdapterForDocs.readFile(doc.storage_path);
          documentFiles.push({ mimeType: doc.mime_type, base64Data: buffer.toString("base64") });
          combinedExtractedText += `\n--- ${doc.filename} - sent as a real file below, read it directly ---\n`;
        } catch (err) {
          req.log?.error({ err, documentId: doc.id, filename: doc.filename }, "Failed to read document file for vision chat");
        }
        continue;
      }
      const text = await dbStore.getDocumentContent(doc.id);
      if (text) {
        combinedExtractedText += `\n--- ${doc.filename} ---\n${text.substring(0, 6000)}\n`;
      }
    }

    const providerResolution = await resolveProvider("spec_copilot", platformSettings);

    // Previously uncapped and uncounted - this is a real synchronous AI call like any other, not
    // exempt from the monthly cost cap just because it isn't a background task.
    const tenantId = req.headers["x-tenant-id"] as string;
    const costCap = await checkCostCap(tenantId, platformSettings.monthly_cost_cap_usd ?? null);
    if (costCap.blocked) {
      return res.status(402).json({
        success: false,
        message: `Monthly AI cost cap reached ($${costCap.currentSpendUsd.toFixed(2)} of $${costCap.capUsd?.toFixed(2)}). Copilot is blocked until next month or the cap is raised in Admin > AI, Prompts e Custos.`
      });
    }

    const prompt = `You are a Pre-Sales Solution Architect copilot answering a colleague's question about a specific bid.
CRITICAL: this project is ONLY the one named below - never reference, compare against, or pull in
information from any other project. Answer in ${project.proposal_language}.

PROJECT: ${project.name} (${project.customer_name}, ${project.vertical})

EXTRACTED DOCUMENT TEXT:
${combinedExtractedText || "No document text extracted yet."}

STRUCTURED ANALYSIS RESULT (JSON, may be empty if analysis hasn't run yet):
${analysis ? JSON.stringify({
  executive_summary: analysis.executive_summary,
  critical_requirements: analysis.critical_requirements,
  risks: analysis.risks,
  bom: analysis.bom
}) : "null"}

QUESTION: ${userMessage}

Answer concisely and specifically, citing the source document/section when the answer comes from the
extracted text or analysis above. If the answer isn't covered by the material provided, say so plainly
instead of inventing information.`;

    const { text: answer, inputTokens, outputTokens, billedCostUsd } = await generateTextWithProvider(providerResolution.provider as ConnectedProvider, providerResolution.model, prompt, documentFiles);

    const userId = requireUserId(req);

    await dbStore.addConversationMessage({
      project_id: projectId,
      user_id: userId,
      role: "user",
      message: userMessage,
      ai_provider: providerResolution.provider,
      ai_model: providerResolution.model,
      prompt_template_version: "chat-v1",
      input_summary: userMessage.slice(0, 200),
      output_summary: "",
      token_input: inputTokens,
      token_output: 0
    });

    await dbStore.addConversationMessage({
      project_id: projectId,
      user_id: userId,
      role: "model",
      message: answer || "Nenhuma resposta gerada.",
      ai_provider: providerResolution.provider,
      ai_model: providerResolution.model,
      prompt_template_version: "chat-v1",
      input_summary: userMessage.slice(0, 200),
      output_summary: (answer || "").slice(0, 200),
      token_input: 0,
      token_output: outputTokens
    });

    await recordAiUsage({
      tenantId,
      taskType: "spec_copilot_chat",
      provider: providerResolution.provider,
      model: providerResolution.model,
      estimatedCostUsd: billedCostUsd ?? estimateCostUsd(providerResolution.model, inputTokens, outputTokens),
    });

    res.json({ success: true, answer: answer || "Nenhuma resposta gerada.", provider: providerResolution.provider });
  } catch (err: any) {
    req.log?.error({ err, projectId }, "Chat copilot request failed");
    res.status(500).json({ success: false, message: `AI provider execution failed: ${err.message}` });
  }
});

const PRIORITY_LABEL: Record<string, string> = { high: "Alta", medium: "Média", low: "Baixa" };

// Exports the clarification questions as a real .docx (buildDocxBuffer already generates valid
// OOXML from plain text, no template file needed - same helper the proposal export uses) so the
// pre-sales engineer can send it straight to the customer for answers.
router.get("/projects/:projectId/clarification-questions/export", requirePermission("analysis:read"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const project = await dbStore.getProject(req.params.projectId);
    if (!project) return res.status(404).json({ success: false, message: "Project not found." });

    const analysis = await dbStore.getAnalysisResult(req.params.projectId);
    const questions = analysis?.clarification_questions || [];

    const lines: string[] = [
      `Perguntas de Esclarecimento Técnico`,
      `Projeto: ${project.name}`,
      `Cliente: ${project.customer_name}`,
      `Data: ${new Date().toLocaleDateString("pt-BR")}`,
      "",
      "",
    ];

    questions.forEach((q, idx) => {
      lines.push(`${idx + 1}. ${q.question}`);
      lines.push(`Motivo: ${q.reason}`);
      if (q.source_reference) lines.push(`Referência no documento: ${q.source_reference}`);
      lines.push(`Prioridade: ${PRIORITY_LABEL[q.priority] || q.priority}`);
      lines.push(`Direcionado a: ${q.target_audience}`);
      lines.push("");
      lines.push("Resposta do cliente: _______________________________________________");
      lines.push("");
      lines.push("");
    });

    if (questions.length === 0) {
      lines.push("Nenhuma pergunta de esclarecimento foi gerada para este projeto ainda.");
    }

    const buffer = buildDocxBuffer(lines.join("\n"));
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="perguntas-esclarecimento-${project.name.replace(/[^a-zA-Z0-9]/g, "-")}.docx"`);
    res.send(buffer);
  } catch (err) {
    next(err);
  }
});

export default router;
