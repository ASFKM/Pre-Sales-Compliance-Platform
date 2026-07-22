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
import { generatePricingTemplate, extractPricingRows, isTemplateWorkbook } from "../utils/pricingImport";
import { extractPricingRowsWithAi } from "../utils/pricingAiExtraction";
import { computeLinePricing } from "../utils/pricingMath";
import { optimizeForBudget } from "../utils/pricingBudgetOptimizer";
import { calculateTax } from "../utils/taxCalculation";
import { fetchUsdBrlExchangeRateFromBcb } from "../utils/exchangeRateFetch";
import { createTask, updateTaskProgress, completeTask, failTask } from "../../src/backgroundTasks";
import { runWithTenant } from "../../src/tenantContext";

const router = express.Router();
// Limite de 25MB com "Enviar Arquivos": fotos/scans de cotação de fornecedor pesam
// mais que uma planilha de texto. `files: 10` é o teto de arquivos por lote de uma vez.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 10 } });

router.get("/health", requirePermission("pricing:read"), requireModule("pricing"), (req: Request, res: Response) => {
  res.json({ success: true, module: "pricing", status: "ok" });
});

// Fase 7: motor fiscal opcional. Desligado por padrão - muitos tenants já calculam imposto no
// próprio ERP (decisão do usuário). Ligar exige também um TenantTaxProfile (UF de origem + regime
// tributário), senão o cálculo não tem o que usar como origem.
// Todos os campos são opcionais aqui de propósito - esse mesmo endpoint é usado tanto pela tela
// de motor fiscal (envia taxCalculationEnabled/originUF/taxRegime) quanto pelo canto da tela de
// Tabela de Preços (envia só usdBrlExchangeRate) - cada chamada só atualiza o que enviar, o resto
// fica como estava (ver PUT abaixo).
const PricingSettingsSchema = z.object({
  taxCalculationEnabled: z.boolean().optional(),
  originUF: z.string().length(2).optional(),
  taxRegime: z.enum(["simples_nacional", "lucro_presumido", "lucro_real"]).optional(),
  // Conversão USD -> BRL usada pelo import da planilha (extractPricingRows) quando só uma das
  // duas colunas de preço vem preenchida. Por padrão busca sozinha do Banco Central (PTAX) - ver
  // refreshExchangeRateIfStale; o admin pode sobrescrever aqui, o que fixa o rótulo de fonte como
  // manual até a próxima janela de atualização automática.
  usdBrlExchangeRate: z.number().positive().optional(),
});

// Fonte é sempre uma destas duas - nunca texto livre do usuário, pra manter o rótulo confiável.
const EXCHANGE_RATE_SOURCE_AUTO = "Banco Central do Brasil (PTAX)";
const EXCHANGE_RATE_SOURCE_MANUAL = "Ajustado manualmente pelo administrador";
const EXCHANGE_RATE_STALE_MS = 24 * 60 * 60 * 1000;

type TenantPricingSettingsRow = Awaited<ReturnType<typeof prisma.tenantPricingSettings.findUnique>>;

// Busca uma cotação nova do Banco Central quando a guardada tem mais de 1 dia (ou nunca foi
// definida) - inclusive quando o valor atual veio de um ajuste manual do admin, que vale só até a
// próxima janela de atualização automática. Fail-open: se o Banco Central não responder, mantém o
// que já estava salvo em vez de travar a tela de preços por causa disso.
async function refreshExchangeRateIfStale(tenantId: string, settings: TenantPricingSettingsRow): Promise<TenantPricingSettingsRow> {
  const isStale = !settings?.usdBrlExchangeRateUpdatedAt || Date.now() - settings.usdBrlExchangeRateUpdatedAt.getTime() > EXCHANGE_RATE_STALE_MS;
  if (!isStale) return settings;

  const fetched = await fetchUsdBrlExchangeRateFromBcb();
  if (!fetched) return settings;

  return settings
    ? prisma.tenantPricingSettings.update({
        where: { id: settings.id },
        data: { usdBrlExchangeRate: fetched.rate, usdBrlExchangeRateSource: EXCHANGE_RATE_SOURCE_AUTO, usdBrlExchangeRateUpdatedAt: new Date() },
      })
    : prisma.tenantPricingSettings.create({
        data: {
          id: randomId("tps"),
          tenantId,
          taxCalculationEnabled: false,
          usdBrlExchangeRate: fetched.rate,
          usdBrlExchangeRateSource: EXCHANGE_RATE_SOURCE_AUTO,
          usdBrlExchangeRateUpdatedAt: new Date(),
        },
      });
}

