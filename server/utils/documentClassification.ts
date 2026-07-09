import { prisma } from "../../src/prisma";
import { getGeminiClient } from "./gemini";
import { FACTORY_DEFAULT_CLASSIFICATION_PROMPT } from "./promptDefaults";
import { estimateCostUsd } from "./aiPricing";
import { recordAiUsage } from "../../src/aiOrchestrator";

const CLASSIFICATION_MODEL = "gemini-3.5-flash";

export interface DocumentClassification {
  document_type: string;
  confidence: number;
}

const FALLBACK: DocumentClassification = { document_type: "Other", confidence: 0 };

// Real AI-driven classification, replacing what used to be a hardcoded mimetype guess (PDF ->
// "RFP / Bid Document", anything else -> "Contract/SLA") with an always-identical fake 0.92
// confidence. Runs on every upload, so it deliberately uses Gemini (the one key required
// platform-wide) rather than going through the task->provider orchestrator built for the
// heavier document_analysis flow - this is a small, frequent, low-stakes call.
export async function classifyDocument(filename: string, extractedText: string, tenantId: string): Promise<DocumentClassification> {
  try {
    const promptRow = await prisma.promptTemplate.findFirst({ where: { type: "classification", isActive: true } });
    const instructions = promptRow?.content?.trim() || FACTORY_DEFAULT_CLASSIFICATION_PROMPT;

    const prompt = `${instructions}

FILENAME: ${filename}

EXTRACTED TEXT (first 4000 characters):
${extractedText.slice(0, 4000) || "(no text extracted)"}

Respond in Brazilian Portuguese. Respond with ONLY a JSON object matching this shape, no markdown, no extra text:
{
  "document_type": "one short label in Portuguese, e.g. 'Edital / Termo de Referência', 'Contrato/SLA', 'Especificação Técnica', 'Proposta Comercial', 'Outro'",
  "confidence": 0.0 to 1.0
}`;

    const ai = await getGeminiClient();
    const response = await ai.models.generateContent({
      model: CLASSIFICATION_MODEL,
      contents: prompt,
      config: { responseMimeType: "application/json" },
    });

    await recordAiUsage({
      tenantId,
      taskType: "document_classification",
      provider: "gemini",
      model: CLASSIFICATION_MODEL,
      estimatedCostUsd: estimateCostUsd(
        CLASSIFICATION_MODEL,
        response.usageMetadata?.promptTokenCount || 0,
        response.usageMetadata?.candidatesTokenCount || 0
      ),
    });

    const parsed = JSON.parse((response.text || "{}").trim());
    if (typeof parsed.document_type !== "string" || typeof parsed.confidence !== "number") {
      return FALLBACK;
    }
    return { document_type: parsed.document_type, confidence: Math.max(0, Math.min(1, parsed.confidence)) };
  } catch {
    // Fail-open: a classification hiccup shouldn't block the upload itself, it's metadata, not
    // the core deliverable - falls back to "Other" at zero confidence, visibly not a real guess.
    return FALLBACK;
  }
}
