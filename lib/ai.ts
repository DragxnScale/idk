import { createOpenAI } from "@ai-sdk/openai";

const apiKey = process.env.OPENAI_API_KEY;

export const openai = createOpenAI({ apiKey: apiKey ?? "" });

/** OpenAI chat model for all AI features (notes, quiz, videos, owner chat). */
export const MODEL = "gpt-5.4";

export function isAiConfigured(): boolean {
  return Boolean(apiKey);
}