router.get("/settings", requirePermission("pricing:read"), requireModule("pricing"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.headers["x-tenant-id"] as string;
    let settings = await prisma.tenantPricingSettings.findUnique({ where: { tenantId } });
    settings = await refreshExchangeRateIfStale(tenantId, settings);
    const taxProfile = await prisma.tenantTaxProfile.findUnique({ where: { tenantId } });
    res.json({
      success: true,
      taxCalculationEnabled: settings?.taxCalculationEnabled ?? false,
      usdBrlExchangeRate: settings?.usdBrlExchangeRate ?? 5.0,
      usdBrlExchangeRateSource: settings?.usdBrlExchangeRateSource ?? null,
      usdBrlExchangeRateUpdatedAt: settings?.usdBrlExchangeRateUpdatedAt ?? null,
      taxProfile,
    });
  } catch (err) {
    next(err);
  }
});

// Força uma nova busca no Banco Central agora, ignorando a janela de 1 dia - botão "atualizar"
// no canto da tela de preços.
router.post(
  "/settings/refresh-exchange-rate",
  requirePermission("pricing:manage"),
  requireModule("pricing"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.headers["x-tenant-id"] as string;
      const fetched = await fetchUsdBrlExchangeRateFromBcb();
      if (!fetched) {
        return res.status(502).json({ success: false, message: "Não foi possível consultar a cotação no Banco Central agora. Tente novamente em instantes." });
      }
      const existingSettings = await prisma.tenantPricingSettings.findUnique({ where: { tenantId } });
      const settings = existingSettings
        ? await prisma.tenantPricingSettings.update({
            where: { id: existingSettings.id },
            data: { usdBrlExchangeRate: fetched.rate, usdBrlExchangeRateSource: EXCHANGE_RATE_SOURCE_AUTO, usdBrlExchangeRateUpdatedAt: new Date() },
          })
        : await prisma.tenantPricingSettings.create({
            data: {
              id: randomId("tps"),
              tenantId,
              taxCalculationEnabled: false,
              usdBrlExchangeRate: fetched.rate,
              usdBrlExchangeRateSource: EXCHANGE_RATE_SOURCE_AUTO,
              usdBrlExchangeRateUpdatedAt: new Date(),
            },
          });
      res.json({
        success: true,
        usdBrlExchangeRate: settings.usdBrlExchangeRate,
        usdBrlExchangeRateSource: settings.usdBrlExchangeRateSource,
        usdBrlExchangeRateUpdatedAt: settings.usdBrlExchangeRateUpdatedAt,
      });
    } catch (err) {
      next(err);
    }
  }
);

