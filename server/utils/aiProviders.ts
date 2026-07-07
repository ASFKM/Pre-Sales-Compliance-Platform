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

// Single JSON-generating entry point across all three connected providers - callers always get
// back raw text they can JSON.parse, regardless of which provider actually served the request.
export async function generateJsonWithProvider(provider: ConnectedProvider, model: string, prompt: string): Promise<string> {
  if (provider === "openai") {
    const apiKey = await getConfiguredOpenAiApiKey();
    const client = new OpenAI({ apiKey });
    const response = await client.chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    });
    return response.choices[0]?.message?.content || "{}";
  }

  if (provider === "anthropic") {
    const apiKey = await getConfiguredAnthropicApiKey();
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model,
      max_tokens: 8192,
      messages: [{ role: "user", content: `${prompt}\n\nRespond with ONLY a single valid JSON object - no markdown, no code fences, no extra text.` }],
    });
    const textBlock = response.content.find((block) => block.type === "text");
    return textBlock && "text" in textBlock ? textBlock.text : "{}";
  }

  const ai = await getGeminiClient();
  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: { responseMimeType: "application/json" },
  });
  return response.text || "{}";
}
