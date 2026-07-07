// Approximate public per-token pricing (USD per 1M tokens) for the models this platform can be
// configured to use. Real published list prices as of mid-2026, not metered/billed by the
// provider in real time - close enough to replace the flat hardcoded cost estimate that used to
// be recorded on every single AI call regardless of what actually ran.
interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
}

const PRICING: Record<string, ModelPricing> = {
  "gemini-3.5-flash": { inputPer1M: 0.10, outputPer1M: 0.40 },
  "gemini-2.5-flash": { inputPer1M: 0.10, outputPer1M: 0.40 },
  "gemini-2.5-pro": { inputPer1M: 1.25, outputPer1M: 10.0 },
  "gpt-4o": { inputPer1M: 2.5, outputPer1M: 10.0 },
  "gpt-4o-mini": { inputPer1M: 0.15, outputPer1M: 0.60 },
  "claude-sonnet-5": { inputPer1M: 3.0, outputPer1M: 15.0 },
  "claude-haiku-4-5": { inputPer1M: 0.80, outputPer1M: 4.0 },
};

const DEFAULT_PRICING: ModelPricing = { inputPer1M: 0.5, outputPer1M: 2.0 };

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = PRICING[model] || DEFAULT_PRICING;
  const cost = (inputTokens / 1_000_000) * pricing.inputPer1M + (outputTokens / 1_000_000) * pricing.outputPer1M;
  return Math.round(cost * 1_000_000) / 1_000_000;
}
