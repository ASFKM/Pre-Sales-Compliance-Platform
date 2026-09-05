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
import { casarApontamentos, compararRodadas, type ApontamentoParaCasar } from "../utils/proposalRoundMatching";
import { localizarCorrecoes, type CorrecaoBruta } from "../utils/proposalGrammar";
import {
  apontamentosDoAprovador,
  PERSPECTIVA_DO_APROVADOR,
  ORIGEM_APROVADOR,
  ORIGEM_IA,
} from "../utils/approverFindings";
import { podeVerDossieDaProposta } from "../utils/approvalScope";
import {
  CATEGORIAS_DO_ASSISTENTE,
  calcularImpressaoDoEstado,
  contemRecomendacaoDeDecisao,
  percentualDeMudanca,
  recortarPontosDoAssistente,
  type EstadoLidoPeloAssistente,
} from "../utils/approverBriefing";

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
  secoesDeTexto: readonly { nome: string; descricao: string }[],
  // F7: os apontamentos que ficaram ABERTOS na rodada anterior, com id. E o que permite ao modelo
  // declarar qual deles cada apontamento novo continua - e so isso ele faz com a lista: o servidor
  // revalida o id antes de gravar, e um id inventado vira "sem antecessor".
  apontamentosDaRodadaAnterior: readonly { id: string; title: string; targetKey: string | null }[] = []
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

  /*
   * F7: o VINCULO com a rodada anterior.
   *
   * Sem ele, cada rodada e uma lista solta e nao ha como distinguir "o time esta corrigindo a
   * proposta" de "a IA inventa um apontamento diferente toda vez". Quem sabe se o ponto de agora e
   * o mesmo de antes e quem acabou de ler as duas coisas - o modelo - entao e a ele que se pergunta.
   *
   * O que o servidor NAO faz e confiar na resposta: o id volta para
   * server/utils/proposalRoundMatching.ts, que o revalida contra esta mesma lista e descarta o que
   * nao estiver nela. Onde o modelo se cala, um desempate deterministico (mesma secao-alvo E
   * similaridade de titulo) tenta o casamento - as duas regras, e o porque de cada alternativa
   * descartada, estao documentadas naquele modulo.
   */
  const listaAnterior = apontamentosDaRodadaAnterior
    .map((a) => `- id "${a.id}"${a.targetKey ? ` [secao ${a.targetKey}]` : ""}: ${a.title}`)
    .join("\n");
  const blocoDeVinculo = apontamentosDaRodadaAnterior.length > 0
    ? `\n\nAPONTAMENTOS QUE FICARAM ABERTOS NA REVISAO ANTERIOR DESTA MESMA PROPOSTA:\n${listaAnterior}\nFor EACH finding you return now, set "previous_finding_id" to the id above that it CONTINUES - the same problem, still standing, even if the wording of the section changed in between. Use null when the finding is genuinely new. Do not force the link: claiming a new point continues an old one hides a new problem, and claiming an old point is new hides that it was never resolved. If the problem behind one of the ids above no longer exists in the current text, simply DO NOT return it - that is how you say it was remediated.`
    : "";

  const responseShape = `\n\nRespond with ONLY a JSON object (no markdown, no extra text), in this exact shape:\n{ "severity": "info"|"warning"|"critical", "summary": "one sentence in ${proposal.language}", "content": "2-4 short paragraphs in ${proposal.language}", "suggested_field": string|null, "suggested_value": string|null, "findings": [{ "title": "short title in ${proposal.language}", "detail": "1-2 sentences in ${proposal.language}", "severity": "info"|"warning"|"critical", "target_kind": "proposal_field"|"template_field"|"geral", "target_key": string|null, "suggested_value": string|null, "previous_finding_id": string|null }] }.${suggestionInstruction}${findingsInstruction}${blocoDeVinculo}`;

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
    // F7: a rodada que ESTA valendo agora vira a "anterior" desta que comeca. Capturada aqui, no
    // handler, e nao dentro do worker: quando o worker termina ele mesmo reescreve
    // latestOpinionRunId, e ler o campo la dentro devolveria a rodada nova comparada consigo mesma.
    const rodadaAnteriorId = proposal.latest_opinion_run_id ?? null;
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

        /*
         * F7: os apontamentos ABERTOS da rodada anterior - o universo da comparacao.
         *
         * Um apontamento ja FECHADO (resolvido / aceito com risco / descartado) fica de fora da
         * conta inteira, e nao por economia de prompt: ele saiu de pauta por decisao humana, e
         * conta-lo como "sanado" nesta rodada atribuiria a IA um merito que foi de quem decidiu -
         * e, pior, produziria um numero de sanados que cresce sozinho a cada apontamento
         * descartado. O mesmo criterio da rota sugerir-texto da F6, pela mesma razao.
         */
        const apontamentosAnteriores = rodadaAnteriorId
          ? await prisma.proposalOpinionFinding.findMany({
              where: { opinion: { runId: rodadaAnteriorId }, status: { in: ["aberto", "em_tratativa"] } },
              select: { id: true, title: true, targetKind: true, targetKey: true },
              orderBy: { createdAt: "asc" },
            })
          : [];
        const resumoAnterior = apontamentosAnteriores.map((a) => ({ id: a.id, title: a.title, targetKey: a.targetKey }));
        const novosParaCasar: ApontamentoParaCasar[] = [];

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
            const prompt = await buildOpinionPrompt(perspective, proposal, project, analysisResult, tenantId, platformSettings, userId, suggestibleFields, SECOES_DE_TEXTO_DO_TEMPLATE, resumoAnterior);
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
                // F7: o antecessor DECLARADO. Nullish porque um modelo que ignore a instrucao nao
                // pode derrubar o parecer - a ausencia cai no desempate deterministico depois.
                previous_finding_id: z.string().nullish(),
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
              /*
               * O casamento e adiado para o FIM da rodada, e nao feito aqui por perspectiva, por
               * uma razao concreta: um apontamento anterior so pode ser reivindicado uma vez, e
               * duas perspectivas diferentes podem apontar para o mesmo antecessor (o Comercial e
               * o Financeiro veem o mesmo problema em `payment_terms` com frequencia). Casando
               * perspectiva a perspectiva, quem rodasse primeiro ficaria com o antecessor por
               * acaso da ordem do laco; casando no fim, a regra e uma so para a rodada inteira.
               */
              apontamentos.forEach((a, i) => novosParaCasar.push({
                id: a.id,
                title: a.title,
                targetKind: a.targetKind,
                targetKey: a.targetKey,
                previousFindingId: opinion.findings[i]?.previous_finding_id ?? null,
              }));
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

        /*
         * F7: grava o VINCULO entre as duas rodadas, uma vez, com a rodada inteira em maos.
         *
         * `casarApontamentos` revalida cada id declarado pelo modelo contra a lista que ESTE
         * servidor montou e, para quem ficou sem vinculo, aplica o desempate deterministico. O
         * resultado e persistido em previousFindingId: a comparacao que a tela le depois nao
         * refaz nada, so conta linhas - o que garante que o numero mostrado hoje continue o mesmo
         * amanha, mesmo que a heuristica mude.
         */
        if (novosParaCasar.length > 0 && apontamentosAnteriores.length > 0) {
          const casamentos = casarApontamentos(
            apontamentosAnteriores.map((a) => ({ id: a.id, title: a.title, targetKind: a.targetKind, targetKey: a.targetKey })),
            novosParaCasar
          );
          for (const casamento of casamentos) {
            if (!casamento.anteriorId) continue;
            await prisma.proposalOpinionFinding.update({
              where: { id: casamento.novoId },
              data: { previousFindingId: casamento.anteriorId },
            });
          }
          logger.info(
            { runId, rodadaAnteriorId, vinculados: casamentos.filter((c) => c.anteriorId).length, porModelo: casamentos.filter((c) => c.origem === "modelo").length, porHeuristica: casamentos.filter((c) => c.origem === "heuristica").length },
            "Opinion panel: vinculo entre rodadas gravado"
          );
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

/*
 * F8: a RODADA DO APROVADOR de uma proposta - os itens que o aprovador escreveu ao rejeitar a
 * versão anterior, já convertidos em apontamentos tratáveis (ver server/utils/approverFindings.ts).
 *
 * Serializada em snake_case, como toda a API deste produto, e com os MESMOS campos de um
 * apontamento de IA: a tela de tratativa é a mesma, e um payload com forma diferente obrigaria a
 * escrever um segundo componente de tratativa - que divergiria do primeiro.
 */
/*
 * As SECOES APONTAVEIS de uma proposta, com o texto que cada uma tem AGORA.
 *
 * Extraida do handler do dossie na F9 porque o assistente do aprovador precisa exatamente da
 * mesma lista, e por uma razao que vai alem de nao repetir codigo: se as duas divergissem, o
 * assistente poderia citar uma secao que o dossie nao mostra (ou deixar de citar uma que ele
 * mostra), e o recorte contra alucinacao de server/utils/approverBriefing.ts passaria a barrar
 * pontos legitimos. Uma lista so, para as duas telas.
 *
 * O recorte e o do resto do produto - os campos que ESTE tipo de proposta possui
 * (PROPOSAL_TYPE_EDITABLE_FIELDS) mais os placeholders do template REAL desta proposta, e nao o
 * catalogo inteiro: oferecer uma secao que o template nao usa produziria um apontamento
 * pendurado num texto que nunca aparece no documento.
 */
async function montarSecoesDaProposta(
  proposal: Proposal
): Promise<{ target_kind: string; target_key: string; label: string; texto_atual: string | null }[]> {
  const secoes: { target_kind: string; target_key: string; label: string; texto_atual: string | null }[] = [];
  for (const campo of PROPOSAL_TYPE_EDITABLE_FIELDS[proposal.proposal_type] ?? []) {
    if (campo === "manual_pricing_table") continue; // tabela, não texto: não cabe num comentário de seção
    secoes.push({
      target_kind: "proposal_field",
      target_key: campo,
      label: campo,
      texto_atual: ((proposal as any)[campo] as string | null) ?? null,
    });
  }
  try {
    const settingsParaSecoes = await dbStore.getSettings();
    const templatesParaSecoes = await dbStore.getProposalTemplates();
    const templateDaProposta = templatesParaSecoes.find((t) => t.id === proposal.template_id);
    const placeholders = await lerPlaceholdersDoTemplateDaProposta(templateDaProposta, settingsParaSecoes);
    const catalogo = new Map(TEMPLATE_VARIABLE_CATALOG.map((v) => [v.name, v]));
    for (const nome of [...new Set(placeholders)]) {
      if (!podeSerSubstituidaPorTextoAprovado(nome)) continue;
      secoes.push({
        target_kind: "template_field",
        target_key: nome,
        label: catalogo.get(nome)?.description || nome,
        texto_atual: ((proposal.template_field_values ?? {}) as Record<string, string>)[nome] ?? null,
      });
    }
  } catch {
    // Template ausente no storage não pode impedir o aprovador de ver o dossiê: ele fica com os
    // campos da proposta e o alvo "geral", que é o suficiente para rejeitar apontando.
  }
  return secoes;
}

async function carregarRodadaDoAprovador(proposalId: string) {
  const run = await prisma.proposalOpinionRun.findFirst({
    where: { proposalId, origem: ORIGEM_APROVADOR },
    orderBy: { createdAt: "desc" },
    include: { opinions: { include: { findings: { orderBy: { ordinal: "asc" } } } } },
  });
  if (!run) return null;

  const findings = run.opinions.flatMap((o) => o.findings);
  return {
    id: run.id,
    origem: run.origem,
    created_at: run.createdAt,
    // De qual versão rejeitada estes itens vieram. Vem do item da decisão, e não de um campo na
    // rodada, porque é a decisão que carrega o vínculo real - a rodada é só o continente.
    total: findings.length,
    abertos: findings.filter((f) => f.status === "aberto" || f.status === "em_tratativa").length,
    findings: findings.map((f) => ({
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
      origem: f.origem,
      approval_decision_item_id: f.approvalDecisionItemId,
      previous_finding_id: f.previousFindingId,
      remediation_verdict: f.remediationVerdict,
      remediation_note: f.remediationNote,
      remediation_checked_at: f.remediationCheckedAt,
    })),
  };
}

/*
 * ═════════════════════════════════════════════════════════════════════════════════════════════
 * F8: O DOSSIÊ DO APROVADOR - tudo o que decide uma aprovação, numa resposta só.
 * ═════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Até esta fase, o Centro de Aprovação mostrava ao aprovador o cabeçalho da proposta, os estágios
 * do workflow e uma caixa de texto. Não mostrava o DOCUMENTO, nem os pareceres, nem os
 * apontamentos e suas tratativas, nem as verificações determinísticas, nem o histórico de versões.
 * Ele decidia sobre um id.
 *
 * Uma resposta só, e não quatro chamadas: as quatro abas do modal abrem juntas e sobre a MESMA
 * proposta, e quatro requisições concorrentes com quatro gates diferentes produziriam abas que
 * carregam em ordens diferentes e falham em separado.
 *
 * O GATE, que é a outra metade da fase: `requireAuth` + `proposal:approve` OU ser aprovador
 * designado em algum estágio do workflow DESTA proposta (server/utils/approvalScope.ts, a mesma
 * função que responde ao menu). Esconder o botão do menu é conveniência de tela; ESTA é a
 * autorização. Sem ela, o dossiê inteiro - documento, pareceres, tratativas - estaria a uma
 * chamada de distância de qualquer sessão autenticada.
 */
router.get("/proposals/:id/dossie-de-aprovacao", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const proposal = await dbStore.getProposal(req.params.id);
    if (!proposal) {
      return res.status(404).json({ success: false, message: "Proposal not found." });
    }

    const userId = (req.headers["x-user-id"] as string) || "";
    const roleId = (req.headers["x-role-id"] as string) || "";
    const workflows = await dbStore.getApprovalWorkflows();
    const designado = podeVerDossieDaProposta(workflows as any, proposal.approval_workflow_id, { userId, roleId });
    const role = roleId ? await dbStore.getRoleById(roleId) : null;
    const podeAprovar = Boolean(role?.permissions?.includes("proposal:approve"));

    if (!designado && !podeAprovar) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: you are not a designated approver for this proposal's workflow.",
      });
    }

    const project = await dbStore.getProject(proposal.project_id);
    if (!project) {
      return res.status(404).json({ success: false, message: "Project not found." });
    }

    // ── ABA "verificações": a conferência determinística, a MESMA de GET /revisao. Nunca IA.
    let achados: AchadoDeRevisao[] | null = null;
    let erroDaRevisao: string | null = null;
    try {
      achados = await montarAchadosDeRevisao(proposal, project, req.headers["x-tenant-id"] as string);
    } catch (revisaoErr: any) {
      // Um documento ilegível no storage não pode derrubar as outras três abas: a aba diz que a
      // conferência falhou, com o motivo, em vez de o modal inteiro não abrir.
      erroDaRevisao = revisaoErr?.message || "Não foi possível conferir o documento.";
    }

    // ── ABA "pareceres": a última rodada de IA com seus apontamentos, e a rodada do aprovador.
    const runDeIa = proposal.latest_opinion_run_id
      ? await prisma.proposalOpinionRun.findUnique({
          where: { id: proposal.latest_opinion_run_id },
          include: { opinions: { include: { findings: { orderBy: { ordinal: "asc" } } } } },
        })
      : null;
    const rodadaDoAprovador = await carregarRodadaDoAprovador(proposal.id);

    // ── ABA "histórico de versões": a cadeia inteira do grupo, com as decisões de cada versão e as
    // edições de seção desta. `proposal_group_id` é o elo que a F8 (PARTE B) criou; sem ele, "v2"
    // seria só um número maior numa linha solta.
    const doGrupo = await prisma.proposal.findMany({
      where: { proposalGroupId: proposal.proposal_group_id },
      orderBy: { version: "asc" },
      select: { id: true, version: true, status: true, generatedAt: true, generatedBy: true, previousVersionId: true, proposalType: true },
    });
    const decisoes = await prisma.approvalDecision.findMany({
      where: { proposalId: { in: doGrupo.map((p) => p.id) } },
      orderBy: { createdAt: "asc" },
      include: { items: { orderBy: { ordinal: "asc" } } },
    });
    const nomePorUsuario: Record<string, string> = {};
    for (const id of [...new Set(decisoes.map((d) => d.approverUserId))]) {
      const u = await dbStore.getUserById(id);
      nomePorUsuario[id] = u?.name ?? id;
    }
    const stagePorId = new Map(
      (workflows as any[]).flatMap((w: any) => (w.stages || []).map((st: any) => [st.id, st] as const))
    );

    /*
     * F8: as SEÇÕES apontáveis desta proposta, com o texto que cada uma tem AGORA.
     *
     * É o que a rejeição estruturada precisa para funcionar: o aprovador escolhe a seção e o texto
     * atual aparece ao lado, para ele escrever o comentário olhando o que vai ser corrigido. E é o
     * mesmo recorte que o resto do produto usa - os campos que ESTE tipo de proposta possui
     * (PROPOSAL_TYPE_EDITABLE_FIELDS) mais os placeholders do template REAL desta proposta, e não o
     * catálogo inteiro: oferecer uma seção que o template não usa produziria um apontamento
     * pendurado num texto que nunca aparece no documento.
     */
    const secoesApontaveis = await montarSecoesDaProposta(proposal);

    const edicoesDeSecao = await prisma.proposalSectionEdit.findMany({
      where: { proposalId: proposal.id },
      include: { finding: { select: { id: true, title: true, severity: true, origem: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    for (const e of edicoesDeSecao) {
      if (!nomePorUsuario[e.authorUserId]) {
        const u = await dbStore.getUserById(e.authorUserId);
        nomePorUsuario[e.authorUserId] = u?.name ?? e.authorUserId;
      }
    }

    res.json({
      success: true,
      proposal: {
        id: proposal.id,
        version: proposal.version,
        status: proposal.status,
        proposal_type: proposal.proposal_type,
        project_id: proposal.project_id,
        project_name: project.name,
        previous_version_id: proposal.previous_version_id,
        proposal_group_id: proposal.proposal_group_id,
        approval_workflow_id: proposal.approval_workflow_id,
        generated_at: proposal.generated_at,
        generated_by: proposal.generated_by,
        has_docx: Boolean(proposal.docx_file_path),
        has_pdf: Boolean(proposal.pdf_file_path),
      },
      // Quem está lendo, e por quê pôde. A tela usa isto para dizer "você é aprovador da etapa X".
      acesso: { designado, pode_aprovar: podeAprovar },
      verificacoes: {
        disponivel: achados !== null,
        erro: erroDaRevisao,
        achados: achados ?? [],
        total: achados?.length ?? 0,
        bloqueantes: (achados ?? []).filter((a) => a.severidade === "alta").length,
      },
      pareceres: {
        run: runDeIa
          ? {
              id: runDeIa.id,
              status: runDeIa.status,
              logic_version: runDeIa.logicVersion,
              created_at: runDeIa.createdAt,
              completed_at: runDeIa.completedAt,
              opinions: runDeIa.opinions.map((o) => ({
                id: o.id,
                perspective: o.perspective,
                status: o.status,
                severity: o.severity,
                summary: o.summary,
                content: o.content,
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
                  status: f.status,
                  resolution_note: f.resolutionNote,
                  resolved_at: f.resolvedAt,
                  origem: f.origem,
                  remediation_verdict: f.remediationVerdict,
                  remediation_note: f.remediationNote,
                })),
              })),
            }
          : null,
        rodada_do_aprovador: rodadaDoAprovador,
      },
      secoes: secoesApontaveis,
      versoes: {
        cadeia: doGrupo.map((p) => ({
          id: p.id,
          version: p.version,
          status: p.status,
          proposal_type: p.proposalType,
          generated_at: p.generatedAt,
          generated_by: p.generatedBy,
          previous_version_id: p.previousVersionId,
          e_a_atual: p.id === proposal.id,
        })),
        decisoes: decisoes.map((d) => ({
          id: d.id,
          proposal_id: d.proposalId,
          stage_id: d.stageId,
          stage_name: (stagePorId.get(d.stageId) as any)?.name ?? d.stageId,
          decision: d.decision,
          comments: d.comments,
          created_at: d.createdAt,
          approver_user_id: d.approverUserId,
          approver_name: nomePorUsuario[d.approverUserId],
          // F8: os itens por seção daquela rejeição, na ordem em que o aprovador os escreveu.
          items: d.items.map((i) => ({
            id: i.id,
            ordinal: i.ordinal,
            target_kind: i.targetKind,
            target_key: i.targetKey,
            comment: i.comment,
            section_snapshot: i.sectionSnapshot,
          })),
        })),
        edicoes_de_secao: edicoesDeSecao.map((e) => ({
          id: e.id,
          target_kind: e.targetKind,
          target_key: e.targetKey,
          previous_value: e.previousValue,
          new_value: e.newValue,
          origin: e.origin,
          created_at: e.createdAt,
          author_name: nomePorUsuario[e.authorUserId],
          finding: e.finding ? { id: e.finding.id, title: e.finding.title, severity: e.finding.severity, origem: e.finding.origem } : null,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get("/proposals/:id/opinion-panel", requirePermission("proposal:edit"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const proposal = await dbStore.getProposal(req.params.id);
    if (!proposal) {
      return res.json({ success: true, run: null, rodada_do_aprovador: null });
    }

    /*
     * F8: os itens do aprovador viajam JUNTO, numa chave própria, e nunca dentro de `run`.
     *
     * Eles têm de aparecer no mesmo painel para serem tratados pelo mesmo ciclo - é esse o pedido
     * da fase. Mas misturá-los às perspectivas da IA faria a tela contá-los como parecer de modelo,
     * e é justamente o que `origem` existe para impedir. Chave separada: o cliente mostra os dois
     * blocos, cada um com o seu rótulo, e nenhum número se confunde com o outro.
     */
    const rodadaDoAprovador = await carregarRodadaDoAprovador(proposal.id);

    if (!proposal.latest_opinion_run_id) {
      return res.json({ success: true, run: null, rodada_do_aprovador: rodadaDoAprovador });
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
      return res.json({ success: true, run: null, rodada_do_aprovador: rodadaDoAprovador });
    }
    res.json({
      success: true,
      rodada_do_aprovador: rodadaDoAprovador,
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
            // F7, mesma convencao snake_case: o antecessor e o veredito consultivo de sanacao.
            previous_finding_id: f.previousFindingId,
            remediation_verdict: f.remediationVerdict,
            remediation_note: f.remediationNote,
            remediation_checked_at: f.remediationCheckedAt,
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

    /*
     * F7: o histórico por seção passa a cobrir também os CAMPOS DE TEXTO DA PROPOSTA.
     *
     * A F6 criou ProposalSectionEdit e o alimentou só pelo PUT campos-do-template, ou seja, só
     * para `template_field`. Isso deixou metade dos apontamentos de fora sem que aparecesse:
     * `payment_terms`, `delivery_terms`, `proposal_validity`, `commercial_assumptions` e
     * `exclusions` são "proposal_field", editados por ESTA rota - e são justamente os alvos que a
     * IA mais aponta (na rodada real medida nesta fase, TODOS os apontamentos com seção eram
     * proposal_field).
     *
     * Sem esta gravação a verificação de sanação da F7 não teria par anterior/novo para ler
     * nesses campos, e o botão existiria devolvendo 409 para o caso mais comum - um recurso que
     * funciona só na metade menos usada é pior que nenhum, porque parece pronto.
     *
     * Só campos de TEXTO (TEXT_SUGGESTIBLE_FIELDS): a tabela de precificação é estrutura, não
     * prosa, e um "texto anterior" dela seria um JSON que ninguém compara lendo. Só quando o valor
     * MUDA de verdade: salvar o formulário inteiro sem tocar num campo não é edição dele, e
     * inventariar isso encheria o histórico de linhas em que nada aconteceu.
     */
    const camposDeTextoAlterados = submittedFields.filter(
      (campo): campo is (typeof TEXT_SUGGESTIBLE_FIELDS)[number] =>
        (TEXT_SUGGESTIBLE_FIELDS as readonly string[]).includes(campo)
        && typeof (validated as Record<string, unknown>)[campo] === "string"
        && ((validated as Record<string, string>)[campo] ?? "") !== ((existingProposal as unknown as Record<string, string>)[campo] ?? "")
    );
    if (camposDeTextoAlterados.length > 0) {
      const origemDaEdicao = typeof req.body?.origem === "string" && ["humano", "ia", "ia_editada"].includes(req.body.origem)
        ? req.body.origem
        : "humano";
      await prisma.proposalSectionEdit.createMany({
        data: camposDeTextoAlterados.map((campo) => ({
          id: randomId("pse"),
          tenantId: req.headers["x-tenant-id"] as string,
          proposalId: existingProposal.id,
          targetKind: "proposal_field",
          targetKey: campo,
          previousValue: (existingProposal as unknown as Record<string, string | null>)[campo] ?? null,
          newValue: (validated as Record<string, string>)[campo],
          origin: origemDaEdicao,
          findingId: typeof req.body?.apontamento_id === "string" ? req.body.apontamento_id : null,
          authorUserId: requireUserId(req),
        })),
      });
    }

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

    /*
     * F8: OS ITENS DO APROVADOR VIRAM APONTAMENTOS DA v2.
     *
     * Este é o ponto em que a rejeição estruturada deixa de ser registro histórico e volta a ser
     * trabalho: cada item que o aprovador escreveu ao rejeitar a v1 nasce na v2 como
     * ProposalOpinionFinding "aberto", crítico, com a seção-alvo preservada - tratável pelo MESMO
     * ciclo da F6 (PATCH de status com justificativa obrigatória em "aceito com risco" e
     * "descartado", botão de sugestão por seção, histórico por seção) e visível para o gate de
     * envio da F7.
     *
     * A modelagem inteira, com o porquê e o custo de cada alternativa descartada, está no cabeçalho
     * de server/utils/approverFindings.ts. Em uma frase: rodada SINTÉTICA de `origem: "aprovador"`
     * com uma única perspectiva "aprovador", que NÃO vira `latest_opinion_run_id` (esse campo
     * continua significando "a última rodada de IA") e que a comparação entre rodadas da F7 filtra
     * fora - os três números dela contam apontamento de IA, e um item humano lá dentro responderia
     * outra pergunta com o mesmo número.
     *
     * Falhar aqui não desfaz a reabertura: a v2 já existe e é uma proposta válida. Por isso este
     * bloco não derruba a resposta - o que ele produz é conveniência de tratativa, e a rejeição
     * continua legível pelas decisões da v1 mesmo se ele não rodar.
     */
    let apontamentosDoAprovadorCriados = 0;
    try {
      const itensDaRejeicao = await prisma.approvalDecisionItem.findMany({
        where: { decision: { proposalId: rejected.id, decision: "rejected" } },
        orderBy: [{ decision: { createdAt: "asc" } }, { ordinal: "asc" }],
      });

      const convertidos = apontamentosDoAprovador(
        itensDaRejeicao.map((i) => ({
          id: i.id,
          ordinal: i.ordinal,
          targetKind: i.targetKind,
          targetKey: i.targetKey,
          comment: i.comment,
          sectionSnapshot: i.sectionSnapshot,
        }))
      );

      if (convertidos.length > 0) {
        const runId = randomId("por");
        const opinionId = randomId("poi");
        await prisma.proposalOpinionRun.create({
          data: {
            id: runId,
            tenantId,
            proposalId: reopened.id,
            origem: ORIGEM_APROVADOR,
            // "completed" porque não há nada a executar: os itens já existem, escritos por uma
            // pessoa. Deixá-la "pending" faria a tela esperar por um trabalho que ninguém vai fazer.
            status: "completed",
            requestedByUserId: userId,
            // Rodada humana não tem versão de lógica de prompt. Zero é o valor que a diz "isto não
            // saiu de prompt nenhum" - e a comparação entre rodadas, que exige logicVersion >= 2
            // para se declarar comparável, nunca chega a ver esta rodada de qualquer forma.
            logicVersion: 0,
            completedAt: new Date(),
          },
        });
        await prisma.proposalAiOpinionItem.create({
          data: {
            id: opinionId,
            tenantId,
            runId,
            perspective: PERSPECTIVA_DO_APROVADOR,
            status: "completed",
            severity: "critical",
            summary: `Itens apontados pelo aprovador ao rejeitar a versão ${rejected.version}.`,
            content: `Esta rodada não é um parecer de IA: são ${convertidos.length} item(ns) escrito(s) por quem rejeitou a versão anterior desta proposta. Cada um vira um apontamento com o mesmo ciclo de tratativa dos demais.`,
          },
        });
        await prisma.proposalOpinionFinding.createMany({
          data: convertidos.map((c) => ({
            id: randomId("pof"),
            tenantId,
            opinionId,
            ordinal: c.ordinal,
            title: c.title,
            detail: c.detail,
            severity: c.severity,
            targetKind: c.targetKind,
            targetKey: c.targetKey,
            status: "aberto",
            origem: ORIGEM_APROVADOR,
            approvalDecisionItemId: c.approvalDecisionItemId,
          })),
        });
        apontamentosDoAprovadorCriados = convertidos.length;
      }
    } catch (itensErr: any) {
      logDebugMessage({
        operation: "Proposal Reopen Approver Findings Failure",
        message: `Reopened ${reopened.id} but could not create the approver findings: ${itensErr?.message}`,
        status: "ERROR",
        durationMs: Date.now() - startTime,
        correlationId,
        projectId: rejected.project_id,
        error: itensErr,
      });
    }

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
        regenerated_analysis: regeneration,
        // F8: quantos itens do aprovador viraram apontamento nesta v2.
        approver_findings: apontamentosDoAprovadorCriados
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
      regenerated_analysis: regeneration,
      approver_findings: apontamentosDoAprovadorCriados
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
/*
 * F8: a montagem da revisão determinística, extraída da rota para poder ser reusada pelo DOSSIÊ do
 * aprovador. Uma segunda implementação da mesma conferência divergiria da primeira, e a aba
 * "verificações" do dossiê passaria a dizer algo diferente da aba "revisão" do Estúdio sobre o
 * mesmo documento - que é o pior defeito possível numa tela cujo propósito é conferir.
 *
 * Devolve `null` quando a proposta ainda não tem documento gerado: a rota transforma isso num 409
 * (não há o que revisar), e o dossiê apenas informa a ausência sem quebrar as outras três abas.
 */
async function montarAchadosDeRevisao(
  proposal: Proposal,
  project: Project,
  tenantId: string
): Promise<AchadoDeRevisao[] | null> {
  if (!proposal.docx_file_path) return null;

  const platformSettings = await dbStore.getSettings();
  const templates = await dbStore.getProposalTemplates();
  const template = templates.find((t) => t.id === proposal.template_id);

  const adapter = createStorageAdapter({ ...platformSettings, storage_mode: proposal.storage_provider });
  const docxBuffer = await adapter.readFile(proposal.docx_file_path);

  const analysis = await dbStore.getAnalysisResult(proposal.project_id);
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

  const placeholdersDoTemplate = await lerPlaceholdersDoTemplateDaProposta(template, platformSettings);
  return revisarDocumentoGerado({
    docxBuffer,
    placeholdersDoTemplate,
    variaveisResolvidas: buildTemplateVariables(templateData) as Record<string, unknown>,
  });
}

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
    void platformSettings;
    const achados = await montarAchadosDeRevisao(proposal, project, req.headers["x-tenant-id"] as string);

    if (achados === null) {
      return res.status(409).json({
        success: false,
        message: "Esta proposta ainda não tem documento gerado para revisar.",
      });
    }

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


/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * F7 (rodada 09/2026): A REVISÃO ASSISTIDA.
 *
 * Três tarefas de IA novas, e o que as separa é a pergunta que cada uma responde:
 *   - SANAÇÃO: "a edição que a pessoa fez endereçou este apontamento?" - lê o par
 *     previousValue/newValue que o histórico da F6 já grava, e devolve um veredito CONSULTIVO.
 *   - GRAMÁTICA: "o que está gramaticalmente errado neste texto?" - devolve correções PONTUAIS,
 *     cada uma com aceitar e recusar próprios, nunca a seção reescrita (isso é a F6).
 *   - COERÊNCIA: "uma seção afirma o que outra nega?" - só TEXTO.
 *
 * O que NÃO passa por modelo nenhum: número. A coerência numérica (soma dos itens x total
 * apresentado, item do BOM ausente, placeholder não substituído) continua determinística em
 * server/utils/proposalQa.ts, que já existe e a esta fase só cabia não estragar. O comentário de
 * abertura daquele módulo explica por quê, e vale igual aqui: uma pergunta com resposta exata
 * respondida por um modelo troca uma prova por uma opinião - e por uma opinião mais cara.
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * As variáveis do template já resolvidas para esta proposta - de onde sai o texto ATUAL de uma
 * seção. Mesma montagem que a rota sugerir-texto da F6 faz inline; extraída aqui porque as três
 * rotas desta fase precisam da mesma coisa, e três cópias divergiriam na primeira mudança.
 */
async function resolverVariaveisDaProposta(proposal: Proposal, project: Project, tenantId: string, platformSettings: PlatformSettings): Promise<Record<string, unknown>> {
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
  return buildTemplateVariables(templateData) as Record<string, unknown>;
}

/**
 * F7: o prompt da SANAÇÃO. Função nomeada e isolada de propósito - é ela que o golden-hash guard
 * (src/aiLogicVersions.test.ts) hasheia sob a chave `proposal_finding_remediation`.
 *
 * O veredito que ela pede é consultivo, e o prompt diz isso ao modelo em vez de esconder: um
 * modelo que se saiba decisor tende a fechar o caso ("sanado") por cooperação. O que se pede aqui
 * é o contrário - que ele prefira "parcial" quando a edição andou mas não fechou, porque é o
 * veredito que devolve a decisão a quem revisa em vez de dar por encerrado.
 */
function buildRemediationPrompt(
  apontamento: { title: string; detail: string; severity: string; targetKey: string | null },
  textoAnterior: string | null,
  textoNovo: string,
  idioma: string
): string {
  return `Você avalia se UMA edição de texto endereçou UM apontamento de revisão de uma proposta comercial.

APONTAMENTO (severidade ${apontamento.severity}${apontamento.targetKey ? `, seção "${apontamento.targetKey}"` : ""}):
Título: ${apontamento.title}
Detalhe: ${apontamento.detail}

TEXTO ANTERIOR DA SEÇÃO:
${textoAnterior && textoAnterior.trim().length > 0 ? textoAnterior : "(a seção estava vazia)"}

TEXTO NOVO DA SEÇÃO:
${textoNovo}

Responda qual destes três descreve a mudança:
- "sanado": o texto novo endereça o apontamento por completo; não sobra nada do problema descrito.
- "parcial": o texto novo anda na direção certa mas deixa parte do problema de pé.
- "nao_sanado": o texto novo não endereça o apontamento (mudou outra coisa, ou não mudou nada relevante).

Regras:
- Julgue APENAS o apontamento acima. Outros defeitos do texto não entram neste veredito.
- Na dúvida entre "sanado" e "parcial", responda "parcial": este veredito é CONSULTIVO e quem
  fecha o apontamento é uma pessoa - um "sanado" errado faz alguém deixar de olhar.
- Não invente que um dado foi acrescentado se ele não está no texto novo.

Responda com ONLY um objeto JSON, sem markdown:
{ "veredito": "sanado"|"parcial"|"nao_sanado", "justificativa": "1-2 frases em ${idioma} dizendo o que no texto novo sustenta este veredito" }`;
}

/**
 * F7: o prompt da GRAMÁTICA. Hasheado sob `proposal_grammar_check`.
 *
 * A instrução central é a que o servidor não consegue impor sozinho: devolver o trecho original
 * BYTE A BYTE como ele aparece no texto. Um trecho normalizado pelo modelo (aspa curva virando
 * reta, espaço duplo virando simples) é inaplicável, e server/utils/proposalGrammar.ts o descarta
 * - mas o descarte é perda: a correção era legítima e some. Daí o prompt insistir.
 */
function buildGrammarPrompt(secao: string, texto: string, idioma: string): string {
  return `Você revisa a GRAMÁTICA e a ORTOGRAFIA de UMA seção de uma proposta comercial, em ${idioma}.

SEÇÃO: "${secao}"

TEXTO:
${texto}

Devolva uma lista de CORREÇÕES PONTUAIS. Cada correção troca um trecho curto por outro.

Regras, e a primeira é a que mais importa:
- "trecho_original" tem de ser uma cópia EXATA, caractere por caractere, de um pedaço do texto
  acima - mesmas aspas, mesmos espaços, mesma acentuação (ou falta dela). Não normalize nada. Um
  trecho que não exista literalmente no texto é descartado pelo servidor e a correção se perde.
- Mantenha cada trecho o mais CURTO possível: o suficiente para ser inequívoco no texto e para
  quem revisa entender a troca de relance. Não devolva o parágrafo inteiro.
- Corrija apenas gramática, ortografia, concordância, regência, pontuação e acentuação. NÃO
  reescreva por estilo, NÃO mude o sentido, NÃO acrescente nem remova informação, NÃO mexa em
  número, preço, prazo, nome de fabricante ou nome de cliente.
- Zero correções é uma resposta válida e honesta quando o texto está correto. Não invente erro
  para parecer útil.

Responda com ONLY um objeto JSON, sem markdown:
{ "correcoes": [{ "trecho_original": "...", "trecho_corrigido": "...", "motivo": "poucas palavras em ${idioma}, ex: 'concordância verbal'" }] }`;
}

/**
 * F7: o prompt da COERÊNCIA ENTRE SEÇÕES. Hasheado sob `proposal_section_coherence`.
 *
 * A restrição explícita contra número não é decoração: sem ela o modelo naturalmente compara
 * totais e prazos, que é justamente a pergunta com resposta exata que proposalQa.ts responde de
 * graça e sem errar. Mandar o mesmo trabalho ao modelo trocaria uma prova por uma opinião.
 */
function buildCoherencePrompt(secoes: readonly { nome: string; texto: string }[], idioma: string): string {
  const corpo = secoes.map((s) => `### ${s.nome}\n${s.texto}`).join("\n\n");
  return `Você procura CONTRADIÇÕES entre as seções de texto de uma proposta comercial, em ${idioma}.

${corpo}

Uma contradição é uma seção afirmar algo que outra nega ou torna impossível. Exemplos do que conta:
uma seção incluir no escopo o que outra lista como exclusão; uma prometer suporte contínuo enquanto
outra encerra a responsabilidade na entrega; uma citar um responsável pela operação e outra dizer
que a operação é do cliente.

Regras:
- NÃO confira número, preço, quantidade, total, prazo em dias nem item de material. Esses são
  conferidos exatamente por outra parte do sistema, e um palpite seu sobre eles seria pior que o
  silêncio.
- Cada achado tem de citar as DUAS seções e o que exatamente se contradiz. Um achado que não
  consiga nomear as duas pontas não é uma contradição, é uma impressão - não o devolva.
- Zero achados é a resposta esperada numa proposta coerente. Não force.

Responda com ONLY um objeto JSON, sem markdown:
{ "achados": [{ "secao_a": "nome exato de uma seção acima", "secao_b": "nome exato de outra seção acima", "contradicao": "uma frase em ${idioma}", "detalhe": "1-2 frases em ${idioma} citando o que cada seção afirma", "severidade": "info"|"warning"|"critical" }] }`;
}

/*
 * F7, ENTREGA 1: a SANAÇÃO POR APONTAMENTO.
 *
 * Lê o par texto anterior / texto novo de ProposalSectionEdit - o par que a F6 já grava, e que
 * esta rota deliberadamente NÃO reinventa nem pede ao usuário - e devolve sanado | parcial |
 * nao_sanado com justificativa.
 *
 * O veredito é CONSULTIVO e a rota faz questão de não confundir as duas coisas: ele vai para
 * `remediationVerdict`, um campo separado, e o `status` do apontamento não é tocado. A IA nunca
 * fecha um apontamento - ela sugere a quem revisa que o marque como resolvido, e o marcar continua
 * sendo um PATCH humano com autor e instante. Se o veredito virasse status, o gate de envio desta
 * mesma fase passaria a ser atravessável por uma opinião de modelo.
 */
router.post("/proposals/:id/apontamentos/:findingId/verificar-sanacao", requirePermission("proposal:edit"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const proposal = await dbStore.getProposal(req.params.id);
    if (!proposal) {
      return res.status(404).json({ success: false, message: "Proposal not found." });
    }

    const apontamento = await prisma.proposalOpinionFinding.findUnique({
      where: { id: req.params.findingId },
      include: { opinion: { include: { run: true } } },
    });
    if (!apontamento || apontamento.opinion.run.proposalId !== proposal.id) {
      return res.status(404).json({ success: false, message: "Apontamento não encontrado nesta proposta." });
    }

    /*
     * De onde sai o par anterior/novo, em duas tentativas e nesta ordem:
     *
     * 1. A edição que declarou ESTE apontamento (`findingId`) - é a mais precisa, porque quem
     *    editou disse a que apontamento estava respondendo.
     * 2. Na falta dela, a edição mais recente da SEÇÃO que o apontamento aponta, desde que
     *    posterior ao apontamento. A segunda existe porque a pessoa pode ter corrigido a seção
     *    pelo caminho normal, sem passar pelo botão do apontamento - o que é uso legítimo, e
     *    recusar avaliar nesse caso empurraria todo mundo de volta ao "marque como resolvido e
     *    confie".
     *
     * O corte por data importa: uma edição ANTERIOR ao apontamento não pode tê-lo sanado, e
     * avaliá-la produziria um "não sanado" garantido sobre um texto que a IA acabou de criticar.
     */
    const edicaoDoApontamento = await prisma.proposalSectionEdit.findFirst({
      where: { proposalId: proposal.id, findingId: apontamento.id },
      orderBy: { createdAt: "desc" },
    });
    const edicao = edicaoDoApontamento ?? (apontamento.targetKey
      ? await prisma.proposalSectionEdit.findFirst({
          where: {
            proposalId: proposal.id,
            targetKind: apontamento.targetKind,
            targetKey: apontamento.targetKey,
            createdAt: { gt: apontamento.createdAt },
          },
          orderBy: { createdAt: "desc" },
        })
      : null);

    if (!edicao) {
      return res.status(409).json({
        success: false,
        message: apontamento.targetKey
          ? `Ainda não há edição da seção "${apontamento.targetKey}" posterior a este apontamento para avaliar. Edite a seção e verifique de novo.`
          : "Este apontamento é transversal (sem seção-alvo) e não tem edição de seção para avaliar.",
      });
    }

    const tenantId = req.headers["x-tenant-id"] as string;
    const platformSettings = await dbStore.getSettings();
    const costCap = await checkCostCap(tenantId, platformSettings.monthly_cost_cap_usd ?? null);
    if (costCap.blocked) {
      return res.status(402).json({
        success: false,
        message: `Monthly AI cost cap reached ($${costCap.currentSpendUsd.toFixed(2)} of $${costCap.capUsd?.toFixed(2)}). Verificação de sanação bloqueada até o próximo mês ou até o teto ser elevado em Admin > IA, Prompts e Custos.`,
      });
    }

    const userId = requireUserId(req);
    const providerResolution = await resolveProvider("proposal_finding_remediation", platformSettings);
    if (providerResolution.isFallback) {
      await recordProviderFallback({ tenantId, taskType: "proposal_finding_remediation", intendedProvider: providerResolution.intendedProvider, userId });
    }

    const prompt = buildRemediationPrompt(
      { title: apontamento.title, detail: apontamento.detail, severity: apontamento.severity, targetKey: apontamento.targetKey },
      edicao.previousValue,
      edicao.newValue,
      proposal.language
    );

    const { text, inputTokens, outputTokens, billedCostUsd } = await generateJsonWithProvider(
      providerResolution.provider as ConnectedProvider,
      providerResolution.model,
      prompt,
      { taskKey: "proposal_finding_remediation", actorRef: buildActorRef("user", userId), triggerType: "user_action" }
    );

    const parecer = z.object({
      veredito: z.enum(["sanado", "parcial", "nao_sanado"]),
      justificativa: z.string(),
    }).parse(parseAiJson(text));

    await recordAiUsage({
      tenantId,
      taskType: "proposal_finding_remediation",
      provider: providerResolution.provider,
      model: providerResolution.model,
      estimatedCostUsd: billedCostUsd ?? estimateCostUsd(providerResolution.model, inputTokens, outputTokens),
      userId,
    });

    // Grava no campo CONSULTIVO. `status` fica exatamente como estava - ver o comentário da rota.
    const atualizado = await prisma.proposalOpinionFinding.update({
      where: { id: apontamento.id },
      data: {
        remediationVerdict: parecer.veredito,
        remediationNote: parecer.justificativa,
        remediationCheckedAt: new Date(),
      },
    });

    await dbStore.addAuditLog({
      user_id: userId,
      action: "Check Proposal Finding Remediation",
      entity_type: "Proposal",
      entity_id: proposal.id,
      ip_address: req.ip || "127.0.0.1",
      user_agent: req.headers["user-agent"] || "unknown",
      metadata: JSON.stringify({ apontamento_id: apontamento.id, veredito: parecer.veredito, section_edit_id: edicao.id }),
    });

    res.json({
      success: true,
      apontamento_id: atualizado.id,
      veredito: parecer.veredito,
      justificativa: parecer.justificativa,
      status_atual: atualizado.status,
      // Dito na resposta, e não só no comentário: quem consome esta rota precisa saber que o
      // veredito não mexeu no ciclo e que fechar o apontamento continua sendo ato humano.
      veredito_e_consultivo: true,
      baseado_em: {
        section_edit_id: edicao.id,
        target_key: edicao.targetKey,
        origem_da_edicao: edicao.origin,
        editado_em: edicao.createdAt,
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(502).json({ success: false, message: "A resposta do provedor de IA não veio no formato esperado." });
    }
    next(err);
  }
});

/*
 * F7, ENTREGA 2: a GRAMÁTICA COM ACEITAR/RECUSAR POR CORREÇÃO.
 *
 * Devolve correções PONTUAIS com o offset de cada uma no texto atual - nunca a seção reescrita.
 * A diferença em relação ao sugerir-texto da F6 é de controle, não de forma: lá, aceitar é tudo ou
 * nada; aqui, quem revisa fica com a vírgula certa e recusa a troca que mudaria o sentido.
 *
 * O servidor descarta aqui, antes de a tela ver, toda correção cujo trecho não exista literalmente
 * no texto (server/utils/proposalGrammar.ts explica por quê). Aplicar continua sendo o PUT
 * campos-do-template com clique humano, como todo o resto desta família de rotas.
 */
router.post("/proposals/:id/secoes/:targetKey/revisar-gramatica", requirePermission("proposal:edit"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const proposal = await dbStore.getProposal(req.params.id);
    if (!proposal) {
      return res.status(404).json({ success: false, message: "Proposal not found." });
    }
    if (proposal.status !== "draft") {
      return res.status(409).json({ success: false, message: "Só uma proposta em rascunho pode ter seções revisadas." });
    }

    const secao = req.params.targetKey;
    if (!podeSerSubstituidaPorTextoAprovado(secao)) {
      return res.status(400).json({
        success: false,
        message: `"${secao}" tem fonte de dado própria no sistema e não pode ser corrigida por texto.`,
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
        message: `Monthly AI cost cap reached ($${costCap.currentSpendUsd.toFixed(2)} of $${costCap.capUsd?.toFixed(2)}). Revisão gramatical bloqueada até o próximo mês ou até o teto ser elevado em Admin > IA, Prompts e Custos.`,
      });
    }

    /*
     * O texto que se corrige e o que a pessoa esta prestes a salvar, e nao o que a analise deixou.
     * Um texto ja APROVADO para esta secao (template_field_values) cobre o resolvido - e e ele que
     * aparece no textarea da tela. Corrigir o resolvido enquanto a tela mostra o aprovado
     * produziria offsets que nao existem no texto que a pessoa esta vendo, e o aceitar por item
     * escreveria no lugar errado ou seria recusado em silencio.
     */
    const variaveis = await resolverVariaveisDaProposta(proposal, project, tenantId, platformSettings);
    const aprovado = (proposal.template_field_values as Record<string, string> | null | undefined)?.[secao];
    const textoAtual = typeof aprovado === "string" && aprovado.trim().length > 0
      ? aprovado
      : (typeof variaveis[secao] === "string" ? (variaveis[secao] as string) : "");
    if (textoAtual.trim().length === 0) {
      return res.status(409).json({ success: false, message: `A seção "${secao}" está vazia - não há texto para corrigir.` });
    }

    const userId = requireUserId(req);
    const providerResolution = await resolveProvider("proposal_grammar_check", platformSettings);
    if (providerResolution.isFallback) {
      await recordProviderFallback({ tenantId, taskType: "proposal_grammar_check", intendedProvider: providerResolution.intendedProvider, userId });
    }

    const { text, inputTokens, outputTokens, billedCostUsd } = await generateJsonWithProvider(
      providerResolution.provider as ConnectedProvider,
      providerResolution.model,
      buildGrammarPrompt(secao, textoAtual, proposal.language),
      { taskKey: "proposal_grammar_check", actorRef: buildActorRef("user", userId), triggerType: "user_action" }
    );

    const resposta = z.object({
      correcoes: z.array(z.object({
        trecho_original: z.string(),
        trecho_corrigido: z.string(),
        motivo: z.string().optional().default(""),
      })).catch([]),
    }).parse(parseAiJson(text));

    await recordAiUsage({
      tenantId,
      taskType: "proposal_grammar_check",
      provider: providerResolution.provider,
      model: providerResolution.model,
      estimatedCostUsd: billedCostUsd ?? estimateCostUsd(providerResolution.model, inputTokens, outputTokens),
      userId,
    });

    const localizadas = localizarCorrecoes(textoAtual, resposta.correcoes as CorrecaoBruta[]);

    await dbStore.addAuditLog({
      user_id: userId,
      action: "Check Proposal Section Grammar",
      entity_type: "Proposal",
      entity_id: proposal.id,
      ip_address: req.ip || "127.0.0.1",
      user_agent: req.headers["user-agent"] || "unknown",
      metadata: JSON.stringify({ secao, devolvidas: resposta.correcoes.length, aplicaveis: localizadas.length }),
    });

    res.json({
      success: true,
      secao,
      texto_atual: textoAtual,
      correcoes: localizadas,
      // A diferença entre as duas contagens é informação, não ruído: quando o modelo devolve 6 e
      // só 3 são aplicáveis, quem lê a tela precisa saber que 3 se perderam por trecho inexato,
      // em vez de achar que o texto tinha só 3 problemas.
      devolvidas_pelo_modelo: resposta.correcoes.length,
      descartadas_por_trecho_inexato: resposta.correcoes.length - localizadas.length,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(502).json({ success: false, message: "A resposta do provedor de IA não veio no formato esperado." });
    }
    next(err);
  }
});

/*
 * F7, ENTREGA 3: a COERÊNCIA ENTRE SEÇÕES, por IA.
 *
 * A pergunta é "uma seção afirma o que outra nega" - que não tem resposta exata e por isso é
 * trabalho de modelo. A coerência NUMÉRICA continua onde estava, em GET /proposals/:id/revisao,
 * determinística e sem uma única chamada de IA: o prompt manda explicitamente NÃO conferir número,
 * total, prazo nem item de material.
 *
 * Síncrona e sem persistência, de propósito: o achado é sobre o texto de AGORA e envelhece na
 * primeira edição. Guardá-lo criaria uma segunda lista de pendências, concorrente com os
 * apontamentos, cujo ciclo ninguém dirime - exatamente o oposto do que a F6 construiu.
 */
router.post("/proposals/:id/coerencia-entre-secoes", requirePermission("proposal:edit"), async (req: Request, res: Response, next: NextFunction) => {
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
        message: `Monthly AI cost cap reached ($${costCap.currentSpendUsd.toFixed(2)} of $${costCap.capUsd?.toFixed(2)}). Verificação de coerência bloqueada até o próximo mês ou até o teto ser elevado em Admin > IA, Prompts e Custos.`,
      });
    }

    /*
     * Mesma regra da revisao gramatical: o texto APROVADO cobre o resolvido. Sem isto, a coerencia
     * leria o que a analise deixou e ignoraria justamente o texto que a pessoa acabou de escrever
     * - que e o que ela quer conferir. Medido na prova desta fase: uma secao recem-salva nao era
     * contada, e a rota recusava por "menos de duas secoes preenchidas" com duas na tela.
     */
    const variaveis = await resolverVariaveisDaProposta(proposal, project, tenantId, platformSettings);
    const aprovados = (proposal.template_field_values as Record<string, string> | null | undefined) ?? {};
    const secoes = SECOES_DE_TEXTO_DO_TEMPLATE
      .map((v) => {
        const aprovado = typeof aprovados[v.nome] === "string" ? aprovados[v.nome].trim() : "";
        const resolvido = typeof variaveis[v.nome] === "string" ? (variaveis[v.nome] as string).trim() : "";
        return { nome: v.nome, texto: aprovado.length > 0 ? aprovado : resolvido };
      })
      .filter((s) => s.texto.length > 0);

    // Contradição é relação entre DUAS seções: com uma só, não há o que comparar, e chamar a IA
    // devolveria achado inventado ou lista vazia - custando dinheiro nos dois casos.
    if (secoes.length < 2) {
      return res.status(409).json({
        success: false,
        message: "É preciso ter ao menos duas seções de texto preenchidas para procurar contradição entre elas.",
      });
    }

    const userId = requireUserId(req);
    const providerResolution = await resolveProvider("proposal_section_coherence", platformSettings);
    if (providerResolution.isFallback) {
      await recordProviderFallback({ tenantId, taskType: "proposal_section_coherence", intendedProvider: providerResolution.intendedProvider, userId });
    }

    const { text, inputTokens, outputTokens, billedCostUsd } = await generateJsonWithProvider(
      providerResolution.provider as ConnectedProvider,
      providerResolution.model,
      buildCoherencePrompt(secoes, proposal.language),
      { taskKey: "proposal_section_coherence", actorRef: buildActorRef("user", userId), triggerType: "user_action" }
    );

    const resposta = z.object({
      achados: z.array(z.object({
        secao_a: z.string(),
        secao_b: z.string(),
        contradicao: z.string(),
        detalhe: z.string().optional().default(""),
        severidade: z.enum(["info", "warning", "critical"]).catch("warning"),
      })).catch([]),
    }).parse(parseAiJson(text));

    await recordAiUsage({
      tenantId,
      taskType: "proposal_section_coherence",
      provider: providerResolution.provider,
      model: providerResolution.model,
      estimatedCostUsd: billedCostUsd ?? estimateCostUsd(providerResolution.model, inputTokens, outputTokens),
      userId,
    });

    // Mesma disciplina de `recortarApontamento` (F6): um achado que cite uma seção que não foi
    // mandada ao modelo não é comparação entre seções, é alucinação - e sai fora.
    const nomesEnviados = new Set(secoes.map((s) => s.nome));
    const achados = resposta.achados.filter((a) => nomesEnviados.has(a.secao_a) && nomesEnviados.has(a.secao_b) && a.secao_a !== a.secao_b);

    await dbStore.addAuditLog({
      user_id: userId,
      action: "Check Proposal Section Coherence",
      entity_type: "Proposal",
      entity_id: proposal.id,
      ip_address: req.ip || "127.0.0.1",
      user_agent: req.headers["user-agent"] || "unknown",
      metadata: JSON.stringify({ secoes: secoes.map((s) => s.nome), achados: achados.length }),
    });

    res.json({
      success: true,
      secoes_avaliadas: secoes.map((s) => s.nome),
      achados,
      descartados_por_secao_inexistente: resposta.achados.length - achados.length,
      // Dito na resposta para que nenhuma tela futura apresente isto como conferência de conta.
      coerencia_numerica_e_deterministica: "GET /api/proposals/:id/revisao",
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(502).json({ success: false, message: "A resposta do provedor de IA não veio no formato esperado." });
    }
    next(err);
  }
});

/*
 * F7, ENTREGA 4: a COMPARAÇÃO ENTRE RODADAS.
 *
 * Sem estes três números o ciclo não tem critério de parada: revisar de novo seria um ato de fé.
 * Com eles, "sanados 4, parciais 1, novos 0" e "sanados 0, parciais 1, novos 6" são duas
 * situações que se distinguem de relance - a segunda dizendo que a IA está inventando pauta nova
 * em vez de fechar a antiga.
 *
 * A conta NÃO é refeita aqui: ela só lê o `previousFindingId` que o worker gravou quando a rodada
 * nasceu. Isso é o que garante que o número mostrado hoje continue o mesmo amanhã, mesmo que a
 * heurística de casamento mude de versão - o oposto de recalcular a cada abertura da tela.
 *
 * O único ponto que exige cuidado é o universo dos ANTERIORES. "Sanado" deve significar
 * "estava aberto quando esta rodada começou e não voltou", e o status de hoje não responde isso:
 * alguém pode ter marcado o apontamento como resolvido DEPOIS. `resolvedAt` resolve sem snapshot
 * nenhum - um apontamento fechado depois do início da rodada estava aberto no início dela.
 */
router.get("/proposals/:id/comparacao-de-rodadas", requirePermission("proposal:edit"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const proposal = await dbStore.getProposal(req.params.id);
    if (!proposal) {
      return res.status(404).json({ success: false, message: "Proposal not found." });
    }

    /*
     * F8: `origem: "ia"` é o que impede a rodada do aprovador de entrar nesta conta.
     *
     * Os três números daqui (sanados / parciais / novos) respondem "a IA está apontando as mesmas
     * coisas de novo?". A rodada do aprovador é criada na reabertura, portanto seria a PRIMEIRA no
     * `orderBy desc` e passaria a ser lida como "a rodada atual" - a comparação diria que 100% dos
     * apontamentos são novos e que nada foi sanado. Os números têm dono e significado; este filtro
     * é o que os mantém.
     */
    const rodadas = await prisma.proposalOpinionRun.findMany({
      where: { proposalId: proposal.id, origem: ORIGEM_IA },
      orderBy: { createdAt: "desc" },
      take: 2,
      include: { opinions: { include: { findings: { where: { origem: ORIGEM_IA } } } } },
    });

    if (rodadas.length < 2) {
      return res.json({
        success: true,
        comparacao: null,
        // Não é erro: a primeira rodada de uma proposta não tem contra o que comparar, e a tela
        // precisa dizer isso em vez de mostrar três zeros, que se leem como "nada mudou".
        motivo: rodadas.length === 0 ? "sem_rodadas" : "primeira_rodada",
      });
    }

    const [atual, anterior] = rodadas;
    const findingsDe = (r: typeof atual) => r.opinions.flatMap((o) => o.findings);
    const novosDaRodada = findingsDe(atual);
    const anterioresAbertosNoInicio = findingsDe(anterior).filter(
      (f) => f.status === "aberto" || f.status === "em_tratativa" || (f.resolvedAt !== null && f.resolvedAt > atual.createdAt)
    );

    const porId = new Map(findingsDe(anterior).map((f) => [f.id, f]));
    const abertosNoInicio = new Set(anterioresAbertosNoInicio.map((f) => f.id));
    const casamentos = novosDaRodada.map((f) => ({
      novoId: f.id,
      // Um vínculo que aponte para apontamento JÁ FECHADO no início desta rodada não conta: ele
      // não estava na conta dos anteriores, e deixá-lo entrar produziria um "parcial" sobre algo
      // que ninguém tinha em aberto.
      anteriorId: f.previousFindingId && abertosNoInicio.has(f.previousFindingId) ? f.previousFindingId : null,
      origem: null,
      similaridade: null,
    }));

    const comparacao = compararRodadas(
      anterioresAbertosNoInicio.map((f) => ({ id: f.id, title: f.title, targetKind: f.targetKind, targetKey: f.targetKey })),
      novosDaRodada.map((f) => ({ id: f.id, title: f.title, targetKind: f.targetKind, targetKey: f.targetKey })),
      casamentos
    );

    const detalhar = (ids: string[], fonte: "atual" | "anterior") => ids.map((id) => {
      const f = fonte === "atual" ? novosDaRodada.find((x) => x.id === id)! : porId.get(id)!;
      return {
        id: f.id,
        title: f.title,
        severity: f.severity,
        status: f.status,
        target_kind: f.targetKind,
        target_key: f.targetKey,
        previous_finding_id: fonte === "atual" ? f.previousFindingId : null,
        remediation_verdict: f.remediationVerdict,
      };
    });

    res.json({
      success: true,
      comparacao: {
        rodada_atual: { id: atual.id, created_at: atual.createdAt, logic_version: atual.logicVersion },
        rodada_anterior: { id: anterior.id, created_at: anterior.createdAt, logic_version: anterior.logicVersion },
        // Uma rodada v1 (anterior à F6) não tem apontamento nenhum: comparar com ela diria que
        // 100% dos apontamentos são novos - o que é verdade e ao mesmo tempo inútil, então a tela
        // recebe o aviso em vez de um número que engana.
        comparavel: anterior.logicVersion >= 2,
        totais: {
          sanados: comparacao.sanados.length,
          parciais: comparacao.parciais.length,
          novos: comparacao.novos.length,
          abertos_na_rodada_anterior: anterioresAbertosNoInicio.length,
          total_nesta_rodada: novosDaRodada.length,
        },
        sanados: detalhar(comparacao.sanados, "anterior"),
        parciais: detalhar(comparacao.parciais, "atual"),
        novos: detalhar(comparacao.novos, "atual"),
      },
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

/*
 * =============================================================================================
 * F9 (rodada 09/2026): O ASSISTENTE DO APROVADOR
 * =============================================================================================
 *
 * O que ele responde, e o que ele deliberadamente NAO responde.
 *
 * A F8 deu ao aprovador o dossie: o documento, os pareceres com as tratativas, as verificacoes
 * deterministicas e o historico de versoes. Tudo verdadeiro, tudo relevante - e muito. Um dossie
 * de uma v2 reaberta traz facilmente quinze apontamentos com quinze justificativas, oito edicoes
 * de secao e duas decisoes anteriores com seus itens. Ler isso inteiro, a cada aprovacao, e o que
 * ninguem faz; e o que se faz no lugar - olhar o resumo e assinar - e exatamente o risco que as
 * oito fases anteriores existiram para eliminar.
 *
 * Este assistente le o CONJUNTO e devolve PERGUNTAS. Nao um resumo (que substituiria a leitura),
 * nao um veredito (que substituiria a decisao): perguntas sobre onde vale a pena olhar.
 *
 * ---------------------------------------------------------------------------------------------
 * POR QUE NUNCA UM VEREDITO - e por que isso e requisito, nao estilo
 * ---------------------------------------------------------------------------------------------
 *
 * O risco tem nome: vies de automacao. Uma ferramenta que diga "esta proposta parece pronta" nao
 * ajuda o aprovador a decidir - ela decide, e transfere a ele so a assinatura. O aprovador que
 * discorda passa a ter de justificar a discordancia contra a maquina, e o que discorda menos
 * simplesmente concorda. A autoridade formal continuaria no lugar certo no organograma e teria
 * saido do lugar certo na pratica.
 *
 * A proibicao esta escrita DENTRO do prompt, como a F7 fez com o veredito de sanacao
 * ("consultivo"), e e verificada DEPOIS em codigo (server/utils/approverBriefing.ts), porque uma
 * instrucao e cumprida quase sempre e "quase" nao serve aqui. Ver o cabecalho daquele arquivo para
 * as tres amarras e por que a palavra "aprovar" sozinha nao e barrada.
 *
 * ---------------------------------------------------------------------------------------------
 * O QUE E CONTA, E POR ISSO NAO VAI AO MODELO
 * ---------------------------------------------------------------------------------------------
 *
 * Duas coisas ficam de fora do prompt por politica, nao por esquecimento:
 *
 *   - A COERENCIA NUMERICA. Total, preco, quantidade, soma de tabela: tudo isso e conferido
 *     exatamente por server/utils/proposalQa.ts, e o resultado ja esta na aba "Verificacoes" do
 *     mesmo dossie. Mandar o mesmo trabalho ao modelo trocaria uma prova por uma opiniao.
 *   - O TAMANHO DA MUDANCA de uma secao editada. `percentualDeMudanca` calcula por Levenshtein e
 *     manda o numero pronto como FATO. O modelo nao recebe os dois textos para "avaliar se mudou
 *     pouco" - ele recebe "mudou 3%" e a pergunta que sobra, a interessante, e a que nao tem
 *     resposta exata: uma mudanca desse tamanho enderecou o que o apontamento dizia?
 */
function buildApproverBriefingPrompt(material: MaterialDoAssistente, idioma: string): string {
  const secoes = material.secoes.length
    ? material.secoes.map((s) => `### ${s.nome}\n${s.texto}`).join("\n\n")
    : "(nenhuma secao de texto preenchida)";

  const apontamentos = material.apontamentos.length
    ? material.apontamentos
        .map(
          (a) =>
            `- id=${a.id} | origem=${a.origem} | severidade=${a.severidade} | secao=${a.secao ?? "geral"} | status=${a.status}\n` +
            `  APONTOU: ${a.titulo} - ${a.detalhe}\n` +
            `  TRATATIVA REGISTRADA: ${a.justificativa ? `"${a.justificativa}"` : "(nenhuma justificativa foi escrita)"}` +
            (a.veredito_de_sanacao ? `\n  VEREDITO CONSULTIVO DE SANACAO: ${a.veredito_de_sanacao}` : "")
        )
        .join("\n")
    : "(nenhum apontamento)";

  const edicoes = material.edicoes.length
    ? material.edicoes
        .map(
          (e) =>
            `- secao=${e.secao} | MUDOU ${e.percentual_de_mudanca}% DO TEXTO (medido, nao estimado) | motivada por: ${e.motivada_por ?? "nenhum apontamento"}\n` +
            `  ANTES: ${e.texto_anterior}\n  DEPOIS: ${e.texto_novo}`
        )
        .join("\n")
    : "(nenhuma edicao de secao registrada nesta versao)";

  const decisoes = material.decisoes.length
    ? material.decisoes
        .map(
          (d) =>
            `- v${d.versao} | etapa=${d.etapa} | ${d.decisao} | comentario: ${d.comentarios || "(vazio)"}\n` +
            (d.itens.length
              ? d.itens.map((i) => `    apontou "${i.secao ?? "geral"}": ${i.comentario}`).join("\n")
              : "    (rejeicao sem itens por secao)")
        )
        .join("\n")
    : "(nenhuma decisao anterior)";

  const cadeia = material.versoes.map((v) => `v${v.versao} (${v.status})`).join(" -> ") || "(versao unica)";

  return `Voce prepara um APROVADOR para ler uma proposta comercial, em ${idioma}. Ele tem autoridade
formal para aprovar ou rejeitar, e essa decisao e dele - nao sua.

Seu unico trabalho e apontar ONDE VALE A PENA OLHAR, em forma de PERGUNTA.

== PROIBICAO ABSOLUTA ==
Voce NAO recomenda aprovar. Voce NAO recomenda rejeitar. Voce NAO diz que a proposta esta pronta,
apta, madura, adequada, satisfatoria ou sem impedimentos, nem que "nao ha motivo para nao aprovar".
Nao ha excecao, nem de passagem, nem no panorama, nem como conclusao de um ponto. Uma unica frase
sua que soe como recomendacao transforma o aprovador em carimbo - e e por isso que este produto
tem aprovador humano. Cada ponto seu TEM de terminar em "?": se voce nao consegue formula-lo como
pergunta, ele nao pertence a esta lista.

== TAMBEM PROIBIDO: CONTA ==
NAO confira valor, total, soma, preco, quantidade, percentual nem desconto. Isso e conferido
exatamente por outra parte do sistema, ja esta na tela ao lado do seu resultado, e um palpite seu
sobre numero seria pior que o silencio.

== A PROPOSTA (v${material.versao}) ==
Cadeia de versoes: ${cadeia}

--- SECOES DE TEXTO, COMO ESTAO AGORA ---
${secoes}

--- APONTAMENTOS E O QUE FIZERAM COM CADA UM ---
${apontamentos}

--- EDICOES DE SECAO NESTA VERSAO ---
${edicoes}

--- DECISOES ANTERIORES DA CADEIA ---
${decisoes}

== O QUE PROCURAR ==
1. TRATATIVA QUE RESPONDE DE LADO: a justificativa registrada para "resolvido" ou "aceito com
   risco" fala de outra coisa que nao o que o apontamento dizia, ou responde so parte dele.
2. EDICAO PEQUENA DEMAIS PARA O QUE SE PEDIU: o percentual de mudanca acima e medido; pergunte se
   uma mudanca daquele tamanho da conta do que o apontamento pedia.
3. RISCO ACEITO: o que ficou "aceito com risco", com que justificativa, e o que exatamente o
   aprovador estaria assumindo ao seguir adiante com aquilo em aberto.
4. CONCENTRACAO: uma secao que acumula apontamentos - o que ela tem que as outras nao tem.
5. ENTRE VERSOES: o que a rejeicao anterior apontou e como a versao atual respondeu a cada item.

Regras dos pontos:
- Cite SEMPRE o nome exato de uma secao da lista acima em "secao", ou deixe null. Nunca invente.
- Cite o id exato de um apontamento da lista acima em "apontamento_id", ou deixe null.
- Nenhum ponto deve ser generico ("verifique se esta tudo certo?"). Um ponto que nao nomeie o que
  o motivou nao ajuda ninguem a olhar para lugar nenhum.
- Lista vazia e resposta legitima. Nao invente pauta para preencher espaco.
- No maximo 8 pontos: uma lista que nao se le de uma vez volta a ser o dossie inteiro.

Responda com ONLY um objeto JSON, sem markdown:
{ "panorama": "1-2 frases em ${idioma} descrevendo o estado do conjunto, SEM juizo sobre aprovar ou rejeitar",
  "pontos": [{ "pergunta": "uma pergunta em ${idioma}, terminando em ?", "por_que": "1-2 frases em ${idioma} dizendo o que no material acima motivou a pergunta", "categoria": "tratativa"|"edicao"|"risco_aceito"|"concentracao"|"entre_versoes", "secao": "nome exato de uma secao acima ou null", "apontamento_id": "id exato de um apontamento acima ou null" }] }`;
}

interface MaterialDoAssistente {
  versao: number;
  secoes: { nome: string; texto: string }[];
  apontamentos: {
    id: string;
    origem: string;
    titulo: string;
    detalhe: string;
    severidade: string;
    secao: string | null;
    status: string;
    justificativa: string | null;
    veredito_de_sanacao: string | null;
  }[];
  edicoes: {
    secao: string;
    texto_anterior: string;
    texto_novo: string;
    percentual_de_mudanca: number;
    motivada_por: string | null;
  }[];
  versoes: { versao: number; status: string }[];
  decisoes: {
    id: string;
    versao: number;
    etapa: string;
    decisao: string;
    comentarios: string;
    itens: { secao: string | null; comentario: string }[];
  }[];
}

/*
 * Junta, numa estrutura so, tudo o que o assistente le - e e a MESMA estrutura que alimenta a
 * impressao do estado. Duas fontes separadas (uma para o prompt, outra para o hash) divergiriam na
 * primeira manutencao, e a tela passaria a dizer "desatualizado" para sempre ou nunca.
 */
async function montarMaterialDoAssistente(proposal: Proposal): Promise<MaterialDoAssistente> {
  const secoesDaProposta = await montarSecoesDaProposta(proposal);
  const secoes = secoesDaProposta
    .filter((s) => (s.texto_atual ?? "").trim().length > 0)
    .map((s) => ({ nome: s.target_key, texto: (s.texto_atual as string).trim() }));

  /*
   * TODOS os apontamentos desta proposta, de TODAS as rodadas e das DUAS origens. O painel de
   * pareceres recorta pela ultima rodada de IA (`latest_opinion_run_id`) porque a pergunta dele e
   * "o que a IA apontou agora"; a pergunta do aprovador e outra - "o que ficou pendente sobre este
   * documento" -, e um apontamento do aprovador, que vive numa rodada sintetica e NUNCA e a
   * `latest_opinion_run_id` (primeira amarra de server/utils/approverFindings.ts), ficaria de fora
   * exatamente no cenario para o qual este assistente foi feito.
   */
  const rodadas = await prisma.proposalOpinionRun.findMany({
    where: { proposalId: proposal.id },
    include: { opinions: { include: { findings: { orderBy: { ordinal: "asc" } } } } },
    orderBy: { createdAt: "asc" },
  });
  const apontamentos = rodadas.flatMap((r) =>
    r.opinions.flatMap((o) =>
      o.findings.map((f) => ({
        id: f.id,
        origem: f.origem,
        titulo: f.title,
        detalhe: f.detail,
        severidade: f.severity,
        secao: f.targetKey,
        status: f.status,
        justificativa: f.resolutionNote,
        veredito_de_sanacao: f.remediationVerdict,
      }))
    )
  );

  const edicoesBrutas = await prisma.proposalSectionEdit.findMany({
    where: { proposalId: proposal.id },
    include: { finding: { select: { title: true } } },
    orderBy: { createdAt: "asc" },
  });
  const edicoes = edicoesBrutas.map((e) => ({
    secao: e.targetKey ?? "geral",
    texto_anterior: e.previousValue ?? "",
    texto_novo: e.newValue ?? "",
    percentual_de_mudanca: percentualDeMudanca(e.previousValue ?? "", e.newValue ?? ""),
    motivada_por: e.finding?.title ?? null,
  }));

  const doGrupo = await prisma.proposal.findMany({
    where: { proposalGroupId: proposal.proposal_group_id },
    orderBy: { version: "asc" },
    select: { id: true, version: true, status: true },
  });
  const decisoesBrutas = await prisma.approvalDecision.findMany({
    where: { proposalId: { in: doGrupo.map((p) => p.id) } },
    orderBy: { createdAt: "asc" },
    include: { items: { orderBy: { ordinal: "asc" } } },
  });
  const versaoPorProposta = new Map(doGrupo.map((p) => [p.id, p.version]));
  const workflows = await dbStore.getApprovalWorkflows();
  const stagePorId = new Map(
    (workflows as any[]).flatMap((w: any) => (w.stages || []).map((st: any) => [st.id, st] as const))
  );

  return {
    versao: proposal.version,
    secoes,
    apontamentos,
    edicoes,
    versoes: doGrupo.map((p) => ({ versao: p.version, status: p.status as string })),
    decisoes: decisoesBrutas.map((d) => ({
      id: d.id,
      versao: versaoPorProposta.get(d.proposalId) ?? 0,
      etapa: (stagePorId.get(d.stageId) as any)?.name ?? d.stageId,
      decisao: d.decision as string,
      comentarios: d.comments ?? "",
      itens: d.items.map((i) => ({ secao: i.targetKey, comentario: i.comment })),
    })),
  };
}

/** O estado que a impressao hasheia, derivado do MESMO material que vai ao modelo. */
function estadoLidoDoMaterial(material: MaterialDoAssistente): EstadoLidoPeloAssistente {
  return {
    secoes: material.secoes,
    apontamentos: material.apontamentos.map((a) => ({
      id: a.id,
      status: a.status,
      justificativa: a.justificativa,
      veredito: a.veredito_de_sanacao,
    })),
    edicoes: material.edicoes.map((e) => ({
      secao: e.secao,
      texto_anterior: e.texto_anterior,
      texto_novo: e.texto_novo,
    })),
    decisoes: material.decisoes.map((d) => ({
      id: d.id,
      decisao: d.decisao,
      comentarios: d.comentarios,
      itens: d.itens,
    })),
  };
}

function serializarBriefing(b: {
  id: string;
  proposalVersion: number;
  pontos: unknown;
  panorama: string;
  logicVersion: number;
  providerUsed: string;
  modelUsed: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: b.id,
    proposal_version: b.proposalVersion,
    panorama: b.panorama,
    pontos: b.pontos,
    logic_version: b.logicVersion,
    provider_used: b.providerUsed,
    model_used: b.modelUsed,
    created_at: b.createdAt,
    updated_at: b.updatedAt,
  };
}

/*
 * O GATE do assistente e o MESMO do dossie - `proposal:approve` OU ser aprovador designado no
 * workflow DESTA proposta. Nao e `proposal:edit`, como as tarefas de IA da F6 e da F7, e a
 * diferenca importa: aquelas ajudam quem ESCREVE a proposta, esta prepara quem a JULGA. Um autor
 * que pudesse executa-la estaria lendo a preparacao de quem vai avalia-lo.
 */
type AutorizacaoDoAssistente =
  | { erro: { status: number; message: string }; proposal?: undefined; userId?: undefined }
  | { erro?: undefined; proposal: Proposal; userId: string };

async function autorizarAssistenteDoAprovador(req: Request, proposalId: string): Promise<AutorizacaoDoAssistente> {
  const proposal = await dbStore.getProposal(proposalId);
  if (!proposal) return { erro: { status: 404, message: "Proposal not found." } };

  const userId = requireUserId(req);
  const roleId = (req.headers["x-role-id"] as string) || "";
  const workflows = await dbStore.getApprovalWorkflows();
  const designado = podeVerDossieDaProposta(workflows as any, proposal.approval_workflow_id, { userId, roleId });
  const role = roleId ? await dbStore.getRoleById(roleId) : null;
  const podeAprovar = Boolean(role?.permissions?.includes("proposal:approve"));
  if (!designado && !podeAprovar) {
    return {
      erro: {
        status: 403,
        message: "Forbidden: you are not a designated approver for this proposal's workflow.",
      },
    };
  }
  return { proposal, userId };
}

/*
 * GET /proposals/:id/assistente-do-aprovador
 *
 * LE o resultado guardado desta versao. NUNCA chama o modelo - e por isso que a aba pode abrir
 * junto com o dossie sem gastar nada. Devolve `briefing: null` quando ainda nao foi gerado (a tela
 * mostra o botao) e `desatualizado: true` quando o documento ou a tratativa mudaram desde a
 * geracao (a tela mostra o resultado com o aviso, e o botao de gerar de novo).
 *
 * Separado do POST de proposito: fossem a mesma rota, abrir a aba geraria - e "abrir uma tela"
 * viraria um evento de custo, que e exatamente o que o resultado guardado existe para evitar.
 */
router.get("/proposals/:id/assistente-do-aprovador", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const auth = await autorizarAssistenteDoAprovador(req, req.params.id);
    if (auth.erro) return res.status(auth.erro.status).json({ success: false, message: auth.erro.message });
    const { proposal } = auth;

    const guardado = await prisma.proposalApproverBriefing.findUnique({ where: { proposalId: proposal.id } });
    if (!guardado) {
      return res.json({ success: true, briefing: null, desatualizado: false, nao_recomenda_decisao: true });
    }

    const material = await montarMaterialDoAssistente(proposal);
    const impressao = calcularImpressaoDoEstado(estadoLidoDoMaterial(material));

    res.json({
      success: true,
      briefing: serializarBriefing(guardado),
      desatualizado: guardado.inputFingerprint !== impressao,
      nao_recomenda_decisao: true,
    });
  } catch (err) {
    next(err);
  }
});

/*
 * POST /proposals/:id/assistente-do-aprovador
 *
 * GERA o resultado - e so ele gasta IA.
 *
 * RESULTADO GUARDADO POR VERSAO: acionar de novo sobre a MESMA versao devolve o que esta gravado,
 * com `origem: "guardado"` e sem uma unica chamada ao provedor. Uma versao nova (a v2, criada por
 * POST /reopen com id proprio) nao tem linha guardada e portanto oferece rodada nova - e a
 * unicidade por `proposalId` que faz isso, sem nenhum "if" de versao no caminho. Ver o comentario
 * do modelo ProposalApproverBriefing em prisma/schema.prisma.
 *
 * DESATUALIZADO NAO E INVALIDO: se a impressao nao casa, a resposta AINDA vem do guardado, so que
 * marcada. Regerar exige `regenerar: true` no corpo. O motivo esta no schema: mudar o status de um
 * apontamento e o ato mais comum de toda a tratativa, e re-executar a cada mudanca faria a conta
 * subir sozinha, sem que ninguem tivesse pedido analise nova.
 */
router.post("/proposals/:id/assistente-do-aprovador", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const auth = await autorizarAssistenteDoAprovador(req, req.params.id);
    if (auth.erro) return res.status(auth.erro.status).json({ success: false, message: auth.erro.message });
    const { proposal, userId } = auth;

    const tenantId = req.headers["x-tenant-id"] as string;
    const material = await montarMaterialDoAssistente(proposal);
    const impressao = calcularImpressaoDoEstado(estadoLidoDoMaterial(material));

    const guardado = await prisma.proposalApproverBriefing.findUnique({ where: { proposalId: proposal.id } });
    const regenerar = req.body?.regenerar === true;

    if (guardado && !regenerar) {
      return res.json({
        success: true,
        origem: "guardado",
        desatualizado: guardado.inputFingerprint !== impressao,
        briefing: serializarBriefing(guardado),
        nao_recomenda_decisao: true,
      });
    }

    /*
     * Sem material, nao ha o que ler. Chamar o modelo aqui devolveria pontos inventados sobre um
     * documento vazio - e custaria dinheiro para faze-lo.
     */
    if (material.secoes.length === 0 && material.apontamentos.length === 0) {
      return res.status(409).json({
        success: false,
        message: "Esta proposta ainda nao tem secao de texto preenchida nem apontamento registrado: nao ha conjunto para o assistente ler.",
      });
    }

    const platformSettings = await dbStore.getSettings();
    const costCap = await checkCostCap(tenantId, platformSettings.monthly_cost_cap_usd ?? null);
    if (costCap.blocked) {
      return res.status(402).json({
        success: false,
        message: `Monthly AI cost cap reached ($${costCap.currentSpendUsd.toFixed(2)} of $${costCap.capUsd?.toFixed(2)}). Assistente do aprovador bloqueado ate o proximo mes ou ate o teto ser elevado em Admin > IA, Prompts e Custos.`,
      });
    }

    const providerResolution = await resolveProvider("proposal_approver_briefing", platformSettings);
    if (providerResolution.isFallback) {
      await recordProviderFallback({ tenantId, taskType: "proposal_approver_briefing", intendedProvider: providerResolution.intendedProvider, userId });
    }

    const { text, inputTokens, outputTokens, billedCostUsd } = await generateJsonWithProvider(
      providerResolution.provider as ConnectedProvider,
      providerResolution.model,
      buildApproverBriefingPrompt(material, proposal.language),
      { taskKey: "proposal_approver_briefing", actorRef: buildActorRef("user", userId), triggerType: "user_action" }
    );

    const resposta = z
      .object({
        panorama: z.string().catch(""),
        pontos: z
          .array(
            z.object({
              pergunta: z.string(),
              por_que: z.string().nullable().optional().default(""),
              categoria: z.enum(CATEGORIAS_DO_ASSISTENTE).catch("tratativa"),
              secao: z.string().nullable().optional().default(null),
              apontamento_id: z.string().nullable().optional().default(null),
            })
          )
          .catch([]),
      })
      .parse(parseAiJson(text));

    await recordAiUsage({
      tenantId,
      taskType: "proposal_approver_briefing",
      provider: providerResolution.provider,
      model: providerResolution.model,
      estimatedCostUsd: billedCostUsd ?? estimateCostUsd(providerResolution.model, inputTokens, outputTokens),
      userId,
    });

    const recorte = recortarPontosDoAssistente(
      resposta.pontos.map((p) => ({
        pergunta: p.pergunta,
        por_que: p.por_que ?? "",
        categoria: p.categoria,
        secao: p.secao ?? null,
        apontamento_id: p.apontamento_id ?? null,
      })),
      new Set(material.secoes.map((s) => s.nome)),
      new Set(material.apontamentos.map((a) => a.id))
    );

    /*
     * O PANORAMA passa pela mesma proibicao dos pontos, e e o unico campo que pode ser SUBSTITUIDO
     * em vez de descartado: ele nao e uma lista de onde tirar um item, e devolver string vazia
     * deixaria a tela sem cabecalho. Trocado por uma frase neutra montada aqui a partir de
     * contagens que ja sao verdade - nenhuma delas e juizo sobre decidir.
     */
    const panoramaSoaComoVeredito = contemRecomendacaoDeDecisao(resposta.panorama);
    const abertos = material.apontamentos.filter((a) => a.status === "aberto" || a.status === "em_tratativa").length;
    const aceitosComRisco = material.apontamentos.filter((a) => a.status === "aceito_com_risco").length;
    const panorama = panoramaSoaComoVeredito
      ? `v${material.versao}: ${material.apontamentos.length} apontamento(s) no total, ${abertos} ainda em aberto ou em tratativa e ${aceitosComRisco} aceito(s) com risco, com ${material.edicoes.length} edicao(oes) de secao registrada(s) nesta versao.`
      : resposta.panorama.trim();

    /*
     * `upsert` NAO serve aqui, e a recusa e do proprio produto: a extensao de tenant-scoping
     * (src/prisma.ts) bloqueia upsert em modelo com tenant_id, porque nao consegue injetar o
     * tenant no `where` de um upsert cuja unicidade nao inclui o tenant - e a nossa e por
     * `proposalId` sozinho. Sem esse bloqueio, um upsert conseguiria alcancar a linha de outro
     * tenant pelo id da proposta. Entao o caminho e o que a mensagem manda: o findUnique ja foi
     * feito acima, e daqui sai um create ou um update, ambos com o tenant no escopo.
     */
    const dadosDaLeitura = {
      pontos: recorte.pontos as any,
      panorama,
      inputFingerprint: impressao,
      logicVersion: LOGIC_VERSIONS.proposal_approver_briefing,
      providerUsed: providerResolution.provider,
      modelUsed: providerResolution.model,
      generatedByUserId: userId,
    };
    const briefing = guardado
      ? await prisma.proposalApproverBriefing.update({ where: { proposalId: proposal.id }, data: dadosDaLeitura })
      : await prisma.proposalApproverBriefing.create({
          data: {
            id: randomId("pab"),
            tenantId,
            proposalId: proposal.id,
            proposalVersion: proposal.version,
            ...dadosDaLeitura,
          },
        });

    await dbStore.addAuditLog({
      user_id: userId,
      action: "Generate Approver Briefing",
      entity_type: "Proposal",
      entity_id: proposal.id,
      ip_address: req.ip || "127.0.0.1",
      user_agent: req.headers["user-agent"] || "unknown",
      metadata: JSON.stringify({
        versao: proposal.version,
        pontos: recorte.pontos.length,
        descartados: recorte.descartados,
        panorama_substituido: panoramaSoaComoVeredito,
      }),
    });

    res.json({
      success: true,
      origem: "gerado",
      desatualizado: false,
      briefing: serializarBriefing(briefing),
      // Quantos pontos o modelo devolveu e as regras da casa barraram, por motivo. Fica na resposta
      // para que uma queda de qualidade do modelo apareca em vez de virar uma lista mais curta sem
      // explicacao - ver o cabecalho de server/utils/approverBriefing.ts.
      descartados: recorte.descartados,
      panorama_substituido: panoramaSoaComoVeredito,
      nao_recomenda_decisao: true,
      // Dito aqui pelo mesmo motivo que na coerencia da F7: para que nenhuma tela futura apresente
      // este resultado como conferencia de conta.
      coerencia_numerica_e_deterministica: "GET /api/proposals/:id/revisao",
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(502).json({ success: false, message: "A resposta do provedor de IA nao veio no formato esperado." });
    }
    next(err);
  }
});

export default router;
