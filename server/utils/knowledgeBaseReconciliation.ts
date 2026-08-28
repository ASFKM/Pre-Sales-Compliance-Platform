import { dbStore } from "../../src/dbStore";
import { resolveProvider, recordAiUsage } from "../../src/aiOrchestrator";
import { estimateCostUsd } from "./aiPricing";
import { generateJsonWithProvider, ConnectedProvider } from "./aiProviders";
import { extractKnowledgeBaseKeywords } from "../routes/analysis";
import { logger } from "./logger";
import { PlatformSettings } from "../../src/types";

export interface IncomingGlobalKbEntry {
  entry_id: string;
  category: string;
  trigger: string;
  knowledge: string;
}

export type ReconciliationOutcome =
  | { action: "create"; status: "approved" }
  | { action: "create"; status: "pending"; conflictNote: string }
  | { action: "skip" };

// Runs once per entry the Fleet Manager pushes down on a heartbeat, before it's persisted
// locally - checks whether it duplicates or contradicts something this tenant already has (any
// status, not just approved: a pending local entry can still be the same fact worded
// differently). Per the platform's normal rule an incoming global entry lands already `approved`;
// a real contradiction is the one carve-out, landing `pending` instead so a human resolves which
// fact is right. A plain duplicate is skipped entirely (never creates a redundant row). Never
// throws - any failure here (AI call, JSON parse) falls back to the safe default (treat as new,
// approved), consistent with the rest of the heartbeat's fail-open philosophy (see
// server/utils/fleetLicense.ts).
export async function reconcileIncomingKnowledgeEntry(
  incoming: IncomingGlobalKbEntry,
  platformSettings: PlatformSettings,
  tenantId: string,
  // F11 (docs/cdc/16, item 31): opcional de propósito - chamado pelo heartbeat (server/utils/
  // fleetLicense.ts) para entradas que chegam do Fleet Manager, sem usuário nenhum por trás; e
  // pelas rotas de sugestão/análise de server/routes/knowledgeBase.ts, com um usuário real.
  userId?: string
): Promise<ReconciliationOutcome> {
  try {
    const keywords = extractKnowledgeBaseKeywords(`${incoming.trigger} ${incoming.knowledge}`, 15);
    const candidates = await dbStore.searchKnowledgeBaseByCategory(incoming.category, keywords, 5);
    if (candidates.length === 0) {
      return { action: "create", status: "approved" };
    }

    const providerResolution = await resolveProvider("spec_copilot", platformSettings);
    const prompt = `A new knowledge base entry is about to be added. Compare it against the existing candidate entries below (same category, found via keyword overlap) and classify the relationship.

NEW ENTRY:
trigger: ${incoming.trigger}
knowledge: ${incoming.knowledge}

EXISTING CANDIDATES:
${candidates.map((c) => `- id: ${c.id}\n  trigger: ${c.trigger}\n  knowledge: ${c.knowledge}`).join("\n")}

Classify as exactly one of:
- "duplicate": the new entry says essentially the same thing as one of the candidates (same fact, same subject) - no new information.
- "contradiction": the new entry is about the same subject/situation as one of the candidates, but states a DIFFERENT fact (conflicting information).
- "distinct": the new entry is genuinely different from every candidate (only superficially similar - e.g. shares a keyword but isn't actually the same subject).

Respond with ONLY a JSON object: { "classification": "duplicate"|"contradiction"|"distinct", "conflicting_entry_id": "..." or null, "reason": "one short sentence in Portuguese" }`;

    // Up to 3 retries on an actual rate-limit error, same pattern already proven in production for
    // enrichBomWithWebSearch (server/routes/analysis.ts) - real incident, 2026-07-21: a single
    // heartbeat syncing several KB entries at once made 12 of these calls in quick succession,
    // every one hitting an OpenAI rate limit with no retry at all, each silently falling back to
    // "treat as new/approved" (safe, but skips the real duplicate/contradiction check every time
    // there's a burst). Backoff increases per attempt (20s/40s/60s) to clear a per-minute window
    // even under sustained load.
    const MAX_ATTEMPTS = 4;
    let text = "", inputTokens = 0, outputTokens = 0, billedCostUsd: number | undefined;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        ({ text, inputTokens, outputTokens, billedCostUsd } = await generateJsonWithProvider(providerResolution.provider as ConnectedProvider, providerResolution.model, prompt));
        break;
      } catch (aiErr: any) {
        const isRateLimit = aiErr?.status === 429 || /rate.?limit|429/i.test(String(aiErr?.message || ""));
        if (isRateLimit && attempt < MAX_ATTEMPTS - 1) {
          logger.warn({ err: aiErr, tenantId, entryId: incoming.entry_id, attempt }, "Knowledge base reconciliation rate-limited, retrying");
          await new Promise((resolve) => setTimeout(resolve, 20000 * (attempt + 1)));
          continue;
        }
        throw aiErr;
      }
    }
    await recordAiUsage({
      tenantId,
      taskType: "kb_reconciliation",
      provider: providerResolution.provider,
      model: providerResolution.model,
      estimatedCostUsd: billedCostUsd ?? estimateCostUsd(providerResolution.model, inputTokens, outputTokens),
      userId,
    });

    const fenceMatch = text.match(/```json\s*([\s\S]*?)```/);
    const rawJson = fenceMatch ? fenceMatch[1] : text.slice(text.indexOf("{"));
    const parsed: { classification: "duplicate" | "contradiction" | "distinct"; conflicting_entry_id: string | null; reason: string } = JSON.parse(rawJson.trim());

    if (parsed.classification === "duplicate") {
      return { action: "skip" };
    }
    if (parsed.classification === "contradiction") {
      const conflictNote = `[Conflita com entrada existente${parsed.conflicting_entry_id ? ` ${parsed.conflicting_entry_id}` : ""}: ${parsed.reason}] `;
      return { action: "create", status: "pending", conflictNote };
    }
    return { action: "create", status: "approved" };
  } catch (err) {
    logger.warn({ err, tenantId, entryId: incoming.entry_id }, "Knowledge base reconciliation check failed, treating as new/approved");
    return { action: "create", status: "approved" };
  }
}
