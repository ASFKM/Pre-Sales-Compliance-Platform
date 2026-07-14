// Fase 6 (add-on): Gestão de POC. Every route below runs behind requirePermission("poc:read" |
// "poc:manage") AND requireModule("poc") - the module only exists for tenants whose Fleet
// Manager ModuleEntitlement includes "poc" (see server/utils/fleetLicense.ts /
// getFleetLicenseStatus), independent of RBAC permissions.
import express, { Response, NextFunction } from "express";
import type { Request } from "../types/express";
import { z } from "zod";
import multer from "multer";
import { dbStore } from "../../src/dbStore";
import { requirePermission, requireModule } from "./auth";
import { requireUserId } from "../middleware/security";
import { createStorageAdapter, validateUploadedFile } from "../utils/storage";
import { runWithTenant } from "../../src/tenantContext";
import { resolveProvider, checkCostCap, recordProviderFallback, recordAiUsage } from "../../src/aiOrchestrator";
import { generateJsonWithProvider } from "../utils/aiProviders";
import { estimateCostUsd } from "../utils/aiPricing";
import { prisma } from "../../src/prisma";
import { FACTORY_DEFAULT_POC_TEST_GENERATION_PROMPT, FACTORY_DEFAULT_POC_SCHEDULE_GENERATION_PROMPT, FACTORY_DEFAULT_POC_FINAL_REPORT_GENERATION_PROMPT } from "../utils/promptDefaults";
import { extractKnowledgeBaseKeywords } from "./analysis";
import { triggerKnowledgeBaseAnalysis } from "./knowledgeBase";
import { getSiteRastreioApiKey, queryTrackingStatus } from "../utils/siteRastreio";

const router = express.Router();

// Same memory-storage config as documents.ts - a 10MB limit comfortably covers a scanned NF PDF.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// Fase L: once a POC is fully approved (Poc.status === "completed"), nothing about it can be
// edited anymore - equipment, cronograma, casos de teste, visão geral, aceite. One shared
// middleware instead of copy-pasting the same check into every write route below, since every
// mutating route under /:id shares this exact rule. Read (GET) requests always pass through
// untouched - "locked" means read-only, not access-denied. Archiving and the acceptance
// finalize/approve endpoints are the explicit exceptions: archiving only ever applies to an
// already-completed POC, and finalize/approve ARE the mechanism that reaches "completed" in the
// first place, so they can't be blocked by the state they're the one to set.
const POC_LOCK_EXEMPT_SUFFIXES = ["/archive", "/acceptance/finalize", "/acceptance/approve"];
router.use("/:id", async (req: Request, res: Response, next: NextFunction) => {
  if (!["POST", "PUT", "DELETE"].includes(req.method)) return next();
  if (POC_LOCK_EXEMPT_SUFFIXES.some((suffix) => req.path.endsWith(suffix))) return next();
  try {
    const poc = await dbStore.getPoc(req.params.id);
    if (poc && poc.status === "completed") {
      return res.status(423).json({ success: false, message: "Esta POC foi concluída e aprovada - não é mais possível editá-la." });
    }
    next();
  } catch (err) {
    next(err);
  }
});

// Fase G: same keyword-extraction + IDF-weighted search already proven for BOM enrichment
// (server/routes/analysis.ts) - minLength 3 on purpose, equipment specs in this domain are full
// of short, highly-distinguishing acronyms (PTZ, DAI, DVR) a longer floor would drop. Only
// counts approved entries (dbStore.searchApprovedKnowledgeBase's own WHERE clause) - a pending,
// not-yet-reviewed datasheet extraction doesn't count as "we have knowledge" yet.
async function countKnowledgeBaseMatches(name: string, manufacturer?: string): Promise<number> {
  const keywords = extractKnowledgeBaseKeywords([name, manufacturer].filter(Boolean).join(" "), 25, 3);
  if (keywords.length === 0) return 0;
  const matches = await dbStore.searchApprovedKnowledgeBase(keywords, 10);
  return matches.length;
}

// Fase H: real grounding for both AI generation routes below (test cases, schedule) - the actual
// fix for the reported hallucination bug (asked to generate a test for "DAI", the model invented
// plausible-sounding but fake metrics instead of drawing on the tenant's own Knowledge Base, which
// DOES have real DAI entries once the equipment is linked - see countKnowledgeBaseMatches above).
// Walks every equipment item on the POC (not just ones already flagged with kb_match_count > 0 -
// approved entries can be added to the KB after the equipment item itself was created) and
// collects the union of matching approved entries, deduplicated by id since the same entry can
// legitimately match more than one piece of equipment (e.g. a shared VMS license).
async function getPocKnowledgeBaseContext(pocId: string): Promise<{ hasContext: boolean; contextText: string }> {
  const poc = await dbStore.getPoc(pocId);
  const items = await dbStore.getPocEquipmentItems(pocId);
  const seenEntryIds = new Set<string>();
  const entries: { trigger: string; knowledge: string }[] = [];

  // Bug fix (2026-07-14, reported directly): searching by equipment name/manufacturer alone
  // pulled in EVERY KB fact about a rich, multi-page datasheet (mount hardware, HTTPS certs,
  // password policy, PPPoE) with equal weight, regardless of what the POC's objective actually
  // asks to validate - a "Testar a acuracidade do DAI" objective ended up generating test cases
  // about wall mounts and PPPoE. Folding the objective's own keywords into the SAME search query
  // (not a separate one) lets the existing IDF weighting in searchApprovedKnowledgeBase do its job:
  // "DAI" is rare across this equipment's many KB rows, so it outweighs generic terms shared by
  // most of them, pulling in the DAI/analytics-specific entries first instead of arbitrary ones.
  const objectiveKeywords = poc ? extractKnowledgeBaseKeywords(poc.objective, 15, 3) : [];

  for (const item of items) {
    const keywords = extractKnowledgeBaseKeywords([item.name, item.manufacturer].filter(Boolean).join(" "), 25, 3);
    const combinedKeywords = Array.from(new Set([...objectiveKeywords, ...keywords]));
    if (combinedKeywords.length === 0) continue;
    const matches = await dbStore.searchApprovedKnowledgeBase(combinedKeywords, 6);
    for (const m of matches) {
      if (seenEntryIds.has(m.id)) continue;
      seenEntryIds.add(m.id);
      entries.push({ trigger: m.trigger, knowledge: m.knowledge });
    }
  }

  if (entries.length === 0) {
    return { hasContext: false, contextText: "" };
  }

  const contextText = entries.map((e, i) => `${i + 1}. Situação: ${e.trigger}\n   Conhecimento: ${e.knowledge}`).join("\n");
  return { hasContext: true, contextText };
}

