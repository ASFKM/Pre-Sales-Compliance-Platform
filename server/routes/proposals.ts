import express, { Response, NextFunction } from "express";
import type { Request } from "../types/express";
import { z } from "zod";
import { dbStore } from "../../src/dbStore";
import { requireAuth, requirePermission } from "./auth";
import { buildProposalText, writeProposalFiles } from "../utils/docx";
import { renderDocxFromTemplate } from "../utils/docxTemplateEngine";
import { createStorageAdapter } from "../utils/storage";
import { logDebugMessage, requireUserId } from "../middleware/security";
import { ProposalTemplate, SlaRiskFlag, Proposal, Project, PlatformSettings } from "../../src/types";
import { createTask, updateTaskProgress, completeTask, failTask } from "../../src/backgroundTasks";
import { runWithTenant } from "../../src/tenantContext";
import { PROPOSAL_TYPES, ProposalTypeValue, PROPOSAL_EDITABLE_FIELDS, ProposalEditableField, PROPOSAL_TYPE_EDITABLE_FIELDS, getRejectedEditableFields, getReopenRegenerationSection } from "../utils/proposalTypes";
import { DocxTemplateData } from "../utils/docx";
import { getFleetLicenseStatus } from "../utils/fleetLicense";
import { generateJsonWithProvider, ConnectedProvider } from "../utils/aiProviders";
import { resolveProvider, checkCostCap, recordProviderFallback, recordAiUsage } from "../../src/aiOrchestrator";
import { estimateCostUsd } from "../utils/aiPricing";
import { extractKnowledgeBaseKeywords, parseAiJson, regenerateAnalysisSection } from "./analysis";
import { prisma } from "../../src/prisma";
import { randomId } from "../../src/idGenerator";
import { LOGIC_VERSIONS } from "../../src/aiLogicVersions";
import { logger } from "../utils/logger";
import { empurrarProposta } from "../utils/crmOutbox";
import { canReopenProposal, buildReopenedProposalFields } from "../utils/proposalVersioning";

const router = express.Router();
// Exportada (Fase 8) para que a precedência de branding possa ser provada por teste e por uma
// geração real de DOCX, em vez de reimplementada num script - reescrever a regra de fora é
// justamente o que faz uma prova concordar com o código errado.
//
// A precedência: `project.brand_style_id` -> o BrandStyle vence (proposta co-marcada com a
// identidade do próprio cliente); sem ele, cai no BrandingSettings do tenant. Nada aqui alcança
// markup, preço de lista ou desconto: o cabeçalho leva nome, cor e logo, e o resolvedor de
// template (server/utils/docxTemplateEngine.ts) segue recebendo apenas o `templateData` montado
// mais abaixo, que nunca carregou esses campos.

export async function resolveBrandingHeader(projectId: string): Promise<{ companyName?: string; primaryColorHex?: string; logoDataUrl?: string }> {
  const project = await dbStore.getProject(projectId);
  if (project?.brand_style_id) {
    const style = await dbStore.getBrandStyle(project.brand_style_id);
    if (style) {
      return { companyName: style.company_name, primaryColorHex: style.primary_color, logoDataUrl: style.logo_data_url };
    }
  }
  const branding = await dbStore.getBranding();
  return { companyName: branding.company_name, primaryColorHex: branding.primary_color, logoDataUrl: branding.report_logo_path };
}

async function resolveRegisteredTemplate(
  templateId: string,
  proposalType: ProposalTypeValue
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

// Módulo de Precificação (add-on): busca opcional, nunca bloqueia a geração/edição de proposta pra
// quem não tem o módulo (mesmo padrão de dado-opcional-de-add-on de server/routes/settings.ts:707,
// não requireModule - essa rota nunca foi gated por add-on). Quando existe mais de uma
// ProjectPricingSheet (BOM reimportado mais de uma vez), usa sempre a mais recente - não há flag de
// "sessão atual" no schema. Extraído para ser reaproveitado pela geração inicial (POST) e pela
// regeneração ao editar (PUT) - os dois precisam do mesmo dado de precificação atualizado.
async function resolvePricingLines(tenantId: string, projectId: string): Promise<{ pricingLines: NonNullable<DocxTemplateData["pricing"]>["lines"]; pricingExcludedCount: number }> {
  const license = tenantId ? await getFleetLicenseStatus(tenantId) : { modules: [] as string[] };
  const pricingSheet = license.modules.includes("pricing")
    ? await prisma.projectPricingSheet.findFirst({
        where: { projectId },
        orderBy: { createdAt: "desc" },
        include: { lines: { include: { matchedItem: true } } },
      })
    : null;
  // Só os campos abaixo chegam a templateData.pricing - ver o comentário de aviso em
  // server/utils/docx.ts sobre por que markup/preço de lista nunca podem entrar aqui.
  const pricingLines = (pricingSheet?.lines || [])
    .filter((l) => l.matchStatus !== "unmatched" && (l.finalUnitPrice != null || l.finalPriceWithTax != null))
    .map((l) => ({
      description: l.matchedItem?.description || l.rawDescription || "",
      quantity: l.quantity,
      finalUnitPrice: l.finalUnitPrice,
      finalPriceWithTax: l.finalPriceWithTax,
    }));
  // Linhas do BOM que ficaram de fora da tabela de preços da proposta por falta de preço cadastrado
  // - só pra avisar o usuário na tela de geração, nunca chega em templateData/no documento.
  const pricingExcludedCount = pricingSheet ? pricingSheet.lines.length - pricingLines.length : 0;
  return { pricingLines, pricingExcludedCount };
}

// Monta o `DocxTemplateData` a partir de projeto/análise/campos comerciais da proposta - o MESMO
// formato usado pelo resolvedor de variáveis do template engine (docxTemplateEngine.ts) e pelo
// gerador genérico de texto (docx.ts's buildProposalText). Compartilhado entre a geração inicial
// (POST) e a regeneração ao editar (PUT /proposals/:id) - antes desta fase, só o POST usava este
// caminho; o PUT reescrevia editable_content como texto livre, o que sempre derrubava a
// formatação/letterhead de um template real (ver PROPOSAL_TYPE_EDITABLE_FIELDS em proposalTypes.ts).
function buildProposalTemplateData(
  template: { id: string; name: string; version: string; template_type: string; file_path: string },
  physicalFileFound: boolean,
  project: Project,
  ownerName: string | undefined,
  analysis: any,
  commercial: {
    manual_pricing_table?: Array<Record<string, any>>;
    payment_terms?: string;
    delivery_terms?: string;
    proposal_validity?: string;
    commercial_assumptions?: string;
    exclusions?: string;
  },
  pricingLines: NonNullable<DocxTemplateData["pricing"]>["lines"]
): DocxTemplateData {
  return {
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
      vertical: project.vertical,
      opportunity_name: project.opportunity_name,
      status: project.status,
      deadline: project.deadline,
      proposal_validity_date: project.proposal_validity_date,
      procurement_modality: project.procurement_modality,
      procurement_subtype: project.procurement_subtype,
      owner_name: ownerName,
    },
    analysis: analysis ? {
      executive_summary: analysis.executive_summary,
      critical_requirements: analysis.critical_requirements,
      risks: analysis.risks,
      opportunities: analysis.opportunities,
      bom: analysis.bom,
      point_to_point_table: analysis.point_to_point_table,
      preliminary_schedule: analysis.preliminary_schedule,
      clarification_questions: analysis.clarification_questions
    } : undefined,
    proposal: commercial,
    pricing: { lines: pricingLines }
  };
}

