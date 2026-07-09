import express, { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { dbStore } from "../../src/dbStore";
import { requirePermission } from "./auth";
import { logDebugMessage } from "../middleware/security";
import { AnalysisResult } from "../../src/types";
import { createTask, updateTaskProgress, completeTask, failTask } from "../../src/backgroundTasks";
import { generateJsonWithProvider, generateTextWithProvider, searchWebWithProvider, ConnectedProvider, ProviderFileInput } from "../utils/aiProviders";
import { createStorageAdapter } from "../utils/storage";
import { estimateCostUsd } from "../utils/aiPricing";
import { resolveProvider, checkCostCap, recordProviderFallback, recordAiUsage } from "../../src/aiOrchestrator";
import { runWithTenant } from "../../src/tenantContext";
import { prisma } from "../../src/prisma";
import { FACTORY_DEFAULT_ANALYSIS_PROMPT } from "../utils/promptDefaults";
import { buildDocxBuffer } from "../utils/docx";

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
    console.warn(`normalizedEnum: unrecognized value "${val}", defaulting to "${options[0]}". Options: ${options.join(", ")}`);
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
function extractKnowledgeBaseKeywords(text: string, maxKeywords = 40): string[] {
  const counts = new Map<string, number>();
  for (const raw of text.toLowerCase().split(/[^\p{L}\p{N}-]+/u)) {
    const word = raw.trim();
    if (word.length < 4 || KEYWORD_STOPWORDS.has(stripAccents(word))) continue;
    counts.set(word, (counts.get(word) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, maxKeywords).map(([w]) => w);
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
  notes: z.string()
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
  // Set client-side the moment a user hand-edits sku/part_number/manufacturer - takes over from
  // sourced_via_web_search in the UI badge once a person has verified/corrected the value.
  edited_by: z.string().optional(),
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


// GET latest analysis result
router.get("/projects/:projectId/analysis-result", requirePermission("analysis:read"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await dbStore.getAnalysisResult(req.params.projectId);
    if (!result) {
      return res.status(404).json({ success: false, message: "No analysis result exists for this project." });
    }
    res.json(result);
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

    const userId = (req.headers["x-user-id"] as string) || "u1";
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

// Looks up a real part number/manufacturer for BOM items the document itself didn't specify
// (sku/part_number left blank by the main analysis, per its own "never invent" instruction) via
// the configured web_grounding provider's native search tool - a real internet lookup, not the
// model guessing from training data. Never throws: if the provider isn't configured for web
// search, the API errors, or the response isn't parsable JSON, the original BOM is returned
// unchanged and the failure is only logged - this is an enrichment step, losing it should never
// fail (or even flag as failed) an otherwise-successful analysis.
async function enrichBomWithWebSearch(bom: any[], platformSettings: any, proposalLanguage: string, tenantId: string): Promise<any[]> {
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
    const providerResolution = resolveProvider("web_grounding", platformSettings);
    const lookupList = itemsNeedingLookup.map((item) => ({
      item_id: item.item_id,
      equipment_name: item.equipment_name,
      category: item.category,
      specification: item.specification,
      known_part_number: item.part_number?.trim() || null,
    }));

    const prompt = `Search the web for a real, currently-sold product that matches or exceeds each equipment specification below. If "known_part_number" is set for an item, that part number is already correct/authoritative - only search for which real manufacturer makes that exact part number, do not substitute a different product. If "known_part_number" is null, find an actual manufacturer and part number/SKU from a real product page, datasheet, or distributor listing - never invent one. If you cannot find a confident real match after searching, leave sku/part_number/manufacturer as empty strings for that item rather than guessing.

ITEMS TO LOOK UP:
${JSON.stringify(lookupList, null, 2)}

Respond with ONLY a JSON array (no markdown, no extra text), one object per item_id above, in this exact shape:
[{ "item_id": "...", "sku": "real SKU or empty string", "part_number": "real part number or empty string", "manufacturer": "real manufacturer name or empty string", "note": "one short sentence in ${proposalLanguage} - what you found and its source, or why nothing confident was found" }]`;

    const { text, inputTokens, outputTokens } = await searchWebWithProvider(providerResolution.provider as ConnectedProvider, providerResolution.model, prompt);
    await recordAiUsage({
      tenantId,
      taskType: "bom_web_search",
      provider: providerResolution.provider,
      model: providerResolution.model,
      estimatedCostUsd: estimateCostUsd(providerResolution.model, inputTokens, outputTokens),
    });
    // The model prefaces the JSON with explanatory prose that can itself contain stray "[...]"
    // (e.g. citing "[16:9]" resolution) - a single greedy [\s\S]*] regex grabbed from that first
    // stray bracket through to the real array's closing bracket, garbling the JSON. Prefer the
    // ```json fenced block if present (the array is always what's fenced); only fall back to the
    // last "[" in the text (the real array is always the final thing in the response) if no fence
    // is found.
    const fenceMatch = text.match(/```json\s*([\s\S]*?)```/);
    const rawJsonText = fenceMatch ? fenceMatch[1] : text.slice(text.lastIndexOf("["));
    if (!rawJsonText.includes("[")) throw new Error("Web search response did not contain a JSON array");
    const results: Array<{ item_id: string; sku: string; part_number: string; manufacturer: string; note: string }> = JSON.parse(rawJsonText.trim());

    const resultsByItemId = new Map(results.map((r) => [r.item_id, r]));
    return bom.map((item) => {
      const found = resultsByItemId.get(item.item_id);
      if (!found || (!found.part_number?.trim() && !found.manufacturer?.trim())) return item;
      return {
        ...item,
        sku: item.sku?.trim() || found.sku || item.sku,
        part_number: item.part_number?.trim() || found.part_number || item.part_number,
        manufacturer: item.manufacturer?.trim() || found.manufacturer || item.manufacturer,
        specification: found.note ? `${item.specification} (${found.note})` : item.specification,
        sourced_via_web_search: true,
      };
    });
  } catch (err: any) {
    console.error("BOM web search enrichment failed, keeping original BOM:", err.message);
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

  const project = await dbStore.getProject(projectId);
  if (!project) {
    return res.status(404).json({ success: false, message: "Project not found." });
  }

  const platformSettings = await dbStore.getSettings();
  const providerResolution = resolveProvider("document_analysis", platformSettings);

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
  const userId = (req.headers["x-user-id"] as string) || "u1";
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
  const analysisInstructions = analysisPromptRow?.content?.trim() || FACTORY_DEFAULT_ANALYSIS_PROMPT;

  const job = await dbStore.createJob({
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
  const task = await createTask({ userId, type: "document_analysis", currentStep: "Iniciando análise...", resultId: projectId });
  res.status(202).json({ success: true, task_id: task.id, job_id: job.id });

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
          console.error(`Failed to read document file for vision analysis: ${doc.filename}`, err);
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

    let rawText: string, inputTokens: number, outputTokens: number;
    try {
      ({ text: rawText, inputTokens, outputTokens } = await generateJsonWithProvider(providerResolution.provider as ConnectedProvider, providerResolution.model, prompt, documentFiles));
    } finally {
      clearInterval(progressTicker);
    }
    const realEstimatedCostUsd = estimateCostUsd(providerResolution.model, inputTokens, outputTokens);

    // 3. Add Structured Output Validation using Zod
    // Every provider is explicitly told to respond with raw JSON only, but Claude in particular
    // still sometimes wraps it in a markdown code fence anyway - strip it defensively rather than
    // fail the whole analysis over formatting.
    const parsedJson = JSON.parse(rawText.trim().replace(/^```json\s*|```\s*$/g, ""));
    const validatedJson = AnalysisResultSchema.parse(parsedJson);

    // 4. Look up real part numbers/manufacturers for any BOM item the document itself didn't
    // specify - a real web search (see enrichBomWithWebSearch), not the model guessing. Failure
    // here never fails the analysis - see that function's own error handling.
    await updateTaskProgress(task.id, { currentStep: "Buscando equipamentos reais para o BOM", progressPct: 88 });
    const enrichedBom = await enrichBomWithWebSearch(validatedJson.bom, platformSettings, project.proposal_language, tenantId);

    // Save final Analysis Result
    const analysisResult: AnalysisResult = {
      id: "ar_" + Math.random().toString(36).substring(2, 11),
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
      updated_at: new Date().toISOString()
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
    console.error("Gemini invocation or validation failed:", err);

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

    let combinedExtractedText = "";
    for (const doc of docs) {
      const text = await dbStore.getDocumentContent(doc.id);
      if (text) {
        combinedExtractedText += `\n--- ${doc.filename} ---\n${text.substring(0, 6000)}\n`;
      }
    }

    const platformSettings = await dbStore.getSettings();
    const providerResolution = resolveProvider("spec_copilot", platformSettings);

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

    const { text: answer, inputTokens, outputTokens } = await generateTextWithProvider(providerResolution.provider as ConnectedProvider, providerResolution.model, prompt);

    const userId = (req.headers["x-user-id"] as string) || "u1";

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
      estimatedCostUsd: estimateCostUsd(providerResolution.model, inputTokens, outputTokens),
    });

    res.json({ success: true, answer: answer || "Nenhuma resposta gerada.", provider: providerResolution.provider });
  } catch (err: any) {
    console.error("Chat copilot request failed:", err);
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
