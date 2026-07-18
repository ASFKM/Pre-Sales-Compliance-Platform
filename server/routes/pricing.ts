// Módulo de Precificação (add-on). Every route below runs behind requirePermission("pricing:read" |
// "pricing:manage") AND requireModule("pricing") - the module only exists for tenants whose Fleet
// Manager ModuleEntitlement includes "pricing" (see server/utils/fleetLicense.ts /
// getFleetLicenseStatus), independent of RBAC permissions. Same shape as server/routes/pocs.ts.
import express, { Response, NextFunction } from "express";
import type { Request } from "../types/express";
import multer from "multer";
import { z } from "zod";
import { requirePermission, requireModule } from "./auth";
import { prisma } from "../../src/prisma";
import { randomId } from "../../src/idGenerator";
import { dbStore } from "../../src/dbStore";
import { resolveProvider, checkCostCap, recordProviderFallback, recordAiUsage } from "../../src/aiOrchestrator";
import { generateJsonWithProvider, ConnectedProvider } from "../utils/aiProviders";
import { estimateCostUsd } from "../utils/aiPricing";
import { parseAiJson } from "./analysis";
import { requireUserId } from "../middleware/security";
import { generatePricingTemplate, extractPricingRows } from "../utils/pricingImport";
import { computeLinePricing } from "../utils/pricingMath";
import { optimizeForBudget } from "../utils/pricingBudgetOptimizer";
import { calculateTax } from "../utils/taxCalculation";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.get("/health", requirePermission("pricing:read"), requireModule("pricing"), (req: Request, res: Response) => {
  res.json({ success: true, module: "pricing", status: "ok" });
});

// Fase 7: motor fiscal opcional. Desligado por padrão - muitos tenants já calculam imposto no
// próprio ERP (decisão do usuário). Ligar exige também um TenantTaxProfile (UF de origem + regime
// tributário), senão o cálculo não tem o que usar como origem.
const TaxSettingsSchema = z.object({
  taxCalculationEnabled: z.boolean(),
  originUF: z.string().length(2).optional(),
  taxRegime: z.enum(["simples_nacional", "lucro_presumido", "lucro_real"]).optional(),
});

router.get("/settings", requirePermission("pricing:read"), requireModule("pricing"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.headers["x-tenant-id"] as string;
    const settings = await prisma.tenantPricingSettings.findUnique({ where: { tenantId } });
    const taxProfile = await prisma.tenantTaxProfile.findUnique({ where: { tenantId } });
    res.json({ success: true, taxCalculationEnabled: settings?.taxCalculationEnabled ?? false, taxProfile });
  } catch (err) {
    next(err);
  }
});

router.put("/settings", requirePermission("pricing:manage"), requireModule("pricing"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.headers["x-tenant-id"] as string;
    const body = TaxSettingsSchema.parse(req.body);

    if (body.taxCalculationEnabled && (!body.originUF || !body.taxRegime)) {
      return res.status(400).json({ success: false, message: "Pra ligar o motor fiscal, informe UF de origem e regime tributário." });
    }

    const existingSettings = await prisma.tenantPricingSettings.findUnique({ where: { tenantId } });
    const settings = existingSettings
      ? await prisma.tenantPricingSettings.update({ where: { id: existingSettings.id }, data: { taxCalculationEnabled: body.taxCalculationEnabled } })
      : await prisma.tenantPricingSettings.create({ data: { id: randomId("tps"), tenantId, taxCalculationEnabled: body.taxCalculationEnabled } });

    if (body.originUF && body.taxRegime) {
      const existingProfile = await prisma.tenantTaxProfile.findUnique({ where: { tenantId } });
      await (existingProfile
        ? prisma.tenantTaxProfile.update({ where: { id: existingProfile.id }, data: { originUF: body.originUF, taxRegime: body.taxRegime } })
        : prisma.tenantTaxProfile.create({ data: { id: randomId("ttp"), tenantId, originUF: body.originUF, taxRegime: body.taxRegime } }));
    }

    res.json({ success: true, taxCalculationEnabled: settings.taxCalculationEnabled });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.issues[0].message });
    }
    next(err);
  }
});

// Fase 2: cadastro de tabela de preços.

router.get("/catalog", requirePermission("pricing:read"), requireModule("pricing"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const items = await prisma.priceCatalogItem.findMany({ orderBy: { itemCode: "asc" } });
    res.json({ success: true, items });
  } catch (err) {
    next(err);
  }
});