router.put("/settings", requirePermission("pricing:manage"), requireModule("pricing"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.headers["x-tenant-id"] as string;
    const body = PricingSettingsSchema.parse(req.body);

    if (body.taxCalculationEnabled && (!body.originUF || !body.taxRegime)) {
      return res.status(400).json({ success: false, message: "Pra ligar o motor fiscal, informe UF de origem e regime tributário." });
    }

    const existingSettings = await prisma.tenantPricingSettings.findUnique({ where: { tenantId } });
    const settingsUpdateData: { taxCalculationEnabled?: boolean; usdBrlExchangeRate?: number; usdBrlExchangeRateSource?: string; usdBrlExchangeRateUpdatedAt?: Date } = {};
    if (body.taxCalculationEnabled !== undefined) settingsUpdateData.taxCalculationEnabled = body.taxCalculationEnabled;
    if (body.usdBrlExchangeRate !== undefined) {
      settingsUpdateData.usdBrlExchangeRate = body.usdBrlExchangeRate;
      settingsUpdateData.usdBrlExchangeRateSource = EXCHANGE_RATE_SOURCE_MANUAL;
      settingsUpdateData.usdBrlExchangeRateUpdatedAt = new Date();
    }

    const settings = existingSettings
      ? await prisma.tenantPricingSettings.update({ where: { id: existingSettings.id }, data: settingsUpdateData })
      : await prisma.tenantPricingSettings.create({
          data: { id: randomId("tps"), tenantId, taxCalculationEnabled: body.taxCalculationEnabled ?? false, ...settingsUpdateData },
        });

    if (body.originUF && body.taxRegime) {
      const existingProfile = await prisma.tenantTaxProfile.findUnique({ where: { tenantId } });
      await (existingProfile
        ? prisma.tenantTaxProfile.update({ where: { id: existingProfile.id }, data: { originUF: body.originUF, taxRegime: body.taxRegime } })
        : prisma.tenantTaxProfile.create({ data: { id: randomId("ttp"), tenantId, originUF: body.originUF, taxRegime: body.taxRegime } }));
    }

    res.json({
      success: true,
      taxCalculationEnabled: settings.taxCalculationEnabled,
      usdBrlExchangeRate: settings.usdBrlExchangeRate,
      usdBrlExchangeRateSource: settings.usdBrlExchangeRateSource,
      usdBrlExchangeRateUpdatedAt: settings.usdBrlExchangeRateUpdatedAt,
    });
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

const CatalogItemEditSchema = z.object({
  itemCode: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  pn: z.string().min(1).optional(),
  erpCode: z.string().nullable().optional(),
  description: z.string().min(1).optional(),
  currentListPrice: z.number().positive().optional(),
  currentListPriceUsd: z.number().positive().nullable().optional(),
  currency: z.enum(["BRL", "USD"]).optional(),
  markupMin: z.number().optional(),
  markupMax: z.number().optional(),
});

// Edição direta de uma linha já cadastrada no catálogo (diferente da edição de rascunho em
// "Extrações pendentes", que é PriceCatalogExtractionDraft - aqui já é o item de verdade). Preço
// ou markup alterados manualmente também geram um PriceHistoryEntry, senão o gráfico de evolução
// de preço (GET /catalog/:id/history) ficaria com um buraco toda vez que alguém corrige um valor
// direto na tabela em vez de reenviar a planilha inteira.
router.put("/catalog/:id", requirePermission("pricing:manage"), requireModule("pricing"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.headers["x-tenant-id"] as string;
    const userId = requireUserId(req);
    const body = CatalogItemEditSchema.parse(req.body);

    const existing = await prisma.priceCatalogItem.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      return res.status(404).json({ success: false, message: "Item não encontrado." });
    }

    const updated = await prisma.priceCatalogItem.update({ where: { id: existing.id }, data: body });

    const priceOrMarkupChanged =
      (body.currentListPrice != null && body.currentListPrice !== existing.currentListPrice) ||
      (body.markupMin != null && body.markupMin !== existing.markupMin) ||
      (body.markupMax != null && body.markupMax !== existing.markupMax);

    if (priceOrMarkupChanged) {
      const priceListUpload = await prisma.priceListUpload.create({
        data: {
          id: randomId("plu"),
          tenantId,
          uploadedByUserId: userId,
          fileName: "Edição manual na tabela de preços",
          effectiveDate: new Date(),
          status: "completed",
          sourceLabel: "edição manual",
        },
      });
      await prisma.priceHistoryEntry.create({
        data: {
          id: randomId("phe"),
          tenantId,
          priceListUploadId: priceListUpload.id,
          itemId: updated.id,
          listPrice: updated.currentListPrice,
          listPriceUsd: updated.currentListPriceUsd,
          currency: updated.currency,
          updateSource: "spreadsheet",
          markupMax: updated.markupMax,
          markupMin: updated.markupMin,
          effectiveDate: new Date(),
        },
      });
    }

    res.json({ success: true, item: updated });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.issues[0].message });
    }
    next(err);
  }
});

// Exclusão direta de uma linha do catálogo. Seguro por design de schema, não por checagem manual
// aqui: PriceHistoryEntry cai em cascata (histórico de um item que não existe mais não faz
// sentido), ItemAliasMapping.resolvedItemId e ProjectPricingLine.matchedItemId viram null (a
// linha de um BOM/pricing sheet já precificado não é apagada, só perde o vínculo com o catálogo -
// ver onDelete: SetNull em prisma/schema.prisma).
router.delete("/catalog/:id", requirePermission("pricing:manage"), requireModule("pricing"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.priceCatalogItem.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      return res.status(404).json({ success: false, message: "Item não encontrado." });
    }
    await prisma.priceCatalogItem.delete({ where: { id: existing.id } });
    res.json({ success: true });
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

// Upsert compartilhado por linha completa da planilha modelo - usado tanto pra linha que já
// veio completa do arquivo quanto pra linha incompleta que virou completa depois de herdar os
// campos que faltavam de um item já cadastrado (ver commitTemplateFile).
async function upsertCatalogRow(
  tenantId: string,
  priceListUploadId: string,
  effectiveDate: Date,
  row: { itemCode: string; category: string; pn: string; erpCode: string | null; description: string; listPriceBrl: number; listPriceUsd: number; sourceCurrency: "BRL" | "USD"; markupMax: number; markupMin: number }
): Promise<"created" | "updated"> {
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
          currentListPrice: row.listPriceBrl,
          currentListPriceUsd: row.listPriceUsd,
          currency: row.sourceCurrency,
          lastUpdateSource: "spreadsheet",
          lastUpdateSupplierName: null,
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
          currentListPrice: row.listPriceBrl,
          currentListPriceUsd: row.listPriceUsd,
          currency: row.sourceCurrency,
          lastUpdateSource: "spreadsheet",
          markupMax: row.markupMax,
          markupMin: row.markupMin,
        },
      });

  await prisma.priceHistoryEntry.create({
    data: {
      id: randomId("phe"),
      tenantId,
      priceListUploadId,
      itemId: item.id,
      listPrice: row.listPriceBrl,
      listPriceUsd: row.listPriceUsd,
      currency: row.sourceCurrency,
      updateSource: "spreadsheet",
      markupMax: row.markupMax,
      markupMin: row.markupMin,
      effectiveDate,
    },
  });

  // Fase 5 (ciclo de itens sem cadastro): resolve qualquer pendência em ItemAliasMapping cujo PN
  // bata com o item recém-cadastrado/atualizado - futuros imports de BOM com esse PN casam
  // automaticamente a partir daqui, sem precisar reprocessar o BOM original.
  await prisma.itemAliasMapping.updateMany({
    where: { tenantId, rawPN: row.pn, resolvedItemId: null },
    data: { resolvedItemId: item.id },
  });

  return existing ? "updated" : "created";
}

