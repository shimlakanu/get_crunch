// lib/ai/fireworks.ts
import OpenAI from "openai";
import type { BatchScoreResponse, ConsistencyScoreJson } from "@/lib/types";

const BATCH_SCORE_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    properties: {
      id:        { type: "number" },
      score:     { type: "number" },
      reasoning: { type: "string" },
    },
    required: ["id", "score", "reasoning"],
  },
};

const CONSISTENCY_SCORE_SCHEMA = {
  type: "object",
  properties: {
    score: { type: "number" },
    reasoning: { type: "string" },
  },
  required: ["score", "reasoning"],
};

if (!process.env.FIREWORKS_API_KEY) {
  throw new Error(
    "FIREWORKS_API_KEY is not set. Add it to .env.local and Vercel environment variables."
  );
}

export const fireworks = new OpenAI({
  apiKey: process.env.FIREWORKS_API_KEY,
  baseURL: "https://api.fireworks.ai/inference/v1",
});

const SCORING_MODEL = "accounts/fireworks/models/deepseek-v3p2";
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

function parseJsonWithRecovery<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    const firstBrace = raw.indexOf("{");
    const lastBrace = raw.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      const objectCandidate = raw.slice(firstBrace, lastBrace + 1);
      try {
        return JSON.parse(objectCandidate) as T;
      } catch {
        // Continue and try array extraction.
      }
    }

    const firstBracket = raw.indexOf("[");
    const lastBracket = raw.lastIndexOf("]");
    if (firstBracket !== -1 && lastBracket > firstBracket) {
      const arrayCandidate = raw.slice(firstBracket, lastBracket + 1);
      return JSON.parse(arrayCandidate) as T;
    }

    return fallback;
  }
}

export async function generateScore(prompt: string, temperature: number = 0.4): Promise<BatchScoreResponse[]> {
  const res = await getClient().chat.completions.create({
    model: SCORING_MODEL,
    temperature: temperature,
    max_tokens: 4096, 
    messages: [{ role: "user", content: prompt }],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "BatchScoreResponse",
        schema: BATCH_SCORE_SCHEMA,
      },
    }  as unknown as OpenAI.ChatCompletionCreateParams["response_format"],
  });

  const raw = res.choices[0].message.content ?? "[]";
  return parseJsonWithRecovery<BatchScoreResponse[]>(raw, []);
}

export async function generateConsistencyScore(
  prompt: string,
  temperature: number = 0.6
): Promise<ConsistencyScoreJson> {
  const res = await getClient().chat.completions.create({
    model: SCORING_MODEL,
    temperature,
    max_tokens: 1024,
    messages: [
      {
        role: "system",
        content:
          "Return exactly one valid JSON object and nothing else. Do not include explanations, markdown, or step-by-step analysis.",
      },
      { role: "user", content: prompt },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "ConsistencyScoreResponse",
        schema: CONSISTENCY_SCORE_SCHEMA,
      },
    } as unknown as OpenAI.ChatCompletionCreateParams["response_format"],
  });

  const raw = res.choices[0].message.content ?? "{}";
  const parsed = parseJsonWithRecovery<Partial<ConsistencyScoreJson>>(raw, {});
  if (typeof parsed.score !== "number") {
    throw new Error(`Consistency response missing numeric score. Raw output: ${raw}`);
  }
  return { score: parsed.score };
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