import path from "path";
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";
import ExcelJS from "exceljs";
import { logger } from "./logger";

export interface ExtractedDocument {
  text: string;
  metadata: {
    pages?: number;
    wordCount?: number;
    characterCount: number;
    linesCount: number;
    extractionStatus: "success" | "warning" | "failed";
    issues?: string[];
  };
}

function fromText(text: string, extra: Partial<ExtractedDocument["metadata"]> = {}): ExtractedDocument {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = text.split("\n");
  return {
    text,
    metadata: {
      wordCount: words.length,
      characterCount: text.length,
      linesCount: lines.length,
      extractionStatus: text.trim().length > 0 ? "success" : "warning",
      ...extra,
    },
  };
}

/**
 * Extracts plain text from various document formats using real parsers - a hand-rolled regex
 * scan (the previous implementation) only ever worked on uncompressed PDF content streams and
 * on DOCX/XLSX zip archives read as if they were plain text, neither of which real-world files
 * actually are (both formats compress their content), so it silently produced garbage on
 * essentially every real document.
 */
export async function extractTextFromDocument(fileBuffer: Buffer, originalFilename: string, mimeType: string): Promise<ExtractedDocument> {
  const extension = path.extname(originalFilename).toLowerCase();

  try {
    if (extension === ".txt" || mimeType === "text/plain") {
      return fromText(fileBuffer.toString("utf8"));
    } else if (extension === ".csv" || mimeType === "text/csv") {
      return extractCsv(fileBuffer);
    } else if (extension === ".docx" || mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      return await extractDocx(fileBuffer);
    } else if (extension === ".xlsx" || mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
      return await extractXlsx(fileBuffer);
    } else if (extension === ".pdf" || mimeType === "application/pdf") {
      return await extractPdf(fileBuffer);
    } else {
      return fromText(fileBuffer.toString("utf8", 0, 5000), { extractionStatus: "warning", issues: ["Unsupported extension. Performed standard UTF-8 buffer conversion."] });
    }
  } catch (err: any) {
    logger.error({ err, filename: originalFilename }, "Extraction failed");
    return {
      text: `Error extracting text from ${originalFilename}.`,
      metadata: {
        characterCount: 0,
        linesCount: 0,
        extractionStatus: "failed",
        issues: [err.message],
      },
    };
  }
}

function extractCsv(buffer: Buffer): ExtractedDocument {
  const text = buffer.toString("utf8");
  const lines = text.split("\n");
  let formattedText = "CSV GRID DATA:\n";
  lines.forEach((line, idx) => {
    if (line.trim()) {
      formattedText += `Row ${idx + 1}: ${line.split(",").join(" | ")}\n`;
    }
  });
  return fromText(formattedText);
}

async function extractDocx(buffer: Buffer): Promise<ExtractedDocument> {
  const result = await mammoth.extractRawText({ buffer });
  return fromText(result.value, result.messages.length > 0 ? { issues: result.messages.map((m) => m.message) } : {});
}

async function extractXlsx(buffer: Buffer): Promise<ExtractedDocument> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);
  let text = "";
  workbook.eachSheet((sheet) => {
    text += `SHEET: ${sheet.name}\n`;
    sheet.eachRow((row) => {
      const cells = (row.values as any[]).slice(1).map((v) => (v == null ? "" : String(v)));
      text += cells.join(" | ") + "\n";
    });
  });
  return fromText(text);
}

async function extractPdf(buffer: Buffer): Promise<ExtractedDocument> {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return fromText(result.text, { pages: Array.isArray(result.pages) ? result.pages.length : undefined });
  } finally {
    await parser.destroy();
  }
}