// Grava as linhas do caminho determinístico (planilha modelo) - extraído pra função porque
// "Enviar Arquivos" chama isso por arquivo dentro de um lote, além do uso direto de antes.
//
// Linha com campo obrigatório faltando NUNCA é descartada (achado real, reportado pelo usuário:
// PN/descrição/preço válidos eram jogados fora só por falta de markup ou código do item). Em vez
// disso: 1) tenta casar com um item já cadastrado - por código do item se veio na planilha, senão
// por PN - e herda dele o que faltar (nunca o preço, que sempre vem da planilha nova); 2) se
// ficar completa, atualiza o catálogo direto, igual uma linha que já veio completa; 3) senão, vira
// PriceCatalogExtractionDraft pra revisão manual em "Extrações pendentes", mesmo fluxo já usado
// pela extração por IA (EditableCell/isDraftReadyToConfirm em PricingExtractionReview.tsx).
async function commitTemplateFile(
  tenantId: string,
  userId: string,
  file: { buffer: Buffer; originalname: string },
  exchangeRate: number
) {
  const { rows, partialRows, errors } = await extractPricingRows(file.buffer, exchangeRate);

  const priceListUpload = await prisma.priceListUpload.create({
    data: {
      id: randomId("plu"),
      tenantId,
      uploadedByUserId: userId,
      fileName: file.originalname,
      effectiveDate: new Date(),
      status: "processing",
      sourceLabel: "planilha-modelo",
    },
  });

  let created = 0;
  let updated = 0;
  let draftCount = 0;

  for (const row of rows) {
    const outcome = await upsertCatalogRow(tenantId, priceListUpload.id, priceListUpload.effectiveDate, row);
    outcome === "created" ? created++ : updated++;
  }

  for (const partial of partialRows) {
    const existingMatch = partial.itemCode
      ? await prisma.priceCatalogItem.findUnique({ where: { tenantId_itemCode: { tenantId, itemCode: partial.itemCode } } })
      : partial.pn
        ? await prisma.priceCatalogItem.findFirst({ where: { tenantId, pn: partial.pn } })
        : null;

    const itemCode = partial.itemCode ?? existingMatch?.itemCode ?? null;
    const category = partial.category ?? existingMatch?.category ?? null;
    const markupMin = partial.markupMin ?? existingMatch?.markupMin ?? null;
    const markupMax = partial.markupMax ?? existingMatch?.markupMax ?? null;

    if (itemCode && category && markupMin != null && markupMax != null && partial.listPriceBrl != null && partial.listPriceUsd != null && partial.sourceCurrency && partial.pn && partial.description) {
      const outcome = await upsertCatalogRow(tenantId, priceListUpload.id, priceListUpload.effectiveDate, {
        itemCode,
        category,
        pn: partial.pn,
        erpCode: partial.erpCode,
        description: partial.description,
        listPriceBrl: partial.listPriceBrl,
        listPriceUsd: partial.listPriceUsd,
        sourceCurrency: partial.sourceCurrency,
        markupMax,
        markupMin,
      });
      outcome === "created" ? created++ : updated++;
      continue;
    }

    const stillMissing: string[] = [];
    if (!itemCode) stillMissing.push("Código do item");
    if (!category) stillMissing.push("Categoria");
    if (partial.listPriceBrl == null || partial.listPriceUsd == null) stillMissing.push("Preço de lista (R$ ou US$)");
    if (markupMin == null) stillMissing.push("Markup mínimo");
    if (markupMax == null) stillMissing.push("Markup máximo");
    const matchNote = existingMatch ? ` Item já cadastrado encontrado por PN (${existingMatch.itemCode}) - alguns campos foram herdados dele.` : "";

    await prisma.priceCatalogExtractionDraft.create({
      data: {
        id: randomId("pced"),
        tenantId,
        priceListUploadId: priceListUpload.id,
        rowIndexInFile: partial.rowNumber,
        itemCode,
        category,
        pn: partial.pn,
        erpCode: partial.erpCode,
        description: partial.description,
        listPriceBrl: partial.listPriceBrl,
        listPriceUsd: partial.listPriceUsd,
        sourceCurrency: partial.sourceCurrency ?? "BRL",
        markupMin,
        markupMax,
        supplierName: null,
        confidenceNote: `Linha ${partial.rowNumber} da planilha: faltando ${stillMissing.join(", ")}.${matchNote}`,
      },
    });
    draftCount++;
  }

  await prisma.priceListUpload.update({
    where: { id: priceListUpload.id },
    data: { status: draftCount > 0 ? "pending_review" : created + updated > 0 ? "completed" : "failed" },
  });

  return { fileName: file.originalname, uploadId: priceListUpload.id, created, updated, draftCount, errors, mode: "template" as const };
}

