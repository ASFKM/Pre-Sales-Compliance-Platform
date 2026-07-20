import { prisma } from "../../src/prisma";
import { dbStore } from "../../src/dbStore";
import { FACTORY_DEFAULT_CLASSIFICATION_PROMPT } from "./promptDefaults";
import { estimateCostUsd } from "./aiPricing";
import { recordAiUsage, resolveProvider, recordProviderFallback } from "../../src/aiOrchestrator";
import { generateJsonWithProvider, ConnectedProvider } from "./aiProviders";
import { UNTRUSTED_DOCUMENT_WARNING } from "./promptSafety";

export interface DocumentClassification {
  document_type: string;
  confidence: number;
}

const FALLBACK: DocumentClassification = { document_type: "Other", confidence: 0 };

// Real AI-driven classification, replacing what used to be a hardcoded mimetype guess (PDF ->
// "RFP / Bid Document", anything else -> "Contract/SLA") with an always-identical fake 0.92
// confidence. Previously hardcoded to always call Gemini directly, bypassing the task->provider
// orchestrator entirely (2026-07 AI Orchestrator redesign fixed this - now routed through
// resolveProvider() like the other real task types, admin-configurable same as the rest).
export async function classifyDocument(filename: string, extractedText: string, tenantId: string): Promise<DocumentClassification> {
  try {
    const promptRow = await prisma.promptTemplate.findFirst({ where: { type: "classification", isActive: true } });
    const instructions = promptRow?.content?.trim() || FACTORY_DEFAULT_CLASSIFICATION_PROMPT;

    const prompt = `${instructions}

FILENAME: ${filename}

${UNTRUSTED_DOCUMENT_WARNING}

EXTRACTED TEXT (first 4000 characters):
${extractedText.slice(0, 4000) || "(no text extracted)"}

Respond in Brazilian Portuguese. Respond with ONLY a JSON object matching this shape, no markdown, no extra text:
{
  "document_type": "one short label in Portuguese, e.g. 'Edital / Termo de Referência', 'Contrato/SLA', 'Especificação Técnica', 'Proposta Comercial', 'Outro'",
  "confidence": 0.0 to 1.0
}`;

    const settings = await dbStore.getSettings();
    const resolution = await resolveProvider("document_classification", settings as any);
    if (resolution.isFallback) {
      await recordProviderFallback({ tenantId, taskType: "document_classification", intendedProvider: resolution.intendedProvider, userId: "system" });
    }

    const { text, inputTokens, outputTokens, billedCostUsd } = await generateJsonWithProvider(resolution.provider as ConnectedProvider, resolution.model, prompt);

    await recordAiUsage({
      tenantId,
      taskType: "document_classification",
      provider: resolution.provider,
      model: resolution.model,
      estimatedCostUsd: billedCostUsd ?? estimateCostUsd(resolution.model, inputTokens, outputTokens),
    });

    const parsed = JSON.parse(text.trim());
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
