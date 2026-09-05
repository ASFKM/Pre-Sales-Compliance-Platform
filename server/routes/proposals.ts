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
import { generateJsonWithProvider, buildActorRef, ConnectedProvider } from "../utils/aiProviders";
import { resolveProvider, checkCostCap, recordProviderFallback, recordAiUsage } from "../../src/aiOrchestrator";
import { estimateCostUsd } from "../utils/aiPricing";
import { extractKnowledgeBaseKeywords, parseAiJson, regenerateAnalysisSection } from "./analysis";
import { prisma } from "../../src/prisma";
import { randomId } from "../../src/idGenerator";
import { LOGIC_VERSIONS } from "../../src/aiLogicVersions";
import { logger } from "../utils/logger";
import { empurrarProposta, empurrarEventoDaProposta } from "../utils/crmOutbox";
import { canReopenProposal, buildReopenedProposalFields } from "../utils/proposalVersioning";
import { buildTemplateVariables, extractTemplatePlaceholders } from "../utils/docxTemplateEngine";
import { consolidarSugestoes, identificarVariaveisParaSugerir, montarPromptDeSugestao, podeSerSugeridaPelaIa, podeSerSubstituidaPorTextoAprovado } from "../utils/proposalAiAssist";
import { TEMPLATE_VARIABLE_CATALOG } from "../utils/templateVariableCatalog";
import { STATUS_DE_APONTAMENTO, exigeJustificativa, ehStatusFechado, recortarApontamento } from "../utils/proposalFindings";
import { revisarDocumentoGerado, AchadoDeRevisao } from "../utils/proposalQa";

const router = express.Router();
// F5: o template .docx passou a ser OBRIGATORIO para gerar proposta.
//
// O achado que motivou a fase: quando um template REAL existe, o documento sai inteiro dele - o
// cabecalho de marca do gerador generico nunca chegava a aparecer. O gerador generico produzia um
// texto plano sem timbre nenhum e era o unico lugar onde a identidade visual configuravel valia,
// ou seja, a tela de branding pintava um documento que quase ninguem gerava. Removida a tela,
// gerar uma proposta a partir do texto plano deixou de fazer sentido: o que o cliente recebe tem
// que sair do modelo cadastrado.
//
// Antes disto, a ausencia do arquivo fisico caia em silencio no gerador generico e a proposta saia
// com a formatacao padrao - o mesmo defeito que a F6 ja tinha fechado para template de formato
// errado, agora fechado tambem para template sem arquivo.
export const MENSAGEM_TEMPLATE_SEM_ARQUIVO =
  "O modelo .docx desta proposta nao esta disponivel: o template selecionado nao tem arquivo cadastrado no armazenamento. " +
  "Cadastre o modelo em Configuracoes > Templates de Propostas (envie o arquivo .docx) e gere a proposta novamente. " +
  "A proposta nao e mais gerada sem o modelo.";

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
  pricingLines: NonNullable<DocxTemplateData["pricing"]>["lines"],
  // F6: opcional para nao quebrar nenhuma das chamadas que nao tem campo customizado nenhum.
  templateFieldValues?: Record<string, string> | null
): DocxTemplateData {
  return {
    templateFieldValues: templateFieldValues ?? null,
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

// Template registrado num formato que o motor de merge não abre (legado .doc/.pdf, anterior à F6).
// Erro próprio para as três rotas que geram documento (POST, PUT e reabertura) poderem devolver 400
// com o motivo real, em vez de deixar virar 500 genérico ou, pior, uma proposta gerada errada.
export class TemplateNaoMesclavelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateNaoMesclavelError";
  }
}

// Renderiza (merge no template real quando existe, senão o gerador genérico) e grava DOCX/PDF -
// compartilhado entre POST (geração inicial) e PUT (regeneração ao editar campos estruturados).
async function renderAndWriteProposalDocuments(
  templateData: DocxTemplateData,
  template: Pick<ProposalTemplate, "file_type" | "storage_provider">,
  physicalFileFound: boolean,
  platformSettings: PlatformSettings,
  projectId: string,
  proposalType: string
): Promise<{ docx_file_path: string; pdf_file_path: string; proposalContent: string }> {
  const proposalContent = buildProposalText(templateData);

  /*
   * F6: um template registrado cujo arquivo existe mas NÃO é .docx não pode ser mesclado por este
   * motor, e isso passa a ser um erro explícito em vez de um fallback mudo.
   *
   * Era aqui que o bug relatado se manifestava: a condição abaixo simplesmente não era satisfeita
   * para um template .doc/.pdf, o merge não acontecia, e a proposta saía pelo gerador genérico com
   * a formatação padrão - o admin via "um arquivo de texto em vez da proposta" e nada no sistema
   * dizia que o template escolhido tinha sido ignorado. O cadastro já não aceita mais esses
   * formatos (o .doc é convertido no upload, o .pdf é recusado - ver server/routes/templates.ts),
   * então isto só alcança template legado, registrado antes desta fase, e o caminho certo para ele
   * é reenviar o arquivo - não gerar uma proposta errada em silêncio.
   *
   * F5: a ausencia do arquivo fisico deixou de cair no gerador generico e passou a ser recusa.
   * As rotas ja barram isso antes de gastar IA (ver MENSAGEM_TEMPLATE_SEM_ARQUIVO); a guarda
   * abaixo e a ultima linha, no funil unico por onde os tres caminhos de geracao passam - um
   * chamador novo que esqueca a checagem falha alto em vez de gerar o documento errado calado.
   */
  if (!physicalFileFound) {
    throw new TemplateNaoMesclavelError(MENSAGEM_TEMPLATE_SEM_ARQUIVO);
  }

  if (physicalFileFound && template.file_type !== "docx") {
    throw new TemplateNaoMesclavelError(
      `O template desta proposta está registrado como .${template.file_type}, formato que não pode ter as variáveis {{...}} mescladas. Reenvie o modelo em .docx (ou .doc, que é convertido automaticamente) no cadastro de templates e gere a proposta novamente.`
    );
  }

  // Chegou aqui, o arquivo existe e e .docx (as duas guardas acima) - o merge no template real e
  // o unico caminho, nao mais um override opcional sobre o gerador generico.
  const templateAdapter = createStorageAdapter({ ...platformSettings, storage_mode: template.storage_provider });
  const templateBuffer = await templateAdapter.readFile(templateData.template!.file_path);
  const docxBuffer = renderDocxFromTemplate(templateBuffer, templateData);

  const outputAdapter = createStorageAdapter(platformSettings);
  const { docx_file_path, pdf_file_path } = await writeProposalFiles(outputAdapter, projectId, proposalType, proposalContent, docxBuffer);
  return { docx_file_path, pdf_file_path, proposalContent };
}


/*
 * F6: placeholders REAIS do template desta proposta, lidos do arquivo.
 *
 * Tanto o QA (frente c) quanto o apoio de IA (frentes a/b) precisam saber o que o template pede -
 * nao o que alguem cadastrou a mao no variables_schema, que pode estar desatualizado em relacao ao
 * arquivo. Devolve lista vazia quando a proposta nao tem template com arquivo real (o caso do
 * gerador generico), e nesse caso as duas funcionalidades simplesmente nao tem o que oferecer.
 */