router.get("/catalog/template", requirePermission("pricing:read"), requireModule("pricing"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const buffer = await generatePricingTemplate();
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="tabela-de-precos-modelo.xlsx"');
    res.send(buffer);
  } catch (err) {
    next(err);
  }
});

router.post(
  "/catalog/upload",
  requirePermission("pricing:manage"),
  requireModule("pricing"),
  upload.single("file"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.headers["x-tenant-id"] as string;
      const userId = req.headers["x-user-id"] as string;

      if (!req.file) {
        return res.status(400).json({ success: false, message: "Nenhum arquivo enviado." });
      }

      const { rows, errors } = await extractPricingRows(req.file.buffer);

      const priceListUpload = await prisma.priceListUpload.create({
        data: {
          id: randomId("plu"),
          tenantId,
          uploadedByUserId: userId,
          fileName: req.file.originalname,
          effectiveDate: new Date(),
          status: rows.length > 0 ? "processing" : "failed",
        },
      });

      let created = 0;
      let updated = 0;

      for (const row of rows) {
        const existing = await prisma.priceCatalogItem.findUnique({
          where: { tenantId_itemCode: { tenantId, itemCode: row.itemCode } },
        });

        const item = existing
          ? await prisma.priceCatalogItem.update({
              where: { id: existing.id },
              data: {
                category: row.category,
                pn: row.pn,
                erpCode: row.erpCode,
                description: row.description,
                currentListPrice: row.listPrice,
                markupMax: row.markupMax,
                markupMin: row.markupMin,
              },
            })
          : await prisma.priceCatalogItem.create({
              data: {
                id: randomId("pci"),
                tenantId,
                itemCode: row.itemCode,
                category: row.category,
                pn: row.pn,
                erpCode: row.erpCode,
                description: row.description,
                currentListPrice: row.listPrice,
                markupMax: row.markupMax,
                markupMin: row.markupMin,
              },
            });

        existing ? updated++ : created++;

        await prisma.priceHistoryEntry.create({
          data: {
            id: randomId("phe"),
            tenantId,
            priceListUploadId: priceListUpload.id,
            itemId: item.id,
            listPrice: row.listPrice,
            currency: item.currency,
            markupMax: row.markupMax,
            markupMin: row.markupMin,
            effectiveDate: priceListUpload.effectiveDate,
          },
        });

        // Fase 5 (ciclo de itens sem cadastro): resolve qualquer pendência em ItemAliasMapping
        // cujo PN bata com o item recém-cadastrado/atualizado - futuros imports de BOM com esse
        // PN casam automaticamente a partir daqui, sem precisar reprocessar o BOM original.
        await prisma.itemAliasMapping.updateMany({
          where: { tenantId, rawPN: row.pn, resolvedItemId: null },
          data: { resolvedItemId: item.id },
        });
      }

      await prisma.priceListUpload.update({
        where: { id: priceListUpload.id },
        data: { status: rows.length > 0 ? "completed" : "failed" },
      });

      res.json({
        success: true,
        uploadId: priceListUpload.id,
        created,
        updated,
        errors,
      });
    } catch (err) {
      next(err);
    }
  }
);

// Fase 3: gráfico de evolução de preço por item - uma série por PriceHistoryEntry, mais antigo
// primeiro (o frontend só precisa desenhar a linha na ordem recebida).
router.get("/catalog/:id/history", requirePermission("pricing:read"), requireModule("pricing"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const entries = await prisma.priceHistoryEntry.findMany({
      where: { itemId: req.params.id },
      orderBy: { effectiveDate: "asc" },
    });
    res.json({ success: true, entries });
  } catch (err) {
    next(err);
  }
});

