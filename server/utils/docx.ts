import { StorageAdapter } from "./storage";

export interface DocxTemplateData {
  template?: {
    id: string;
    name: string;
    version: string;
    template_type: string;
    file_path: string;
    physical_file_found: boolean;
  };
  project: {
    name: string;
    customer_name: string;
    description: string;
    vertical: string;
  };
  analysis?: {
    executive_summary?: any;
    critical_requirements?: any[];
    risks?: any[];
    bom?: any[];
  };
  proposal?: {
    manual_pricing_table?: Array<Record<string, any>>;
    payment_terms?: string;
    delivery_terms?: string;
    proposal_validity?: string;
    commercial_assumptions?: string;
    exclusions?: string;
  };
}

function escapeXml(value: string): string {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
}

function escapePdfText(value: string): string {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
}

function wrapLine(line: string, maxLength = 92): string[] {
  const words = String(line || "").split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if ((current + " " + word).trim().length > maxLength) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = `${current} ${word}`.trim();
    }
  }

  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

export function buildProposalText(data: DocxTemplateData): string {
  let content = "";
  content += "==================================================\n";
  content += "COMMERCIAL ASSISTANT AI - DOCUMENTO DE PROPOSTA\n";
  content += "==================================================\n\n";

  if (data.template) {
    content += `MODELO: ${data.template.name} (${data.template.version})\n`;
    content += `ID DO MODELO: ${data.template.id}\n`;
    content += `TIPO DE MODELO: ${data.template.template_type}\n`;
    content += `ARQUIVO DO MODELO: ${data.template.file_path}\n`;
    content += `ARQUIVO DO MODELO ENCONTRADO: ${data.template.physical_file_found ? "SIM" : "NÃO - GERADO A PARTIR DOS METADADOS DO MODELO REGISTRADO"}\n\n`;
  }

  content += `PROJETO: ${data.project.name.toUpperCase()}\n`;
  content += `CLIENTE: ${data.project.customer_name}\n`;
  content += `VERTICAL: ${data.project.vertical}\n`;
  content += `DESCRIÇÃO: ${data.project.description}\n\n`;

  const es = data.analysis?.executive_summary;
  if (es) {
    content += "1. RESUMO EXECUTIVO\n";
    content += "--------------------------------------------------\n";
    content += `Escopo do Projeto: ${es.project_overview || "N/D"}\n`;
    content += `Contexto do Cliente: ${es.customer_context || "N/D"}\n`;
    content += `Resumo dos Requisitos Críticos: ${es.main_requirements || "N/D"}\n`;
    content += `Principais Riscos: ${es.main_risks || "N/D"}\n`;
    content += `Oportunidades & Estratégia: ${es.main_opportunities || "N/D"}\n`;
    content += `Estratégia Recomendada: ${es.recommended_strategy || "N/D"}\n`;
    content += `Premissas: ${es.assumptions || "N/D"}\n`;
    content += `Próximos Passos: ${es.next_steps || "N/D"}\n\n`;
  }

  if (data.analysis?.critical_requirements?.length) {
    content += "2. MATRIZ DE CONFORMIDADE CRÍTICA\n";
    content += "--------------------------------------------------\n";
    data.analysis.critical_requirements.forEach(req => {
      content += `[ID: ${req.requirement_id}] [${String(req.category || "geral").toUpperCase()}] ${req.description}\n`;
      content += `   Status de Conformidade: ${String(req.compliance_status || "not_enough_information").toUpperCase()}\n`;
      if (req.priority) content += `   Prioridade: ${req.priority}\n`;
      if (req.source_document) content += `   Fonte: ${req.source_document} ${req.source_page_or_section || ""}\n`;
      if (req.notes) content += `   Notas: ${req.notes}\n`;
      content += "\n";
    });
  }

  if (data.analysis?.risks?.length) {
    content += "3. GRADE DE MITIGAÇÃO DE RISCOS\n";
    content += "--------------------------------------------------\n";
    data.analysis.risks.forEach(risk => {
      content += `[ID: ${risk.risk_id}] [SEVERIDADE: ${String(risk.severity || "medium").toUpperCase()}] ${risk.title}\n`;
      if (risk.probability) content += `   Probabilidade: ${risk.probability}\n`;
      if (risk.impact) content += `   Impacto: ${risk.impact}\n`;
      content += `   Estratégia de Mitigação: ${risk.mitigation || "N/D"}\n\n`;
    });
  }

  if (data.analysis?.bom?.length) {
    content += "4. LISTA PRELIMINAR DE MATERIAIS (BOM)\n";
    content += "--------------------------------------------------\n";
    content += "ITEM | FABRICANTE | QTD | UNIDADE | CATEGORIA | ESPECIFICAÇÃO\n";
    data.analysis.bom.forEach(item => {
      content += `${item.equipment_name} | ${item.manufacturer || "N/D"} | ${item.quantity} | ${item.unit} | ${item.category || "N/D"} | ${item.specification || ""}\n`;
    });
    content += "\n";
  }

  if (data.proposal?.manual_pricing_table?.length) {
    content += "5. PRECIFICAÇÃO E COTAÇÃO COMERCIAL\n";
    content += "--------------------------------------------------\n";
    content += "ITEM | QTD | PREÇO UNITÁRIO | TOTAL\n";
    let subtotal = 0;
    data.proposal.manual_pricing_table.forEach(p => {
      const qty = Number(p.quantity || 0);
      const unitPrice = Number(p.unit_price || 0);
      const total = Number(p.total_price || qty * unitPrice);
      const currency = p.currency || "USD";
      content += `${p.product_or_service} | ${qty} | ${currency} ${unitPrice.toFixed(2)} | ${currency} ${total.toFixed(2)}\n`;
      subtotal += total;
    });
    content += "--------------------------------------------------\n";
    content += `ESTIMATIVA DE SUBTOTAL: USD ${subtotal.toFixed(2)}\n\n`;
  }

  if (data.proposal) {
    content += "6. TERMOS E CONDIÇÕES\n";
    content += "--------------------------------------------------\n";
    content += `Termos de Pagamento: ${data.proposal.payment_terms || "30 dias líquidos (padrão)"}\n`;
    content += `Entrega: ${data.proposal.delivery_terms || "FOB Armazém"}\n`;
    content += `Validade da Proposta: ${data.proposal.proposal_validity || "N/D"}\n`;
    content += `Premissas Comerciais: ${data.proposal.commercial_assumptions || "N/D"}\n`;
    content += `Exclusões: ${data.proposal.exclusions || "Impostos e desembaraço aduaneiro"}\n\n`;
  }

  content += "==================================================\n";
  content += "GERADO COM SEGURANÇA PELO COMMERCIAL ASSISTANT AI v3.0\n";
  content += "==================================================\n";

  return content;
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    crc ^= buffer[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createZip(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuffer = Buffer.from(entry.name, "utf8");
    const data = entry.data;
    const crc = crc32(data);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, nameBuffer, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, nameBuffer);

    offset += localHeader.length + nameBuffer.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

export function buildDocxBuffer(text: string): Buffer {
  const paragraphs = text.split(/\r?\n/).map(line =>
    `<w:p><w:r><w:t xml:space="preserve">${escapeXml(line || " ")}</w:t></w:r></w:p>`
  ).join("");

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;

  return createZip([
    { name: "[Content_Types].xml", data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`, "utf8") },
    { name: "_rels/.rels", data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`, "utf8") },
    { name: "word/document.xml", data: Buffer.from(documentXml, "utf8") },
    { name: "docProps/core.xml", data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Commercial Assistant AI Proposal</dc:title><dc:creator>Commercial Assistant AI</dc:creator><cp:lastModifiedBy>Commercial Assistant AI</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:modified></cp:coreProperties>`, "utf8") },
    { name: "docProps/app.xml", data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Commercial Assistant AI</Application></Properties>`, "utf8") }
  ]);
}