async function lerPlaceholdersDoTemplateDaProposta(
  template: ProposalTemplate | undefined,
  platformSettings: PlatformSettings
): Promise<string[]> {
  if (!template || template.file_type !== "docx") return [];
  try {
    const adapter = createStorageAdapter({ ...platformSettings, storage_mode: template.storage_provider });
    const buffer = await adapter.readFile(template.file_path);
    return extractTemplatePlaceholders(buffer);
  } catch {
    // Arquivo ausente/ilegivel ja e sinalizado por outro caminho (physical_file_found); aqui isso
    // so significa "nao ha o que conferir/sugerir", nunca um erro que derrube a requisicao.
    return [];
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
    // F5: recusa ANTES de responder 202 e disparar a geracao em background. Descobrir a ausencia
    // do arquivo la dentro custaria as chamadas de IA da montagem do documento e chegaria ao
    // usuario como task falhada, nao como resposta ao clique dele.
    if (!physicalFileFound) {
      return res.status(422).json({
        success: false,
        code: "TEMPLATE_SEM_ARQUIVO",
        message: MENSAGEM_TEMPLATE_SEM_ARQUIVO,
      });
    }

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
      const { docx_file_path, pdf_file_path, proposalContent } = await renderAndWriteProposalDocuments(
        templateData, template, physicalFileFound, platformSettings, projectId, proposalType
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
    // F6: template legado em formato que o motor nao mescla - o motivo real precisa chegar ao
    // admin (o errorHandler global, corretamente, so devolve mensagem generica).
    if (err instanceof TemplateNaoMesclavelError) {
      return res.status(400).json({ success: false, message: err.message });
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

  const { text, inputTokens, outputTokens, billedCostUsd } = await generateJsonWithProvider(providerResolution.provider as ConnectedProvider, providerResolution.model, prompt, { taskKey: "document_analysis", actorRef: buildActorRef("user", userId), triggerType: "user_action" });
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

/*
 * F6 (rodada 09/2026): as SEÇÕES DE TEXTO que um apontamento pode endereçar do lado do template.
 *
 * São as variáveis de valor do catálogo que sobrevivem à allowlist - na prática, as seções
 * redigidas (resumo executivo, contexto, riscos, estratégia, premissas técnicas, próximos passos).
 * Fato de cadastro, laço, preço e campo com edição estruturada própria já saíram pela allowlist,
 * então esta lista nunca oferece à IA uma seção que ninguém poderia gravar depois.
 *
 * Derivada, e não escrita à mão, por um motivo prático: uma lista literal aqui envelheceria em
 * silêncio na primeira variável nova do catálogo, que é a mesma classe de defasagem que o
 * ai_task_catalog da F4 acabou de corrigir do outro lado.
 */
const SECOES_DE_TEXTO_DO_TEMPLATE = TEMPLATE_VARIABLE_CATALOG
  .filter((v) => v.kind === "value" && podeSerSubstituidaPorTextoAprovado(v.name))
  .map((v) => ({ nome: v.name, descricao: v.description }));

// O apontamento pode não ter seção: nem toda observação de um revisor cabe num campo. "geral"
// existe para que a IA não seja empurrada a inventar um alvo só para preencher o formato - um
// apontamento transversal ("a proposta não diz quem opera o sistema depois da entrega") é
// legítimo e continua acionável na tela, só não tem botão de aplicar.
const FINDING_TARGET_KINDS = ["proposal_field", "template_field", "geral"] as const;

async function buildOpinionPrompt(
  perspective: OpinionPerspective,
  proposal: Proposal,
  project: Project,
  analysisResult: any,
  tenantId: string,
  platformSettings: PlatformSettings,
  userId: string,
  suggestibleFields: readonly ProposalEditableField[],
  secoesDeTexto: readonly { nome: string; descricao: string }[]
): Promise<string> {
  const header = `PROJECT: ${project.name} | Customer: ${project.customer_name} | Vertical: ${project.vertical}\n`;
  // The AI never edits the proposal itself - suggested_field/suggested_value is only ever a
  // recommendation the human reviewer applies explicitly (an "Apply" button in the client PUTs it
  // to /proposals/:id). Omitted entirely from the requested shape when this proposal's type owns
  // no suggestible field (the 4 report types), so the model isn't even offered the option.
  const suggestionInstruction = suggestibleFields.length > 0
    ? ` If (and only if) you have ONE concrete, specific change to recommend to one of this proposal's own fields, also include "suggested_field" (exactly one of: ${suggestibleFields.map((f) => `"${f}"`).join(", ")}) and "suggested_value" (the full exact replacement text for that field, in ${proposal.language}). Leave both out if you have no single concrete field-level change to propose - most reviews won't have one, and a vague/general suggestion doesn't count.`
    : "";

  /*
   * F6: a mudança de forma do parecer. Ele deixa de ser 2-4 parágrafos em modo leitura e passa a
   * carregar APONTAMENTOS - cada um com título, detalhe, severidade e a seção que afeta.
   *
   * A razão é operacional, não estética: não se dirime um parágrafo. Um apontamento tem ciclo
   * (aberto -> em tratativa -> resolvido / aceito com risco / descartado), e sem identidade própria
   * não há o que marcar como resolvido, o que aceitar com risco, nem o que a F7 vai comparar entre
   * duas rodadas para separar progresso de "a IA inventa apontamento toda vez".
   *
   * `summary`/`content` continuam: o parecer narrativo é o que dá contexto aos apontamentos, e as
   * 8 rodadas geradas antes desta fase seguem legíveis exatamente como estão.
   */
  const alvosProposta = suggestibleFields.length > 0
    ? `\n  - "proposal_field": target_key must be exactly one of ${suggestibleFields.map((f) => `"${f}"`).join(", ")}`
    : "";
  const alvosTemplate = secoesDeTexto.length > 0
    ? `\n  - "template_field": target_key must be exactly one of ${secoesDeTexto.map((v) => `"${v.nome}"`).join(", ")}`
    : "";
  const findingsInstruction = `\n\nEach finding is ONE specific, self-contained point a human reviewer can act on and then close - not a paragraph of prose split in pieces. Give 0 to 6 of them; zero is a valid and honest answer when the proposal is sound from your perspective. NEVER pad the list to look thorough: a vague finding costs a reviewer the same time as a real one.
"target_kind" says which section the finding is about:${alvosProposta}${alvosTemplate}
  - "geral": use when the point is transversal or you cannot tie it to one of the sections above. Then target_key must be null.
Set "suggested_value" ONLY when target_kind is not "geral" AND you can write the full exact replacement text for that section, in ${proposal.language}. Otherwise leave it null - a suggestion that just restates the problem is worse than none.
Never propose changing a price, a quantity, a BOM item or the customer's name: those are facts the system owns and the server will reject them.`;

  const responseShape = `\n\nRespond with ONLY a JSON object (no markdown, no extra text), in this exact shape:\n{ "severity": "info"|"warning"|"critical", "summary": "one sentence in ${proposal.language}", "content": "2-4 short paragraphs in ${proposal.language}", "suggested_field": string|null, "suggested_value": string|null, "findings": [{ "title": "short title in ${proposal.language}", "detail": "1-2 sentences in ${proposal.language}", "severity": "info"|"warning"|"critical", "target_kind": "proposal_field"|"template_field"|"geral", "target_key": string|null, "suggested_value": string|null }] }.${suggestionInstruction}${findingsInstruction}`;

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
            const prompt = await buildOpinionPrompt(perspective, proposal, project, analysisResult, tenantId, platformSettings, userId, suggestibleFields, SECOES_DE_TEXTO_DO_TEMPLATE);
            let rawText = "", inputTokens = 0, outputTokens = 0, billedCostUsd: number | undefined;
            for (let attempt = 0; attempt < 2; attempt++) {
              try {
                const result = await generateJsonWithProvider(providerResolution.provider as ConnectedProvider, providerResolution.model, prompt, { taskKey: "proposal_opinion_panel", actorRef: buildActorRef("user", task.user_id), triggerType: "background_task" });
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
              // F6: `.catch([])` e nao `.optional()` - um modelo que devolva "findings" malformado
              // nao pode derrubar o parecer inteiro, que continua util em modo narrativo. O que
              // NAO se faz aqui e aceitar o conteudo sem validar: cada apontamento passa pelo
              // recorte abaixo, contra as listas do servidor.
              findings: z.array(z.object({
                title: z.string(),
                detail: z.string(),
                severity: z.enum(["info", "warning", "critical"]),
                target_kind: z.string(),
                target_key: z.string().nullish(),
                suggested_value: z.string().nullish(),
              })).catch([]),
            }).parse(parsed);

            // Re-validate against the server's own allowlist rather than trusting the model - a
            // hallucinated field name, a field this proposal's type doesn't own, or a suggestion
            // with no value all get dropped down to a plain narrative opinion (never a hard
            // failure: the rest of the opinion is still useful even with no applicable suggestion).
            const isValidSuggestion = !!opinion.suggested_field
              && !!opinion.suggested_value
              && (suggestibleFields as readonly string[]).includes(opinion.suggested_field);

            const opinionId = randomId("poi");
            await prisma.proposalAiOpinionItem.create({
              data: {
                id: opinionId,
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

            /*
             * F6: os apontamentos, recortados contra as listas do SERVIDOR antes de virarem linha.
             *
             * Mesma disciplina do `isValidSuggestion` acima, e pela mesma razao: o modelo pode
             * inventar um nome de campo, apontar para um campo que este tipo de proposta nao tem,
             * ou tentar `preco_total` apesar da instrucao. Nada disso vira erro - o apontamento
             * DESCE para "geral", perdendo o botao de aplicar mas mantendo o texto, que continua
             * sendo uma observacao legitima de um revisor. Descartar o apontamento inteiro por
             * causa de um alvo errado jogaria fora a parte que valia.
             */
            const alvosDeProposta = new Set<string>(suggestibleFields as readonly string[]);
            const alvosDeTemplate = new Set(SECOES_DE_TEXTO_DO_TEMPLATE.map((v) => v.nome));
            const apontamentos = opinion.findings.map((f, indice) => ({
              id: randomId("pof"),
              tenantId,
              opinionId,
              ordinal: indice,
              ...recortarApontamento(f, alvosDeProposta, alvosDeTemplate),
              status: "aberto",
            }));
            if (apontamentos.length > 0) {
              await prisma.proposalOpinionFinding.createMany({ data: apontamentos });
            }
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
      // F6: `findings` sai ordenado pelo ordinal com que a IA os devolveu - a ordem em que um
      // revisor escreveria os pontos e informacao, e reordenar por severidade misturaria a
      // leitura. Rodadas com logicVersion < 2 simplesmente vem com a lista vazia: elas foram
      // geradas antes de existirem apontamentos, e o parecer narrativo delas continua inteiro.
      include: { opinions: { include: { findings: { orderBy: { ordinal: "asc" } } } } },
    });

    /*
     * F6: serializa em snake_case, que e a convencao de TODA a API deste produto (src/types.ts).
     *
     * Isto conserta um bug que esta fase encontrou, e que e anterior a ela: este endpoint devolvia
     * o objeto do Prisma cru, em camelCase, enquanto o cliente sempre leu `suggested_field` /
     * `suggested_value`. Ou seja, o botao "Aplicar" do parecer acionavel (a PARTE B) NUNCA apareceu
     * na tela - as duas pontas foram escritas com convencoes diferentes e nada as confrontou,
     * porque so 2 das 32 opinioes gravadas ate hoje tinham sugestao, e nenhuma delas foi olhada na
     * tela depois. Os apontamentos da F6 cairiam no mesmo buraco: foi assim que ele apareceu.
     */
    if (!run) {
      return res.json({ success: true, run: null });
    }
    res.json({
      success: true,
      run: {
        id: run.id,
        status: run.status,
        logic_version: run.logicVersion,
        created_at: run.createdAt,
        completed_at: run.completedAt,
        opinions: run.opinions.map((o) => ({
          id: o.id,
          perspective: o.perspective,
          status: o.status,
          severity: o.severity,
          summary: o.summary,
          content: o.content,
          suggested_field: o.suggestedField,
          suggested_value: o.suggestedValue,
          provider_used: o.providerUsed,
          model_used: o.modelUsed,
          findings: o.findings.map((f) => ({
            id: f.id,
            ordinal: f.ordinal,
            title: f.title,
            detail: f.detail,
            severity: f.severity,
            target_kind: f.targetKind,
            target_key: f.targetKey,
            suggested_value: f.suggestedValue,
            status: f.status,
            resolution_note: f.resolutionNote,
            resolved_by_user_id: f.resolvedByUserId,
            resolved_at: f.resolvedAt,
          })),
        })),
      },
    });
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
      // F5: sem o arquivo do modelo nao ha o que regerar. Recusar aqui preserva o documento que a
      // proposta ja tem - o caminho antigo sobrescrevia um DOCX vindo de template por um texto
      // plano do gerador generico assim que o arquivo sumisse do armazenamento.
      if (!physicalFileFound) {
        return res.status(422).json({
          success: false,
          code: "TEMPLATE_SEM_ARQUIVO",
          message: MENSAGEM_TEMPLATE_SEM_ARQUIVO,
        });
      }
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
        pricingLines,
        // F6: os campos livres aprovados por uma pessoa entram no merge deste documento.
        existingProposal.template_field_values
      );

      const { docx_file_path, pdf_file_path, proposalContent } = await renderAndWriteProposalDocuments(
        templateData,
        template ?? { file_type: "docx" as const, storage_provider: existingProposal.storage_provider },
        physicalFileFound,
        platformSettings,
        existingProposal.project_id,
        existingProposal.proposal_type
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
    // F6: template legado em formato que o motor nao mescla - o motivo real precisa chegar ao
    // admin (o errorHandler global, corretamente, so devolve mensagem generica).
    if (err instanceof TemplateNaoMesclavelError) {
      return res.status(400).json({ success: false, message: err.message });
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
    // F5: mesma recusa da geracao e da regeneracao - reabrir uma proposta sem o arquivo do modelo
    // produziria um documento que nao veio do template escolhido.
    if (!physicalFileFound) {
      return res.status(422).json({
        success: false,
        code: "TEMPLATE_SEM_ARQUIVO",
        message: MENSAGEM_TEMPLATE_SEM_ARQUIVO,
      });
    }
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
      pricingLines,
      // F6: os campos livres aprovados por uma pessoa entram no merge deste documento.
      rejected.template_field_values
    );

    const { docx_file_path, pdf_file_path, proposalContent } = await renderAndWriteProposalDocuments(
      templateData,
      template ?? { file_type: "docx" as const, storage_provider: rejected.storage_provider },
      physicalFileFound,
      platformSettings,
      rejected.project_id,
      rejected.proposal_type
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
    // F6: mesma razao do catch das rotas de geracao/edicao - a reabertura tambem regenera
    // documento e precisa dizer ao admin que o template registrado nao pode ser mesclado.
    if (err instanceof TemplateNaoMesclavelError) {
      return res.status(400).json({ success: false, message: err.message });
    }
    next(err);
  }
});

/*
 * F6, frente (c): revisao/QA do documento final gerado.
 *
 * Sem IA e sem custo - ver o cabecalho de server/utils/proposalQa.ts para o porque. Rota propria
 * (em vez de embutida na geracao) porque a revisao vale para qualquer proposta ja existente,
 * inclusive as geradas antes desta fase, e porque quem revisa quer poder repetir a conferencia
 * depois de editar campos.
 */
router.get("/proposals/:id/revisao", requirePermission("proposal:edit"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const proposal = await dbStore.getProposal(req.params.id);
    if (!proposal) {
      return res.status(404).json({ success: false, message: "Proposal not found." });
    }
    const project = await dbStore.getProject(proposal.project_id);
    if (!project) {
      return res.status(404).json({ success: false, message: "Project not found." });
    }

    const platformSettings = await dbStore.getSettings();
    const templates = await dbStore.getProposalTemplates();
    const template = templates.find((t) => t.id === proposal.template_id);

    if (!proposal.docx_file_path) {
      return res.status(409).json({
        success: false,
        message: "Esta proposta ainda não tem documento gerado para revisar.",
      });
    }

    const adapter = createStorageAdapter({ ...platformSettings, storage_mode: proposal.storage_provider });
    const docxBuffer = await adapter.readFile(proposal.docx_file_path);

    const analysis = await dbStore.getAnalysisResult(proposal.project_id);
    const { pricingLines } = await resolvePricingLines(req.headers["x-tenant-id"] as string, proposal.project_id);
    const owner = await dbStore.getUserById(project.owner_user_id);
    const templateData = buildProposalTemplateData(
      template ?? { id: "", name: "", version: "", template_type: proposal.proposal_type, file_path: "" },
      false,
      project,
      owner ? owner.name : undefined,
      analysis,
      {
        manual_pricing_table: proposal.manual_pricing_table as any,
        payment_terms: proposal.payment_terms ?? undefined,
        delivery_terms: proposal.delivery_terms ?? undefined,
        proposal_validity: proposal.proposal_validity ?? undefined,
        commercial_assumptions: proposal.commercial_assumptions ?? undefined,
        exclusions: proposal.exclusions ?? undefined,
      },
      pricingLines
    );

    const placeholdersDoTemplate = await lerPlaceholdersDoTemplateDaProposta(template, platformSettings);
    const achados: AchadoDeRevisao[] = revisarDocumentoGerado({
      docxBuffer,
      placeholdersDoTemplate,
      variaveisResolvidas: buildTemplateVariables(templateData) as Record<string, unknown>,
    });

    res.json({
      success: true,
      // Lista vazia aqui significa "conferido e limpo", nao "nao checado" - a diferenca importa
      // para quem le a tela antes de mandar a proposta ao cliente.
      achados,
      total: achados.length,
      bloqueantes: achados.filter((a) => a.severidade === "alta").length,
    });
  } catch (err) {
    next(err);
  }
});

/*
 * F6, frentes (a) e (b): sugestoes de IA para os campos de texto que sairiam em branco.
 *
 * Devolve SUGESTAO, nunca grava - aplicar e um clique humano no client, pelo PUT /proposals/:id
 * que ja existe (mesmo contrato do parecer acionavel da F7). Usa o task type proposal_generation,
 * cuja configuracao de provedor/modelo ja existia no Admin sem nunca ter sido usada.
 */
router.post("/proposals/:id/sugerir-conteudo", requirePermission("proposal:edit"), async (req: Request, res: Response, next: NextFunction) => {
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
        message: `Monthly AI cost cap reached ($${costCap.currentSpendUsd.toFixed(2)} of $${costCap.capUsd?.toFixed(2)}). Sugestão de conteúdo bloqueada até o próximo mês ou até o teto ser elevado em Admin > IA, Prompts e Custos.`,
      });
    }

    const templates = await dbStore.getProposalTemplates();
    const template = templates.find((t) => t.id === proposal.template_id);
    const placeholdersDoTemplate = await lerPlaceholdersDoTemplateDaProposta(template, platformSettings);
    if (placeholdersDoTemplate.length === 0) {
      return res.status(409).json({
        success: false,
        message: "Esta proposta não usa um template .docx com variáveis, então não há campos para sugerir.",
      });
    }

    const analysis = await dbStore.getAnalysisResult(proposal.project_id);
    if (!analysis) {
      return res.status(409).json({
        success: false,
        message: "Este projeto ainda não tem análise técnica — ela é a fonte de fatos das sugestões.",
      });
    }

    const { pricingLines } = await resolvePricingLines(tenantId, proposal.project_id);
    const owner = await dbStore.getUserById(project.owner_user_id);
    const templateData = buildProposalTemplateData(
      template ?? { id: "", name: "", version: "", template_type: proposal.proposal_type, file_path: "" },
      false,
      project,
      owner ? owner.name : undefined,
      analysis,
      {
        manual_pricing_table: proposal.manual_pricing_table as any,
        payment_terms: proposal.payment_terms ?? undefined,
        delivery_terms: proposal.delivery_terms ?? undefined,
        proposal_validity: proposal.proposal_validity ?? undefined,
        commercial_assumptions: proposal.commercial_assumptions ?? undefined,
        exclusions: proposal.exclusions ?? undefined,
      },
      pricingLines
    );

    const variaveis = identificarVariaveisParaSugerir(
      placeholdersDoTemplate,
      buildTemplateVariables(templateData) as Record<string, unknown>
    );

    if (variaveis.length === 0) {
      return res.json({
        success: true,
        sugestoes: [],
        message: "Nenhum campo de texto do template ficou em branco — não há o que sugerir.",
      });
    }

    const userId = requireUserId(req);
    const providerResolution = await resolveProvider("proposal_generation", platformSettings);
    if (providerResolution.isFallback) {
      await recordProviderFallback({ tenantId, taskType: "proposal_generation", intendedProvider: providerResolution.intendedProvider, userId });
    }

    const prompt = montarPromptDeSugestao({
      variaveis,
      idioma: proposal.language,
      projeto: {
        nome: project.name,
        cliente: project.customer_name,
        vertical: project.vertical,
        escopo: project.description,
      },
      analise: {
        resumo_executivo: analysis.executive_summary,
        requisitos_criticos: analysis.critical_requirements,
        riscos: analysis.risks,
      },
    });

    const { text, inputTokens, outputTokens, billedCostUsd } = await generateJsonWithProvider(
      providerResolution.provider as ConnectedProvider,
      providerResolution.model,
      prompt,
      { taskKey: "proposal_generation", actorRef: buildActorRef("user", userId), triggerType: "user_action" }
    );

    const parsed = parseAiJson(text);
    const respostaDoModelo = z.array(z.object({
      variavel: z.string(),
      valor_sugerido: z.string(),
      justificativa: z.string().optional(),
    })).parse(parsed);

    await recordAiUsage({
      tenantId,
      taskType: "proposal_generation",
      provider: providerResolution.provider,
      model: providerResolution.model,
      estimatedCostUsd: billedCostUsd ?? estimateCostUsd(providerResolution.model, inputTokens, outputTokens),
      userId,
    });

    const sugestoes = consolidarSugestoes(variaveis, respostaDoModelo);

    await dbStore.addAuditLog({
      user_id: userId,
      action: "Suggest Proposal Content",
      entity_type: "Proposal",
      entity_id: proposal.id,
      ip_address: req.ip || "127.0.0.1",
      user_agent: req.headers["user-agent"] || "unknown",
      metadata: JSON.stringify({ campos_pedidos: variaveis.map((v) => v.nome), campos_sugeridos: sugestoes.map((s) => s.variavel) }),
    });

    res.json({
      success: true,
      sugestoes,
      // A IA nunca escreve na proposta: o client aplica campo a campo, com confirmacao, pelo
      // PUT /proposals/:id que ja valida o allowlist por tipo de proposta (F7).
      aplicar_exige_confirmacao: true,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(502).json({ success: false, message: "A resposta do provedor de IA não veio no formato esperado." });
    }
    next(err);
  }
});