// Fase 4: import de BOM para dentro de uma sessão de precificação do projeto, com matching
// automático contra o catálogo. AnalysisResult é único por projeto (@@unique([projectId]) no
// schema) - não existe "escolher qual versão do BOM importar", sempre é a única/mais recente.
router.post(
  "/projects/:projectId/pricing-sheets",
  requirePermission("pricing:manage"),
  requireModule("pricing"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.headers["x-tenant-id"] as string;
      const { projectId } = req.params;

      const analysisResult = await prisma.analysisResult.findUnique({ where: { projectId } });
      if (!analysisResult) {
        return res.status(404).json({ success: false, message: "Este projeto ainda não tem uma análise com BOM." });
      }

      const bomItems = (Array.isArray(analysisResult.bom) ? analysisResult.bom : []) as Array<{
        item_id: string;
        part_number?: string;
        equipment_name?: string;
        quantity?: number;
      }>;

      // Fase 7: UF de destino é opcional no body - só importa pro cálculo de ICMS interestadual
      // quando o motor fiscal estiver ligado (senão fica só guardado, sem efeito).
      const destinationUF = typeof req.body?.destinationUF === "string" && req.body.destinationUF.length === 2 ? req.body.destinationUF : null;

      const sheet = await prisma.projectPricingSheet.create({
        data: {
          id: randomId("pps"),
          tenantId,
          projectId,
          sourceAnalysisResultId: analysisResult.id,
          status: "draft",
          destinationUF,
        },
      });

      const taxSettings = await prisma.tenantPricingSettings.findUnique({ where: { tenantId } });
      const taxProfile = taxSettings?.taxCalculationEnabled ? await prisma.tenantTaxProfile.findUnique({ where: { tenantId } }) : null;

      let matched = 0;
      let unmatched = 0;

      for (const bomItem of bomItems) {
        const pn = (bomItem.part_number || "").trim();
        let matchedItem: Awaited<ReturnType<typeof prisma.priceCatalogItem.findFirst>> = null;

        if (pn) {
          matchedItem = await prisma.priceCatalogItem.findFirst({
            where: { tenantId, pn: { equals: pn, mode: "insensitive" } },
          });

          if (!matchedItem) {
            const alias = await prisma.itemAliasMapping.findUnique({
              where: { tenantId_rawPN: { tenantId, rawPN: pn } },
            });
            if (alias?.resolvedItemId) {
              matchedItem = await prisma.priceCatalogItem.findUnique({ where: { id: alias.resolvedItemId } });
            }
          }
        }

        if (matchedItem) {
          matched++;
        } else if (pn) {
          unmatched++;
          const existingAlias = await prisma.itemAliasMapping.findUnique({
            where: { tenantId_rawPN: { tenantId, rawPN: pn } },
          });
          if (existingAlias) {
            await prisma.itemAliasMapping.update({
              where: { id: existingAlias.id },
              data: { timesSeen: { increment: 1 }, rawDescription: bomItem.equipment_name || existingAlias.rawDescription },
            });
          } else {
            await prisma.itemAliasMapping.create({
              data: { id: randomId("iam"), tenantId, rawPN: pn, rawDescription: bomItem.equipment_name || null },
            });
          }
        } else {
          unmatched++;
        }

        const listPriceSnapshot = matchedItem?.currentListPrice ?? null;
        const pricing = matchedItem
          ? computeLinePricing({ listPrice: matchedItem.currentListPrice, markupMin: matchedItem.markupMin, markupMax: matchedItem.markupMax, discountPercent: 0 })
          : null;

        const lineData: Record<string, unknown> = {
          id: randomId("ppl"),
          tenantId,
          pricingSheetId: sheet.id,
          bomItemId: bomItem.item_id,
          rawPartNumber: pn || null,
          rawDescription: bomItem.equipment_name || null,
          matchedItemId: matchedItem?.id ?? null,
          matchStatus: matchedItem ? "matched" : "unmatched",
          quantity: bomItem.quantity ?? 1,
          listPriceSnapshot,
          discountPercent: 0,
          finalUnitPrice: pricing?.finalUnitPrice ?? null,
          marginPercent: pricing?.marginPercent ?? null,
        };

        if (matchedItem && pricing && taxProfile) {
          const tax = await calculateTax({
            originUF: taxProfile.originUF,
            destinationUF: sheet.destinationUF,
            taxRegime: taxProfile.taxRegime,
            itemType: matchedItem.itemType,
            ipiRatePercent: matchedItem.ipiRatePercent,
            issRatePercent: matchedItem.issRatePercent,
            stApplicable: matchedItem.stApplicable,
          });
          lineData.icmsRatePercent = tax.icmsRatePercent;
          lineData.ipiRatePercent = tax.ipiRatePercent;
          lineData.pisCofinsRatePercent = tax.pisCofinsRatePercent;
          lineData.issRatePercent = tax.issRatePercent;
          lineData.stFlag = tax.stFlag;
          lineData.totalTaxPercent = tax.totalTaxPercent;
          lineData.finalPriceWithTax = pricing.finalUnitPrice * (1 + tax.totalTaxPercent / 100);
        }

        await prisma.projectPricingLine.create({ data: lineData as any });
      }

      res.json({ success: true, sheetId: sheet.id, matched, unmatched, total: bomItems.length });
    } catch (err) {
      next(err);
    }
  }
);