// Caminho de IA (cotação de fornecedor em qualquer formato) - nunca commita direto no catálogo,
// só cria rascunhos em PriceCatalogExtractionDraft pra revisão humana (aba "Extrações pendentes").
// Roda como uma BackgroundTask (mesmo padrão de document_analysis em server/routes/analysis.ts) -
// taskId opcional só pra manter a função testável isoladamente sem precisar de uma tarefa real.
async function commitAiExtractionFile(
  tenantId: string,
  userId: string,
  file: { buffer: Buffer; originalname: string; mimetype: string },
  exchangeRate: number,
  provider: ConnectedProvider,
  model: string,
  taskId?: string
) {
  const priceListUpload = await prisma.priceListUpload.create({
    data: {
      id: randomId("plu"),
      tenantId,
      uploadedByUserId: userId,
      fileName: file.originalname,
      effectiveDate: new Date(),
      status: "processing",
      sourceLabel: "extração por IA",
    },
  });

  if (taskId) await updateTaskProgress(taskId, { status: "running", currentStep: `Lendo ${file.originalname}`, progressPct: 15 });

  try {
    if (taskId) await updateTaskProgress(taskId, { currentStep: `Analisando ${file.originalname} com IA`, progressPct: 40 });

    const extraction = await extractPricingRowsWithAi(
      { buffer: file.buffer, filename: file.originalname, mimeType: file.mimetype },
      exchangeRate,
      provider,
      model
    );

    await recordAiUsage({
      tenantId,
      taskType: "pricing_catalog_extraction",
      provider,
      model,
      estimatedCostUsd: extraction.billedCostUsd ?? estimateCostUsd(model, extraction.inputTokens, extraction.outputTokens),
    });

    if (taskId) await updateTaskProgress(taskId, { currentStep: "Salvando itens para revisão", progressPct: 80 });

    let draftCount = 0;
    for (let i = 0; i < extraction.rows.length; i++) {
      const row = extraction.rows[i];

      // Cotação de fornecedor quase nunca traz o código interno do item, categoria ou markup -
      // herda do catálogo existente pelo PN se achar um item já cadastrado, pra não deixar toda
      // linha travada pedindo preenchimento manual do que já se sabe. Preço NUNCA é herdado -
      // sempre vem do documento/IA, é o próprio motivo do upload. A linha continua exigindo
      // confirmação manual em "Extrações pendentes" mesmo assim (dado de IA nunca vira fato no
      // catálogo sozinho, diferente da planilha-modelo que o próprio usuário preencheu à mão -
      // ver commitTemplateFile).
      let itemCode = row.itemCode;
      let category = row.category;
      let markupMin = row.markupMin;
      let markupMax = row.markupMax;
      if (!itemCode || !category || markupMin == null || markupMax == null) {
        const existingByPn = await prisma.priceCatalogItem.findFirst({ where: { tenantId, pn: row.pn } });
        if (existingByPn) {
          itemCode = itemCode || existingByPn.itemCode;
          category = category || existingByPn.category;
          markupMin = markupMin ?? existingByPn.markupMin;
          markupMax = markupMax ?? existingByPn.markupMax;
        }
      }

      await prisma.priceCatalogExtractionDraft.create({
        data: {
          id: randomId("pced"),
          tenantId,
          priceListUploadId: priceListUpload.id,
          rowIndexInFile: i,
          itemCode,
          category,
          pn: row.pn,
          erpCode: row.erpCode,
          description: row.description,
          listPriceBrl: row.listPriceBrl,
          listPriceUsd: row.listPriceUsd,
          sourceCurrency: row.sourceCurrency,
          markupMin,
          markupMax,
          supplierName: extraction.supplierName,
          confidenceNote: row.confidenceNote,
        },
      });
      draftCount++;
    }

    await prisma.priceListUpload.update({
      where: { id: priceListUpload.id },
      data: { status: draftCount > 0 ? "pending_review" : "failed" },
    });

    if (taskId) {
      await completeTask(taskId, {
        resultType: "price_list_upload",
        resultId: priceListUpload.id,
        estimatedCostUsd: extraction.billedCostUsd ?? undefined,
        aiProvider: provider,
        warningMessage: draftCount === 0 ? "Nenhum item reconhecível encontrado neste arquivo." : null,
      });
    }

    return { fileName: file.originalname, uploadId: priceListUpload.id, draftCount, supplierName: extraction.supplierName, mode: "ai_extraction" as const };
  } catch (err: any) {
    await prisma.priceListUpload.update({ where: { id: priceListUpload.id }, data: { status: "failed" } });
    if (taskId) await failTask(taskId, err.message || "Falha na extração por IA.");
    return { fileName: file.originalname, uploadId: priceListUpload.id, draftCount: 0, error: err.message || "Falha na extração por IA.", mode: "ai_extraction" as const };
  }
}

