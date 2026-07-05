import { GoogleGenAI } from "@google/genai";
import { dbStore } from "../../src/dbStore";
import { decryptSecret } from "./security";

let aiClient: GoogleGenAI | null = null;
let aiClientFingerprint = "";

export async function getConfiguredGeminiApiKey(): Promise<string> {
  const envKey = [
    process.env.GEMINI_API_KEY,
    process.env.GOOGLE_API_KEY,
    process.env.GOOGLE_GENERATIVE_AI_API_KEY
  ].find((key) => typeof key === "string" && key.trim().length > 0)?.trim();

  if (envKey) return envKey;

  const settings = await dbStore.getSettings() as any;
  const encryptedKey = settings.ai_api_key_encrypted;
  if (!encryptedKey) {
    throw new Error("Gemini API key is not configured. Configure it in Admin > IA, Prompts e Custos.");
  }

  return decryptSecret(encryptedKey);
}

export async function getGeminiClient(): Promise<GoogleGenAI> {
  const key = await getConfiguredGeminiApiKey();
  const fingerprint = `${key.length}:${key.slice(0, 4)}:${key.slice(-4)}`;

  if (!aiClient || aiClientFingerprint !== fingerprint) {
    aiClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: { "User-Agent": "aistudio-build" }
      }
    });
    aiClientFingerprint = fingerprint;
  }

  return aiClient;
}
