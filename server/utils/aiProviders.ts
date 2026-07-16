import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { dbStore } from "../../src/dbStore";
import { prisma } from "../../src/prisma";
import { redis } from "../../src/redis";
import { getCurrentTenantId } from "../../src/tenantContext";
import { decryptSecret } from "./security";
import { getGeminiClient } from "./gemini";
import { logger } from "./logger";

// The 3 built-in providers keep their own bespoke handling below (vision input, streaming, native
// web search tools). Anything else is treated as a user-added, OpenAI-compatible custom provider
// (see AiProviderConfig) - a string, not a fixed union, since the whole point is that new ones can
// be added without a code change.
export type ConnectedProvider = string;

// ia_kb add-on: whether the current tenant's AI calls should route through the Fleet Manager's
// proxy (server/routes/aiProxy.ts on that side) instead of a locally-held key. Reads the same
// Redis cache server/utils/fleetLicense.ts populates on every heartbeat, but deliberately WITHOUT
// verifying the Ed25519 signature that module does - importing fleetLicense.ts here would create
// a circular import (fleetLicense.ts -> knowledgeBaseReconciliation.ts -> aiProviders.ts already
// exists). This is safe despite skipping verification: the real enforcement boundary is the Fleet
// Manager's own requireIaKbEntitlement middleware, which re-checks ModuleEntitlement in its own
// database on every single proxied call regardless of what this tenant's local cache claims - a
// tampered/stale local cache can at worst cause a proxy call to be correctly rejected by the
// Fleet Manager, never an unauthorized one to succeed.
export async function isIaKbActive(): Promise<boolean> {
  const tenantId = getCurrentTenantId();
  if (!tenantId) return false;
  try {
    const raw = await redis.get(`fleet:license:${tenantId}`);
    if (!raw) return false;
    const cached = JSON.parse(raw);
    return Array.isArray(cached?.payload?.modules) && cached.payload.modules.includes("ia_kb");
  } catch {
    return false;
  }
}

async function getFleetManagerProxyConfig(): Promise<{ baseUrl: string; apiKey: string }> {
  const settings = await dbStore.getSettings();
  if (!settings.fleet_manager_url || !settings.fleet_manager_api_key_encrypted) {
    throw new Error("O add-on IA/KB está ativo, mas a conexão com o Fleet Manager não está configurada corretamente. Contate o suporte.");
  }
  return { baseUrl: settings.fleet_manager_url, apiKey: decryptSecret(settings.fleet_manager_api_key_encrypted) };
}