// Renderiza (merge no template real quando existe, senão o gerador genérico) e grava DOCX/PDF -
// compartilhado entre POST (geração inicial) e PUT (regeneração ao editar campos estruturados).
async function renderAndWriteProposalDocuments(
  templateData: DocxTemplateData,
  template: Pick<ProposalTemplate, "file_type" | "storage_provider">,
  physicalFileFound: boolean,
  platformSettings: PlatformSettings,
  projectId: string,
  proposalType: string,
  branding: { companyName?: string; primaryColorHex?: string; logoDataUrl?: string }
): Promise<{ docx_file_path: string; pdf_file_path: string; proposalContent: string }> {
  const proposalContent = buildProposalText(templateData);

  let docxBufferOverride: Buffer | undefined;
  if (physicalFileFound && template.file_type === "docx") {
    const templateAdapter = createStorageAdapter({ ...platformSettings, storage_mode: template.storage_provider });
    const templateBuffer = await templateAdapter.readFile(templateData.template!.file_path);
    docxBufferOverride = renderDocxFromTemplate(templateBuffer, templateData);
  }

  const outputAdapter = createStorageAdapter(platformSettings);
  const { docx_file_path, pdf_file_path } = await writeProposalFiles(outputAdapter, projectId, proposalType, proposalContent, docxBufferOverride, branding);
  return { docx_file_path, pdf_file_path, proposalContent };
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
  // Item 3 (confiança no enriquecimento de BOM): permite prosseguir mesmo com itens de baixa
  // confiança/fabricante destoante na proposta comercial - ver checkBomConfidenceForCommercial.
  force_low_confidence_bom: z.boolean().optional().default(false)
});

