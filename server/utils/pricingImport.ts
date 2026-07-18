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
  listPrice: number;
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
  "Preço de lista",
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
    { header: TEMPLATE_HEADERS[5], key: "listPrice", width: 16 },
    { header: TEMPLATE_HEADERS[6], key: "markupMax", width: 18 },
    { header: TEMPLATE_HEADERS[7], key: "markupMin", width: 18 },
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

export async function extractPricingRows(buffer: Buffer): Promise<{ rows: PricingRow[]; errors: PricingRowError[] }> {
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
    const [itemCode, category, pn, erpCode, description, listPrice, markupMax, markupMin] = values;

    if (!itemCode && !pn && !description) return; // fully blank row, skip silently

    const missing: string[] = [];
    if (!itemCode) missing.push("Código do item");
    if (!category) missing.push("Categoria");
    if (!pn) missing.push("PN");
    if (!description) missing.push("Descrição");
    if (listPrice == null || isNaN(Number(listPrice))) missing.push("Preço de lista");
    if (markupMax == null || isNaN(Number(markupMax))) missing.push("Markup máximo");
    if (markupMin == null || isNaN(Number(markupMin))) missing.push("Markup mínimo");

    if (missing.length > 0) {
      errors.push({ rowNumber, message: `Campos obrigatórios ausentes/inválidos: ${missing.join(", ")}` });
      return;
    }

    rows.push({
      rowNumber,
      itemCode: String(itemCode).trim(),
      category: String(category).trim(),
      pn: String(pn).trim(),
      erpCode: erpCode ? String(erpCode).trim() : null,
      description: String(description).trim(),
      listPrice: Number(listPrice),
      markupMax: Number(markupMax),
      markupMin: Number(markupMin),
    });
  });

  return { rows, errors };
}