// Single call point for all 3 ai-proxy endpoints on the Fleet Manager side - taskType is a
// best-effort category (one of the 3 dispatch functions below, not the caller's real task_key,
// since generateJsonWithProvider/generateTextWithProvider/searchWebWithProvider deliberately keep
// their existing signatures unchanged - see the plan this add-on was built from) so the Fleet
// Manager's own AiProxyUsageLog still has SOME breakdown to show an admin, even without full
// per-task granularity.
async function callFleetManagerAiProxy(
  endpoint: "generate-json" | "generate-text" | "search-web",
  taskType: string,
  provider: string,
  model: string,
  prompt: string,
  files?: ProviderFileInput[]
): Promise<ProviderJsonResult> {
  const { baseUrl, apiKey } = await getFleetManagerProxyConfig();
  const res = await fetch(`${baseUrl}/api/ai-proxy/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      task_type: taskType,
      provider,
      model,
      prompt,
      files: (files || []).map((f) => ({ mime_type: f.mimeType, base64_data: f.base64Data })),
    }),
    // Mirrors the real provider calls below (Anthropic alone documents needing minutes on a large
    // document) - the proxy adds one network hop but not meaningfully more latency than calling
    // the provider directly would. Raised from 150s alongside the proxy's own MAX_OUTPUT_TOKENS
    // bump (server/utils/aiProxyClient.ts on the Fleet Manager side, 32768) - a real analysis
    // genuinely needing that much output can take longer than 150s to finish generating, and was
    // timing out here (confirmed via production logs) even after the truncation bug itself was
    // fixed. Stays above the Fleet Manager's own internal timeout so its clearer, cause-specific
    // error reaches the caller instead of this generic AbortSignal firing first.
    signal: AbortSignal.timeout(300_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    throw new Error(data?.message || `Falha ao chamar o proxy de IA do Fleet Manager (HTTP ${res.status}).`);
  }
  return {
    text: data.text || "",
    inputTokens: data.input_tokens || 0,
    outputTokens: data.output_tokens || 0,
    billedCostUsd: typeof data.billed_cost_usd === "number" ? data.billed_cost_usd : undefined,
  };
}

async function getCustomProviderConfig(providerKey: string): Promise<{ baseUrl: string; apiKey: string; supportsVision: boolean; supportsWebSearch: boolean }> {
  const config = await prisma.aiProviderConfig.findFirst({ where: { providerKey } });
  if (!config) {
    throw new Error(`AI provider "${providerKey}" is not configured. Add it in Admin > IA, Prompts e Custos > Provedores Personalizados.`);
  }
  return {
    baseUrl: config.baseUrl,
    apiKey: decryptSecret(config.apiKeyEncrypted),
    supportsVision: config.supportsVision,
    supportsWebSearch: config.supportsWebSearch,
  };
}

// OpenAI's file-input content block: images still use the "image_url" shape (unchanged, vision
// has worked for a while), but PDF needs "type": "file" with a data URI - added to the Chat
// Completions API in ~March 2026 (see developers.openai.com/api/docs/guides/file-inputs). This was
// previously hard-blocked here as unsupported, which was correct when that block was written and
// is no longer correct - kept as one shared builder since OpenAI-compatible custom providers
// (declared supportsVision) use the identical request shape.
function buildOpenAiCompatibleFileBlocks(files: ProviderFileInput[]): any[] {
  return files.map((f, idx) =>
    f.mimeType === "application/pdf"
      ? { type: "file", file: { filename: `document-${idx + 1}.pdf`, file_data: `data:${f.mimeType};base64,${f.base64Data}` } }
      : { type: "image_url", image_url: { url: `data:${f.mimeType};base64,${f.base64Data}` } }
  );
}

async function getConfiguredOpenAiApiKey(): Promise<string> {
  const envKey = process.env.OPENAI_API_KEY?.trim();
  if (envKey) return envKey;

  const settings = await dbStore.getSettings() as any;
  const encryptedKey = settings.openai_api_key_encrypted;
  if (!encryptedKey) {
    throw new Error("OpenAI API key is not configured. Configure it in Admin > IA, Prompts e Custos.");
  }
  return decryptSecret(encryptedKey);
}

async function getConfiguredAnthropicApiKey(): Promise<string> {
  const envKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (envKey) return envKey;

  const settings = await dbStore.getSettings() as any;
  const encryptedKey = settings.anthropic_api_key_encrypted;
  if (!encryptedKey) {
    throw new Error("Anthropic API key is not configured. Configure it in Admin > IA, Prompts e Custos.");
  }
  return decryptSecret(encryptedKey);
}

// Whether a given provider actually has a usable, configured key right now - used by
// src/aiOrchestrator.ts to decide whether an intended provider should really be used or the
// call should fall back to Gemini instead.
export async function isProviderConnected(provider: string): Promise<boolean> {
  try {
    // With the ia_kb add-on active, the tenant's own keys were cleared on activation (see
    // fleetLicense.ts) and every call for the 3 built-ins routes through the Fleet Manager's
    // proxy instead - they're "connected" via the add-on, not a locally-held key, so
    // resolveProvider()'s fallback-to-Gemini logic must not treat Anthropic/OpenAI as
    // unconfigured just because those fields are now empty on purpose.
    if ((provider === "gemini" || provider === "openai" || provider === "anthropic") && (await isIaKbActive())) {
      return true;
    }
    if (provider === "gemini") return true; // Gemini's key is required platform-wide already.
    if (provider === "openai") return Boolean(await getConfiguredOpenAiApiKey().catch(() => null));
    if (provider === "anthropic") return Boolean(await getConfiguredAnthropicApiKey().catch(() => null));
    return Boolean(await prisma.aiProviderConfig.findFirst({ where: { providerKey: provider } }));
  } catch {
    return false;
  }
}

export interface ProviderJsonResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  // Set only when this call was routed through the Fleet Manager's ia_kb proxy - the actual
  // amount billed to the tenant (real provider cost + markup), computed there since the markup
  // percentage and the CMSaaS's own pricing table must never be exposed to the Presales side.
  // Callers must prefer this over a local estimateCostUsd() re-estimate whenever it's present,
  // since a local estimate never includes the markup and always understates what was billed.
  billedCostUsd?: number;
}

export interface ProviderFileInput {
  mimeType: string;
  base64Data: string;
}

// Single JSON-generating entry point across all three connected providers - callers always get
// back raw text they can JSON.parse (plus real token usage, for real cost tracking - see
// aiPricing.ts), regardless of which provider actually served the request. `files` lets a caller
// hand over real document binaries (PDF/image) instead of pre-extracted text - needed because some
// real-world PDFs (scanned documents, or ones using a font encoding with no ToUnicode map) have no
// text a local extractor can ever recover; all three providers read the document directly via
// native vision/OCR instead (OpenAI's Chat Completions API gained real PDF support in ~March
// 2026, via the "file" content block - it was correctly unsupported when this comment last said
// otherwise, it no longer is).
export async function generateJsonWithProvider(provider: ConnectedProvider, model: string, prompt: string, files?: ProviderFileInput[]): Promise<ProviderJsonResult> {
  if ((provider === "gemini" || provider === "openai" || provider === "anthropic") && (await isIaKbActive())) {
    return callFleetManagerAiProxy("generate-json", "document_json", provider, model, prompt, files);
  }

  if (provider === "openai") {
    const apiKey = await getConfiguredOpenAiApiKey();
    const client = new OpenAI({ apiKey });
    const content: any[] = [{ type: "text", text: prompt }, ...buildOpenAiCompatibleFileBlocks(files || [])];
    const response = await client.chat.completions.create({
      model,
      messages: [{ role: "user", content }],
      response_format: { type: "json_object" },
    });
    return {
      text: response.choices[0]?.message?.content || "{}",
      inputTokens: response.usage?.prompt_tokens || 0,
      outputTokens: response.usage?.completion_tokens || 0,
    };
  }

  if (provider === "anthropic") {
    const apiKey = await getConfiguredAnthropicApiKey();
    const client = new Anthropic({ apiKey });
    const content: any[] = [];
    for (const f of files || []) {
      if (f.mimeType === "application/pdf") {
        content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: f.base64Data } });
      } else {
        content.push({ type: "image", source: { type: "base64", media_type: f.mimeType, data: f.base64Data } });
      }
    }
    content.push({ type: "text", text: `${prompt}\n\nRespond with ONLY a single valid JSON object - no markdown, no code fences, no extra text.` });
    // Streamed rather than a plain create() call - the Anthropic SDK requires streaming for any
    // request that might run past 10 minutes (confirmed hit on a real 48-page tender document
    // with a large output), and .stream().finalMessage() reassembles the same Message shape a
    // plain create() would return, so nothing else below needs to change.
    const stream = client.messages.stream({
      model,
      // The full analysis schema (critical_requirements/risks/opportunities/bom/multiple
      // discipline-specific point-to-point matrices, clarification questions, two full proposal
      // drafts) genuinely needs a large output budget for a real, detailed source document -
      // 32000 still truncated mid-response ("Unterminated string in JSON") on a real government
      // tender once the full schema (not a stripped-down test schema) was requested. Raised to
      // 64000, the documented ceiling for this model family.
      max_tokens: 64000,
      messages: [{ role: "user", content }],
    });
    const response = await stream.finalMessage();
    const textBlock = response.content.find((block) => block.type === "text");
    if (response.stop_reason === "max_tokens") {
      logger.warn({ outputTokens: response.usage?.output_tokens }, "Anthropic response hit max_tokens - JSON is likely truncated");
    }
    return {
      text: textBlock && "text" in textBlock ? textBlock.text : "{}",
      inputTokens: response.usage?.input_tokens || 0,
      outputTokens: response.usage?.output_tokens || 0,
    };
  }

  if (provider === "gemini") {
    const ai = await getGeminiClient();
    const parts: any[] = [{ text: prompt }];
    for (const f of files || []) {
      parts.push({ inlineData: { mimeType: f.mimeType, data: f.base64Data } });
    }
    const response = await ai.models.generateContent({
      model,
      contents: [{ role: "user", parts }],
      config: { responseMimeType: "application/json" },
    });
    return {
      text: response.text || "{}",
      inputTokens: response.usageMetadata?.promptTokenCount || 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount || 0,
    };
  }

  // User-added custom provider (Grok/xAI, DeepSeek, Mistral AI, Perplexity, or any other
  // OpenAI-compatible endpoint) - dispatched generically via the `openai` SDK pointed at the
  // provider's own base URL, since all of them mirror OpenAI's chat completions request/response
  // shape including JSON mode. This is what makes adding a new provider a config-only action, no
  // code change. File input is only attempted if the admin declared supportsVision when adding
  // this provider (most custom providers genuinely don't support it - reusing OpenAI's own
  // "file"/"image_url" content block shape only for the ones self-declared as OpenAI-compatible
  // enough to also handle it).
  const { baseUrl, apiKey, supportsVision } = await getCustomProviderConfig(provider);
  if (files?.length && !supportsVision) {
    throw new Error("Este provedor não suporta envio de arquivo/visão. Marque \"Suporta PDF/visão\" ao configurá-lo (se for realmente compatível) ou troque este serviço para Gemini, Anthropic ou OpenAI em Admin > IA, Prompts e Custos.");
  }
  const client = new OpenAI({ apiKey, baseURL: baseUrl });
  const content: any = files?.length ? [{ type: "text", text: prompt }, ...buildOpenAiCompatibleFileBlocks(files)] : prompt;
  const response = await client.chat.completions.create({
    model,
    messages: [{ role: "user", content }],
    response_format: { type: "json_object" },
  });
  return {
    text: response.choices[0]?.message?.content || "{}",
    inputTokens: response.usage?.prompt_tokens || 0,
    outputTokens: response.usage?.completion_tokens || 0,
  };
}

// Same provider dispatch as generateJsonWithProvider, but for conversational free-text
// answers (the spec copilot chat) - no forced JSON response format/instruction, since a JSON
// object isn't what a chat answer should look like. `files` lets the copilot answer questions
// about vision-only documents (scanned PDFs with no extractable text) the same way the main
// analysis pipeline does, instead of only ever seeing pre-extracted text.
export async function generateTextWithProvider(provider: ConnectedProvider, model: string, prompt: string, files?: ProviderFileInput[]): Promise<ProviderJsonResult> {
  if ((provider === "gemini" || provider === "openai" || provider === "anthropic") && (await isIaKbActive())) {
    return callFleetManagerAiProxy("generate-text", "chat_text", provider, model, prompt, files);
  }

  if (provider === "openai") {
    const apiKey = await getConfiguredOpenAiApiKey();
    const client = new OpenAI({ apiKey });
    const content: any[] = [{ type: "text", text: prompt }, ...buildOpenAiCompatibleFileBlocks(files || [])];
    const response = await client.chat.completions.create({
      model,
      messages: [{ role: "user", content }],
    });
    return {
      text: response.choices[0]?.message?.content || "",
      inputTokens: response.usage?.prompt_tokens || 0,
      outputTokens: response.usage?.completion_tokens || 0,
    };
  }

  if (provider === "anthropic") {
    const apiKey = await getConfiguredAnthropicApiKey();
    const client = new Anthropic({ apiKey });
    const content: any[] = [];
    for (const f of files || []) {
      if (f.mimeType === "application/pdf") {
        content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: f.base64Data } });
      } else {
        content.push({ type: "image", source: { type: "base64", media_type: f.mimeType, data: f.base64Data } });
      }
    }
    content.push({ type: "text", text: prompt });
    const stream = client.messages.stream({
      model,
      max_tokens: 4096,
      messages: [{ role: "user", content }],
    });
    const response = await stream.finalMessage();
    const textBlock = response.content.find((block) => block.type === "text");
    return {
      text: textBlock && "text" in textBlock ? textBlock.text : "",
      inputTokens: response.usage?.input_tokens || 0,
      outputTokens: response.usage?.output_tokens || 0,
    };
  }

  if (provider === "gemini") {
    const ai = await getGeminiClient();
    const parts: any[] = [{ text: prompt }];
    for (const f of files || []) {
      parts.push({ inlineData: { mimeType: f.mimeType, data: f.base64Data } });
    }
    const response = await ai.models.generateContent({
      model,
      contents: [{ role: "user", parts }],
    });
    return {
      text: response.text || "",
      inputTokens: response.usageMetadata?.promptTokenCount || 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount || 0,
    };
  }

  const { baseUrl, apiKey, supportsVision } = await getCustomProviderConfig(provider);
  if (files?.length && !supportsVision) {
    throw new Error("Este provedor não suporta envio de arquivo/visão. Marque \"Suporta PDF/visão\" ao configurá-lo (se for realmente compatível) ou troque este serviço para Gemini, Anthropic ou OpenAI em Admin > IA, Prompts e Custos.");
  }
  const client = new OpenAI({ apiKey, baseURL: baseUrl });
  const content: any = files?.length ? [{ type: "text", text: prompt }, ...buildOpenAiCompatibleFileBlocks(files)] : prompt;
  const response = await client.chat.completions.create({
    model,
    messages: [{ role: "user", content }],
  });
  return {
    text: response.choices[0]?.message?.content || "",
    inputTokens: response.usage?.prompt_tokens || 0,
    outputTokens: response.usage?.completion_tokens || 0,
  };
}

// Real web search, not the model's own training-data guess - used for the BOM's part-number
// lookup (web_grounding task). All three built-in providers now have a real path: Gemini
// (googleSearch tool) and Anthropic (web_search tool) run search as an opt-in tool; OpenAI has no
// such tool on Chat Completions, but its dedicated gpt-5-search-api model always searches before
// answering, enabled via the top-level web_search_options param instead of a tools array - the
// orchestrator UI only offers this one model for OpenAI + web_grounding, so no extra validation
// is needed here. Custom providers only reach the search path if self-declared supportsWebSearch
// when added (e.g. Perplexity Sonar, which - like OpenAI's search model - always grounds its
// answer in a real search, no opt-in parameter needed on this end).
export async function searchWebWithProvider(provider: ConnectedProvider, model: string, prompt: string): Promise<ProviderJsonResult> {
  if ((provider === "gemini" || provider === "openai" || provider === "anthropic") && (await isIaKbActive())) {
    return callFleetManagerAiProxy("search-web", "web_search", provider, model, prompt);
  }

  if (provider === "openai") {
    const apiKey = await getConfiguredOpenAiApiKey();
    const client = new OpenAI({ apiKey });
    const response = await client.chat.completions.create({
      model,
      web_search_options: {},
      messages: [{ role: "user", content: prompt }],
    } as any);
    return {
      text: response.choices[0]?.message?.content || "",
      inputTokens: response.usage?.prompt_tokens || 0,
      outputTokens: response.usage?.completion_tokens || 0,
    };
  }

  if (provider !== "anthropic" && provider !== "gemini") {
    const { baseUrl, apiKey, supportsWebSearch } = await getCustomProviderConfig(provider);
    if (!supportsWebSearch) {
      throw new Error("Este provedor não possui ferramenta de busca web. Marque \"Suporta busca web\" ao configurá-lo (se for realmente compatível, ex: Perplexity Sonar) ou troque o serviço 'Pesquisa com Grounding Web' para Gemini, Anthropic ou OpenAI em Admin > IA, Prompts e Custos.");
    }
    const client = new OpenAI({ apiKey, baseURL: baseUrl });
    const response = await client.chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }],
    });
    return {
      text: response.choices[0]?.message?.content || "",
      inputTokens: response.usage?.prompt_tokens || 0,
      outputTokens: response.usage?.completion_tokens || 0,
    };
  }

  if (provider === "anthropic") {
    const apiKey = await getConfiguredAnthropicApiKey();
    const client = new Anthropic({ apiKey });
    const stream = client.messages.stream({
      model,
      max_tokens: 8192,
      // allowed_callers is required by the API for models that don't support programmatic tool
      // calling (e.g. the Haiku family) - without it, every request 400s with "does not support
      // programmatic tool calling" and this whole function throws, silently failing 100% of BOM
      // enrichment attempts whenever Admin > IA's "Web Grounding" provider is set to such a model
      // (confirmed: zero successful bom_web_search entries in ai_usage_logs despite real, relevant
      // approved Knowledge Base entries existing for both test projects).
      tools: [{ type: "web_search_20260318", name: "web_search", allowed_callers: ["direct"] }] as any,
      messages: [{ role: "user", content: prompt }],
    });
    const response = await stream.finalMessage();
    const textBlocks = response.content.filter((block) => block.type === "text");
    return {
      text: textBlocks.map((b) => ("text" in b ? b.text : "")).join("\n"),
      inputTokens: response.usage?.input_tokens || 0,
      outputTokens: response.usage?.output_tokens || 0,
    };
  }

  const ai = await getGeminiClient();
  const response = await ai.models.generateContent({
    model,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: { tools: [{ googleSearch: {} }] },
  });
  return {
    text: response.text || "",
    inputTokens: response.usageMetadata?.promptTokenCount || 0,
    outputTokens: response.usageMetadata?.candidatesTokenCount || 0,
  };
}
