import { z } from "zod";

export const BATCH_SCORE_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    properties: {
      id: { type: "number" },
      score: { type: "number" },
      reasoning: { type: "string" },
    },
    required: ["id", "score", "reasoning"],
  },
} as const;

export const batchScoreZodSchema = z.array(
  z.object({
    id: z.number(),
    score: z.number(),
    reasoning: z.string().min(1),
  })
);

export const SELF_CONSISTENCY_SCHEMA = {
  type: "object",
  properties: {
    score: { type: "number" },
    reasoning: { type: "string" },
    consistencyConfidence: { type: "number" },
  },
  required: ["score", "reasoning", "consistencyConfidence"],
} as const;

export const selfConsistencyZodSchema = z.object({
  score: z.number(),
  reasoning: z.string().min(1),
  consistencyConfidence: z.number(),
});

export const SELF_CONSISTENCY_REQUIRED_KEYS = [
  "score",
  "reasoning",
  "consistencyConfidence",
] as const;