router.get("/pricing-sheets/:id", requirePermission("pricing:read"), requireModule("pricing"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sheet = await prisma.projectPricingSheet.findUnique({
      where: { id: req.params.id },
      include: { lines: { orderBy: { createdAt: "asc" } } },
    });
    if (!sheet) {
      return res.status(404).json({ success: false, message: "Sessão de precificação não encontrada." });
    }
    res.json({ success: true, sheet });
  } catch (err) {
    next(err);
  }
});

// Fase 4: desconto por linha. discountPercent é aplicado a partir do teto de markup (markupMax),
// não do preço de lista puro - ver server/utils/pricingMath.ts. Fora da faixa não bloqueia, só
// sinaliza (withinMarkupRange: false) - decisão do usuário na hora ("chegar no budget" da Fase 6
// também precisa poder sinalizar em vez de travar).
router.put(
  "/pricing-sheets/:sheetId/lines/:lineId",
  requirePermission("pricing:manage"),
  requireModule("pricing"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { discountPercent } = req.body;
      if (typeof discountPercent !== "number" || discountPercent < 0 || discountPercent > 100) {
        return res.status(400).json({ success: false, message: "discountPercent precisa ser um número entre 0 e 100." });
      }

      const line = await prisma.projectPricingLine.findUnique({ where: { id: req.params.lineId } });
      if (!line || line.pricingSheetId !== req.params.sheetId) {
        return res.status(404).json({ success: false, message: "Linha não encontrada." });
      }
      if (!line.matchedItemId || line.listPriceSnapshot == null) {
        return res.status(400).json({ success: false, message: "Linha sem item de catálogo associado - não é possível aplicar desconto." });
      }

      const matchedItem = await prisma.priceCatalogItem.findUnique({ where: { id: line.matchedItemId } });
      if (!matchedItem) {
        return res.status(400).json({ success: false, message: "Item de catálogo associado não existe mais." });
      }

      const pricing = computeLinePricing({
        listPrice: line.listPriceSnapshot,
        markupMin: matchedItem.markupMin,
        markupMax: matchedItem.markupMax,
        discountPercent,
      });

      const updateData: Record<string, unknown> = {
        discountPercent,
        finalUnitPrice: pricing.finalUnitPrice,
        marginPercent: pricing.marginPercent,
      };

      // Fase 7: motor fiscal opcional - só calcula quando o tenant ligou o toggle explicitamente.
      const tenantId = req.headers["x-tenant-id"] as string;
      const taxSettings = await prisma.tenantPricingSettings.findUnique({ where: { tenantId } });
      if (taxSettings?.taxCalculationEnabled) {
        const taxProfile = await prisma.tenantTaxProfile.findUnique({ where: { tenantId } });
        const sheet = await prisma.projectPricingSheet.findUnique({ where: { id: line.pricingSheetId } });
        if (taxProfile) {
          const tax = await calculateTax({
            originUF: taxProfile.originUF,
            destinationUF: sheet?.destinationUF ?? null,
            taxRegime: taxProfile.taxRegime,
            itemType: matchedItem.itemType,
            ipiRatePercent: matchedItem.ipiRatePercent,
            issRatePercent: matchedItem.issRatePercent,
            stApplicable: matchedItem.stApplicable,
          });
          updateData.icmsRatePercent = tax.icmsRatePercent;
          updateData.ipiRatePercent = tax.ipiRatePercent;
          updateData.pisCofinsRatePercent = tax.pisCofinsRatePercent;
          updateData.issRatePercent = tax.issRatePercent;
          updateData.stFlag = tax.stFlag;
          updateData.totalTaxPercent = tax.totalTaxPercent;
          updateData.finalPriceWithTax = pricing.finalUnitPrice * (1 + tax.totalTaxPercent / 100);
        }
      }

      const updated = await prisma.projectPricingLine.update({
        where: { id: line.id },
        data: updateData,
      });

      res.json({ success: true, line: updated, withinMarkupRange: pricing.withinMarkupRange });
    } catch (err) {
      next(err);
    }
  }
);

