// Módulo de Precificação (add-on), Fase 2: parsing/geração da planilha de cadastro de preços.
// Deliberadamente separado de server/utils/extraction.ts - aquele arquivo achata qualquer
// planilha em texto pipe-delimited para alimentar prompts de IA (extractXlsx); este mantém a
// estrutura tabular (colunas conhecidas) porque alimenta um importador estrito, não um prompt.
import ExcelJS from "exceljs";

export interface PricingRow {
  rowNumber: number;
  itemCode: string;
  category: string;
  pn: string;
  erpCode: string | null;
  description: string;
  // Canônico (BRL) e espelho (USD) - sempre os dois preenchidos na saída, independente de qual
  // coluna o usuário de fato preencheu na planilha (ver conversão em extractPricingRows).
  listPriceBrl: number;
  listPriceUsd: number;
  // Moeda que o usuário de fato informou nesta linha - só informativo (qual das duas colunas
  // veio preenchida "de origem"); se as duas vierem preenchidas, fica "BRL" por convenção (nenhuma
  // conversão acontece nesse caso, os dois valores são aceitos como informados).
  sourceCurrency: "BRL" | "USD";
  markupMax: number;
  markupMin: number;
}

export interface PricingRowError {
  rowNumber: number;
  message: string;
}

const TEMPLATE_HEADERS = [
  "Código do item",
  "Categoria",
  "PN",
  "Código ERP/SAP",
  "Descrição",
  "Preço de lista (R$)",
  "Preço de lista (US$)",
  "Markup máximo (%)",
  "Markup mínimo (%)",
];

export async function generatePricingTemplate(prefillRows: Array<{ pn: string; description: string }> = []): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Tabela de Preços");
  sheet.columns = [
    { header: TEMPLATE_HEADERS[0], key: "itemCode", width: 18 },
    { header: TEMPLATE_HEADERS[1], key: "category", width: 16 },
    { header: TEMPLATE_HEADERS[2], key: "pn", width: 18 },
    { header: TEMPLATE_HEADERS[3], key: "erpCode", width: 18 },
    { header: TEMPLATE_HEADERS[4], key: "description", width: 40 },
    { header: TEMPLATE_HEADERS[5], key: "listPriceBrl", width: 18 },
    { header: TEMPLATE_HEADERS[6], key: "listPriceUsd", width: 18 },
    { header: TEMPLATE_HEADERS[7], key: "markupMax", width: 18 },
    { header: TEMPLATE_HEADERS[8], key: "markupMin", width: 18 },
  ];
  sheet.getRow(1).font = { bold: true };

  // Fase 5 (ciclo de itens sem cadastro): quando chamado com pendências, pré-preenche PN/
  // descrição já extraídos do BOM - o usuário só completa o resto.
  for (const row of prefillRows) {
    sheet.addRow({ pn: row.pn, description: row.description });
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

// exchangeRate: quantos R$ vale 1 US$ (TenantPricingSettings.usdBrlExchangeRate) - usado só
// quando a linha preenche apenas uma das duas colunas de preço, pra calcular a outra
// automaticamente. Se as duas vierem preenchidas, nenhuma conversão acontece - o valor informado
// em cada moeda é aceito como está.
export async function extractPricingRows(buffer: Buffer, exchangeRate: number): Promise<{ rows: PricingRow[]; errors: PricingRowError[] }> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);
  const sheet = workbook.worksheets[0];
  const rows: PricingRow[] = [];
  const errors: PricingRowError[] = [];

  if (!sheet) {
    return { rows, errors: [{ rowNumber: 0, message: "Planilha vazia ou sem abas." }] };
  }

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // header

    // row.values is 1-indexed with an empty slot at index 0 (same quirk extraction.ts's
    // extractXlsx already works around).
    const values = (row.values as any[]).slice(1);
    const [itemCode, category, pn, erpCode, description, listPriceBrlRaw, listPriceUsdRaw, markupMax, markupMin] = values;

    if (!itemCode && !pn && !description) return; // fully blank row, skip silently

    const hasBrl = listPriceBrlRaw != null && listPriceBrlRaw !== "" && !isNaN(Number(listPriceBrlRaw));
    const hasUsd = listPriceUsdRaw != null && listPriceUsdRaw !== "" && !isNaN(Number(listPriceUsdRaw));

    const missing: string[] = [];
    if (!itemCode) missing.push("Código do item");
    if (!category) missing.push("Categoria");
    if (!pn) missing.push("PN");
    if (!description) missing.push("Descrição");
    if (!hasBrl && !hasUsd) missing.push("Preço de lista (R$) ou Preço de lista (US$)");
    if (markupMax == null || isNaN(Number(markupMax))) missing.push("Markup máximo");
    if (markupMin == null || isNaN(Number(markupMin))) missing.push("Markup mínimo");

    if (missing.length > 0) {
      errors.push({ rowNumber, message: `Campos obrigatórios ausentes/inválidos: ${missing.join(", ")}` });
      return;
    }

    let listPriceBrl: number;
    let listPriceUsd: number;
    let sourceCurrency: "BRL" | "USD";
    if (hasBrl && hasUsd) {
      listPriceBrl = Number(listPriceBrlRaw);
      listPriceUsd = Number(listPriceUsdRaw);
      sourceCurrency = "BRL";
    } else if (hasBrl) {
      listPriceBrl = Number(listPriceBrlRaw);
      listPriceUsd = listPriceBrl / exchangeRate;
      sourceCurrency = "BRL";
    } else {
      listPriceUsd = Number(listPriceUsdRaw);
      listPriceBrl = listPriceUsd * exchangeRate;
      sourceCurrency = "USD";
    }

    rows.push({
      rowNumber,
      itemCode: String(itemCode).trim(),
      category: String(category).trim(),
      pn: String(pn).trim(),
      erpCode: erpCode ? String(erpCode).trim() : null,
      description: String(description).trim(),
      listPriceBrl,
      listPriceUsd,
      sourceCurrency,
      markupMax: Number(markupMax),
      markupMin: Number(markupMin),
    });
  });

  return { rows, errors };
}
