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
import { PROPOSAL_TYPES, ProposalTypeValue } from "../utils/proposalTypes";
import { getFleetLicenseStatus } from "../utils/fleetLicense";
import { generateJsonWithProvider, ConnectedProvider } from "../utils/aiProviders";
import { resolveProvider, checkCostCap, recordProviderFallback, recordAiUsage } from "../../src/aiOrchestrator";
import { estimateCostUsd } from "../utils/aiPricing";
import { extractKnowledgeBaseKeywords, parseAiJson } from "./analysis";
import { prisma } from "../../src/prisma";
import { randomId } from "../../src/idGenerator";
import { LOGIC_VERSIONS } from "../../src/aiLogicVersions";
import { logger } from "../utils/logger";

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
  editable_content: z.string().optional(),
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

    // Módulo de Precificação (add-on): busca opcional, nunca bloqueia a geração de proposta pra
    // quem não tem o módulo (mesmo padrão de dado-opcional-de-add-on de server/routes/
    // settings.ts:707, não requireModule - essa rota nunca foi gated por add-on). Quando existe
    // mais de uma ProjectPricingSheet (BOM reimportado mais de uma vez), usa sempre a mais
    // recente - não há flag de "sessão atual" no schema. Só os campos abaixo chegam a
    // templateData.pricing - ver o comentário de aviso em server/utils/docx.ts sobre por que
    // markup/preço de lista nunca podem entrar aqui.
    const license = tenantId ? await getFleetLicenseStatus(tenantId) : { modules: [] as string[] };
    const pricingSheet = license.modules.includes("pricing")
      ? await prisma.projectPricingSheet.findFirst({
          where: { projectId },
          orderBy: { createdAt: "desc" },
          include: { lines: { include: { matchedItem: true } } },
        })
      : null;
    const pricingLines = (pricingSheet?.lines || [])
      .filter((l) => l.matchStatus !== "unmatched" && (l.finalUnitPrice != null || l.finalPriceWithTax != null))
      .map((l) => ({
        description: l.matchedItem?.description || l.rawDescription || "",
        quantity: l.quantity,
        finalUnitPrice: l.finalUnitPrice,
        finalPriceWithTax: l.finalPriceWithTax,
      }));
    // Linhas do BOM que ficaram de fora da tabela de preços da proposta por falta de preço
    // cadastrado (sem match no catálogo, ou matched mas ainda sem preço final calculado) - só
    // pra avisar o usuário na tela de geração, nunca chega em templateData/no documento.
    const pricingExcludedCount = pricingSheet ? pricingSheet.lines.length - pricingLines.length : 0;

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
        vertical: project.vertical,
        opportunity_name: project.opportunity_name,
        status: project.status,
        deadline: project.deadline,
        proposal_validity_date: project.proposal_validity_date,
        procurement_modality: project.procurement_modality,
        procurement_subtype: project.procurement_subtype,
        owner_name: owner ? owner.name : undefined,
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
      proposal: {
        manual_pricing_table: validated.manual_pricing_table,
        payment_terms: validated.payment_terms,
        delivery_terms: validated.delivery_terms,
        proposal_validity: validated.proposal_validity,
        commercial_assumptions: validated.commercial_assumptions,
        exclusions: validated.exclusions
      },
      pricing: { lines: pricingLines }
    };

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
      const brandingHeader = await resolveBrandingHeader(projectId);
      const { docx_file_path, pdf_file_path } = await writeProposalFiles(outputAdapter, projectId, proposalType, proposalContent, docxBufferOverride, brandingHeader);

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

async function buildOpinionPrompt(
  perspective: OpinionPerspective,
  proposal: Proposal,
  project: Project,
  analysisResult: any,
  tenantId: string,
  platformSettings: PlatformSettings,
  userId: string
): Promise<string> {
  const header = `PROJECT: ${project.name} | Customer: ${project.customer_name} | Vertical: ${project.vertical}\n`;
  const responseShape = `\n\nRespond with ONLY a JSON object (no markdown, no extra text), in this exact shape:\n{ "severity": "info"|"warning"|"critical", "summary": "one sentence in ${proposal.language}", "content": "2-4 short paragraphs in ${proposal.language}" }`;

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
            const prompt = await buildOpinionPrompt(perspective, proposal, project, analysisResult, tenantId, platformSettings, userId);
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
            }).parse(parsed);

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
      const brandingHeader = await resolveBrandingHeader(existingProposal.project_id);
      const { docx_file_path, pdf_file_path } = await writeProposalFiles(
        outputAdapter,
        existingProposal.project_id,
        existingProposal.proposal_type,
        validated.editable_content,
        undefined,
        brandingHeader
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
