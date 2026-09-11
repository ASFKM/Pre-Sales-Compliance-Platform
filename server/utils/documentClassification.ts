import { prisma } from "../../src/prisma";
import { dbStore } from "../../src/dbStore";
import { FACTORY_DEFAULT_CLASSIFICATION_PROMPT } from "./promptDefaults";
import { estimateCostUsd } from "./aiPricing";
import { recordAiUsage, resolveProvider, recordProviderFallback } from "../../src/aiOrchestrator";
import { generateJsonWithProvider, buildActorRef, AiTriggerType } from "./aiProviders";
import type { ConnectedProvider } from "./aiProviders";
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
// F4 (rodada 09/2026): `triggerType` e obrigatorio e vem de fora porque esta funcao tem dois
// chamadores com gatilhos genuinamente diferentes - o upload de documento (server/routes/
// documents.ts) roda com o usuario esperando a resposta, e a confirmacao da intake
// (server/routes/projectIntake.ts) roda no trabalho de fundo que ja respondeu 202. Um valor fixo
// aqui faria metade das linhas de consumo do CMSaaS mentirem sobre a origem.
export async function classifyDocument(filename: string, extractedText: string, tenantId: string, userId: string | undefined, triggerType: AiTriggerType): Promise<DocumentClassification> {
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

    const { text, inputTokens, outputTokens, billedCostUsd } = await generateJsonWithProvider(resolution.provider as ConnectedProvider, resolution.model, prompt, { taskKey: "document_classification", actorRef: buildActorRef("user", userId), triggerType });

    await recordAiUsage({
      tenantId,
      taskType: "document_classification",
      provider: resolution.provider,
      model: resolution.model,
      estimatedCostUsd: billedCostUsd ?? estimateCostUsd(resolution.model, inputTokens, outputTokens),
      userId,
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