router.post(
  "/catalog/upload",
  requirePermission("pricing:manage"),
  requireModule("pricing"),
  upload.array("files", 10),
  async (req: Request, res: Response, next: NextFunction) => {
    // multer's upload.array() middleware above breaks the AsyncLocalStorage continuation that
    // requireAuth's runWithTenant(ctx, () => next()) set up (confirmed live: createTask() failed
    // with "No tenant context set" on this route specifically - every OTHER route calling
    // createTask synchronously, like document_analysis, never goes through a multer middleware
    // first). Re-establishing the context explicitly here, instead of relying on it surviving
    // through multer, fixes it for this whole handler.
    const tenantId = req.headers["x-tenant-id"] as string;
    const userId = req.headers["x-user-id"] as string;
    const tenantContext = { tenantId };

    await runWithTenant(tenantContext, async () => {
    try {
      const files = (req.files as Express.Multer.File[]) || [];

      if (files.length === 0) {
        return res.status(400).json({ success: false, message: "Nenhum arquivo enviado." });
      }

      const pricingSettings = await prisma.tenantPricingSettings.findUnique({ where: { tenantId } });
      const exchangeRate = pricingSettings?.usdBrlExchangeRate ?? 5.0;

      // Detecção automática por arquivo: bate com o cabeçalho da planilha modelo -> caminho
      // determinístico de sempre; qualquer outra coisa (PDF, imagem, docx, csv, xlsx fora do
      // template) -> extração por IA. O usuário não classifica nada, só solta os arquivos.
      const isXlsx =
        (f: Express.Multer.File) =>
          f.mimetype === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" || f.originalname.toLowerCase().endsWith(".xlsx");

      const templateFiles: Express.Multer.File[] = [];
      const aiFiles: Express.Multer.File[] = [];
      for (const file of files) {
        if (isXlsx(file) && (await isTemplateWorkbook(file.buffer))) {
          templateFiles.push(file);
        } else {
          aiFiles.push(file);
        }
      }

      // Planilha modelo: síncrono, rápido, sem IA - resultado já sai na resposta.
      const templateResults: Awaited<ReturnType<typeof commitTemplateFile>>[] = [];
      for (const file of templateFiles) {
        templateResults.push(await commitTemplateFile(tenantId, userId, file, exchangeRate));
      }

      // Arquivos que precisam de IA: cada um vira uma BackgroundTask própria, com progresso
      // visível na barra de tarefas do rodapé (mesmo padrão de document_analysis) - a resposta
      // não espera a IA terminar, só confirma que a tarefa foi criada.
      const aiTasks: { taskId: string; fileName: string }[] = [];
      const cappedFiles: { fileName: string; error: string }[] = [];

      if (aiFiles.length > 0) {
        const settings = await dbStore.getSettings();
        const costCap = await checkCostCap(tenantId, settings.monthly_cost_cap_usd ?? null);
        if (costCap.blocked) {
          for (const file of aiFiles) {
            cappedFiles.push({
              fileName: file.originalname,
              error: `Limite mensal de custo de IA atingido ($${costCap.currentSpendUsd.toFixed(2)} de $${costCap.capUsd?.toFixed(2)}) - este arquivo precisa de IA pra ser processado.`,
            });
          }
        } else {
          const providerResolution = await resolveProvider("pricing_catalog_extraction", settings as any);
          if (providerResolution.isFallback) {
            await recordProviderFallback({ tenantId, taskType: "pricing_catalog_extraction", intendedProvider: providerResolution.intendedProvider, userId });
          }

          for (const file of aiFiles) {
            const task = await createTask({ userId, type: "pricing_catalog_extraction", currentStep: `Na fila: ${file.originalname}` });
            aiTasks.push({ taskId: task.id, fileName: file.originalname });

            // Cópia própria do buffer - req.files pode ser liberado pelo multer assim que a
            // resposta desta rota for enviada, mas este arquivo continua sendo processado depois
            // disso, em segundo plano.
            const fileBuffer = Buffer.from(file.buffer);
            const originalname = file.originalname;
            const mimetype = file.mimetype;

            void runWithTenant(tenantContext, async () => {
              try {
                await commitAiExtractionFile(
                  tenantId,
                  userId,
                  { buffer: fileBuffer, originalname, mimetype },
                  exchangeRate,
                  providerResolution.provider as ConnectedProvider,
                  providerResolution.model,
                  task.id
                );
              } catch (err: any) {
                await failTask(task.id, err.message || "Falha na extração por IA.");
              }
            });
          }
        }
      }

      res.json({ success: true, templateResults, aiTasks, cappedFiles });
    } catch (err) {
      next(err);
    }
    });
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

// "Enviar Arquivos" - aba "Extrações pendentes": rascunhos de cotações de fornecedor extraídas
// por IA, aguardando revisão humana antes de virarem PriceCatalogItem de verdade. Nunca commita
// sozinho (mesmo espírito de server/utils/knowledgeBaseReconciliation.ts).
router.get(
  "/catalog/extraction-drafts",
  requirePermission("pricing:read"),
  requireModule("pricing"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const drafts = await prisma.priceCatalogExtractionDraft.findMany({
        where: { status: { in: ["pending", "edited"] } },
        include: { priceListUpload: { select: { fileName: true, uploadedAt: true } } },
        orderBy: [{ priceListUploadId: "asc" }, { rowIndexInFile: "asc" }],
      });
      res.json({ success: true, drafts });
    } catch (err) {
      next(err);
    }
  }
);

const DraftEditSchema = z.object({
  itemCode: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  pn: z.string().min(1).optional(),
  erpCode: z.string().nullable().optional(),
  description: z.string().min(1).optional(),
  listPriceBrl: z.number().positive().nullable().optional(),
  listPriceUsd: z.number().positive().nullable().optional(),
  markupMin: z.number().nullable().optional(),
  markupMax: z.number().nullable().optional(),
  supplierName: z.string().nullable().optional(),
});

router.put(
  "/catalog/extraction-drafts/:id",
  requirePermission("pricing:manage"),
  requireModule("pricing"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = DraftEditSchema.parse(req.body);
      const draft = await prisma.priceCatalogExtractionDraft.findUnique({ where: { id: req.params.id } });
      if (!draft) {
        return res.status(404).json({ success: false, message: "Rascunho não encontrado." });
      }
      const updated = await prisma.priceCatalogExtractionDraft.update({
        where: { id: draft.id },
        data: { ...body, status: "edited" },
      });
      res.json({ success: true, draft: updated });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ success: false, message: err.issues[0].message });
      }
      next(err);
    }
  }
);