// Shared instructions for how the two generation prompts below must use (or refuse to use) the
// grounding context - kept as one function so the anti-hallucination rule can't drift apart
// between test-case and schedule generation.
function knowledgeBaseGroundingBlock(kb: { hasContext: boolean; contextText: string }): string {
  if (kb.hasContext) {
    return `BASE DE CONHECIMENTO DISPONÍVEL PARA O(S) EQUIPAMENTO(S) DESTA POC (fonte de verdade
obrigatória - use estas informações reais para qualquer detalhe técnico específico, como métricas,
thresholds, nomes de funcionalidades ou comportamento de um recurso do fabricante):
${kb.contextText}

Regra crítica: qualquer especificação técnica concreta (número, percentual, nome de funcionalidade,
comportamento específico do equipamento) só pode vir do que está listado acima ou do objetivo/
critérios de sucesso informados pelo usuário. NUNCA invente uma métrica, threshold ou comportamento
que não esteja em nenhuma dessas duas fontes - isso vale especialmente para taxas de acerto/
assertividade/precisão (%): se a Base de Conhecimento ou o objetivo/critérios não informam um
percentual-alvo explícito para a funcionalidade sendo testada, o resultado esperado deve pedir para
medir e registrar o percentual observado (ex: "registrar a taxa de detecção observada"), nunca
afirmar um número-alvo que você mesmo inventou.

Regra crítica adicional (relevância): a lista acima é uma busca automática por palavra-chave e pode
trazer fatos genéricos e reais do equipamento que NÃO têm relação com o que o objetivo desta POC
pede para validar (ex: mount físico, senha, PPPoE, certificado HTTPS, em uma POC que pede para
testar acuracidade de detecção). Use apenas as entradas da Base de Conhecimento que sejam
diretamente relevantes ao objetivo/critérios de sucesso informados - ignore silenciosamente as
demais, mesmo que estejam listadas acima. Nunca gere um item cujo tema principal não tenha relação
direta com o que o objetivo pede para testar.`;
  }
  return `BASE DE CONHECIMENTO: não há nenhuma entrada aprovada na Base de Conhecimento para o(s)
equipamento(s) cadastrado(s) nesta POC ainda.

Regra crítica: como não há base real, NÃO invente métricas, thresholds, percentuais de
assertividade ou qualquer comportamento específico de um recurso do fabricante - isso já aconteceu
antes e gerou conteúdo fabricado (o caso relatado foi pedir um teste de "DAI" e a IA inventar
números). Gere apenas o que puder ser validado unicamente com base no objetivo e nos critérios de
sucesso informados pelo usuário, em nível funcional/genérico. Preencha o campo
"knowledge_base_warning" da resposta explicando que a Base de Conhecimento não tem cobertura para
este equipamento ainda e que o conteúdo gerado é genérico por esse motivo.`;
}

const PocStatusEnum = z.enum(["not_started", "planned", "in_progress", "blocked", "completed"]);

// Kept as a plain ZodObject (no .refine() here) specifically so .partial() stays available for
// the PUT handler below - Zod can't call .partial() on a schema once .refine() wraps it in a
// ZodEffects. The cross-field "must have project_id or standalone_customer_name" rule only makes
// sense at creation time anyway, so it's applied separately via PocCreateSchema.
const PocBaseSchema = z.object({
  project_id: z.string().optional(),
  standalone_customer_name: z.string().optional(),
  standalone_contact_name: z.string().optional(),
  standalone_contact_email: z.string().email().optional().or(z.literal("")),
  standalone_contact_phone: z.string().optional(),
  name: z.string().min(2, "Name must be at least 2 characters"),
  objective: z.string().min(5, "Objective is required"),
  // Deliberately no .default() here: Zod applies .default() whenever a field is undefined,
  // .partial() or not - so on PUT (partial update), an unrelated field-only patch (e.g. just
  // customer_contact_name) would silently reset status back to "planned" every time. The
  // "planned" default for creation is applied explicitly in the POST handler below instead.
  status: PocStatusEnum.optional(),
  start_date: z.string().min(5, "Start date is required"),
  end_date: z.string().min(5, "End date is required"),
  customer_contact_name: z.string().min(2, "Customer contact name is required"),
  customer_contact_role: z.string().min(2, "Customer contact role is required"),
  // Fase J: where the POC actually happens - all optional, same reasoning as the fields above
  // (address may not be known yet at creation time).
  address_zip: z.string().optional(),
  address_street: z.string().optional(),
  address_number: z.string().optional(),
  address_complement: z.string().optional(),
  address_neighborhood: z.string().optional(),
  address_city: z.string().optional(),
  address_state: z.string().optional(),
});

// A POC either hangs off an existing Project (inheriting its customer/vertical) or stands alone
// with its own minimal customer record - at least one of the two must be present.
export const PocCreateSchema = PocBaseSchema.refine(
  (data) => Boolean(data.project_id) || Boolean(data.standalone_customer_name),
  {
    message: "A POC must be linked to a project or have a standalone customer name.",
    path: ["project_id"],
  }
);

// Fase K: the board excludes archived POCs by default (?archived unset or "false") so completed
// deals don't pile up forever; the "Arquivadas" popup passes ?archived=true to see exactly those.
router.get("/", requirePermission("poc:read"), requireModule("poc"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const archived = req.query.archived === "true";
    const pocs = await dbStore.getPocs({ archived });
    res.json(pocs);
  } catch (err) {
    next(err);
  }
});

router.get("/:id", requirePermission("poc:read"), requireModule("poc"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const poc = await dbStore.getPoc(req.params.id);
    if (!poc) {
      return res.status(404).json({ success: false, message: "POC not found" });
    }
    res.json(poc);
  } catch (err) {
    next(err);
  }
});

router.post("/", requirePermission("poc:manage"), requireModule("poc"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = PocCreateSchema.parse(req.body);
    const userId = requireUserId(req);

    if (validated.project_id) {
      const project = await dbStore.getProject(validated.project_id);
      if (!project) {
        return res.status(400).json({ success: false, message: "Linked project not found." });
      }
    }

    const poc = await dbStore.createPoc({
      ...validated,
      status: validated.status || "not_started",
      standalone_contact_email: validated.standalone_contact_email || undefined,
      owner_user_id: userId,
    });

    await dbStore.addAuditLog({
      user_id: userId,
      action: "Create Poc",
      entity_type: "Poc",
      entity_id: poc.id,
      ip_address: req.ip || "127.0.0.1",
      user_agent: req.headers["user-agent"] || "unknown",
      metadata: JSON.stringify(validated)
    });

    res.status(201).json(poc);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.issues[0].message });
    }
    next(err);
  }
});

router.put("/:id", requirePermission("poc:manage"), requireModule("poc"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = PocBaseSchema.partial().parse(req.body);
    const poc = await dbStore.updatePoc(req.params.id, validated);
    if (!poc) {
      return res.status(404).json({ success: false, message: "POC not found" });
    }

    const userId = requireUserId(req);
    await dbStore.addAuditLog({
      user_id: userId,
      action: "Update Poc",
      entity_type: "Poc",
      entity_id: req.params.id,
      ip_address: req.ip || "127.0.0.1",
      user_agent: req.headers["user-agent"] || "unknown",
      metadata: JSON.stringify(validated)
    });

    res.json(poc);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.issues[0].message });
    }
    next(err);
  }
});

router.delete("/:id", requirePermission("poc:manage"), requireModule("poc"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const deleted = await dbStore.deletePoc(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: "POC not found" });
    }

    const userId = requireUserId(req);
    await dbStore.addAuditLog({
      user_id: userId,
      action: "Delete Poc",
      entity_type: "Poc",
      entity_id: req.params.id,
      ip_address: req.ip || "127.0.0.1",
      user_agent: req.headers["user-agent"] || "unknown",
      metadata: JSON.stringify({ deleted_poc_id: req.params.id })
    });

    res.json({ success: true, message: "POC deleted successfully" });
  } catch (err) {
    next(err);
  }
});

// Fase K: archiving only makes sense for a POC that's actually done - lets the board declutter
// without deleting history. Un-archiving (archived: false) is the same route so the "Arquivadas"
// popup can offer a way back if someone archives the wrong one.
router.put("/:id/archive", requirePermission("poc:manage"), requireModule("poc"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { archived } = z.object({ archived: z.boolean() }).parse(req.body);

    const poc = await dbStore.getPoc(req.params.id);
    if (!poc) {
      return res.status(404).json({ success: false, message: "POC not found" });
    }
    if (archived && poc.status !== "completed") {
      return res.status(400).json({ success: false, message: "Only a completed POC can be archived." });
    }

    const updated = await dbStore.updatePoc(req.params.id, { archived });
    res.json(updated);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.issues[0].message });
    }
    next(err);
  }
});

// Success criteria (Fase B) - a short checklist agreed upfront with the customer.
router.get("/:id/success-criteria", requirePermission("poc:read"), requireModule("poc"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const poc = await dbStore.getPoc(req.params.id);
    if (!poc) {
      return res.status(404).json({ success: false, message: "POC not found" });
    }
    const criteria = await dbStore.getPocSuccessCriteria(req.params.id);
    res.json(criteria);
  } catch (err) {
    next(err);
  }
});

