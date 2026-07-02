import fs from "fs";
import path from "path";
import zlib from "zlib";

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

/**
 * Extracts plain text from various document formats securely.
 */
export async function extractTextFromDocument(fileBuffer: Buffer, originalFilename: string, mimeType: string): Promise<ExtractedDocument> {
  const extension = path.extname(originalFilename).toLowerCase();
  
  try {
    if (extension === ".txt" || mimeType === "text/plain") {
      return extractTxt(fileBuffer);
    } else if (extension === ".csv" || mimeType === "text/csv") {
      return extractCsv(fileBuffer);
    } else if (extension === ".docx" || mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      return extractDocx(fileBuffer);
    } else if (extension === ".xlsx" || mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
      return extractXlsx(fileBuffer);
    } else if (extension === ".pdf" || mimeType === "application/pdf") {
      return extractPdf(fileBuffer, originalFilename);
    } else {
      return {
        text: fileBuffer.toString("utf8", 0, 5000),
        metadata: {
          characterCount: fileBuffer.length,
          linesCount: 1,
          extractionStatus: "warning",
          issues: ["Unsupported extension. Performed standard UTF-8 buffer conversion."]
        }
      };
    }
  } catch (err: any) {
    console.error(`Extraction failed for ${originalFilename}:`, err);
    return {
      text: `Error extracting text from ${originalFilename}.`,
      metadata: {
        characterCount: 0,
        linesCount: 0,
        extractionStatus: "failed",
        issues: [err.message]
      }
    };
  }
}

function extractTxt(buffer: Buffer): ExtractedDocument {
  const text = buffer.toString("utf8");
  const lines = text.split("\n");
  const words = text.split(/\s+/).filter(Boolean);
  
  return {
    text,
    metadata: {
      wordCount: words.length,
      characterCount: text.length,
      linesCount: lines.length,
      extractionStatus: "success"
    }
  };
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

  const words = text.split(/\s+/).filter(Boolean);
  return {
    text: formattedText,
    metadata: {
      wordCount: words.length,
      characterCount: formattedText.length,
      linesCount: lines.length,
      extractionStatus: "success"
    }
  };
}

// DOCX parsing by inspecting core XML directly if zipped
function extractDocx(buffer: Buffer): ExtractedDocument {
  try {
    // DOCX is a zip. Let's do a fast XML text extract if we can.
    // In node, we can search for word/document.xml tags or paragraphs.
    const textContent = buffer.toString("utf8");
    // Search for text chunks in standard paragraphs <w:t>...</w:t>
    const matches = textContent.match(/<w:t[^>]*>(.*?)<\/w:t>/g);
    if (matches && matches.length > 0) {
      const extracted = matches.map(m => m.replace(/<[^>]+>/g, "")).join(" ");
      return {
        text: extracted,
        metadata: {
          wordCount: extracted.split(/\s+/).length,
          characterCount: extracted.length,
          linesCount: Math.ceil(extracted.length / 80),
          extractionStatus: "success"
        }
      };
    }
    
    // Fallback: If zipped binary, we can scan for ASCII characters matching requirements
    const asciiText = buffer.toString("ascii").replace(/[^\x20-\x7E\n\r\t]/g, " ");
    const words = asciiText.split(/\s+/).filter(w => w.length > 3 && w.length < 20);
    const cleanedText = words.slice(0, 500).join(" ");
    
    return {
      text: cleanedText || "DOCX binary parsed. Found no standard XML text matches.",
      metadata: {
        characterCount: cleanedText.length,
        linesCount: 1,
        extractionStatus: "warning",
        issues: ["Zipped DOCX XML not directly accessible in standard stream. Scanned ascii bytes."]
      }
    };
  } catch (err: any) {
    return {
      text: "DOCX Extraction Fallback Placeholder",
      metadata: {
        characterCount: 36,
        linesCount: 1,
        extractionStatus: "warning",
        issues: [err.message]
      }
    };
  }
}