router.post(
  "/catalog/extraction-drafts/:id/reject",
  requirePermission("pricing:manage"),
  requireModule("pricing"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const draft = await prisma.priceCatalogExtractionDraft.findUnique({ where: { id: req.params.id } });
      if (!draft) {
        return res.status(404).json({ success: false, message: "Rascunho não encontrado." });
      }
      await prisma.priceCatalogExtractionDraft.update({ where: { id: draft.id }, data: { status: "rejected" } });
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  }
);

// Confirma um ou mais rascunhos em lote - só aqui os dados viram PriceCatalogItem/
// PriceHistoryEntry de verdade. Cada linha precisa ter preço (BRL ou USD) e markup min/máx
// preenchidos (herdados automaticamente na extração quando possível, ou preenchidos manualmente
// na revisão) - sem isso a linha é rejeitada com erro em vez de criar um item incompleto.
router.post(
  "/catalog/extraction-drafts/confirm",
  requirePermission("pricing:manage"),
  requireModule("pricing"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.headers["x-tenant-id"] as string;
      const ids = z.array(z.string().min(1)).min(1).parse(req.body?.draftIds);

      const drafts = await prisma.priceCatalogExtractionDraft.findMany({
        where: { id: { in: ids }, status: { in: ["pending", "edited"] } },
        include: { priceListUpload: { select: { sourceLabel: true } } },
      });

      let confirmed = 0;
      const errors: { id: string; message: string }[] = [];

      for (const draft of drafts) {
        if (draft.listPriceBrl == null || draft.listPriceUsd == null) {
          errors.push({ id: draft.id, message: "Preencha o preço (R$ e US$) antes de confirmar." });
          continue;
        }
        if (draft.markupMin == null || draft.markupMax == null) {
          errors.push({ id: draft.id, message: "Preencha o markup mínimo e máximo antes de confirmar." });
          continue;
        }
        if (!draft.itemCode) {
          errors.push({ id: draft.id, message: "Preencha o código do item antes de confirmar." });
          continue;
        }

        // Rascunho pode vir da extração por IA (cotação de fornecedor) OU de uma planilha-modelo
        // com campos incompletos (server/routes/pricing.ts's commitTemplateFile) - a origem real
        // decide lastUpdateSource/updateSource, em vez do "supplier_quote" fixo de antes (achava
        // que todo rascunho vinha de cotação, o que não é mais verdade).
        const updateSource = draft.priceListUpload.sourceLabel === "extração por IA" ? "supplier_quote" : "spreadsheet";

        const existing = await prisma.priceCatalogItem.findUnique({
          where: { tenantId_itemCode: { tenantId, itemCode: draft.itemCode } },
        });

        const item = existing
          ? await prisma.priceCatalogItem.update({
              where: { id: existing.id },
              data: {
                category: draft.category || existing.category,
                pn: draft.pn,
                erpCode: draft.erpCode,
                description: draft.description,
                currentListPrice: draft.listPriceBrl,
                currentListPriceUsd: draft.listPriceUsd,
                currency: draft.sourceCurrency,
                lastUpdateSource: updateSource,
                lastUpdateSupplierName: draft.supplierName,
                markupMax: draft.markupMax,
                markupMin: draft.markupMin,
              },
            })
          : await prisma.priceCatalogItem.create({
              data: {
                id: randomId("pci"),
                tenantId,
                itemCode: draft.itemCode,
                category: draft.category || "Não categorizado",
                pn: draft.pn,
                erpCode: draft.erpCode,
                description: draft.description,
                currentListPrice: draft.listPriceBrl,
                currentListPriceUsd: draft.listPriceUsd,
                currency: draft.sourceCurrency,
                lastUpdateSource: updateSource,
                lastUpdateSupplierName: draft.supplierName,
                markupMax: draft.markupMax,
                markupMin: draft.markupMin,
              },
            });

        await prisma.priceHistoryEntry.create({
          data: {
            id: randomId("phe"),
            tenantId,
            priceListUploadId: draft.priceListUploadId,
            itemId: item.id,
            listPrice: draft.listPriceBrl,
            listPriceUsd: draft.listPriceUsd,
            currency: draft.sourceCurrency,
            updateSource,
            supplierName: draft.supplierName,
            markupMax: draft.markupMax,
            markupMin: draft.markupMin,
            effectiveDate: new Date(),
          },
        });

        await prisma.itemAliasMapping.updateMany({
          where: { tenantId, rawPN: draft.pn, resolvedItemId: null },
          data: { resolvedItemId: item.id },
        });

        await prisma.priceCatalogExtractionDraft.update({ where: { id: draft.id }, data: { status: "confirmed" } });
        confirmed++;
      }

      res.json({ success: true, confirmed, errors });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ success: false, message: err.issues[0].message });
      }
      next(err);
    }
  }
);

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

