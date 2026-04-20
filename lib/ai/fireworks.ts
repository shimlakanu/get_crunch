// lib/ai/fireworks.ts
import OpenAI from "openai";
import type { BatchScoreResponse, ConsistencyScoreJson } from "@/lib/types";
import { parseJsonWithRecovery } from "./structured-output";
import { BATCH_SCORE_SCHEMA, SELF_CONSISTENCY_SCHEMA } from "./ai-schemas";

if (!process.env.FIREWORKS_API_KEY) {
  throw new Error(
    "FIREWORKS_API_KEY is not set. Add it to .env.local and Vercel environment variables."
  );
}

export const fireworks = new OpenAI({
  apiKey: process.env.FIREWORKS_API_KEY,
  baseURL: "https://api.fireworks.ai/inference/v1",
});

export const SCORING_MODEL = "accounts/fireworks/models/deepseek-v3p2";
const EMBEDDING_MODEL = "nomic-ai/nomic-embed-text-v1.5";


function getClient(): OpenAI {
  const apiKey = process.env.FIREWORKS_API_KEY;
  if (!apiKey) {
    throw new Error(
      "FIREWORKS_API_KEY is not set. Add it to .env.local and Vercel environment variables."
    );
  }
  return new OpenAI({
    apiKey,
    baseURL: "https://api.fireworks.ai/inference/v1",
  });
}

interface RequestSchemaCompletionOptions {
  prompt: string;
  schemaName: string;
  schema: Record<string, unknown>;
  temperature: number;
  maxTokens: number;
  systemPrompt?: string;
}

export async function requestSchemaCompletion(
  options: RequestSchemaCompletionOptions
): Promise<string> {
  const res = await getClient().chat.completions.create({
    model: SCORING_MODEL,
    temperature: options.temperature,
    max_tokens: options.maxTokens,
    messages: [
      ...(options.systemPrompt ? [{ role: "system" as const, content: options.systemPrompt }] : []),
      { role: "user", content: options.prompt },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: options.schemaName,
        schema: options.schema,
      },
    } as unknown as OpenAI.ChatCompletionCreateParams["response_format"],
  });

  return res.choices[0]?.message?.content ?? "";
}

export async function generateScore(prompt: string, temperature: number = 0.4): Promise<BatchScoreResponse[]> {
  const raw = await requestSchemaCompletion({
    prompt,
    schemaName: "BatchScoreResponse",
    schema: BATCH_SCORE_SCHEMA,
    temperature,
    maxTokens: 4096,
  });
  return parseJsonWithRecovery(raw) as BatchScoreResponse[];
}

export async function generateConsistencyScore(
  prompt: string,
  temperature: number = 0.6
): Promise<ConsistencyScoreJson> {
  const raw = await requestSchemaCompletion({
    prompt,
    schemaName: "ConsistencyScoreResponse",
    schema: SELF_CONSISTENCY_SCHEMA,
    temperature,
    maxTokens: 1024,
    systemPrompt:
      "Return exactly one valid JSON object and nothing else. Do not include explanations, markdown, or step-by-step analysis.",
  });
  const parsed = parseJsonWithRecovery(raw) as Partial<{
    score: number;
    consistencyConfidence: number;
  }>;
  if (typeof parsed.score !== "number") {
    throw new Error(`Consistency response missing numeric score. Raw output: ${raw}`);
  }
  return { score: parsed.score, confidence: parsed.consistencyConfidence };
}

// fireworksEmbed: converts text to a vector for semantic similarity.
// nomic-embed-text-v1.5: 768 dimensions, strong benchmark scores,
// free-tier friendly on Fireworks. Same model referenced in Fireworks' own RAG docs.
// Drop-in replacement for Google's text-embedding-004.
export async function embedText(text: string): Promise<number[]> {
  // Fireworks matryoshka models default to a short slice (e.g. 192) unless dimensions is set.
  // Use explicit float encoding: openai-node defaults to base64 + decode, which can mis-handle
  // some provider payloads; float + dimensions matches Fireworks' OpenAPI.
  const res = await fireworks.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
    dimensions: 768,
    encoding_format: "float",
  });

  const emb = res.data[0].embedding;
  return Array.isArray(emb) ? emb : Array.from(emb as ArrayLike<number>);
}