// Item 3: item vindo de busca web com confiança baixa (ou fabricante destoante do resto da
// categoria no mesmo BOM) é sinalizado antes de uma proposta COMERCIAL ser gerada - o rascunho
// técnico nunca é bloqueado, só o tipo de proposta que efetivamente vira compromisso de preço/
// especificação com o cliente. Não é uma segunda chamada de IA - usa só os campos já calculados
// por enrichBomWithWebSearch/computeEquipmentMatchCrossCheck no momento da análise.
const COMMERCIAL_PROPOSAL_TYPES = new Set<ProposalTypeValue>(["commercial", "technical_commercial"]);
function checkBomConfidenceForCommercial(bom: unknown): { item_id: string; equipment_name: string; reason: string }[] {
  if (!Array.isArray(bom)) return [];
  return bom
    .filter((item: any) => item.sourced_via_web_search && !item.edited_by && (item.match_confidence === "low" || item.manufacturer_outlier === true))
    .map((item: any) => ({
      item_id: item.item_id,
      equipment_name: item.equipment_name,
      reason: item.manufacturer_outlier
        ? "Fabricante destoa dos demais itens da mesma categoria neste BOM"
        : "Correspondência de baixa confiança encontrada via busca web",
    }));
}

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
  const proposalType = req.params.type as ProposalTypeValue;

  if (!(PROPOSAL_TYPES as readonly string[]).includes(proposalType)) {
    return res.status(400).json({ success: false, message: "Invalid proposal type." });
  }

  try {
    const validated = CreateProposalSchema.parse(req.body);
    const project = await dbStore.getProject(projectId);
    const analysis = await dbStore.getAnalysisResult(projectId);

    if (!project) {
      return res.status(404).json({ success: false, message: "Project not found." });
    }

    if (COMMERCIAL_PROPOSAL_TYPES.has(proposalType) && !validated.force_low_confidence_bom) {
      const flaggedItems = checkBomConfidenceForCommercial(analysis?.bom);
      if (flaggedItems.length > 0) {
        return res.status(422).json({
          success: false,
          code: "BOM_NEEDS_REVIEW",
          message: "Há itens do BOM com correspondência de baixa confiança - revise antes de gerar a proposta comercial, ou confirme para prosseguir mesmo assim.",
          flagged_items: flaggedItems,
        });
      }
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
    const owner = await dbStore.getUserById(project.owner_user_id);

    const { pricingLines, pricingExcludedCount } = await resolvePricingLines(tenantId, projectId);

    // 1. Compile template data from projects, analysis result, and manual pricings
    const templateData = buildProposalTemplateData(
      template,
      physicalFileFound,
      project,
      owner ? owner.name : undefined,
      analysis,
      {
        manual_pricing_table: validated.manual_pricing_table,
        payment_terms: validated.payment_terms,
        delivery_terms: validated.delivery_terms,
        proposal_validity: validated.proposal_validity,
        commercial_assumptions: validated.commercial_assumptions,
        exclusions: validated.exclusions
      },
      pricingLines
    );

    // Document generation runs in the background from here - respond immediately with the
    // task id, same pattern as document analysis (server/routes/analysis.ts).
    const task = await createTask({ userId, type: "proposal_generation", currentStep: "Gerando documento..." });
    res.status(202).json({ success: true, task_id: task.id, pricing_excluded_count: pricingExcludedCount });

    // Wrapped in runWithTenant like every other detached background block in this codebase -
    // without it, updateTaskProgress/completeTask/failTask/addAuditLog/createProposal below (all
    // tenant-scoped) would run with no tenant context at all.
    void runWithTenant({ tenantId }, async () => {
    try {
      // 2. Build the full proposal text - this same text becomes the proposal's editable_content,
      // so what the user reviews/edits on screen is exactly what's in the exported files. If the
      // registered template has a real, readable .docx file, it's merged into it directly
      // (preserves the template's own letterhead/styles) - otherwise falls back to the generic
      // generator. A merge failure fails the task with a clear message rather than silently
      // degrading to the generic document - the whole point of choosing a template is the
      // letterhead it produces. Regenerating on a later structured-field edit (PUT /proposals/:id)
      // goes through this exact same helper, so the letterhead never gets lost on save.
      await updateTaskProgress(task.id, { status: "running", currentStep: "Preenchendo e gerando documento", progressPct: 50 });
      const brandingHeader = await resolveBrandingHeader(projectId);
      const { docx_file_path, pdf_file_path, proposalContent } = await renderAndWriteProposalDocuments(
        templateData, template, physicalFileFound, platformSettings, projectId, proposalType, brandingHeader
      );

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

      /*
       * CDC 16 F4 (D22): a proposta viaja para o CRM assim que existe.
       *
       * Aqui, e não antes: o documento é parte do envelope, e o `sha256` que vai declarado no
       * `POST` é o do arquivo já escrito. Empurrar antes da escrita declararia o hash de um
       * arquivo que ainda não existia — e o `PUT` do binário logo depois daria 422 com toda a
       * razão.
       *
       * Dentro do bloco de tenant, e sem `await` que possa derrubar a geração: um CRM fora do ar
       * não pode fazer falhar uma proposta que já foi gerada e salva aqui.
       */
      void empurrarProposta(proposal.id);
    } catch (genErr: any) {
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
// Roadmap item (customer_request): "Alerta de Risco de SLA via Base de Conhecimento" - reformulated
// after review from an earlier version that asked for post-sale delivery telemetry this product
// doesn't (and shouldn't) collect. Viable version: cross-check the proposal's own proposed
// commercial/SLA/penalty terms against the already-existing approved Knowledge Base (which already
// records lessons learned by vertical/client) to flag clauses matching a known historical risk
// pattern before the proposal is sent. Reuses the exact same KB search/AI-matching already used for
// BOM enrichment against the Knowledge Base (server/routes/analysis.ts's enrichBomWithWebSearch) -
// no new data source, just a new checkpoint on the proposal review screen. Synchronous (not a
// background task) - a single short AI call over a handful of terms fields, not a multi-chunk job.
// Shared by the standalone /sla-risk-check endpoint below AND the "legal" opinion perspective in
// the multi-perspective panel (server/routes/proposals.ts's opinion-panel worker) - extracted so
// the panel's Legal opinion reuses this exact cross-check instead of a second, divergent
// implementation (roadmap decision already confirmed). Deliberately does NOT check the cost cap
// itself - the standalone endpoint checks it once before calling this; the panel worker checks it
// once for the whole run instead of once per perspective.
async function computeSlaRiskFlags(
  proposal: Proposal,
  project: Project,
  tenantId: string,
  platformSettings: PlatformSettings,
  userId: string
): Promise<SlaRiskFlag[]> {
  const termsText = [proposal.payment_terms, proposal.delivery_terms, proposal.commercial_assumptions, proposal.exclusions, proposal.proposal_validity]
    .filter((v): v is string => !!v && v.trim().length > 0)
    .join("\n");
  if (!termsText.trim()) return [];

  const keywords = extractKnowledgeBaseKeywords(
    [termsText, project.vertical, project.customer_name].filter(Boolean).join(" "),
    30,
    3
  );
  const relevantKnowledge = keywords.length > 0 ? await dbStore.searchApprovedKnowledgeBase(keywords, 20) : [];
  if (relevantKnowledge.length === 0) return [];

  const providerResolution = await resolveProvider("document_analysis", platformSettings);
  if (providerResolution.isFallback) {
    await recordProviderFallback({ tenantId, taskType: "document_analysis", intendedProvider: providerResolution.intendedProvider, userId });
  }

  const prompt = `You are reviewing the proposed commercial/SLA/penalty terms of a pre-sales proposal
BEFORE it is sent to the customer, cross-checking them against a human-approved Knowledge Base of
lessons learned from past projects (by vertical/client) for known historical risk patterns.

PROJECT: ${project.name} | Customer: ${project.customer_name} | Vertical: ${project.vertical}

PROPOSED TERMS (payment, delivery, validity, commercial assumptions, exclusions):
${termsText}

RELEVANT APPROVED KNOWLEDGE BASE ENTRIES (human-reviewed lessons from past projects):
${relevantKnowledge.map((k) => `- [${k.category}] Se: ${k.trigger} → Então: ${k.knowledge}`).join("\n")}

For each proposed term that matches a known historical risk pattern from the knowledge base above,
flag it. Only flag a term if a knowledge base entry ACTUALLY warns about that specific kind of
clause/commitment - do not invent a risk that isn't grounded in one of the knowledge base entries
above. If no proposed term matches any knowledge base risk pattern, return an empty array.

Respond with ONLY a JSON array (no markdown, no extra text), in this exact shape:
[{ "term_excerpt": "the exact proposed text being flagged", "risk_description": "why this is risky, in ${proposal.language}", "related_lesson": "the specific knowledge base lesson that applies", "severity": "high"|"medium"|"low" }]`;

  const { text, inputTokens, outputTokens, billedCostUsd } = await generateJsonWithProvider(providerResolution.provider as ConnectedProvider, providerResolution.model, prompt);
  const parsed = parseAiJson(text);
  const risks: SlaRiskFlag[] = z.array(z.object({
    term_excerpt: z.string(),
    risk_description: z.string(),
    related_lesson: z.string(),
    severity: z.enum(["high", "medium", "low"]),
  })).parse(parsed);

  await recordAiUsage({
    tenantId,
    taskType: "document_analysis",
    provider: providerResolution.provider,
    model: providerResolution.model,
    estimatedCostUsd: billedCostUsd ?? estimateCostUsd(providerResolution.model, inputTokens, outputTokens),
    userId,
  });

  return risks;
}

router.post("/proposals/:id/sla-risk-check", requirePermission("proposal:edit"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const proposal = await dbStore.getProposal(req.params.id);
    if (!proposal) {
      return res.status(404).json({ success: false, message: "Proposal not found." });
    }
    const project = await dbStore.getProject(proposal.project_id);
    if (!project) {
      return res.status(404).json({ success: false, message: "Project not found." });
    }

    const tenantId = req.headers["x-tenant-id"] as string;
    const platformSettings = await dbStore.getSettings();
    const costCap = await checkCostCap(tenantId, platformSettings.monthly_cost_cap_usd ?? null);
    if (costCap.blocked) {
      return res.status(402).json({
        success: false,
        message: `Monthly AI cost cap reached ($${costCap.currentSpendUsd.toFixed(2)} of $${costCap.capUsd?.toFixed(2)}). SLA risk check blocked until next month or the cap is raised in Admin > AI, Prompts e Custos.`
      });
    }

    const userId = requireUserId(req);
    const risks = await computeSlaRiskFlags(proposal, project, tenantId, platformSettings, userId);
    res.json({ success: true, risks });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(502).json({ success: false, message: "AI response for SLA risk check did not match the expected format." });
    }
    next(err);
  }
});

// Roadmap item (official): "Pareceres de IA Multi-Perspectiva em Propostas" - 4 opinions
// (Technical/Commercial/Legal/Financial), generated sequentially as ONE proposal_opinion_panel
// BackgroundTask (not 4, and not Promise.all - see this session's plan for why: sequential is the
// only real precedent in this codebase, and it lets checkCostCap be re-checked mid-run instead of
// only once at the very start). Persisted (ProposalOpinionRun/ProposalAiOpinionItem), unlike the
// synchronous/unpersisted sla-risk-check, so the panel survives a page reload. Never blocks
// anything - purely informational context for the human ApprovalWorkflow stages.
const OPINION_PERSPECTIVES = ["technical", "commercial", "legal", "financial"] as const;
type OpinionPerspective = (typeof OPINION_PERSPECTIVES)[number];
const OPINION_PERSPECTIVE_LABEL: Record<OpinionPerspective, string> = {
  technical: "Técnico",
  commercial: "Comercial",
  legal: "Jurídico",
  financial: "Financeiro",
};

// PARTE B (actionable AI opinion): of PROPOSAL_EDITABLE_FIELDS, only these five are plain text -
// manual_pricing_table is a structured array the AI would have to invent line-by-line (item_id,
// quantity, unit_price, discount, ...), which is a much riskier thing for a model to get right
// than a paragraph of terms text, so it's deliberately excluded from what an opinion can suggest.
// The AI is only ever offered fields this specific proposal's own type can take
// (PROPOSAL_TYPE_EDITABLE_FIELDS ∩ this list) - it can't suggest editing a field the proposal's
// type doesn't own, and the server re-validates that below regardless of what the model returns.
const TEXT_SUGGESTIBLE_FIELDS = ["payment_terms", "delivery_terms", "proposal_validity", "commercial_assumptions", "exclusions"] as const satisfies readonly ProposalEditableField[];

async function buildOpinionPrompt(
  perspective: OpinionPerspective,
  proposal: Proposal,
  project: Project,
  analysisResult: any,
  tenantId: string,
  platformSettings: PlatformSettings,
  userId: string,
  suggestibleFields: readonly ProposalEditableField[]
): Promise<string> {
  const header = `PROJECT: ${project.name} | Customer: ${project.customer_name} | Vertical: ${project.vertical}\n`;
  // The AI never edits the proposal itself - suggested_field/suggested_value is only ever a
  // recommendation the human reviewer applies explicitly (an "Apply" button in the client PUTs it
  // to /proposals/:id). Omitted entirely from the requested shape when this proposal's type owns
  // no suggestible field (the 4 report types), so the model isn't even offered the option.
  const suggestionInstruction = suggestibleFields.length > 0
    ? ` If (and only if) you have ONE concrete, specific change to recommend to one of this proposal's own fields, also include "suggested_field" (exactly one of: ${suggestibleFields.map((f) => `"${f}"`).join(", ")}) and "suggested_value" (the full exact replacement text for that field, in ${proposal.language}). Leave both out if you have no single concrete field-level change to propose - most reviews won't have one, and a vague/general suggestion doesn't count.`
    : "";
  const responseShape = `\n\nRespond with ONLY a JSON object (no markdown, no extra text), in this exact shape:\n{ "severity": "info"|"warning"|"critical", "summary": "one sentence in ${proposal.language}", "content": "2-4 short paragraphs in ${proposal.language}", "suggested_field": string|null, "suggested_value": string|null }.${suggestionInstruction}`;

  if (perspective === "technical") {
    const bom = (analysisResult?.bom || []) as any[];
    const bomText = bom.length > 0
      ? bom.map((item) => {
          const flag = item.brand_policy_applicable && item.brand_policy_compliant === false ? " [FORA DA POLÍTICA DE MARCA DO PROJETO]" : "";
          const unresolved = !item.part_number?.trim() ? " [PART NUMBER NÃO RESOLVIDO]" : "";
          return `- ${item.equipment_name} (${item.manufacturer || "fabricante não confirmado"}, qty ${item.quantity}): ${item.specification}${flag}${unresolved}`;
        }).join("\n")
      : "Nenhum item de BOM disponível (a análise de IA do projeto ainda não gerou um).";
    return `${header}
You are a senior technical reviewer evaluating this proposal's Bill of Materials (BOM) before it is
sent to the customer.

MANDATORY PROJECT BRAND POLICY: ${project.ai_orientation_text || "None defined"}

BOM (brand-policy flags already computed - comment on them if relevant, don't re-derive from scratch):
${bomText}

Evaluate: items with an unresolved part number, items outside the mandated brand policy, equipment
categories that look under-specified (cabling, licensing, labor/installation). Flag concrete,
specific technical risks - not generic boilerplate.${responseShape}`;
  }

  if (perspective === "commercial") {
    return `${header}
You are a commercial reviewer evaluating this proposal's terms before it is sent to the customer.

PROPOSED TERMS:
Payment: ${proposal.payment_terms || "N/D"}
Delivery: ${proposal.delivery_terms || "N/D"}
Validity: ${proposal.proposal_validity || "N/D"}
Commercial assumptions: ${proposal.commercial_assumptions || "N/D"}

Evaluate consistency between the proposed delivery timeline and the nature of the BOM items (high
lead-time equipment needs a longer delivery window), and whether the proposal's validity period is
compatible with the promised delivery timeline.${responseShape}`;
  }

  if (perspective === "legal") {
    const slaFlags = await computeSlaRiskFlags(proposal, project, tenantId, platformSettings, userId);
    const flagsText = slaFlags.length > 0
      ? slaFlags.map((f) => `- [${f.severity}] "${f.term_excerpt}": ${f.risk_description} (${f.related_lesson})`).join("\n")
      : "No historical risk pattern found in the approved Knowledge Base for the proposed terms.";
    return `${header}
You are a legal reviewer evaluating this proposal before it is sent to the customer.

RISKS ALREADY FLAGGED BY THE APPROVED KNOWLEDGE BASE (an automated cross-check already ran - use
this as input, don't redo the same analysis from scratch):
${flagsText}

PROPOSED EXCLUSIONS: ${proposal.exclusions || "N/D"}

Evaluate additional contractual risk: missing standard clauses, contradictions between the
exclusions and the BOM's technical scope.${responseShape}`;
  }

  // financial
  const pricing = (proposal.manual_pricing_table || []) as any[];
  const total = pricing.reduce((sum, p) => sum + Number(p.total_price ?? Number(p.quantity || 0) * Number(p.unit_price || 0)), 0);
  const pricingText = pricing.length > 0
    ? pricing.map((p) => `- ${p.product_or_service}: qty ${p.quantity} x ${p.currency} ${p.unit_price} (discount ${p.discount}%) = ${p.currency} ${p.total_price}`).join("\n")
    : "No pricing table defined.";
  return `${header}
You are a financial reviewer evaluating this proposal's pricing before it is sent to the customer.

PRICING TABLE (estimated total: USD ${total.toFixed(2)}):
${pricingText}

PAYMENT TERMS: ${proposal.payment_terms || "N/D"}

Evaluate: unusual/aggressive discounts, currency exposure (if the table mixes currencies), and cash
flow implications of the payment terms and proposal validity. Do NOT evaluate profit margin - there
is no cost-basis data available, only sale price.${responseShape}`;
}

router.post("/proposals/:id/opinion-panel", requirePermission("proposal:edit"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const proposal = await dbStore.getProposal(req.params.id);
    if (!proposal) {
      return res.status(404).json({ success: false, message: "Proposal not found." });
    }
    const project = await dbStore.getProject(proposal.project_id);
    if (!project) {
      return res.status(404).json({ success: false, message: "Project not found." });
    }

    const tenantId = req.headers["x-tenant-id"] as string;
    const platformSettings = await dbStore.getSettings();
    const costCap = await checkCostCap(tenantId, platformSettings.monthly_cost_cap_usd ?? null);
    if (costCap.blocked) {
      return res.status(402).json({
        success: false,
        message: `Monthly AI cost cap reached ($${costCap.currentSpendUsd.toFixed(2)} of $${costCap.capUsd?.toFixed(2)}). Opinion panel blocked until next month or the cap is raised in Admin > AI, Prompts e Custos.`
      });
    }

    const userId = requireUserId(req);
    const providerResolution = await resolveProvider("proposal_opinion_panel", platformSettings);
    if (providerResolution.isFallback) {
      await recordProviderFallback({ tenantId, taskType: "proposal_opinion_panel", intendedProvider: providerResolution.intendedProvider, userId });
    }

    const task = await createTask({ userId, type: "proposal_opinion_panel", currentStep: "Iniciando pareceres de IA...", resultId: proposal.id });
    const runId = randomId("por");
    await prisma.proposalOpinionRun.create({
      data: {
        id: runId,
        tenantId,
        proposalId: proposal.id,
        backgroundTaskId: task.id,
        status: "running",
        requestedByUserId: userId,
        logicVersion: LOGIC_VERSIONS.proposal_opinion_panel,
      },
    });
    res.status(202).json({ success: true, task_id: task.id, run_id: runId });

    // Detached background block, same pattern as every other long-running AI task in this
    // codebase (see server/routes/analysis.ts) - runWithTenant re-establishes tenant context for
    // everything below, since the request that kicked this off has already responded.
    void runWithTenant({ tenantId }, async () => {
      let completedCount = 0;
      let anyFailed = false;
      try {
        const analysisResult = await dbStore.getAnalysisResult(proposal.project_id);
        const suggestibleFields = PROPOSAL_TYPE_EDITABLE_FIELDS[proposal.proposal_type]
          .filter((f): f is (typeof TEXT_SUGGESTIBLE_FIELDS)[number] => (TEXT_SUGGESTIBLE_FIELDS as readonly string[]).includes(f));

        for (let i = 0; i < OPINION_PERSPECTIVES.length; i++) {
          const perspective = OPINION_PERSPECTIVES[i];
          await updateTaskProgress(task.id, {
            currentStep: `Gerando parecer ${OPINION_PERSPECTIVE_LABEL[perspective]}... ${i + 1}/${OPINION_PERSPECTIVES.length}`,
            progressPct: Math.round((i / OPINION_PERSPECTIVES.length) * 100),
          });

          // Re-check accumulated spend before the 3rd/4th call - the only other multi-call
          // precedent in this codebase (Knowledge Base document analysis) only ever checks the
          // cap once at the very start, a blind spot already identified as a real risk; this
          // closes it for a run that costs ~4x a single document_analysis call.
          if (i >= 2) {
            const midCheck = await checkCostCap(tenantId, platformSettings.monthly_cost_cap_usd ?? null);
            if (midCheck.blocked) {
              logger.warn({ tenantId, runId, perspective }, "Opinion panel stopped mid-run: cost cap reached");
              break;
            }
          }

          try {
            const prompt = await buildOpinionPrompt(perspective, proposal, project, analysisResult, tenantId, platformSettings, userId, suggestibleFields);
            let rawText = "", inputTokens = 0, outputTokens = 0, billedCostUsd: number | undefined;
            for (let attempt = 0; attempt < 2; attempt++) {
              try {
                const result = await generateJsonWithProvider(providerResolution.provider as ConnectedProvider, providerResolution.model, prompt);
                rawText = result.text; inputTokens = result.inputTokens; outputTokens = result.outputTokens; billedCostUsd = result.billedCostUsd;
                break;
              } catch (callErr: any) {
                const isRateLimit = callErr?.status === 429 || /rate.?limit|429/i.test(String(callErr?.message || ""));
                if (isRateLimit && attempt === 0) { await new Promise((resolve) => setTimeout(resolve, 20000)); continue; }
                throw callErr;
              }
            }
            const parsed = parseAiJson(rawText);
            const opinion = z.object({
              severity: z.enum(["info", "warning", "critical"]),
              summary: z.string(),
              content: z.string(),
              suggested_field: z.string().nullish(),
              suggested_value: z.string().nullish(),
            }).parse(parsed);

            // Re-validate against the server's own allowlist rather than trusting the model - a
            // hallucinated field name, a field this proposal's type doesn't own, or a suggestion
            // with no value all get dropped down to a plain narrative opinion (never a hard
            // failure: the rest of the opinion is still useful even with no applicable suggestion).
            const isValidSuggestion = !!opinion.suggested_field
              && !!opinion.suggested_value
              && (suggestibleFields as readonly string[]).includes(opinion.suggested_field);

            await prisma.proposalAiOpinionItem.create({
              data: {
                id: randomId("poi"),
                tenantId,
                runId,
                perspective,
                status: "completed",
                severity: opinion.severity,
                summary: opinion.summary,
                content: opinion.content,
                suggestedField: isValidSuggestion ? opinion.suggested_field : null,
                suggestedValue: isValidSuggestion ? opinion.suggested_value : null,
                raw: parsed,
                providerUsed: providerResolution.provider,
                modelUsed: providerResolution.model,
              },
            });
            await recordAiUsage({
              tenantId,
              taskType: "proposal_opinion_panel",
              provider: providerResolution.provider,
              model: providerResolution.model,
              estimatedCostUsd: billedCostUsd ?? estimateCostUsd(providerResolution.model, inputTokens, outputTokens),
              backgroundTaskId: task.id,
              userId: task.user_id,
            });
            completedCount++;
          } catch (perspectiveErr: any) {
            anyFailed = true;
            logger.warn({ err: perspectiveErr, runId, perspective }, "Opinion panel perspective failed");
            await prisma.proposalAiOpinionItem.create({
              data: {
                id: randomId("poi"),
                tenantId,
                runId,
                perspective,
                status: "failed",
                summary: perspectiveErr.message || "Unknown error",
                content: "",
              },
            });
          }
        }

        const finalStatus = completedCount === 0 ? "failed" : (anyFailed || completedCount < OPINION_PERSPECTIVES.length ? "partial" : "completed");
        await prisma.proposalOpinionRun.update({ where: { id: runId }, data: { status: finalStatus, completedAt: new Date() } });
        await prisma.proposal.update({ where: { id: proposal.id }, data: { latestOpinionRunId: runId } });

        if (finalStatus === "failed") {
          await failTask(task.id, "All opinion perspectives failed.");
        } else {
          await completeTask(task.id, { resultType: "proposal_opinion_run", resultId: runId });
        }
      } catch (err: any) {
        logger.error({ err, runId }, "Opinion panel run failed");
        await prisma.proposalOpinionRun.update({ where: { id: runId }, data: { status: "failed", completedAt: new Date() } }).catch(() => {});
        await failTask(task.id, err.message || "Unknown error during opinion panel generation");
      }
    });
  } catch (err) {
    next(err);
  }
});

router.get("/proposals/:id/opinion-panel", requirePermission("proposal:edit"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const proposal = await dbStore.getProposal(req.params.id);
    if (!proposal || !proposal.latest_opinion_run_id) {
      return res.json({ success: true, run: null });
    }
    const run = await prisma.proposalOpinionRun.findUnique({
      where: { id: proposal.latest_opinion_run_id },
      include: { opinions: true },
    });
    res.json({ success: true, run });
  } catch (err) {
    next(err);
  }
});

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

    // Root-cause fix: this proposal's type only owns a specific subset of the editable commercial
    // fields (PROPOSAL_TYPE_EDITABLE_FIELDS, server/utils/proposalTypes.ts) - e.g. a risk_report
    // has no payment_terms, a technical proposal has no pricing table. Reject anything outside
    // that set instead of silently accepting it, same principle as checkBomConfidenceForCommercial
    // above: garbage entering a field the template never reads for this type is worse than an
    // explicit 400.
    const submittedFields = (Object.keys(validated) as Array<keyof typeof validated>)
      .filter((k): k is ProposalEditableField => (PROPOSAL_EDITABLE_FIELDS as readonly string[]).includes(k));
    const rejectedFields = getRejectedEditableFields(existingProposal.proposal_type, submittedFields);
    if (rejectedFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Campo(s) não aplicável(is) a propostas do tipo '${existingProposal.proposal_type}': ${rejectedFields.join(", ")}.`
      });
    }

    let proposal = await dbStore.updateProposal(req.params.id, validated);

    // Regenerate the exported DOCX/PDF whenever a structured commercial field actually changed, so
    // the exported files always match what's on screen - through the SAME template-merge path
    // generation used (renderAndWriteProposalDocuments, shared above), not the old flat-text
    // regeneration that always discarded a real template's letterhead. templateData is rebuilt
    // fresh from the project/analysis/template (exactly like initial generation), with the
    // proposal's just-updated commercial fields merged in - there is no free-text field anymore
    // for the user to desync from the template's actual placeholders.
    if (submittedFields.length > 0 && proposal) {
      const project = await dbStore.getProject(existingProposal.project_id);
      if (!project) {
        return res.status(404).json({ success: false, message: "Project not found." });
      }
      const analysis = await dbStore.getAnalysisResult(existingProposal.project_id);
      const platformSettings = await dbStore.getSettings();
      const templates = await dbStore.getProposalTemplates();
      const template = templates.find(t => t.id === existingProposal.template_id);
      const physicalFileFound = template ? await checkTemplatePhysicalFile(template, platformSettings) : false;
      const owner = await dbStore.getUserById(project.owner_user_id);
      const tenantId = req.headers["x-tenant-id"] as string;
      const { pricingLines } = await resolvePricingLines(tenantId, existingProposal.project_id);

      const templateData = buildProposalTemplateData(
        template ?? { id: existingProposal.template_id, name: "N/D", version: existingProposal.template_version, template_type: existingProposal.proposal_type, file_path: "" },
        physicalFileFound,
        project,
        owner ? owner.name : undefined,
        analysis,
        {
          manual_pricing_table: proposal.manual_pricing_table,
          payment_terms: proposal.payment_terms,
          delivery_terms: proposal.delivery_terms,
          proposal_validity: proposal.proposal_validity,
          commercial_assumptions: proposal.commercial_assumptions,
          exclusions: proposal.exclusions,
        },
        pricingLines
      );

      const brandingHeader = await resolveBrandingHeader(existingProposal.project_id);
      const { docx_file_path, pdf_file_path, proposalContent } = await renderAndWriteProposalDocuments(
        templateData,
        template ?? { file_type: "docx" as const, storage_provider: existingProposal.storage_provider },
        physicalFileFound,
        platformSettings,
        existingProposal.project_id,
        existingProposal.proposal_type,
        brandingHeader
      );

      const oldAdapter = createStorageAdapter({ ...platformSettings, storage_mode: existingProposal.storage_provider });
      await oldAdapter.deleteFile(existingProposal.docx_file_path);
      await oldAdapter.deleteFile(existingProposal.pdf_file_path);

      proposal = await dbStore.updateProposal(req.params.id, {
        docx_file_path,
        pdf_file_path,
        storage_provider: platformSettings.storage_mode,
        editable_content: proposalContent,
      });
    }

    const userId = requireUserId(req);
    await dbStore.addAuditLog({
      user_id: userId,
      action: submittedFields.length > 0 ? "Edit Proposal Terms" : "Update Proposal",
      entity_type: "Proposal",
      entity_id: req.params.id,
      project_id: proposal?.project_id,
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

/*
 * PreSales F8 (PARTE B) - REABRIR uma proposta REJEITADA como uma versão nova.
 *
 * Decisão de arquitetura: cada reabertura cria uma LINHA NOVA de Proposal (id novo, v2), e a v1
 * NUNCA é mutada. A v1 fica `rejected` para sempre, congelada, com os arquivos DOCX/PDF e os
 * pareceres de IA que ela tinha - é o registro auditável do que foi recusado e por quê (o motivo
 * agora é obrigatório, ver server/utils/approvalDecision.ts). Reabrir mudando o status da v1 de
 * volta para `draft` apagaria justamente esse registro, e o `PUT` logo em seguida ainda apagaria
 * os arquivos dela (ver o `deleteFile` incondicional no PUT acima).
 *
 * O que amarra as versões: `proposalGroupId` (estável na cadeia inteira) e `previousVersionId`
 * (elo para trás, `@unique` no banco). O `version`, que era campo morto desde sempre (toda proposta
 * nascia 1 e nada incrementava), passa a ser o número real: v2 = v1.version + 1.
 *
 * Permissão: `proposal:generate`, a MESMA que já protege POST /projects/:projectId/proposals/:type -
 * nenhuma permissão nova foi inventada. Reabrir literalmente CRIA uma linha de proposta e GERA os
 * documentos dela, então é a permissão de criar que se aplica; `proposal:edit` (a do PUT) deixaria
 * qualquer papel futuro que só edite criar propostas por uma porta lateral. Nos três papéis do seed
 * as duas andam juntas, então na prática nenhum usuário existente perde nem ganha acesso.
 *
 * Pareceres de IA: a v2 nasce SEM parecer (`latestOpinionRunId` nulo), exatamente como qualquer
 * proposta recém-gerada. O gatilho de parecer neste produto não é automático - é o próprio usuário
 * que dispara `POST /proposals/:id/opinion-panel` pela tela (Proposals.tsx, botão "Gerar Pareceres
 * de IA", visível só em `draft`), então a v2 segue exatamente o mesmo caminho de uma proposta nova.
 * Os pareceres antigos continuam ligados à v1 e visíveis nela.
 *
 * Geração dos documentos: pelo MESMO par compartilhado da geração inicial
 * (buildProposalTemplateData + renderAndWriteProposalDocuments). A v2 nasce com os caminhos de
 * arquivo já apontando para arquivos NOVOS, e nada é apagado - o caminho de deleção incondicional
 * do PUT não é reaproveitado aqui de propósito: ele existe para trocar o arquivo de uma MESMA
 * proposta, e reutilizá-lo aqui destruiria o documento da v1.
 */
router.post("/proposals/:id/reopen", requirePermission("proposal:generate"), async (req: Request, res: Response, next: NextFunction) => {
  const correlationId = (req.headers["x-correlation-id"] as string) || "corr-proposal-reopen";
  const startTime = Date.now();

  try {
    const rejected = await dbStore.getProposal(req.params.id);

    if (!rejected) {
      return res.status(404).json({ success: false, message: "Proposal not found." });
    }

    const guard = canReopenProposal(rejected.status);
    if (!guard.allowed) {
      return res.status(400).json({ success: false, message: guard.message });
    }

    // `previousVersionId` é `@unique` no banco: uma v1 só pode ter UMA sucessora. Conferir antes
    // transforma o que seria um 500 de violação de constraint (numa reabertura repetida, um duplo
    // clique, uma repetição de requisição) numa resposta honesta que devolve a v2 que já existe.
    const existingSuccessor = await prisma.proposal.findUnique({ where: { previousVersionId: rejected.id } });
    if (existingSuccessor) {
      return res.status(409).json({
        success: false,
        message: `This proposal has already been reopened as version ${existingSuccessor.version}.`,
        proposal_id: existingSuccessor.id,
        version: existingSuccessor.version
      });
    }

    const project = await dbStore.getProject(rejected.project_id);
    if (!project) {
      return res.status(404).json({ success: false, message: "Project not found." });
    }

    let analysis = await dbStore.getAnalysisResult(rejected.project_id);
    const platformSettings = await dbStore.getSettings();
    const templates = await dbStore.getProposalTemplates();
    const template = templates.find(t => t.id === rejected.template_id);
    const physicalFileFound = template ? await checkTemplatePhysicalFile(template, platformSettings) : false;
    const owner = await dbStore.getUserById(project.owner_user_id);
    const tenantId = req.headers["x-tenant-id"] as string;
    const userId = requireUserId(req);
    const { pricingLines } = await resolvePricingLines(tenantId, rejected.project_id);

    /*
     * F8b (item 2) - decisão do dono: reabrir uma proposta que é RELATÓRIO PURO
     * (executive_summary, risk_report, bom_report, questions_report) REGENERA o conteúdo do
     * relatório do zero via IA, em vez de reaproveitar a análise que a v1 já tinha usado.
     *
     * Por que só esses 4: eles não têm campo estruturado editável nenhum
     * (PROPOSAL_TYPE_EDITABLE_FIELDS vazio - ver getReopenRegenerationSection em
     * server/utils/proposalTypes.ts, onde essa amarração é a definição e é provada por teste).
     * Todo o conteúdo deles vem do AnalysisResult do projeto, então "reabrir sem regenerar" produz
     * um documento byte-a-byte igual ao que acabou de ser recusado - a v2 nasceria idêntica à v1.
     * Os outros 3 tipos (technical/commercial/technical_commercial) continuam exatamente como a F8
     * os deixou: clonam os campos comerciais da v1, sem chamada de IA nenhuma, porque neles existe
     * trabalho humano a preservar.
     *
     * A regeração roda pela MESMA rotina que gerou o conteúdo original (regenerateAnalysisSection,
     * server/routes/analysis.ts - a mesma que o botão "reanalisar seção" da tela de análise
     * dispara), e não por uma segunda implementação: ela relê os documentos do projeto, chama o
     * provedor de IA configurado e grava a seção nova no AnalysisResult. O documento da v2 é então
     * montado a partir DESSA análise já atualizada, umas linhas abaixo.
     *
     * Falha da IA REPROVA a reabertura (502), não cai em silêncio para o conteúdo antigo: uma v2
     * que promete conteúdo regenerado e entrega uma cópia da v1 é exatamente o engano que este
     * item veio corrigir. A v1 continua intocada e a reabertura pode ser repetida.
     */
    const regenerationSection = getReopenRegenerationSection(rejected.proposal_type);
    let regeneration: { section: string; provider: string; model: string; estimated_cost_usd: number } | null = null;

    if (regenerationSection) {
      // Mesmas guardas que a rota de reanálise de seção aplica antes de gastar token: teto de
      // custo mensal do tenant e registro do fallback de provedor.
      const costCap = await checkCostCap(tenantId, platformSettings.monthly_cost_cap_usd ?? null);
      if (costCap.blocked) {
        return res.status(402).json({
          success: false,
          message: `Monthly AI cost cap reached ($${costCap.currentSpendUsd.toFixed(2)} of $${costCap.capUsd?.toFixed(2)}). Reopening a report proposal regenerates its content with AI, so it is blocked until next month or the cap is raised in Admin > AI, Prompts e Custos.`
        });
      }

      const providerResolution = await resolveProvider("document_analysis", platformSettings);
      if (providerResolution.isFallback) {
        await recordProviderFallback({ tenantId, taskType: "document_analysis", intendedProvider: providerResolution.intendedProvider, userId });
      }

      try {
        const regenerated = await regenerateAnalysisSection({
          projectId: rejected.project_id,
          section: regenerationSection,
          tenantId,
          project,
          platformSettings,
          providerResolution,
          userId,
        });
        analysis = regenerated.analysis;
        regeneration = {
          section: regenerationSection,
          provider: providerResolution.provider,
          model: providerResolution.model,
          estimated_cost_usd: regenerated.estimatedCostUsd,
        };
        await recordAiUsage({
          tenantId,
          taskType: "document_analysis",
          provider: providerResolution.provider,
          model: providerResolution.model,
          estimatedCostUsd: regenerated.estimatedCostUsd,
          userId,
        });
        logDebugMessage({
          operation: "Proposal Reopen Regeneration",
          message: `Regenerated analysis section "${regenerationSection}" with ${providerResolution.provider}/${providerResolution.model} before reopening ${rejected.proposal_type} proposal ${rejected.id}`,
          status: "SUCCESS",
          durationMs: Date.now() - startTime,
          correlationId,
          projectId: rejected.project_id
        });
      } catch (regenErr: any) {
        logDebugMessage({
          operation: "Proposal Reopen Regeneration Failure",
          message: `Failed to regenerate analysis section "${regenerationSection}" for ${rejected.proposal_type} proposal ${rejected.id}: ${regenErr?.message}`,
          status: "ERROR",
          durationMs: Date.now() - startTime,
          correlationId,
          projectId: rejected.project_id,
          error: regenErr
        });
        return res.status(502).json({
          success: false,
          message: `Could not regenerate the report content with AI, so the proposal was not reopened. Nothing was changed - try again. (${regenErr?.message || "unknown AI error"})`,
        });
      }
    }

    const templateData = buildProposalTemplateData(
      template ?? { id: rejected.template_id, name: "N/D", version: rejected.template_version, template_type: rejected.proposal_type, file_path: "" },
      physicalFileFound,
      project,
      owner ? owner.name : undefined,
      analysis,
      {
        manual_pricing_table: rejected.manual_pricing_table,
        payment_terms: rejected.payment_terms,
        delivery_terms: rejected.delivery_terms,
        proposal_validity: rejected.proposal_validity,
        commercial_assumptions: rejected.commercial_assumptions,
        exclusions: rejected.exclusions,
      },
      pricingLines
    );

    const brandingHeader = await resolveBrandingHeader(rejected.project_id);
    const { docx_file_path, pdf_file_path, proposalContent } = await renderAndWriteProposalDocuments(
      templateData,
      template ?? { file_type: "docx" as const, storage_provider: rejected.storage_provider },
      physicalFileFound,
      platformSettings,
      rejected.project_id,
      rejected.proposal_type,
      brandingHeader
    );

    const user = await dbStore.getUserById(userId);

    const reopened = await dbStore.createProposal(
      buildReopenedProposalFields(
        rejected,
        {
          docx_file_path,
          pdf_file_path,
          storage_provider: platformSettings.storage_mode,
          editable_content: proposalContent,
        },
        user ? user.name : "System User"
      )
    );

    logDebugMessage({
      operation: "Proposal Reopen",
      message: `Reopened rejected proposal ${rejected.id} (v${rejected.version}) as ${reopened.id} (v${reopened.version})`,
      status: "SUCCESS",
      durationMs: Date.now() - startTime,
      correlationId,
      projectId: rejected.project_id
    });

    await dbStore.addAuditLog({
      user_id: userId,
      action: "Reopen Rejected Proposal",
      entity_type: "Proposal",
      entity_id: reopened.id,
      project_id: rejected.project_id,
      ip_address: req.ip || "127.0.0.1",
      user_agent: req.headers["user-agent"] || "unknown",
      metadata: JSON.stringify({
        previous_proposal_id: rejected.id,
        previous_version: rejected.version,
        new_version: reopened.version,
        proposal_group_id: reopened.proposal_group_id,
        // F8b (item 2): fica no registro QUAL seção da análise foi regenerada por IA nesta
        // reabertura (e com qual provedor/modelo), ou `null` quando o tipo apenas clonou a v1.
        // Sem isso, as duas reaberturas seriam indistinguíveis no log de auditoria.
        regenerated_analysis: regeneration
      })
    });

    // CDC 16 F4 (D22): uma proposta viaja para o CRM assim que EXISTE, e a v2 é uma proposta nova
    // (id próprio, chave de idempotência própria `prop-{id}-v{version}-{status}`). Sem `await` e
    // nunca lança, mesmo padrão do POST de geração: um CRM fora do ar não pode fazer falhar uma
    // reabertura que já foi gravada aqui.
    void empurrarProposta(reopened.id);

    res.status(201).json({
      success: true,
      proposal: reopened,
      proposal_id: reopened.id,
      version: reopened.version,
      previous_version_id: rejected.id,
      proposal_group_id: reopened.proposal_group_id,
      regenerated_analysis: regeneration
    });
  } catch (err) {
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

    // CDC 16 F4: liberar é o momento em que a proposta vira compromisso com o cliente — e é
    // justamente o estado (`sent` no contrato) em que o valor dela SOBRESCREVE o da oportunidade
    // no CRM (D21). O envelope carrega a versão nova do status; a versão do documento não muda,
    // então o binário não sobe de novo (o hash é a chave da mensagem, e o CRM já o tem).
    void empurrarProposta(req.params.id);

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
