// lib/ai/fireworks.ts
import OpenAI from "openai";

// Fireworks is OpenAI-API-compatible.
// Instead of a Fireworks-specific SDK, we just point the OpenAI client
// at Fireworks' base URL. Same interface, different models and pricing.

if (!process.env.FIREWORKS_API_KEY) {
  throw new Error(
    "FIREWORKS_API_KEY is not set. Add it to .env.local and Vercel environment variables."
  );
}

export const fireworks = new OpenAI({
  apiKey: process.env.FIREWORKS_API_KEY,
  baseURL: "https://api.fireworks.ai/inference/v1",
});

// Model IDs
// All Fireworks models are namespaced under accounts/fireworks/models/
const SCORING_MODEL = "accounts/fireworks/models/deepseek-v3p2";
const EMBEDDING_MODEL = "nomic-ai/nomic-embed-text-v1.5";

// fireworksChat: use for post scoring and comparison tasks.
// deepseek-v3: Fireworks' recommended fast flagship model.
// Strong reasoning quality at low latency — good fit for structured scoring.
// temperature 0.4: consistent outputs without being fully deterministic.
export async function generateText(prompt: string): Promise<string> {
  const res = await fireworks.chat.completions.create({
    model: SCORING_MODEL,
    temperature: 0.4,
    max_tokens: 2048,
    messages: [{ role: "user", content: prompt }],
  });

  return res.choices[0].message.content ?? "";
}

// fireworksJson: same model but forces valid JSON output.
// response_format: { type: "json_object" } is the OpenAI-style JSON mode —
// Fireworks supports it natively. Guarantees parseable JSON, no markdown fences,
// no preamble. temperature 0.1 for tight, consistent structure.
export async function generateJson<T>(prompt: string): Promise<T> {
  const res = await fireworks.chat.completions.create({
    model: SCORING_MODEL,
    temperature: 0.1,
    max_tokens: 4096,
    response_format: { type: "json_object" },
    messages: [{ role: "user", content: prompt }],
  });

  const text = res.choices[0].message.content ?? "{}";
  return JSON.parse(text) as T;
}

// fireworksEmbed: converts text to a vector for semantic similarity.
// nomic-embed-text-v1.5: 768 dimensions, strong benchmark scores,
// free-tier friendly on Fireworks. Same model referenced in Fireworks' own RAG docs.
// Drop-in replacement for Google's text-embedding-004.
export async function embedText(text: string): Promise<number[]> {
  const res = await fireworks.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
  });

  return res.data[0].embedding;
}