// Fase 5: ciclo de itens sem cadastro. Nenhum endpoint novo de import/reenvio - o upload da Fase 2
// já resolve ItemAliasMapping pendentes automaticamente ao cadastrar um item com o mesmo PN.

router.get("/pending-items", requirePermission("pricing:read"), requireModule("pricing"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const pending = await prisma.itemAliasMapping.findMany({
      where: { resolvedItemId: null },
      orderBy: { timesSeen: "desc" },
    });
    res.json({ success: true, pending });
  } catch (err) {
    next(err);
  }
});

router.get("/pending-items/export", requirePermission("pricing:read"), requireModule("pricing"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const pending = await prisma.itemAliasMapping.findMany({
      where: { resolvedItemId: null },
      orderBy: { timesSeen: "desc" },
    });

    const buffer = await generatePricingTemplate(
      pending.map((p) => ({ pn: p.rawPN, description: p.rawDescription || "" }))
    );

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="itens-sem-preco.xlsx"');
    res.send(buffer);
  } catch (err) {
    next(err);
  }
});

// Fase 6: "chegar no budget". A IA escolhe a ESTRATÉGIA de distribuição do desconto (e explica o
// porquê) - os valores finais em si são calculados por server/utils/pricingBudgetOptimizer.ts
// (determinístico), não pela IA, porque LLMs não são confiáveis pra aritmética exata sobre várias
// linhas ao mesmo tempo. Fica como sugestão (BudgetOptimizationRun) até o usuário aceitar via
// /apply - nada é gravado em ProjectPricingLine nesta rota.
const BudgetOptimizeSchema = z.object({
  targetBudget: z.number().positive(),
});

const StrategyChoiceSchema = z.object({
  strategy: z.enum(["equal_percent", "equal_amount"]),
  rationale: z.string(),
});