router.post("/:id/success-criteria", requirePermission("poc:manage"), requireModule("poc"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { description } = z.object({ description: z.string().min(2, "Description is required") }).parse(req.body);

    const poc = await dbStore.getPoc(req.params.id);
    if (!poc) {
      return res.status(404).json({ success: false, message: "POC not found" });
    }

    const criterion = await dbStore.createPocSuccessCriterion(req.params.id, description);
    res.status(201).json(criterion);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.issues[0].message });
    }
    next(err);
  }
});

router.put("/:id/success-criteria/:criterionId", requirePermission("poc:manage"), requireModule("poc"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = z.object({ description: z.string().min(2).optional(), done: z.boolean().optional() }).parse(req.body);

    const criteria = await dbStore.getPocSuccessCriteria(req.params.id);
    const target = criteria.find((c) => c.id === req.params.criterionId);
    if (!target) {
      return res.status(404).json({ success: false, message: "Success criterion not found for this POC." });
    }

    const updated = await dbStore.updatePocSuccessCriterion(req.params.criterionId, validated);
    res.json(updated);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.issues[0].message });
    }
    next(err);
  }
});

router.delete("/:id/success-criteria/:criterionId", requirePermission("poc:manage"), requireModule("poc"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const criteria = await dbStore.getPocSuccessCriteria(req.params.id);
    const target = criteria.find((c) => c.id === req.params.criterionId);
    if (!target) {
      return res.status(404).json({ success: false, message: "Success criterion not found for this POC." });
    }

    await dbStore.deletePocSuccessCriterion(req.params.criterionId);
    res.json({ success: true, message: "Success criterion deleted successfully" });
  } catch (err) {
    next(err);
  }
});

// Equipment (Fase C) - physical hardware loaned to the customer for the POC.
router.get("/:id/equipment", requirePermission("poc:read"), requireModule("poc"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const poc = await dbStore.getPoc(req.params.id);
    if (!poc) {
      return res.status(404).json({ success: false, message: "POC not found" });
    }
    const items = await dbStore.getPocEquipmentItems(req.params.id);
    res.json(items);
  } catch (err) {
    next(err);
  }
});

router.post("/:id/equipment", requirePermission("poc:manage"), requireModule("poc"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = z
      .object({
        name: z.string().min(2, "Name is required"),
        serial_number: z.string().optional(),
        manufacturer: z.string().optional(),
        part_number: z.string().optional(),
      })
      .parse(req.body);

    const poc = await dbStore.getPoc(req.params.id);
    if (!poc) {
      return res.status(404).json({ success: false, message: "POC not found" });
    }

    const kbMatchCount = await countKnowledgeBaseMatches(validated.name, validated.manufacturer);
    const item = await dbStore.createPocEquipmentItem(req.params.id, { ...validated, kb_match_count: kbMatchCount });
    res.status(201).json(item);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.issues[0].message });
    }
    next(err);
  }
});

// Fase G: BOM items from the linked Project not yet imported as equipment for this POC.
router.get("/:id/equipment/bom-candidates", requirePermission("poc:read"), requireModule("poc"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const poc = await dbStore.getPoc(req.params.id);
    if (!poc) {
      return res.status(404).json({ success: false, message: "POC not found" });
    }
    const candidates = await dbStore.getPocBomCandidates(req.params.id);
    res.json(candidates);
  } catch (err) {
    next(err);
  }
});

router.post("/:id/equipment/from-bom", requirePermission("poc:manage"), requireModule("poc"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { bom_item_id } = z.object({ bom_item_id: z.string().min(1) }).parse(req.body);

    const poc = await dbStore.getPoc(req.params.id);
    if (!poc) {
      return res.status(404).json({ success: false, message: "POC not found" });
    }

    const candidates = await dbStore.getPocBomCandidates(req.params.id);
    const candidate = candidates.find((c) => c.bom_item_id === bom_item_id);
    if (!candidate) {
      return res.status(400).json({ success: false, message: "This BOM item was not found or has already been imported." });
    }

    const kbMatchCount = await countKnowledgeBaseMatches(candidate.equipment_name, candidate.manufacturer);
    const item = await dbStore.createPocEquipmentItem(req.params.id, {
      name: candidate.equipment_name,
      manufacturer: candidate.manufacturer || undefined,
      part_number: candidate.part_number || undefined,
      source_bom_item_id: candidate.bom_item_id,
      kb_match_count: kbMatchCount,
    });
    res.status(201).json(item);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.issues[0].message });
    }
    next(err);
  }
});

router.put("/:id/equipment/:itemId", requirePermission("poc:manage"), requireModule("poc"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = z
      .object({
        name: z.string().min(2).optional(),
        serial_number: z.string().optional(),
        status: z.enum(["shipped", "at_customer", "returned"]).optional(),
        // Fase I: clearing the field (empty string) drops back to manual status - handled below.
        tracking_code: z.string().optional(),
      })
      .parse(req.body);

    const items = await dbStore.getPocEquipmentItems(req.params.id);
    if (!items.some((i) => i.id === req.params.itemId)) {
      return res.status(404).json({ success: false, message: "Equipment item not found for this POC." });
    }

    // Changing (or clearing) the tracking code invalidates any cached carrier status from the
    // previous code - stale text from a different shipment must never linger in the UI.
    const updates: any = { ...validated };
    if (validated.tracking_code !== undefined) {
      updates.tracking_code = validated.tracking_code.trim() || null;
      updates.tracking_carrier_status = null;
      updates.tracking_last_checked_at = null;
    }

    const updated = await dbStore.updatePocEquipmentItem(req.params.itemId, updates);
    res.json(updated);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.issues[0].message });
    }
    next(err);
  }
});

router.delete("/:id/equipment/:itemId", requirePermission("poc:manage"), requireModule("poc"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const items = await dbStore.getPocEquipmentItems(req.params.id);
    if (!items.some((i) => i.id === req.params.itemId)) {
      return res.status(404).json({ success: false, message: "Equipment item not found for this POC." });
    }

    // Remove any attached invoice files from physical storage first (same order as
    // documents.ts's delete route) so deleting the record never orphans a file behind.
    const settings = await dbStore.getSettings();
    for (const which of ["shipping", "return"] as const) {
      const file = await dbStore.getPocEquipmentInvoiceFile(req.params.itemId, which);
      if (file) {
        const storageAdapter = createStorageAdapter({ ...settings, storage_mode: file.storage_provider });
        await storageAdapter.deleteFile(file.storage_path);
      }
    }

    await dbStore.deletePocEquipmentItem(req.params.itemId);
    res.json({ success: true, message: "Equipment item deleted successfully" });
  } catch (err) {
    next(err);
  }
});

// Invoice upload (NF de envio/devolução) - multer's memory storage means the AsyncLocalStorage
// tenant context set by requireAuth doesn't reliably reach this handler (same footgun documented
// in documents.ts), so it's rebuilt from the x-tenant-id header requireAuth already stashed.
function uploadInvoiceHandler(which: "shipping" | "return") {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({ success: false, message: "No file was uploaded." });
      }

      const validation = validateUploadedFile(file.originalname, file.mimetype, file.size);
      if (!validation.valid) {
        return res.status(400).json({ success: false, message: validation.error });
      }

      const tenantId = req.headers["x-tenant-id"] as string;

      const result = await runWithTenant({ tenantId }, async () => {
        const items = await dbStore.getPocEquipmentItems(req.params.id);
        if (!items.some((i) => i.id === req.params.itemId)) {
          return null;
        }

        const settings = await dbStore.getSettings();
        const storageAdapter = createStorageAdapter(settings);

        // Re-attaching (replacing an already-uploaded invoice) must not orphan the previous
        // file on disk/S3/GCS - delete it first, same cleanup discipline as the item-delete route.
        const previous = await dbStore.getPocEquipmentInvoiceFile(req.params.itemId, which);
        if (previous) {
          const previousAdapter = createStorageAdapter({ ...settings, storage_mode: previous.storage_provider });
          await previousAdapter.deleteFile(previous.storage_path);
        }

        const storagePath = await storageAdapter.uploadFile(req.params.id, file.buffer, file.originalname, file.mimetype);

        return dbStore.attachPocEquipmentInvoice(req.params.itemId, which, {
          storage_provider: settings.storage_mode,
          storage_path: storagePath,
          original_filename: file.originalname,
        });
      });

      if (!result) {
        return res.status(404).json({ success: false, message: "Equipment item not found for this POC." });
      }

      res.json(result);
    } catch (err) {
      next(err);
    }
  };
}

