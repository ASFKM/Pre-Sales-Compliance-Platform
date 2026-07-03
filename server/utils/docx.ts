import fs from "fs";
import path from "path";

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
  content += "COMMERCIAL ASSISTANT AI - PROPOSAL DOCUMENT\n";
  content += "==================================================\n\n";

  if (data.template) {
    content += `TEMPLATE: ${data.template.name} (${data.template.version})\n`;
    content += `TEMPLATE ID: ${data.template.id}\n`;
    content += `TEMPLATE TYPE: ${data.template.template_type}\n`;
    content += `TEMPLATE FILE: ${data.template.file_path}\n`;
    content += `TEMPLATE FILE FOUND: ${data.template.physical_file_found ? "YES" : "NO - GENERATED FROM REGISTERED TEMPLATE METADATA"}\n\n`;
  }

  content += `PROJECT: ${data.project.name.toUpperCase()}\n`;
  content += `CUSTOMER: ${data.project.customer_name}\n`;
  content += `VERTICAL: ${data.project.vertical}\n`;
  content += `DESCRIPTION: ${data.project.description}\n\n`;

  const es = data.analysis?.executive_summary;
  if (es) {
    content += "1. EXECUTIVE SUMMARY\n";
    content += "--------------------------------------------------\n";
    content += `Project Overview: ${es.project_overview || "N/A"}\n`;
    content += `Customer Context: ${es.customer_context || "N/A"}\n`;
    content += `Critical Requirements Summary: ${es.main_requirements || "N/A"}\n`;
    content += `Main Risks: ${es.main_risks || "N/A"}\n`;
    content += `Opportunities & Strategy: ${es.main_opportunities || "N/A"}\n`;
    content += `Recommended Strategy: ${es.recommended_strategy || "N/A"}\n`;
    content += `Assumptions: ${es.assumptions || "N/A"}\n`;
    content += `Next Steps: ${es.next_steps || "N/A"}\n\n`;
  }

  if (data.analysis?.critical_requirements?.length) {
    content += "2. CRITICAL COMPLIANCE MATRIX\n";
    content += "--------------------------------------------------\n";
    data.analysis.critical_requirements.forEach(req => {
      content += `[ID: ${req.requirement_id}] [${String(req.category || "general").toUpperCase()}] ${req.description}\n`;
      content += `   Compliance Status: ${String(req.compliance_status || "not_enough_information").toUpperCase()}\n`;
      if (req.priority) content += `   Priority: ${req.priority}\n`;
      if (req.source_document) content += `   Source: ${req.source_document} ${req.source_page_or_section || ""}\n`;
      if (req.notes) content += `   Notes: ${req.notes}\n`;
      content += "\n";
    });
  }

  if (data.analysis?.risks?.length) {
    content += "3. RISK MITIGATION GRID\n";
    content += "--------------------------------------------------\n";
    data.analysis.risks.forEach(risk => {
      content += `[ID: ${risk.risk_id}] [SEVERITY: ${String(risk.severity || "medium").toUpperCase()}] ${risk.title}\n`;
      if (risk.probability) content += `   Probability: ${risk.probability}\n`;
      if (risk.impact) content += `   Impact: ${risk.impact}\n`;
      content += `   Mitigation Strategy: ${risk.mitigation || "N/A"}\n\n`;
    });
  }

  if (data.analysis?.bom?.length) {
    content += "4. PRELIMINARY BILL OF MATERIALS (BOM)\n";
    content += "--------------------------------------------------\n";
    content += "ITEM | QTY | UNIT | CATEGORY | DESCRIPTION\n";
    data.analysis.bom.forEach(item => {
      content += `${item.product_or_service} | ${item.quantity} | ${item.unit} | ${item.category || "N/A"} | ${item.description}\n`;
      if (item.reason_for_inclusion) content += `   Reason: ${item.reason_for_inclusion}\n`;
    });
    content += "\n";
  }

  if (data.proposal?.manual_pricing_table?.length) {
    content += "5. COMMERCIAL PRICING & QUOTATION\n";
    content += "--------------------------------------------------\n";
    content += "ITEM | QTY | UNIT PRICE | TOTAL\n";
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
    content += `SUBTOTAL ESTIMATE: USD ${subtotal.toFixed(2)}\n\n`;
  }

  if (data.proposal) {
    content += "6. TERMS & CONDITIONS\n";
    content += "--------------------------------------------------\n";
    content += `Payment Terms: ${data.proposal.payment_terms || "Standard 30 days"}\n`;
    content += `Delivery: ${data.proposal.delivery_terms || "FOB Warehouse"}\n`;
    content += `Proposal Validity: ${data.proposal.proposal_validity || "N/A"}\n`;
    content += `Commercial Assumptions: ${data.proposal.commercial_assumptions || "N/A"}\n`;
    content += `Exclusions: ${data.proposal.exclusions || "Taxes and custom clearance"}\n\n`;
  }

  content += "==================================================\n";
  content += "GENERATED SECURELY BY COMMERCIAL ASSISTANT AI v3.0\n";
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

function buildDocxBuffer(text: string): Buffer {
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

export async function generateDocxFromTemplate(templatePath: string, outputPath: string, data: DocxTemplateData): Promise<void> {
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const content = buildProposalText({
    ...data,
    template: data.template ? { ...data.template, physical_file_found: fs.existsSync(templatePath) } : undefined
  });

  await fs.promises.writeFile(outputPath, buildDocxBuffer(content));
}

function buildPdfBuffer(text: string): Buffer {
  const lines = text.split(/\r?\n/).flatMap(line => wrapLine(line)).slice(0, 92);
  const stream = ["BT", "/F1 8 Tf", "50 800 Td", "10 TL", ...lines.map(line => `(${escapePdfText(line)}) Tj\nT*`), "ET"].join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ];

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
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(output, "utf8");
}

export async function generatePdfFromProposal(docxPath: string, outputPath: string, data?: DocxTemplateData): Promise<void> {
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const pdfText = data ? buildProposalText(data) : `Proposal DOCX generated at ${docxPath}`;
  await fs.promises.writeFile(outputPath, buildPdfBuffer(pdfText));
}
