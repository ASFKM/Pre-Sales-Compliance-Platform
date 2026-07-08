import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { dbStore } from "../../src/dbStore";
import { decryptSecret } from "./security";
import { getGeminiClient } from "./gemini";

export type ConnectedProvider = "gemini" | "openai" | "anthropic";

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
    if (provider === "gemini") return true; // Gemini's key is required platform-wide already.
    if (provider === "openai") return Boolean(await getConfiguredOpenAiApiKey().catch(() => null));
    if (provider === "anthropic") return Boolean(await getConfiguredAnthropicApiKey().catch(() => null));
    return false;
  } catch {
    return false;
  }
}

export interface ProviderJsonResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
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
// text a local extractor can ever recover; Gemini/Anthropic read the document directly via native
// vision/OCR instead. OpenAI's Chat Completions API has no PDF support at all (image only).
export async function generateJsonWithProvider(provider: ConnectedProvider, model: string, prompt: string, files?: ProviderFileInput[]): Promise<ProviderJsonResult> {
  if (provider === "openai") {
    if (files?.some((f) => f.mimeType === "application/pdf")) {
      throw new Error("OpenAI não aceita PDF para esta tarefa. Troque o serviço de IA desta tarefa para Gemini ou Anthropic em Admin > IA, Prompts e Custos.");
    }
    const apiKey = await getConfiguredOpenAiApiKey();
    const client = new OpenAI({ apiKey });
    const content: any[] = [{ type: "text", text: prompt }];
    for (const f of files || []) {
      content.push({ type: "image_url", image_url: { url: `data:${f.mimeType};base64,${f.base64Data}` } });
    }
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
      // The analysis schema (critical_requirements/risks/opportunities/bom/point_to_point_table
      // arrays, two full proposal drafts) can genuinely need more than 8192 tokens of output for a
      // real, detailed source document - confirmed truncating mid-response ("Unterminated string
      // in JSON") on a real 48-page tender document.
      max_tokens: 32000,
      messages: [{ role: "user", content }],
    });
    const response = await stream.finalMessage();
    const textBlock = response.content.find((block) => block.type === "text");
    return {
      text: textBlock && "text" in textBlock ? textBlock.text : "{}",
      inputTokens: response.usage?.input_tokens || 0,
      outputTokens: response.usage?.output_tokens || 0,
    };
  }

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