/*
 * F6: grava os valores das variaveis livres do template APROVADOS por uma pessoa.
 *
 * Este e o unico caminho de escrita das sugestoes das frentes (a)/(b) - a rota que fala com a IA
 * (/sugerir-conteudo) devolve texto e nada mais. Aqui e onde o clique humano vira dado, e por isso
 * a allowlist e reaplicada: mesmo que alguem chame esta rota direto, sem passar pela sugestao,
 * nao consegue gravar preco, quantidade ou item de BOM sob o nome de uma variavel de template.
 *
 * Regenerar o documento e responsabilidade do PUT /proposals/:id que ja existe - manter isso
 * separado evita duplicar o caminho de regeneracao (e a delecao de arquivo antigo que ele faz).
 */
router.put("/proposals/:id/campos-do-template", requirePermission("proposal:edit"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const proposal = await dbStore.getProposal(req.params.id);
    if (!proposal) {
      return res.status(404).json({ success: false, message: "Proposal not found." });
    }
    if (proposal.status !== "draft") {
      return res.status(409).json({
        success: false,
        message: "Só uma proposta em rascunho pode ter os campos do template alterados.",
      });
    }

    const corpo = z.object({
      campos: z.record(z.string(), z.string()),
      // F6: quem esta gravando e por que. Opcionais para nao quebrar nenhum chamador anterior -
      // sem eles a edicao entra como "humano" sem apontamento, que e a verdade de quem chamou
      // esta rota antes desta fase existir.
      origem: z.enum(["humano", "ia", "ia_editada"]).optional(),
      apontamento_id: z.string().optional(),
    }).parse(req.body);

    // F6: a barreira agora e `podeSerSubstituidaPorTextoAprovado` - a mesma allowlist de antes,
    // ampliada com os fatos de cadastro que perderam a protecao da regra do vazio. Ver o
    // comentario grande em server/utils/proposalAiAssist.ts.
    const recusados = Object.keys(corpo.campos).filter((nome) => !podeSerSubstituidaPorTextoAprovado(nome));
    if (recusados.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Estes campos têm fonte de dado própria no sistema e não podem ser preenchidos à mão: ${recusados.join(", ")}.`,
      });
    }

    // Merge sobre o que ja existe: a tela pode aplicar uma sugestao de cada vez, e cada chamada
    // nao pode apagar o que a anterior aprovou.
    const atuais = proposal.template_field_values ?? {};
    const combinados: Record<string, string> = { ...atuais };
    for (const [nome, valor] of Object.entries(corpo.campos)) {
      // String vazia e como o client REMOVE um campo aprovado.
      if (valor.trim().length === 0) delete combinados[nome];
      else combinados[nome] = valor;
    }

    const atualizada = await dbStore.updateProposal(proposal.id, {
      template_field_values: Object.keys(combinados).length > 0 ? combinados : null,
    });

    const userId = requireUserId(req);

    /*
     * F6: o historico por secao. Escrito AQUI, no unico ponto onde um valor de template vira dado
     * - nao no motor que mescla, que tambem roda em pre-visualizacao e em regeracao e inventaria
     * "edicoes" que ninguem fez.
     *
     * Ele existe por causa da regra nova: com substituicao explicita, um texto aprovado passa a
     * poder COBRIR o que a analise havia escrito. `previousValue` e o que estava la, e sem ele a
     * troca seria perda silenciosa. `origin` distingue o que a pessoa escreveu do que a IA sugeriu
     * e do que a pessoa editou por cima da sugestao - o AuditLog generico nao carrega isso, e e
     * exatamente a distincao que a revisao da proxima fase vai precisar ler.
     *
     * O valor anterior sai de `atuais`, e nao do documento renderizado, de proposito: e o valor
     * que ESTA rota escreveu da ultima vez. Quando nao ha (primeira vez que a secao e tocada),
     * fica null - "estava como a analise deixou".
     */
    const historico = Object.entries(corpo.campos)
      .filter(([, valor]) => valor.trim().length > 0)
      .map(([nome, valor]) => ({
        id: randomId("pse"),
        tenantId: req.headers["x-tenant-id"] as string,
        proposalId: proposal.id,
        targetKind: "template_field",
        targetKey: nome,
        previousValue: (atuais as Record<string, string>)[nome] ?? null,
        newValue: valor,
        origin: corpo.origem ?? "humano",
        findingId: corpo.apontamento_id ?? null,
        authorUserId: userId,
      }));
    if (historico.length > 0) {
      await prisma.proposalSectionEdit.createMany({ data: historico });
    }
    await dbStore.addAuditLog({
      user_id: userId,
      action: "Update Proposal Template Fields",
      entity_type: "Proposal",
      entity_id: proposal.id,
      ip_address: req.ip || "127.0.0.1",
      user_agent: req.headers["user-agent"] || "unknown",
      metadata: JSON.stringify({ campos: Object.keys(corpo.campos) }),
    });

    res.json({
      success: true,
      template_field_values: atualizada?.template_field_values ?? null,
      // O documento so muda quando a proposta for regerada pelo PUT /proposals/:id.
      documento_regenerado: false,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.issues[0].message });
    }
    next(err);
  }
});

/*
 * F6 (rodada 09/2026): o CICLO DE UM APONTAMENTO.
 *
 * aberto -> em_tratativa -> resolvido | aceito_com_risco | descartado.
 *
 * Os dois ultimos EXIGEM justificativa, e a exigencia mora AQUI, no servidor, nao no formulario.
 * Nao e preciosismo: "aceito com risco" e a unica saida que a F7 vai oferecer para submeter uma
 * proposta com apontamento critico em aberto, e um gate cuja unica trava e a validacao do
 * formulario nao e um gate - basta uma chamada direta a rota para atravessa-lo. A justificativa e
 * a peca que sobra depois, para quem tiver de explicar por que a proposta foi assim mesmo.
 *
 * `descartado` exige justificativa pela mesma razao invertida: dizer que o apontamento nao
 * procedia e uma afirmacao sobre o parecer, e ela precisa de autor e motivo registrados.
 * `resolvido` NAO exige: o que sustenta um "resolvido" e a mudanca na secao, que o historico
 * (ProposalSectionEdit) ja registra com autor, instante e apontamento que a motivou.
 */
router.patch("/proposals/:id/apontamentos/:findingId", requirePermission("proposal:edit"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const proposal = await dbStore.getProposal(req.params.id);
    if (!proposal) {
      return res.status(404).json({ success: false, message: "Proposal not found." });
    }

    const corpo = z.object({
      status: z.enum(STATUS_DE_APONTAMENTO),
      justificativa: z.string().optional(),
    }).parse(req.body);

    // O apontamento tem de ser DESTA proposta. Sem esta checagem o id na URL seria decorativo e
    // qualquer apontamento do tenant poderia ser movido pela rota de outra proposta.
    const apontamento = await prisma.proposalOpinionFinding.findUnique({
      where: { id: req.params.findingId },
      include: { opinion: { include: { run: true } } },
    });
    if (!apontamento || apontamento.opinion.run.proposalId !== proposal.id) {
      return res.status(404).json({ success: false, message: "Apontamento não encontrado nesta proposta." });
    }

    const justificativa = corpo.justificativa?.trim() || "";
    if (exigeJustificativa(corpo.status) && justificativa.length === 0) {
      return res.status(400).json({
        success: false,
        message: corpo.status === "aceito_com_risco"
          ? "Aceitar um apontamento com risco exige justificativa: registre quem decidiu seguir assim e por quê."
          : "Descartar um apontamento exige justificativa: registre por que ele não procede.",
      });
    }

    const fechado = ehStatusFechado(corpo.status);
    const userId = requireUserId(req);
    const atualizado = await prisma.proposalOpinionFinding.update({
      where: { id: apontamento.id },
      data: {
        status: corpo.status,
        // Reabrir limpa a justificativa e o carimbo: manter o "resolvido por fulano" de um
        // apontamento que voltou a estar aberto seria afirmar algo falso na tela.
        resolutionNote: fechado ? justificativa : null,
        resolvedByUserId: fechado ? userId : null,
        resolvedAt: fechado ? new Date() : null,
      },
    });

    await dbStore.addAuditLog({
      user_id: userId,
      action: "Update Proposal Finding Status",
      entity_type: "Proposal",
      entity_id: proposal.id,
      ip_address: req.ip || "127.0.0.1",
      user_agent: req.headers["user-agent"] || "unknown",
      metadata: JSON.stringify({ apontamento_id: apontamento.id, de: apontamento.status, para: corpo.status, tem_justificativa: justificativa.length > 0 }),
    });

    res.json({ success: true, apontamento: atualizado });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.issues[0].message });
    }
    next(err);
  }
});

/*
 * F6: quais SECOES DE TEXTO esta proposta tem, para a aba TEXTO do modal.
 *
 * Lidas do template REAL (os placeholders do .docx), e nao do catalogo inteiro: oferecer para
 * edicao uma secao que o template desta proposta nao usa produziria um campo cujo texto nunca
 * apareceria no documento - a versao de tela do bug que a F5 fechou no servidor. Uma variavel
 * livre (placeholder que o autor do template inventou, sem entrada no catalogo) entra tambem, com
 * descricao vazia: ela e justamente o caso em que ninguem alem do autor sabe o que se espera ali.
 */
router.get("/proposals/:id/secoes-de-texto", requirePermission("proposal:edit"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const proposal = await dbStore.getProposal(req.params.id);
    if (!proposal) {
      return res.status(404).json({ success: false, message: "Proposal not found." });
    }
    const platformSettings = await dbStore.getSettings();
    const templates = await dbStore.getProposalTemplates();
    const template = templates.find((t) => t.id === proposal.template_id);
    const placeholders = await lerPlaceholdersDoTemplateDaProposta(template, platformSettings);

    const doCatalogo = new Map(TEMPLATE_VARIABLE_CATALOG.map((v) => [v.name, v]));
    const secoes = [...new Set(placeholders)]
      .filter((nome) => podeSerSubstituidaPorTextoAprovado(nome))
      .map((nome) => ({
        nome,
        descricao: doCatalogo.get(nome)?.description ?? "",
        // Uma variavel livre nao tem fonte nenhuma no sistema; uma do catalogo e uma secao que a
        // analise tenta preencher. A tela usa isso para dizer de onde veio o texto que esta la.
        origem: doCatalogo.has(nome) ? "secao_de_texto" : "variavel_livre",
        valor_aprovado: (proposal.template_field_values ?? {})[nome] ?? null,
      }));

    res.json({ success: true, secoes });
  } catch (err) {
    next(err);
  }
});

/*
 * F6: "pedir sugestao a IA" para UMA secao, com os apontamentos daquela secao como contexto.
 *
 * Tarefa de IA propria (`proposal_section_rewrite`), e nao reuso de `proposal_generation`, porque
 * as duas fazem coisas diferentes com risco diferente: proposal_generation preenche o que saiu EM
 * BRANCO; esta reescreve o que ja esta escrito. Ela e a unica chamada de IA do produto cujo texto
 * pode cobrir conteudo existente - e sob a bilhetagem que a F4 entregou: task_key tipado,
 * actor_ref do usuario que clicou e trigger_type "user_action", porque e um clique, nao um job.
 *
 * A IA continua sem escrever nada: a rota devolve texto. Gravar e o PUT campos-do-template acima,
 * com um clique humano, e e la que o historico registra se o texto salvo foi o da IA ou uma versao
 * editada por cima dele.
 */
router.post("/proposals/:id/secoes/:targetKey/sugerir-texto", requirePermission("proposal:edit"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const proposal = await dbStore.getProposal(req.params.id);
    if (!proposal) {
      return res.status(404).json({ success: false, message: "Proposal not found." });
    }
    if (proposal.status !== "draft") {
      return res.status(409).json({ success: false, message: "Só uma proposta em rascunho pode ter seções reescritas." });
    }

    const secao = req.params.targetKey;
    if (!podeSerSubstituidaPorTextoAprovado(secao)) {
      return res.status(400).json({
        success: false,
        message: `"${secao}" tem fonte de dado própria no sistema e não pode ser reescrita por texto.`,
      });
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
        message: `Monthly AI cost cap reached ($${costCap.currentSpendUsd.toFixed(2)} of $${costCap.capUsd?.toFixed(2)}). Reescrita de seção bloqueada até o próximo mês ou até o teto ser elevado em Admin > IA, Prompts e Custos.`,
      });
    }

    // Os apontamentos ABERTOS desta secao sao o pedido. Um apontamento ja resolvido ou descartado
    // nao volta a pauta: reabri-lo no prompt faria a IA "corrigir" de novo o que alguem ja fechou.
    const apontamentos = proposal.latest_opinion_run_id
      ? await prisma.proposalOpinionFinding.findMany({
          where: {
            opinion: { runId: proposal.latest_opinion_run_id },
            targetKind: "template_field",
            targetKey: secao,
            status: { in: ["aberto", "em_tratativa"] },
          },
          include: { opinion: true },
          orderBy: { ordinal: "asc" },
        })
      : [];

    const analysis = await dbStore.getAnalysisResult(proposal.project_id);
    const { pricingLines } = await resolvePricingLines(tenantId, proposal.project_id);
    const templates = await dbStore.getProposalTemplates();
    const template = templates.find((t) => t.id === proposal.template_id);
    const owner = await dbStore.getUserById(project.owner_user_id);
    const templateData = buildProposalTemplateData(
      template ?? { id: "", name: "", version: "", template_type: proposal.proposal_type, file_path: "" },
      false,
      project,
      owner ? owner.name : undefined,
      analysis,
      {
        manual_pricing_table: proposal.manual_pricing_table as any,
        payment_terms: proposal.payment_terms ?? undefined,
        delivery_terms: proposal.delivery_terms ?? undefined,
        proposal_validity: proposal.proposal_validity ?? undefined,
        commercial_assumptions: proposal.commercial_assumptions ?? undefined,
        exclusions: proposal.exclusions ?? undefined,
      },
      pricingLines
    );
    const variaveis = buildTemplateVariables(templateData) as Record<string, unknown>;
    const textoAtual = typeof variaveis[secao] === "string" ? (variaveis[secao] as string) : "";
    const descricao = TEMPLATE_VARIABLE_CATALOG.find((v) => v.name === secao)?.description
      || "Variável livre do template, sem descrição no catálogo.";

    const apontamentosTexto = apontamentos.length > 0
      ? apontamentos.map((a) => `- [${a.severity}] ${a.title}: ${a.detail}`).join("\n")
      : "Nenhum apontamento aberto para esta seção - o pedido é apenas melhorar a redação sem mudar os fatos.";

    const prompt = `Você reescreve UMA seção de uma proposta comercial, em ${proposal.language}.

PROJETO: ${project.name} | Cliente: ${project.customer_name} | Vertical: ${project.vertical}
ESCOPO: ${project.description}

SEÇÃO A REESCREVER: "${secao}" — ${descricao}

TEXTO ATUAL DA SEÇÃO:
${textoAtual.trim().length > 0 ? textoAtual : "(a seção está vazia)"}

APONTAMENTOS ABERTOS SOBRE ESTA SEÇÃO (é isto que o texto novo precisa endereçar):
${apontamentosTexto}

Regras:
- Reescreva APENAS esta seção. Não escreva título, não escreva preâmbulo, não comente o que mudou.
- Endereça cada apontamento acima. Se um deles pedir um dado que você não tem, escreva o texto de
  forma que a lacuna fique explícita para quem revisa, e não invente o dado.
- NUNCA invente preço, quantidade, prazo, item de BOM, nome de fabricante ou nome de cliente.
- Mantenha o tom e o nível de detalhe do texto atual, quando houver um.

Responda com ONLY um objeto JSON, sem markdown:
{ "texto": "o texto novo da seção, em ${proposal.language}", "o_que_mudou": "uma frase em ${proposal.language} dizendo o que você endereçou" }`;

    const userId = requireUserId(req);
    const providerResolution = await resolveProvider("proposal_section_rewrite", platformSettings);
    if (providerResolution.isFallback) {
      await recordProviderFallback({ tenantId, taskType: "proposal_section_rewrite", intendedProvider: providerResolution.intendedProvider, userId });
    }

    const { text, inputTokens, outputTokens, billedCostUsd } = await generateJsonWithProvider(
      providerResolution.provider as ConnectedProvider,
      providerResolution.model,
      prompt,
      { taskKey: "proposal_section_rewrite", actorRef: buildActorRef("user", userId), triggerType: "user_action" }
    );

    const sugestao = z.object({
      texto: z.string(),
      o_que_mudou: z.string().optional(),
    }).parse(parseAiJson(text));

    await recordAiUsage({
      tenantId,
      taskType: "proposal_section_rewrite",
      provider: providerResolution.provider,
      model: providerResolution.model,
      estimatedCostUsd: billedCostUsd ?? estimateCostUsd(providerResolution.model, inputTokens, outputTokens),
      userId,
    });

    await dbStore.addAuditLog({
      user_id: userId,
      action: "Suggest Proposal Section Rewrite",
      entity_type: "Proposal",
      entity_id: proposal.id,
      ip_address: req.ip || "127.0.0.1",
      user_agent: req.headers["user-agent"] || "unknown",
      metadata: JSON.stringify({ secao, apontamentos: apontamentos.map((a) => a.id) }),
    });

    res.json({
      success: true,
      secao,
      texto_atual: textoAtual,
      texto_sugerido: sugestao.texto,
      o_que_mudou: sugestao.o_que_mudou ?? null,
      apontamentos_considerados: apontamentos.map((a) => ({ id: a.id, title: a.title, severity: a.severity })),
      // A IA nunca grava: aplicar e um PUT /proposals/:id/campos-do-template com o clique humano.
      aplicar_exige_confirmacao: true,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(502).json({ success: false, message: "A resposta do provedor de IA não veio no formato esperado." });
    }
    next(err);
  }
});

// F6: o historico por secao, do mais recente para o mais antigo. Quem escreveu, quando, se veio da
// IA e qual apontamento motivou - o `finding` vem junto para a tela poder nomear o apontamento em
// vez de mostrar um id.
router.get("/proposals/:id/historico-de-secoes", requirePermission("proposal:edit"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const proposal = await dbStore.getProposal(req.params.id);
    if (!proposal) {
      return res.status(404).json({ success: false, message: "Proposal not found." });
    }
    const historico = await prisma.proposalSectionEdit.findMany({
      where: { proposalId: proposal.id },
      include: { finding: { select: { id: true, title: true, severity: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    const autores = await Promise.all([...new Set(historico.map((h) => h.authorUserId))].map(async (id) => {
      const u = await dbStore.getUserById(id);
      return [id, u?.name ?? id] as const;
    }));
    const nomePorAutor = Object.fromEntries(autores);
    res.json({
      success: true,
      // Mesma convencao snake_case do resto da API - ver o comentario no GET opinion-panel acima
      // sobre o bug que a divergencia de convencao causou.
      historico: historico.map((h) => ({
        id: h.id,
        target_kind: h.targetKind,
        target_key: h.targetKey,
        previous_value: h.previousValue,
        new_value: h.newValue,
        origin: h.origin,
        created_at: h.createdAt,
        author_user_id: h.authorUserId,
        author_name: nomePorAutor[h.authorUserId],
        finding: h.finding ? { id: h.finding.id, title: h.finding.title, severity: h.finding.severity } : null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// RELEASE an approved proposal as the final customer-ready version
/**
 * Item 18 do catalogo Reforma CloudMountain — o Comercial registra o que o CLIENTE respondeu.
 *
 * Quem decide se o negocio foi ganho ou perdido e o CRM: e no CMCRM que a oportunidade vira
 * `ganha` ou `perdida` (decisao do dono, 31/08/2026). Esta rota existe para o cenario SEM
 * integracao — o Comercial ouve a resposta e a registra aqui, e daqui ela vira evento na timeline
 * do CRM. Nao e o cliente que usa esta rota, e nao ha assinatura eletronica no caminho.
 *
 * `proposal:approve` e o mesmo gate da liberacao, e nao um permissao nova, por dois motivos: e a
 * mesma pessoa que libera a proposta e recebe a resposta, e uma permissao inventada agora nao
 * estaria em papel nenhum — o botao nasceria morto. Medido nos papeis reais: Administrator e
 * Sales Manager tem; Pre-Sales Engineer NAO, que e o recorte certo (o engenheiro de pre-vendas
 * nao responde pela resposta comercial do cliente).
 */
router.post("/proposals/:id/client-decision", requirePermission("proposal:approve"), async (req: Request, res: Response, next: NextFunction) => {
  const correlationId = (req.headers["x-correlation-id"] as string) || "corr-proposal-client-decision";
  const startTime = Date.now();

  try {
    const { decision, note } = (req.body ?? {}) as { decision?: unknown; note?: unknown };

    if (decision !== "accepted" && decision !== "declined") {
      return res.status(400).json({ success: false, message: "decision must be 'accepted' or 'declined'." });
    }

    const motivo = typeof note === "string" ? note.trim() : "";

    /*
     * Motivo OBRIGATORIO na recusa, opcional no aceite. E a mesma regra que o CMCRM ja aplica para
     * marcar uma oportunidade como `perdida` (`outcomeReason`), e a mesma licao da F8, em que o
     * motivo de rejeicao interna deixou de ser uma string fixa no codigo. "Perdemos" sem motivo e
     * um dado que nao responde a nenhuma pergunta depois.
     */
    if (decision === "declined" && motivo.length === 0) {
      return res.status(400).json({ success: false, message: "note is required when the client declines the proposal." });
    }

    const proposal = await dbStore.getProposal(req.params.id);
    if (!proposal) {
      return res.status(404).json({ success: false, message: "Proposal not found." });
    }

    /*
     * So proposta LIBERADA tem resposta de cliente: antes disso ela nao saiu daqui, e uma
     * "resposta" a um documento que o cliente nunca viu seria dado inventado.
     */
    if (proposal.status !== "released") {
      return res.status(400).json({
        success: false,
        message: `Only released proposals can carry a client decision. Current status is '${proposal.status}'.`,
      });
    }

    if (proposal.client_decision) {
      /*
       * 409, e nao sobrescrever em silencio. A primeira resposta ja virou evento na timeline do
       * CRM, e um segundo registro produziria um segundo evento contando outra historia sobre o
       * mesmo negocio — sem apagar o primeiro. Corrigir um registro errado e um pedido diferente
       * deste, e precisa passar por quem sabe o que fazer com o evento ja emitido.
       */
      return res.status(409).json({
        success: false,
        message: `This proposal already carries a client decision ('${proposal.client_decision}').`,
        decision: proposal.client_decision,
        decided_at: proposal.client_decision_at,
      });
    }

    const userId = requireUserId(req);
    const linhas = await dbStore.registrarDecisaoDoCliente(req.params.id, decision, userId, decision === "declined" ? motivo : (motivo || null));

    /*
     * ZERO linhas significa que outra pessoa registrou entre o `getProposal` acima e este update
     * — a condicao `clientDecision: null` do `where` segurou. Devolver 409 aqui e o que impede a
     * corrida de virar dois eventos contraditorios no CRM.
     */
    if (linhas === 0) {
      const atual = await dbStore.getProposal(req.params.id);
      return res.status(409).json({
        success: false,
        message: "This proposal already carries a client decision (registered concurrently).",
        decision: atual?.client_decision ?? null,
      });
    }

    /*
     * `proposal_accepted` ja existia no vocabulario do CMCRM desde a F3 e nunca tinha sido emitido
     * por ninguem — a F9 registrou isso por escrito. `proposal_declined` e nome NOVO dos dois
     * lados: reusar `proposal_rejected` faria a timeline mostrar "o revisor recusou" e "o cliente
     * disse nao" com a mesma cor e o mesmo rotulo.
     *
     * `void`, como nas outras chamadas deste arquivo: a decisao ja esta gravada, e um CRM fora do
     * ar nao pode desfaze-la. A fila do outbox reenvia.
     */
    void empurrarEventoDaProposta(req.params.id, decision === "accepted" ? "proposal_accepted" : "proposal_declined");

    await dbStore.addAuditLog({
      user_id: userId,
      action: decision === "accepted" ? "Register Client Acceptance" : "Register Client Decline",
      entity_type: "Proposal",
      entity_id: proposal.id,
      project_id: proposal.project_id,
      ip_address: req.ip ?? "",
      user_agent: req.get("user-agent") ?? "",
      // O motivo entra no `metadata`, que e o campo que este modelo tem para contexto — e ele e
      // string JSON, nao objeto. Registrar a decisao sem o motivo tiraria da auditoria justamente
      // a parte que a torna util depois: nao "perdemos", e sim por que.
      metadata: JSON.stringify({ decision, note: motivo || null, proposal_version: proposal.version }),
    });

    logDebugMessage({
      operation: "Proposal Client Decision",
      message: `Registered client decision '${decision}' for proposal ${req.params.id}`,
      status: "SUCCESS",
      durationMs: Date.now() - startTime,
      correlationId,
      projectId: proposal.project_id,
    });

    const atualizada = await dbStore.getProposal(req.params.id);
    return res.json({ success: true, proposal: atualizada });
  } catch (error) {
    return next(error);
  }
});

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

    // F9: o EVENTO de timeline (D30) — sem ele o envelope acima atualiza o valor da oportunidade,
    // mas a timeline só mostraria a liberação quando alguém abrisse a aba de propostas.
    void empurrarEventoDaProposta(req.params.id, "proposal_sent");

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