// Lines per page - fits within the same "50 800 Td .. 10 TL" text-block geometry the single-page
// version used (800pt down to a ~50pt bottom margin on a 842pt-tall page, 10pt leading).
const PDF_LINES_PER_PAGE = 74;

// Real pagination: however many pages the content needs, not a single page that silently
// truncated anything past the first ~92 lines. Object numbering: catalog=1, pages=2, font=3,
// then each page contributes 2 objects (page dict + its content stream).
export function buildPdfBuffer(text: string): Buffer {
  const allLines = text.split(/\r?\n/).flatMap(line => wrapLine(line));
  const pageChunks: string[][] = [];
  for (let i = 0; i < allLines.length; i += PDF_LINES_PER_PAGE) {
    pageChunks.push(allLines.slice(i, i + PDF_LINES_PER_PAGE));
  }
  if (pageChunks.length === 0) pageChunks.push([""]);

  const CATALOG_OBJ = 1;
  const PAGES_OBJ = 2;
  const FONT_OBJ = 3;
  const pageObjNums = pageChunks.map((_, i) => 4 + 2 * i);
  const contentObjNums = pageChunks.map((_, i) => 5 + 2 * i);

  const objects: string[] = [];
  objects[CATALOG_OBJ - 1] = `<< /Type /Catalog /Pages ${PAGES_OBJ} 0 R >>`;
  objects[PAGES_OBJ - 1] = `<< /Type /Pages /Kids [${pageObjNums.map(n => `${n} 0 R`).join(" ")}] /Count ${pageChunks.length} >>`;
  objects[FONT_OBJ - 1] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  pageChunks.forEach((lines, i) => {
    const stream = ["BT", "/F1 8 Tf", "50 800 Td", "10 TL", ...lines.map(line => `(${escapePdfText(line)}) Tj\nT*`), "ET"].join("\n");
    objects[pageObjNums[i] - 1] = `<< /Type /Page /Parent ${PAGES_OBJ} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${FONT_OBJ} 0 R >> >> /Contents ${contentObjNums[i]} 0 R >>`;
    objects[contentObjNums[i] - 1] = `<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream`;
  });

  let output = "%PDF-1.4\n";
  const offsets = [0];

  objects.forEach((obj, index) => {
    offsets.push(Buffer.byteLength(output, "utf8"));
    output += `${index + 1} 0 obj\n${obj}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(output, "utf8");
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach(offset => {
    output += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  output += `trailer\n<< /Size ${objects.length + 1} /Root ${CATALOG_OBJ} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(output, "utf8");
}

// Regenerates the DOCX/PDF pair directly from a plain-text string, through the storage adapter
// rather than a raw fs path - used both for the initial generation (from buildProposalText's
// output) and after the user edits that text in the proposal editor, so the exported files always
// match what's on screen rather than the original unedited analysis data. Returns the storage
// paths the caller should persist on the Proposal row.
export async function writeProposalFiles(
  storageAdapter: StorageAdapter,
  projectId: string,
  proposalType: string,
  text: string
): Promise<{ docx_file_path: string; pdf_file_path: string }> {
  const docxPath = await storageAdapter.uploadFile(
    projectId,
    buildDocxBuffer(text),
    `${proposalType}_proposal.docx`,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
  const pdfPath = await storageAdapter.uploadFile(projectId, buildPdfBuffer(text), `${proposalType}_proposal.pdf`, "application/pdf");
  return { docx_file_path: docxPath, pdf_file_path: pdfPath };
}