router.post(
  "/:id/equipment/:itemId/shipping-invoice",
  requirePermission("poc:manage"),
  requireModule("poc"),
  upload.single("file"),
  uploadInvoiceHandler("shipping")
);

router.post(
  "/:id/equipment/:itemId/return-invoice",
  requirePermission("poc:manage"),
  requireModule("poc"),
  upload.single("file"),
  uploadInvoiceHandler("return")
);

function downloadInvoiceHandler(which: "shipping" | "return") {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const file = await dbStore.getPocEquipmentInvoiceFile(req.params.itemId, which);
      if (!file) {
        return res.status(404).json({ success: false, message: "No invoice attached yet." });
      }

      const settings = await dbStore.getSettings();
      const adapter = createStorageAdapter({ ...settings, storage_mode: file.storage_provider });

      let buffer: Buffer;
      try {
        buffer = await adapter.readFile(file.storage_path);
      } catch {
        return res.status(404).json({ success: false, message: "Physical invoice file not found." });
      }

      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="${file.original_filename}"`);
      res.send(buffer);
    } catch (err) {
      next(err);
    }
  };
}

router.get("/:id/equipment/:itemId/shipping-invoice", requirePermission("poc:read"), requireModule("poc"), downloadInvoiceHandler("shipping"));
router.get("/:id/equipment/:itemId/return-invoice", requirePermission("poc:read"), requireModule("poc"), downloadInvoiceHandler("return"));

// Fase G: datasheet upload. Unlike the NF (a private per-item fiscal document), a datasheet is
// reusable knowledge - it's stored via the exact same pipeline as a normal Knowledge Base upload
// (createStorageAdapter + dbStore.createKnowledgeBaseDocument), only additionally linked back onto
// the equipment item so the UI can show "datasheet enviado", and immediately queued into the same
// AI analysis background task the Base de Conhecimento screen uses - the extracted entries land as
// "pending" like any other upload, subject to the same admin approval gate, not auto-approved just
// because they came in through the POC screen.
router.post(
  "/:id/equipment/:itemId/datasheet",
  requirePermission("poc:manage"),
  requireModule("poc"),
  upload.single("file"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({ success: false, message: "No file was uploaded." });
      }

      const validation = validateUploadedFile(file.originalname, file.mimetype, file.size);
      if (!validation.valid) {
        return res.status(400).json({ success: false, message: validation.error });
      }

      const tenantId = req.headers["x-tenant-id"] as string;
      const userId = requireUserId(req);

      const updated = await runWithTenant({ tenantId }, async () => {
        const items = await dbStore.getPocEquipmentItems(req.params.id);
        if (!items.some((i) => i.id === req.params.itemId)) {
          return null;
        }

        const settings = await dbStore.getSettings();
        const storageAdapter = createStorageAdapter(settings);
        const storagePath = await storageAdapter.uploadFile("knowledge-base", file.buffer, file.originalname, file.mimetype);

        const doc = await dbStore.createKnowledgeBaseDocument({
          filename: file.originalname,
          original_filename: file.originalname,
          mime_type: file.mimetype,
          file_size: file.size,
          storage_provider: settings.storage_mode,
          storage_path: storagePath,
          uploaded_by: userId,
        });

        return dbStore.updatePocEquipmentItem(req.params.itemId, { datasheet_knowledge_base_document_id: doc.id });
      });

      if (!updated) {
        return res.status(404).json({ success: false, message: "Equipment item not found for this POC." });
      }

      // Best-effort: a datasheet that fails to queue for analysis (e.g. cost cap reached) still
      // got uploaded and linked above - the admin can always retry from the Base de Conhecimento
      // screen's own "Analisar documentos" action, so this isn't surfaced as a failure of the
      // upload itself.
      try {
        await triggerKnowledgeBaseAnalysis(tenantId, userId, req.log);
      } catch (analysisErr) {
        req.log?.warn({ err: analysisErr }, "Failed to auto-queue datasheet for Knowledge Base analysis");
      }

      res.json(updated);
    } catch (err) {
      next(err);
    }
  }
);

const TRACKING_REFRESH_MIN_INTERVAL_MS = 10 * 60 * 1000;

// Fase I: real carrier tracking status (Site Rastreio), only when a tracking code is set - no
// tracking code configured falls back to today's behavior (NF as the reference), never breaking
// tenants who don't use the integration. Rate-limited per item (not just relying on the frontend
// not spamming the button) since the free tier is a hard monthly quota shared across the tenant.
router.post("/:id/equipment/:itemId/refresh-tracking", requirePermission("poc:manage"), requireModule("poc"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const items = await dbStore.getPocEquipmentItems(req.params.id);
    const item = items.find((i) => i.id === req.params.itemId);
    if (!item) {
      return res.status(404).json({ success: false, message: "Equipment item not found for this POC." });
    }
    if (!item.tracking_code) {
      return res.status(400).json({ success: false, message: "Este item não tem código de rastreio configurado." });
    }

    if (item.tracking_last_checked_at) {
      const elapsed = Date.now() - new Date(item.tracking_last_checked_at).getTime();
      if (elapsed < TRACKING_REFRESH_MIN_INTERVAL_MS) {
        const waitMin = Math.ceil((TRACKING_REFRESH_MIN_INTERVAL_MS - elapsed) / 60000);
        return res.status(429).json({ success: false, message: `Aguarde cerca de ${waitMin} minuto(s) antes de consultar novamente o rastreio deste item.` });
      }
    }

    const apiKey = await getSiteRastreioApiKey();
    if (!apiKey) {
      return res.status(400).json({ success: false, message: "Nenhuma chave de API do Site Rastreio configurada em Configurações > Integrações e API." });
    }

    let result;
    try {
      result = await queryTrackingStatus(apiKey, item.tracking_code);
    } catch (trackingErr: any) {
      return res.status(502).json({ success: false, message: trackingErr.message || "Não foi possível consultar o Site Rastreio." });
    }

    const updated = await dbStore.updatePocEquipmentItem(req.params.itemId, {
      tracking_carrier_status: result.found ? result.carrierStatusText : "Código não encontrado na transportadora",
      tracking_last_checked_at: new Date().toISOString(),
    });

    res.json(updated);
  } catch (err: any) {
    next(err);
  }
});

// Cronograma (Fase D) - tasks with a single-predecessor finish-to-start dependency chain. Dates
// stay simple ISO day strings (like everywhere else in this file); the Gantt itself does all the
// day-grid/critical-path math on the frontend.
const PocTaskSchema = z.object({
  name: z.string().min(2, "Name is required"),
  start_date: z.string().min(5, "Start date is required"),
  duration_days: z.number().int().min(1, "Duration must be at least 1 day"),
  depends_on_task_id: z.string().optional(),
});

router.get("/:id/tasks", requirePermission("poc:read"), requireModule("poc"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const poc = await dbStore.getPoc(req.params.id);
    if (!poc) {
      return res.status(404).json({ success: false, message: "POC not found" });
    }
    const tasks = await dbStore.getPocTasks(req.params.id);
    res.json(tasks);
  } catch (err) {
    next(err);
  }
});

router.post("/:id/tasks", requirePermission("poc:manage"), requireModule("poc"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = PocTaskSchema.parse(req.body);

    const poc = await dbStore.getPoc(req.params.id);
    if (!poc) {
      return res.status(404).json({ success: false, message: "POC not found" });
    }

    if (validated.depends_on_task_id) {
      const existingTasks = await dbStore.getPocTasks(req.params.id);
      if (!existingTasks.some((t) => t.id === validated.depends_on_task_id)) {
        return res.status(400).json({ success: false, message: "depends_on_task_id must belong to the same POC." });
      }
    }

    const task = await dbStore.createPocTask(req.params.id, validated);
    res.status(201).json(task);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.issues[0].message });
    }
    next(err);
  }
});

router.put("/:id/tasks/:taskId", requirePermission("poc:manage"), requireModule("poc"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = z
      .object({
        name: z.string().min(2).optional(),
        start_date: z.string().min(5).optional(),
        duration_days: z.number().int().min(1).optional(),
        status: z.enum(["planned", "in_progress", "done"]).optional(),
        depends_on_task_id: z.string().nullable().optional(),
      })
      .parse(req.body);

    const existingTasks = await dbStore.getPocTasks(req.params.id);
    if (!existingTasks.some((t) => t.id === req.params.taskId)) {
      return res.status(404).json({ success: false, message: "Task not found for this POC." });
    }

    if (validated.depends_on_task_id) {
      if (validated.depends_on_task_id === req.params.taskId) {
        return res.status(400).json({ success: false, message: "A task cannot depend on itself." });
      }
      if (!existingTasks.some((t) => t.id === validated.depends_on_task_id)) {
        return res.status(400).json({ success: false, message: "depends_on_task_id must belong to the same POC." });
      }
    }

    // Same rule as test cases: editing actual content (not just a status/reorder update) means a
    // human has taken ownership of this task - a future "Sugerir cronograma com IA" must never
    // silently overwrite it again.
    const contentChanged = validated.name !== undefined || validated.start_date !== undefined || validated.duration_days !== undefined || validated.depends_on_task_id !== undefined;

    const updated = await dbStore.updatePocTask(req.params.taskId, {
      ...validated,
      edited_manually: contentChanged ? true : undefined,
    });
    res.json(updated);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.issues[0].message });
    }
    next(err);
  }
});

router.delete("/:id/tasks/:taskId", requirePermission("poc:manage"), requireModule("poc"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const existingTasks = await dbStore.getPocTasks(req.params.id);
    if (!existingTasks.some((t) => t.id === req.params.taskId)) {
      return res.status(404).json({ success: false, message: "Task not found for this POC." });
    }

    await dbStore.deletePocTask(req.params.taskId);
    res.json({ success: true, message: "Task deleted successfully" });
  } catch (err) {
    next(err);
  }
});

// Fase 6 follow-up (bug report, 2026-07-14): generateJsonWithProvider failures (wrong/expired key,
// cost cap on the provider's own side, service outage) were bubbling up as a bare 500 "unexpected
// system error" with no indication of what actually broke or what to do about it - confirmed
// directly (Gemini's prepayment credits ran out mid-testing). Every AI-generation route below
// wraps its call in this helper so the admin gets an actionable message pointing at the specific
// provider and where to fix it, instead of a dead end.
function friendlyAiErrorMessage(err: any, provider: string): string {
  const raw = String(err?.message || err || "");
  const hint = raw.length < 300 ? ` (${raw})` : "";
  return `Não foi possível gerar o conteúdo com o provedor de IA configurado (${provider})${hint}. Verifique a chave/créditos do provedor ou troque-o em Configurações > IA, Prompts e Custos.`;
}

function addDaysToIsoDay(isoDay: string, days: number): string {
  const d = new Date(isoDay);
  d.setDate(d.getDate() + days);
  return d.toISOString().substring(0, 10);
}

// Fase H: cronograma sugerido pela IA, mesma ancoragem na Base de Conhecimento usada em
// test-cases/generate (ver getPocKnowledgeBaseContext) - sem isso, a IA tenderia a inventar etapas
// específicas de um recurso do fabricante sem saber se ele realmente existe/funciona como descrito.
router.post("/:id/tasks/generate", requirePermission("poc:manage"), requireModule("poc"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.headers["x-tenant-id"] as string;

    const poc = await dbStore.getPoc(req.params.id);
    if (!poc) {
      return res.status(404).json({ success: false, message: "POC not found" });
    }

    const settings = await dbStore.getSettings();

    const costCap = await checkCostCap(tenantId, settings.monthly_cost_cap_usd ?? null);
    if (costCap.blocked) {
      return res.status(402).json({
        success: false,
        message: `Monthly AI cost cap reached ($${costCap.currentSpendUsd.toFixed(2)} of $${costCap.capUsd?.toFixed(2)}). Generation blocked until next month or the cap is raised in Admin > IA, Prompts e Custos.`
      });
    }

    const kbContext = await getPocKnowledgeBaseContext(req.params.id);

    const promptRow = await prisma.promptTemplate.findFirst({ where: { type: "poc_schedule_generation", isActive: true } });
    const instructions = promptRow?.content?.trim() || FACTORY_DEFAULT_POC_SCHEDULE_GENERATION_PROMPT;

    const prompt = `${instructions} Sugira de 3 a 8 etapas para o cronograma desta POC.

OBJETIVO DA POC:
${poc.objective}

PERÍODO PLANEJADO DA POC: ${poc.start_date} a ${poc.end_date}

${knowledgeBaseGroundingBlock(kbContext)}

Cada etapa pode depender da conclusão de outra etapa (ela só começa depois que a etapa da qual
depende termina) ou não depender de nenhuma - etapas sem dependência começam em paralelo, junto com
o início da POC. Não force uma cadeia sequencial única quando o trabalho real permite passos em
paralelo (ex: preparar o ambiente do cliente e configurar o equipamento internamente podem
acontecer ao mesmo tempo, antes de uma etapa de integração que depende das duas).

Responda em português do Brasil. Responda APENAS com um objeto JSON, sem markdown, sem texto
extra, no formato:
{
  "knowledge_base_warning": "aviso em português caso a Base de Conhecimento não cubra este equipamento, ou null caso contrário",
  "tasks": [
    { "name": "nome curto da etapa", "duration_days": 3, "depends_on_index": null },
    { "name": "outra etapa que só começa depois da primeira", "duration_days": 2, "depends_on_index": 0 }
  ]
}
"depends_on_index" é o índice (a partir de 0) de outra etapa nesta MESMA lista, ou null se a etapa
não depende de nenhuma outra.`;

    const resolution = await resolveProvider("poc_schedule_generation", settings as any);
    if (resolution.isFallback) {
      await recordProviderFallback({ tenantId, taskType: "poc_schedule_generation", intendedProvider: resolution.intendedProvider, userId: requireUserId(req) });
    }

    let text: string, inputTokens: number, outputTokens: number;
    try {
      ({ text, inputTokens, outputTokens } = await generateJsonWithProvider(resolution.provider, resolution.model, prompt));
    } catch (aiErr: any) {
      return res.status(502).json({ success: false, message: friendlyAiErrorMessage(aiErr, resolution.provider) });
    }

    await recordAiUsage({
      tenantId,
      taskType: "poc_schedule_generation",
      provider: resolution.provider,
      model: resolution.model,
      estimatedCostUsd: estimateCostUsd(resolution.model, inputTokens, outputTokens),
    });

    let parsed: any[];
    let knowledgeBaseWarning: string | null = null;
    try {
      const parsedObj = JSON.parse(text.trim());
      parsed = parsedObj?.tasks;
      if (!Array.isArray(parsed)) throw new Error("not an array");
      if (typeof parsedObj?.knowledge_base_warning === "string") {
        knowledgeBaseWarning = parsedObj.knowledge_base_warning;
      }
    } catch {
      return res.status(502).json({ success: false, message: "A IA retornou uma resposta em formato inesperado. Tente novamente." });
    }

    // Same regeneration safety as test cases: only drafts nobody has touched yet get replaced.
    await dbStore.deleteUneditedAiPocTasks(req.params.id);

    // Validate each item's own fields first and keep original array indices, since
    // depends_on_index refers to positions in the AI's own list, not the filtered/created list.
    const validItems = parsed
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item?.name && Number.isFinite(Number(item.duration_days)) && Number(item.duration_days) >= 1);
    const validIndices = new Set(validItems.map(({ index }) => index));

    // Start dates come from walking the dependency graph (topological order via memoized
    // computeStart), not a blind sequential chain - a task with no dependency (or one pointing at
    // an invalid/filtered-out index) starts at the POC's own start date, same as any other
    // independent/parallel task.
    const startDateByIndex = new Map<number, string>();
    const computeStart = (index: number, seen: Set<number>): string => {
      if (startDateByIndex.has(index)) return startDateByIndex.get(index)!;
      if (seen.has(index)) return poc.start_date; // cycle guard
      seen.add(index);

      const entry = validItems.find(({ index: i }) => i === index);
      const depIndex = entry ? Number(entry.item.depends_on_index) : NaN;
      let start = poc.start_date;
      if (Number.isFinite(depIndex) && validIndices.has(depIndex) && depIndex !== index) {
        const depEntry = validItems.find(({ index: i }) => i === depIndex)!;
        const depStart = computeStart(depIndex, seen);
        start = addDaysToIsoDay(depStart, Number(depEntry.item.duration_days));
      }
      startDateByIndex.set(index, start);
      return start;
    };

    // Two passes because depends_on_index can point at a LATER item in the AI's own list (nothing
    // requires the AI to list a dependency before its dependent) - creating in listed order first
    // and wiring dependsOnTaskId in a second pass, once every task's real id is known, avoids
    // silently dropping a forward-referenced dependency.
    const taskIdByIndex = new Map<number, string>();
    const created = [];
    for (const { item, index } of validItems) {
      const task = await dbStore.createPocTask(req.params.id, {
        name: String(item.name),
        start_date: computeStart(index, new Set()),
        duration_days: Number(item.duration_days),
        generated_by_ai: true,
      });
      created.push(task);
      taskIdByIndex.set(index, task.id);
    }

    for (const { item, index } of validItems) {
      const depIndex = Number(item.depends_on_index);
      if (!Number.isFinite(depIndex) || !validIndices.has(depIndex) || depIndex === index) continue;
      const dependsOnTaskId = taskIdByIndex.get(depIndex);
      if (dependsOnTaskId) {
        await dbStore.updatePocTask(taskIdByIndex.get(index)!, { depends_on_task_id: dependsOnTaskId });
      }
    }

    res.json({
      tasks: await dbStore.getPocTasks(req.params.id),
      knowledge_base_warning: knowledgeBaseWarning,
    });
  } catch (err) {
    next(err);
  }
});

// Cadernos de Teste (Fase E) - test cases generated from the POC's objective/success criteria via
// the AI orchestrator, "IA rascunha, humano valida" (same pattern as Proposal Studio): regenerable
// and editable, editing a field marks edited_manually=true so a future regenerate never clobbers it.
function nextTestCaseCodes(existingCodes: string[], count: number): string[] {
  let max = 0;
  for (const code of existingCodes) {
    const match = /^TC-(\d+)$/.exec(code);
    if (match) max = Math.max(max, parseInt(match[1], 10));
  }
  return Array.from({ length: count }, (_, i) => `TC-${String(max + i + 1).padStart(2, "0")}`);
}

router.get("/:id/test-cases", requirePermission("poc:read"), requireModule("poc"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const poc = await dbStore.getPoc(req.params.id);
    if (!poc) {
      return res.status(404).json({ success: false, message: "POC not found" });
    }
    const cases = await dbStore.getPocTestCases(req.params.id);
    res.json(cases);
  } catch (err) {
    next(err);
  }
});

router.post("/:id/test-cases", requirePermission("poc:manage"), requireModule("poc"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = z
      .object({
        title: z.string().min(2, "Title is required"),
        objective: z.string().min(2, "Objective is required"),
        steps: z.string().min(2, "Steps are required"),
        expected_result: z.string().min(2, "Expected result is required"),
      })
      .parse(req.body);

    const poc = await dbStore.getPoc(req.params.id);
    if (!poc) {
      return res.status(404).json({ success: false, message: "POC not found" });
    }

    const existing = await dbStore.getPocTestCases(req.params.id);
    const [code] = nextTestCaseCodes(existing.map((c) => c.code), 1);

    const testCase = await dbStore.createPocTestCase(req.params.id, { ...validated, code, generated_by_ai: false });
    res.status(201).json(testCase);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.issues[0].message });
    }
    next(err);
  }
});

router.put("/:id/test-cases/:caseId", requirePermission("poc:manage"), requireModule("poc"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = z
      .object({
        title: z.string().min(2).optional(),
        objective: z.string().min(2).optional(),
        steps: z.string().min(2).optional(),
        expected_result: z.string().min(2).optional(),
        status: z.enum(["pending", "in_progress", "approved", "failed"]).optional(),
      })
      .parse(req.body);

    const existing = await dbStore.getPocTestCases(req.params.id);
    if (!existing.some((c) => c.id === req.params.caseId)) {
      return res.status(404).json({ success: false, message: "Test case not found for this POC." });
    }

    // Editing content (not just a status/test-run update) means a human has taken ownership of
    // this case - it should never be silently overwritten by a future "Regenerar com IA".
    const contentChanged = validated.title !== undefined || validated.objective !== undefined || validated.steps !== undefined || validated.expected_result !== undefined;

    const updated = await dbStore.updatePocTestCase(req.params.caseId, {
      ...validated,
      edited_manually: contentChanged ? true : undefined,
    });
    res.json(updated);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.issues[0].message });
    }
    next(err);
  }
});

router.delete("/:id/test-cases/:caseId", requirePermission("poc:manage"), requireModule("poc"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const existing = await dbStore.getPocTestCases(req.params.id);
    if (!existing.some((c) => c.id === req.params.caseId)) {
      return res.status(404).json({ success: false, message: "Test case not found for this POC." });
    }

    await dbStore.deletePocTestCase(req.params.caseId);
    res.json({ success: true, message: "Test case deleted successfully" });
  } catch (err) {
    next(err);
  }
});

router.post("/:id/test-cases/generate", requirePermission("poc:manage"), requireModule("poc"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.headers["x-tenant-id"] as string;

    const poc = await dbStore.getPoc(req.params.id);
    if (!poc) {
      return res.status(404).json({ success: false, message: "POC not found" });
    }

    const settings = await dbStore.getSettings();

    const costCap = await checkCostCap(tenantId, settings.monthly_cost_cap_usd ?? null);
    if (costCap.blocked) {
      return res.status(402).json({
        success: false,
        message: `Monthly AI cost cap reached ($${costCap.currentSpendUsd.toFixed(2)} of $${costCap.capUsd?.toFixed(2)}). Generation blocked until next month or the cap is raised in Admin > IA, Prompts e Custos.`
      });
    }

    const successCriteria = await dbStore.getPocSuccessCriteria(req.params.id);
    const criteriaList = successCriteria.length
      ? successCriteria.map((c) => `- ${c.description}`).join("\n")
      : "(nenhum critério de sucesso definido ainda)";

    // Fase H: grounding fix for the reported hallucination bug - see getPocKnowledgeBaseContext.
    const kbContext = await getPocKnowledgeBaseContext(req.params.id);

    // Only the persona/instruction framing is admin-editable (Admin > IA, Prompts e Custos) -
    // same rule as classification/analysis: the JSON response schema below stays fixed in code
    // so an admin can tune tone/emphasis without being able to break parsing.
    const promptRow = await prisma.promptTemplate.findFirst({ where: { type: "poc_test_generation", isActive: true } });
    const instructions = promptRow?.content?.trim() || FACTORY_DEFAULT_POC_TEST_GENERATION_PROMPT;

    const prompt = `${instructions} Gere de 3 a 6 casos de teste.

OBJETIVO DA POC:
${poc.objective}

CRITÉRIOS DE SUCESSO:
${criteriaList}

${knowledgeBaseGroundingBlock(kbContext)}

Responda em português do Brasil. Responda APENAS com um objeto JSON (não um array na raiz - alguns
provedores exigem um objeto no nível superior), sem markdown, sem texto extra, no formato:
{
  "knowledge_base_warning": "aviso em português caso a Base de Conhecimento não cubra este equipamento, ou null caso contrário",
  "test_cases": [
    { "title": "título curto do caso de teste", "objective": "o que este teste valida", "steps": "passo a passo, uma linha por passo", "expected_result": "resultado esperado, mensurável quando possível" }
  ]
}`;

    const resolution = await resolveProvider("poc_test_generation", settings as any);
    if (resolution.isFallback) {
      await recordProviderFallback({ tenantId, taskType: "poc_test_generation", intendedProvider: resolution.intendedProvider, userId: requireUserId(req) });
    }

    let text: string, inputTokens: number, outputTokens: number;
    try {
      ({ text, inputTokens, outputTokens } = await generateJsonWithProvider(resolution.provider, resolution.model, prompt));
    } catch (aiErr: any) {
      return res.status(502).json({ success: false, message: friendlyAiErrorMessage(aiErr, resolution.provider) });
    }

    await recordAiUsage({
      tenantId,
      taskType: "poc_test_generation",
      provider: resolution.provider,
      model: resolution.model,
      estimatedCostUsd: estimateCostUsd(resolution.model, inputTokens, outputTokens),
    });

    let parsed: any[];
    let knowledgeBaseWarning: string | null = null;
    try {
      const parsedObj = JSON.parse(text.trim());
      parsed = Array.isArray(parsedObj) ? parsedObj : parsedObj?.test_cases;
      if (!Array.isArray(parsed)) throw new Error("not an array");
      if (!Array.isArray(parsedObj) && typeof parsedObj?.knowledge_base_warning === "string") {
        knowledgeBaseWarning = parsedObj.knowledge_base_warning;
      }
    } catch {
      return res.status(502).json({ success: false, message: "A IA retornou uma resposta em formato inesperado. Tente novamente." });
    }

    // Regenerating only replaces drafts nobody has touched yet - anything a human wrote from
    // scratch or edited survives.
    await dbStore.deleteUneditedAiPocTestCases(req.params.id);

    const remaining = await dbStore.getPocTestCases(req.params.id);
    const codes = nextTestCaseCodes(remaining.map((c) => c.code), parsed.length);

    const created = [];
    for (let i = 0; i < parsed.length; i++) {
      const item = parsed[i];
      if (!item?.title || !item?.objective || !item?.steps || !item?.expected_result) continue;
      created.push(
        await dbStore.createPocTestCase(req.params.id, {
          code: codes[i],
          title: String(item.title),
          objective: String(item.objective),
          steps: String(item.steps),
          expected_result: String(item.expected_result),
          generated_by_ai: true,
        })
      );
    }

    res.json({
      test_cases: await dbStore.getPocTestCases(req.params.id),
      knowledge_base_warning: knowledgeBaseWarning,
    });
  } catch (err) {
    next(err);
  }
});

// Relatório Final da POC (Fase M) - AI-generated questionnaire the presales engineer answers with
// the real observed outcome, mandatory before the acceptance can be finalized (see
// POST /:id/acceptance/finalize below). Same "IA rascunha, humano valida" regeneration safety as
// test cases/tasks (dbStore.deleteUneditedAiPocFinalReportQuestions), same KB grounding
// (getPocKnowledgeBaseContext) that fixed the test-case hallucination bug, plus the POC's own test
// cases as extra context since they document what was actually validated.
router.get("/:id/final-report", requirePermission("poc:read"), requireModule("poc"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const poc = await dbStore.getPoc(req.params.id);
    if (!poc) {
      return res.status(404).json({ success: false, message: "POC not found" });
    }
    const questions = await dbStore.getPocFinalReportQuestions(req.params.id);
    res.json(questions);
  } catch (err) {
    next(err);
  }
});

router.put("/:id/final-report/:questionId", requirePermission("poc:manage"), requireModule("poc"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { answer } = z.object({ answer: z.string() }).parse(req.body);

    const questions = await dbStore.getPocFinalReportQuestions(req.params.id);
    if (!questions.some((q) => q.id === req.params.questionId)) {
      return res.status(404).json({ success: false, message: "Question not found for this POC." });
    }

    const updated = await dbStore.updatePocFinalReportQuestion(req.params.questionId, { answer, edited_manually: true });
    res.json(updated);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.issues[0].message });
    }
    next(err);
  }
});

router.post("/:id/final-report/generate", requirePermission("poc:manage"), requireModule("poc"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.headers["x-tenant-id"] as string;

    const poc = await dbStore.getPoc(req.params.id);
    if (!poc) {
      return res.status(404).json({ success: false, message: "POC not found" });
    }

    const settings = await dbStore.getSettings();

    const costCap = await checkCostCap(tenantId, settings.monthly_cost_cap_usd ?? null);
    if (costCap.blocked) {
      return res.status(402).json({
        success: false,
        message: `Monthly AI cost cap reached ($${costCap.currentSpendUsd.toFixed(2)} of $${costCap.capUsd?.toFixed(2)}). Generation blocked until next month or the cap is raised in Admin > IA, Prompts e Custos.`
      });
    }

    const successCriteria = await dbStore.getPocSuccessCriteria(req.params.id);
    const criteriaList = successCriteria.length
      ? successCriteria.map((c) => `- ${c.description}`).join("\n")
      : "(nenhum critério de sucesso definido ainda)";

    const testCases = await dbStore.getPocTestCases(req.params.id);
    const testCasesList = testCases.length
      ? testCases.map((tc) => `- [${tc.code}] ${tc.title}: ${tc.objective} (status: ${tc.status})`).join("\n")
      : "(nenhum caso de teste cadastrado ainda)";

    const kbContext = await getPocKnowledgeBaseContext(req.params.id);

    const promptRow = await prisma.promptTemplate.findFirst({ where: { type: "poc_final_report_generation", isActive: true } });
    const instructions = promptRow?.content?.trim() || FACTORY_DEFAULT_POC_FINAL_REPORT_GENERATION_PROMPT;

    const prompt = `${instructions} Elabore de 5 a 8 perguntas objetivas para o relatório final desta POC.

OBJETIVO DA POC:
${poc.objective}

CRITÉRIOS DE SUCESSO:
${criteriaList}

CASOS DE TESTE REGISTRADOS:
${testCasesList}

${knowledgeBaseGroundingBlock(kbContext)}

As perguntas devem cobrir se o objetivo foi atingido, se os critérios de sucesso foram cumpridos, e
pedir evidências concretas do que foi observado durante a execução - não perguntas genéricas que
sirvam para qualquer POC.

Responda em português do Brasil. Responda APENAS com um objeto JSON, sem markdown, sem texto
extra, no formato:
{
  "knowledge_base_warning": "aviso em português caso a Base de Conhecimento não cubra este equipamento, ou null caso contrário",
  "questions": [
    "pergunta objetiva 1",
    "pergunta objetiva 2"
  ]
}`;

    const resolution = await resolveProvider("poc_final_report_generation", settings as any);
    if (resolution.isFallback) {
      await recordProviderFallback({ tenantId, taskType: "poc_final_report_generation", intendedProvider: resolution.intendedProvider, userId: requireUserId(req) });
    }

    let text: string, inputTokens: number, outputTokens: number;
    try {
      ({ text, inputTokens, outputTokens } = await generateJsonWithProvider(resolution.provider, resolution.model, prompt));
    } catch (aiErr: any) {
      return res.status(502).json({ success: false, message: friendlyAiErrorMessage(aiErr, resolution.provider) });
    }

    await recordAiUsage({
      tenantId,
      taskType: "poc_final_report_generation",
      provider: resolution.provider,
      model: resolution.model,
      estimatedCostUsd: estimateCostUsd(resolution.model, inputTokens, outputTokens),
    });

    let parsed: any[];
    let knowledgeBaseWarning: string | null = null;
    try {
      const parsedObj = JSON.parse(text.trim());
      parsed = parsedObj?.questions;
      if (!Array.isArray(parsed)) throw new Error("not an array");
      if (typeof parsedObj?.knowledge_base_warning === "string") {
        knowledgeBaseWarning = parsedObj.knowledge_base_warning;
      }
    } catch {
      return res.status(502).json({ success: false, message: "A IA retornou uma resposta em formato inesperado. Tente novamente." });
    }

    // Same regeneration safety as test cases/tasks: only drafts nobody has answered/edited yet
    // get replaced.
    await dbStore.deleteUneditedAiPocFinalReportQuestions(req.params.id);

    const remaining = await dbStore.getPocFinalReportQuestions(req.params.id);
    let order = remaining.length;
    for (const q of parsed) {
      if (typeof q !== "string" || !q.trim()) continue;
      await dbStore.createPocFinalReportQuestion(req.params.id, { question: q.trim(), order: order++, generated_by_ai: true });
    }

    res.json({
      questions: await dbStore.getPocFinalReportQuestions(req.params.id),
      knowledge_base_warning: knowledgeBaseWarning,
    });
  } catch (err) {
    next(err);
  }
});

// Aceite do Cliente (Fase F) - final decision record. The signed document is a manual upload
// placeholder deliberately, not a real e-signature integration (product decision, 2026-07-13,
// left open for a future session) - reuses the same storage adapter as equipment invoices.
router.get("/:id/acceptance", requirePermission("poc:read"), requireModule("poc"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const poc = await dbStore.getPoc(req.params.id);
    if (!poc) {
      return res.status(404).json({ success: false, message: "POC not found" });
    }
    const acceptance = await dbStore.getPocAcceptance(req.params.id);
    res.json(acceptance || { poc_id: req.params.id, decision: "pending" });
  } catch (err) {
    next(err);
  }
});

router.put("/:id/acceptance", requirePermission("poc:manage"), requireModule("poc"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = z
      .object({
        decision: z.enum(["pending", "won", "lost"]).optional(),
        signed_by: z.string().optional(),
        signed_at: z.string().optional(),
        notes: z.string().optional(),
      })
      .parse(req.body);

    const poc = await dbStore.getPoc(req.params.id);
    if (!poc) {
      return res.status(404).json({ success: false, message: "POC not found" });
    }

    const acceptance = await dbStore.upsertPocAcceptance(req.params.id, validated);
    res.json(acceptance);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.issues[0].message });
    }
    next(err);
  }
});

// Fase L: "Finalizar" is a real gate, not just setting the decision - it requires the mandatory
// Relatório Final (Fase M) fully answered, and puts the POC into pending_approval rather than
// jumping straight to completed. Only a separate "Aprovar" (below) actually flips Poc.status.
router.post("/:id/acceptance/finalize", requirePermission("poc:manage"), requireModule("poc"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { decision } = z.object({ decision: z.enum(["won", "lost"]) }).parse(req.body);

    const poc = await dbStore.getPoc(req.params.id);
    if (!poc) {
      return res.status(404).json({ success: false, message: "POC not found" });
    }

    const questions = await dbStore.getPocFinalReportQuestions(req.params.id);
    if (questions.length === 0) {
      return res.status(400).json({ success: false, message: "Gere e responda o Relatório Final da POC antes de finalizar." });
    }
    const unanswered = questions.filter((q) => !q.answer || !q.answer.trim());
    if (unanswered.length > 0) {
      return res.status(400).json({ success: false, message: `Responda todas as perguntas do Relatório Final antes de finalizar (${unanswered.length} pendente(s)).` });
    }

    const acceptance = await dbStore.upsertPocAcceptance(req.params.id, { decision, pending_approval: true });
    res.json(acceptance);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.issues[0].message });
    }
    next(err);
  }
});

// Fase L: only "poc:manage" (same permission as the rest of the module - not a new granular
// approval permission, per the approved plan) can approve, and only while genuinely pending.
router.post("/:id/acceptance/approve", requirePermission("poc:manage"), requireModule("poc"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const poc = await dbStore.getPoc(req.params.id);
    if (!poc) {
      return res.status(404).json({ success: false, message: "POC not found" });
    }

    const acceptance = await dbStore.getPocAcceptance(req.params.id);
    if (!acceptance?.pending_approval) {
      return res.status(400).json({ success: false, message: "Esta POC não está aguardando aprovação." });
    }

    const userId = requireUserId(req);
    const approved = await dbStore.approvePocAcceptance(req.params.id, userId);

    await dbStore.addAuditLog({
      user_id: userId,
      action: "Approve Poc Acceptance",
      entity_type: "Poc",
      entity_id: req.params.id,
      ip_address: req.ip || "127.0.0.1",
      user_agent: req.headers["user-agent"] || "unknown",
      metadata: JSON.stringify({ decision: approved.decision }),
    });

    res.json(approved);
  } catch (err) {
    next(err);
  }
});

router.post(
  "/:id/acceptance/signed-document",
  requirePermission("poc:manage"),
  requireModule("poc"),
  upload.single("file"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({ success: false, message: "No file was uploaded." });
      }

      const validation = validateUploadedFile(file.originalname, file.mimetype, file.size);
      if (!validation.valid) {
        return res.status(400).json({ success: false, message: validation.error });
      }

      const tenantId = req.headers["x-tenant-id"] as string;

      const result = await runWithTenant({ tenantId }, async () => {
        const poc = await dbStore.getPoc(req.params.id);
        if (!poc) return null;

        const settings = await dbStore.getSettings();

        // Replacing an already-uploaded signed document must not orphan the previous file.
        const previous = await dbStore.getPocAcceptanceDocumentFile(req.params.id);
        if (previous) {
          const previousAdapter = createStorageAdapter({ ...settings, storage_mode: previous.storage_provider });
          await previousAdapter.deleteFile(previous.storage_path);
        }

        const storageAdapter = createStorageAdapter(settings);
        const storagePath = await storageAdapter.uploadFile(req.params.id, file.buffer, file.originalname, file.mimetype);

        return dbStore.attachPocAcceptanceDocument(req.params.id, {
          storage_provider: settings.storage_mode,
          storage_path: storagePath,
          original_filename: file.originalname,
        });
      });

      if (!result) {
        return res.status(404).json({ success: false, message: "POC not found" });
      }

      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

router.get("/:id/acceptance/signed-document", requirePermission("poc:read"), requireModule("poc"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const file = await dbStore.getPocAcceptanceDocumentFile(req.params.id);
    if (!file) {
      return res.status(404).json({ success: false, message: "No signed document attached yet." });
    }

    const settings = await dbStore.getSettings();
    const adapter = createStorageAdapter({ ...settings, storage_mode: file.storage_provider });

    let buffer: Buffer;
    try {
      buffer = await adapter.readFile(file.storage_path);
    } catch {
      return res.status(404).json({ success: false, message: "Physical document file not found." });
    }

    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${file.original_filename}"`);
    res.send(buffer);
  } catch (err) {
    next(err);
  }
});

// Fase J: ViaCEP (https://viacep.com.br) is a free, keyless, official Brazilian postal-code
// lookup - proxied server-side rather than called directly from the browser because the app's CSP
// pins connect-src to 'self' (server/middleware/security.ts), and loosening that for a single
// convenience lookup isn't worth it when a thin proxy route does the job just as well.
router.get("/cep/:cep", requirePermission("poc:read"), requireModule("poc"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cep = req.params.cep.replace(/\D/g, "");
    if (cep.length !== 8) {
      return res.status(400).json({ success: false, message: "CEP inválido." });
    }

    const viaCepRes = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
    if (!viaCepRes.ok) {
      return res.status(502).json({ success: false, message: "Não foi possível consultar o CEP." });
    }
    const data: any = await viaCepRes.json();
    if (data.erro) {
      return res.status(404).json({ success: false, message: "CEP não encontrado." });
    }

    res.json({
      street: data.logradouro || "",
      neighborhood: data.bairro || "",
      city: data.localidade || "",
      state: data.uf || "",
    });
  } catch (err) {
    next(err);
  }
});

export default router;
