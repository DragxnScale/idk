import { createOpenAI } from "@ai-sdk/openai";

const apiKey = process.env.OPENAI_API_KEY;

export const openai = createOpenAI({ apiKey: apiKey ?? "" });

export const MODEL = "gpt-4o-mini";

export function isAiConfigured(): boolean {
  return Boolean(apiKey);
}