// XLSX parsing by extracting cell values and strings from buffer
function extractXlsx(buffer: Buffer): ExtractedDocument {
  try {
    const textContent = buffer.toString("utf8");
    const matches = textContent.match(/<v[^>]*>(.*?)<\/v>/g);
    if (matches && matches.length > 0) {
      const extracted = matches.map(m => m.replace(/<[^>]+>/g, "")).join(", ");
      return {
        text: `Excel Spreadsheet Values: ${extracted}`,
        metadata: {
          characterCount: extracted.length,
          linesCount: 1,
          extractionStatus: "success"
        }
      };
    }

    // Fallback ascii scan
    const asciiText = buffer.toString("ascii").replace(/[^\x20-\x7E\t\n]/g, " ");
    const filteredWords = asciiText.split(/\s+/).filter(w => w.length > 2 && w.length < 15);
    const cleanedText = filteredWords.slice(0, 400).join(" ");

    return {
      text: cleanedText || "XLSX spreadsheet data scanned.",
      metadata: {
        characterCount: cleanedText.length,
        linesCount: 1,
        extractionStatus: "warning",
        issues: ["Excel XML nodes not fully parsed. Extracted string sequences."]
      }
    };
  } catch (err: any) {
    return {
      text: "XLSX Extraction Fallback Placeholder",
      metadata: {
        characterCount: 36,
        linesCount: 1,
        extractionStatus: "warning",
        issues: [err.message]
      }
    };
  }
}

// PDF text extractor scanning standard PDF text blocks
function extractPdf(buffer: Buffer, filename: string): ExtractedDocument {
  try {
    const rawPdf = buffer.toString("binary");
    
    // PDF text is often contained within parentheses (Text) Tj or ['Text'] TJ or /F1 etc.
    // Let's do a highly robust regex scan for text streams
    const streamRegex = /\(([^)]+)\)\s*Tj/g;
    let match;
    const textParts: string[] = [];
    
    while ((match = streamRegex.exec(rawPdf)) !== null) {
      const cleanPart = match[1].replace(/\\([0-7]{3})/g, (m, octal) => {
        return String.fromCharCode(parseInt(octal, 8));
      }).replace(/\\/g, "");
      if (cleanPart.trim().length > 1) {
        textParts.push(cleanPart);
      }
    }

    if (textParts.length > 0) {
      const extracted = textParts.join(" ");
      return {
        text: extracted,
        metadata: {
          pages: 1,
          wordCount: extracted.split(/\s+/).length,
          characterCount: extracted.length,
          linesCount: Math.ceil(textParts.length / 5),
          extractionStatus: "success"
        }
      };
    }

    // Alternative match for TJ arrays e.g. [ (Te) 10 (xt) ] TJ
    const arrayRegex = /\[\s*(.*?)\s*\]\s*TJ/g;
    const textParts2: string[] = [];
    while ((match = arrayRegex.exec(rawPdf)) !== null) {
      const innerTextRegex = /\(([^)]+)\)/g;
      let innerMatch;
      while ((innerMatch = innerTextRegex.exec(match[1])) !== null) {
        textParts2.push(innerMatch[1]);
      }
    }

    if (textParts2.length > 0) {
      const extracted = textParts2.join(" ");
      return {
        text: extracted,
        metadata: {
          pages: 1,
          wordCount: extracted.split(/\s+/).length,
          characterCount: extracted.length,
          linesCount: Math.ceil(textParts2.length / 5),
          extractionStatus: "success"
        }
      };
    }

    // Default to scanning printable characters if streams are compressed/obfuscated
    const printableOnly = rawPdf.replace(/[^\x20-\x7E\n\r\t]/g, " ");
    const words = printableOnly.split(/\s+/).filter(w => w.length > 3 && w.length < 15 && /^[a-zA-Z]+$/.test(w));
    const cleanWordStream = words.slice(0, 300).join(" ");

    return {
      text: cleanWordStream || `PDF parsed. Metadata matches: ${filename}`,
      metadata: {
        pages: 1,
        characterCount: cleanWordStream.length,
        linesCount: 1,
        extractionStatus: "warning",
        issues: ["PDF streams are compressed. Performed character heuristics scan."]
      }
    };
  } catch (err: any) {
    return {
      text: `PDF stream extraction fallback: ${filename}`,
      metadata: {
        characterCount: filename.length,
        linesCount: 1,
        extractionStatus: "warning",
        issues: [err.message]
      }
    };
  }
}