// Lista as sessões de precificação já importadas, para a aba "Precificação de projeto" mostrar
// o que já foi feito em vez de perder a referência assim que o usuário sai da tela ou importa
// outro projeto. Um projeto pode acumular mais de uma sessão (reimportações do mesmo BOM não
// substituem a anterior, ver POST /projects/:projectId/pricing-sheets acima) - a lista mostra só
// a mais recente por projeto, senão viraria uma lista crescente de sessões obsoletas do mesmo
// projeto sem forma de saber qual é a atual.
router.get("/pricing-sheets", requirePermission("pricing:read"), requireModule("pricing"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sheets = await prisma.projectPricingSheet.findMany({
      orderBy: { updatedAt: "desc" },
      include: {
        project: { select: { name: true } },
        _count: { select: { lines: true } },
      },
    });
    const seenProjectIds = new Set<string>();
    const latestPerProject: typeof sheets = [];
    for (const sheet of sheets) {
      if (seenProjectIds.has(sheet.projectId)) continue;
      seenProjectIds.add(sheet.projectId);
      latestPerProject.push(sheet);
    }
    res.json({
      success: true,
      sheets: latestPerProject.map((s) => ({
        id: s.id,
        projectId: s.projectId,
        projectName: s.project.name,
        status: s.status,
        destinationUF: s.destinationUF,
        totalLines: s._count.lines,
        updatedAt: s.updatedAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

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