router.post(
  "/pricing-sheets/:id/budget-optimize",
  requirePermission("pricing:manage"),
  requireModule("pricing"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.headers["x-tenant-id"] as string;
      const userId = requireUserId(req);
      const { targetBudget } = BudgetOptimizeSchema.parse(req.body);

      const sheet = await prisma.projectPricingSheet.findUnique({
        where: { id: req.params.id },
        include: { lines: { where: { matchStatus: "matched" }, include: { matchedItem: true } } },
      });
      if (!sheet) {
        return res.status(404).json({ success: false, message: "Sessão de precificação não encontrada." });
      }
      if (sheet.lines.length === 0) {
        return res.status(400).json({ success: false, message: "Nenhuma linha casada com o catálogo nesta sessão - não há o que otimizar." });
      }

      const settings = await dbStore.getSettings();
      const costCap = await checkCostCap(tenantId, settings.monthly_cost_cap_usd ?? null);
      if (costCap.blocked) {
        return res.status(402).json({
          success: false,
          message: `Limite mensal de custo de IA atingido ($${costCap.currentSpendUsd.toFixed(2)} de $${costCap.capUsd?.toFixed(2)}).`,
        });
      }

      const optimizableLines = sheet.lines.map((l) => ({
        id: l.id,
        listPrice: l.listPriceSnapshot!,
        markupMin: l.matchedItem!.markupMin,
        markupMax: l.matchedItem!.markupMax,
        quantity: l.quantity,
      }));

      const maxAchievableTotal = optimizableLines.reduce((s, l) => s + l.listPrice * (1 + l.markupMax / 100) * l.quantity, 0);
      const minAchievableTotal = optimizableLines.reduce((s, l) => s + l.listPrice * (1 + l.markupMin / 100) * l.quantity, 0);

      const providerResolution = await resolveProvider("pricing_budget_optimization", settings as any);
      if (providerResolution.isFallback) {
        await recordProviderFallback({ tenantId, taskType: "pricing_budget_optimization", intendedProvider: providerResolution.intendedProvider, userId });
      }

      const prompt = `You are helping a systems-integrator sales engineer distribute a discount across a
BOM's priced line items to hit a target proposal budget, without violating any line's minimum
acceptable margin.

TARGET BUDGET: ${targetBudget}
ACHIEVABLE RANGE (no discount vs. maximum discount on every line): ${minAchievableTotal.toFixed(2)} to ${maxAchievableTotal.toFixed(2)}

LINE ITEMS (list price = acquisition cost; markup_min/markup_max = acceptable markup % band over
that cost; ceiling = price at 0% discount = markup_max; floor = price at maximum discount = markup_min):
${optimizableLines
  .map(
    (l, i) =>
      `${i + 1}. quantity=${l.quantity}, listPrice=${l.listPrice}, markupMin=${l.markupMin}%, markupMax=${l.markupMax}%`
  )
  .join("\n")}

Choose ONE distribution strategy:
- "equal_percent": every line gets the same discount percentage off its ceiling price. Predictable,
  easy to justify to the customer, keeps relative pricing proportions unchanged.
- "equal_amount": every line gets the same flat currency amount removed. In practice this pushes a
  bigger relative (%) discount onto lower-value/accessory items while protecting high-ticket items'
  margin percentage.

Pick whichever better fits this specific BOM's composition (e.g. prefer equal_amount if there's a
large spread between a few high-value items and many small accessories worth protecting; prefer
equal_percent for a more homogeneous BOM). Do not attempt to calculate exact final prices yourself -
only choose the strategy.

Respond with ONLY a JSON object (no markdown, no extra text), in this exact shape:
{ "strategy": "equal_percent" | "equal_amount", "rationale": "short explanation in Portuguese" }`;

      const { text, inputTokens, outputTokens, billedCostUsd } = await generateJsonWithProvider(
        providerResolution.provider as ConnectedProvider,
        providerResolution.model,
        prompt
      );
      const parsed = parseAiJson(text);
      const { strategy, rationale } = StrategyChoiceSchema.parse(parsed);

      await recordAiUsage({
        tenantId,
        taskType: "pricing_budget_optimization",
        provider: providerResolution.provider,
        model: providerResolution.model,
        estimatedCostUsd: billedCostUsd ?? estimateCostUsd(providerResolution.model, inputTokens, outputTokens),
      });

      const optimization = optimizeForBudget(optimizableLines, targetBudget, strategy);

      const run = await prisma.budgetOptimizationRun.create({
        data: {
          id: randomId("bor"),
          tenantId,
          pricingSheetId: sheet.id,
          targetBudget,
          strategy,
          requestedByUserId: userId,
          resultSummary: {
            strategy,
            rationale,
            feasible: optimization.feasible,
            minAchievableTotal: optimization.minAchievableTotal,
            maxAchievableTotal: optimization.maxAchievableTotal,
            achievedTotal: optimization.achievedTotal,
            lines: optimization.lines,
          },
        },
      });

      res.json({
        success: true,
        runId: run.id,
        strategy,
        rationale,
        feasible: optimization.feasible,
        minAchievableTotal: optimization.minAchievableTotal,
        maxAchievableTotal: optimization.maxAchievableTotal,
        achievedTotal: optimization.achievedTotal,
        lines: optimization.lines,
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(502).json({ success: false, message: "Resposta da IA não veio no formato esperado." });
      }
      next(err);
    }
  }
);

// Aplica as sugestões de um BudgetOptimizationRun às linhas reais - só acontece quando o usuário
// aceita explicitamente, nunca automaticamente a partir da rota acima.
router.post(
  "/pricing-sheets/:id/budget-optimize/:runId/apply",
  requirePermission("pricing:manage"),
  requireModule("pricing"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const run = await prisma.budgetOptimizationRun.findUnique({ where: { id: req.params.runId } });
      if (!run || run.pricingSheetId !== req.params.id) {
        return res.status(404).json({ success: false, message: "Rodada de otimização não encontrada." });
      }

      const summary = run.resultSummary as any;
      const suggestions: { id: string; discountPercent: number }[] = summary.lines;

      for (const suggestion of suggestions) {
        const line = await prisma.projectPricingLine.findUnique({ where: { id: suggestion.id }, include: { matchedItem: true } });
        if (!line || !line.matchedItem || line.listPriceSnapshot == null) continue;

        const pricing = computeLinePricing({
          listPrice: line.listPriceSnapshot,
          markupMin: line.matchedItem.markupMin,
          markupMax: line.matchedItem.markupMax,
          discountPercent: suggestion.discountPercent,
        });

        await prisma.projectPricingLine.update({
          where: { id: line.id },
          data: { discountPercent: suggestion.discountPercent, finalUnitPrice: pricing.finalUnitPrice, marginPercent: pricing.marginPercent },
        });
      }

      const sheet = await prisma.projectPricingSheet.findUnique({
        where: { id: req.params.id },
        include: { lines: { orderBy: { createdAt: "asc" } } },
      });

      res.json({ success: true, sheet });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
