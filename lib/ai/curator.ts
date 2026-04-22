// lib/ai/curator.ts
import { requestSchemaCompletion } from "./fireworks";
import { CONSISTENCY_PROMPT } from "./prompts";
import {
  DEFAULT_SIMILARITY_SEED_N,
  resolveScoringPreambleContext,
  type CurateAndRankOptions,
} from "./scoring-preamble";
import type { BatchScoreResponse, HnPost, ScoredPost } from "@/lib/types";
import { runStructuredOutputPipeline } from "./structured-output";
import {
  BATCH_SCORE_SCHEMA,
  batchScoreZodSchema,
  SELF_CONSISTENCY_REQUIRED_KEYS,
  SELF_CONSISTENCY_SCHEMA,
  selfConsistencyZodSchema,
} from "./ai-schemas";
import { extractDomain } from "@/lib/url/extract-domain";

export { selectDiverseSample } from "./select-diverse-sample";
export type { CurateAndRankOptions } from "./scoring-preamble";

const BATCH_SIZE = 5;
const SCORING_ATTEMPTS = 3;
const SELF_CONSISTENCY_ATTEMPTS = 3;
const STRICT_JSON_SYSTEM_PROMPT =
  "Return exactly one valid JSON value and nothing else. No markdown, no commentary.";

async function requestStructuredOutput(args: {
  prompt: string;
  schemaName: string;
  schema: Record<string, unknown>;
  temperature: number;
  maxTokens: number;
}): Promise<string> {
  return requestSchemaCompletion({
    prompt: args.prompt,
    schemaName: args.schemaName,
    schema: args.schema,
    temperature: args.temperature,
    maxTokens: args.maxTokens,
    systemPrompt: STRICT_JSON_SYSTEM_PROMPT,
  });
}

function normalizeBatchScores(scores: BatchScoreResponse[]): BatchScoreResponse[] {
  return scores.map((score) => ({
    id: score.id,
    score: Math.min(10, Math.max(0, Math.round(score.score))),
    reasoning: score.reasoning.trim(),
  }));
}

async function scoreBatch(
  posts: HnPost[],
  scoringPreamble: string
): Promise<BatchScoreResponse[]> {
  const postsForPrompt = posts.map((p) => ({
    id: p.id,
    title: p.title,
    score: p.score, // HN community score (upvotes)
    comments: p.comments,
    domain: extractDomain(p.url),
  }));

  const first = postsForPrompt[0];
  console.log(
    `[curator] Scoring batch of ${first ? `${first.title}  ${first.id}` : "(empty)"}`
  );

  const prompt = `${scoringPreamble}\n\nPosts to score:\n${JSON.stringify(postsForPrompt, null, 2)}`;
  const result = await runStructuredOutputPipeline<BatchScoreResponse[]>({
    basePrompt: prompt,
    attempts: SCORING_ATTEMPTS,
    schema: BATCH_SCORE_SCHEMA,
    zodSchema: batchScoreZodSchema,
    request: (nextPrompt) =>
      requestStructuredOutput({
        prompt: nextPrompt,
        schemaName: "BatchScoreResponse",
        schema: BATCH_SCORE_SCHEMA,
        temperature: 0.3,
        maxTokens: 4096,
      }),
  });

  if (result.data) {
    if (result.failures.length > 0) {
      console.warn("[curator] scoreBatch recovered after retries", {
        batchSize: postsForPrompt.length,
        attemptsUsed: result.attemptsUsed,
        failures: result.failures,
      });
    }
    return normalizeBatchScores(result.data);
  }

  console.error("[curator] scoreBatch failed after retries", {
    batchSize: postsForPrompt.length,
    failures: result.failures,
  });
  return [];
}

function normalizeConsistencyScore(score: number): number {
  return Math.min(10, Math.max(0, Math.round(score)));
}

function normalizeConfidence(confidence: number): number {
  return Math.min(1, Math.max(0, confidence));
}

export async function selfConsistency(post: ScoredPost): Promise<ScoredPost> {
  const basePrompt = `${CONSISTENCY_PROMPT}

Return ONLY one JSON object for this post:
Title: ${post.title}
Post Score: ${post.score}
Comments: ${post.comments}
Domain: ${extractDomain(post.url)}`;
  const result = await runStructuredOutputPipeline({
    basePrompt,
    attempts: SELF_CONSISTENCY_ATTEMPTS,
    schema: SELF_CONSISTENCY_SCHEMA,
    requiredObjectKeys: [...SELF_CONSISTENCY_REQUIRED_KEYS],
    zodSchema: selfConsistencyZodSchema,
    request: (nextPrompt) =>
      requestStructuredOutput({
        prompt: nextPrompt,
        schemaName: "SelfConsistencyResult",
        schema: SELF_CONSISTENCY_SCHEMA,
        temperature: 0.2,
        maxTokens: 1024,
      }),
  });

  if (result.data) {
    post.aiScore = normalizeConsistencyScore(result.data.score);
    post.reasoning = result.data.reasoning.trim();
    post.consistencyConfidence = normalizeConfidence(result.data.consistencyConfidence);

    if (result.failures.length > 0) {
      console.warn("[curator] selfConsistency recovered after retries", {
        postId: post.id,
        attemptsUsed: result.attemptsUsed,
        failures: result.failures,
      });
    }
    return post;
  }

  post.consistencyConfidence = 0;
  if (!post.reasoning || post.reasoning.trim().length === 0) {
    post.reasoning = "Self-consistency fallback: previous response was invalid.";
  }

  console.error("[curator] selfConsistency failed after retries", {
    postId: post.id,
    failures: result.failures,
  });

  return post;
}

// curateAndRank: the main function — takes raw posts, returns scored + sorted posts.
// This is what the cron route calls.
export async function curateAndRank(
  posts: HnPost[],
  options?: CurateAndRankOptions
): Promise<ScoredPost[]> {
  console.log(`[curator] Scoring ${posts.length} posts in batches of ${BATCH_SIZE}`);

  const sampleSize = options?.sampleSize ?? DEFAULT_SIMILARITY_SEED_N;
  // sampleSize <= 0 skips vector similarity and keeps the base-only scoring rubric.
  const ctx = await resolveScoringPreambleContext(posts, sampleSize);
  if (sampleSize > 0) {
    console.log(
      `[curator] Similarity seeds=${ctx.seedCount}, deduped recent-sent titles=${ctx.recentTitleCount}`
    );
  }

  const allScores: BatchScoreResponse[] = [];

  for (let i = 0; i < posts.length; i += BATCH_SIZE) {
    const batch = posts.slice(i, i + BATCH_SIZE);
    console.log(`[curator] Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(posts.length / BATCH_SIZE)}`);

    const batchScores = await scoreBatch(batch, ctx.preamble);
    allScores.push(...batchScores);
    if (i + BATCH_SIZE < posts.length) {
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  const scoreMap = new Map(allScores.map((s) => [s.id, s]));

  const scoredPosts: ScoredPost[] = posts
    .map((post) => {
      const scoreData = scoreMap.get(post.id);
      return {
        ...post,
        aiScore: scoreData?.score ?? 0,
        reasoning: scoreData?.reasoning ?? "Score unavailable",
      };
    })
    .filter((p) => p.aiScore > 0);

  console.log(`[curator] Scored ${scoredPosts.length} posts`);

  return scoredPosts.sort((a, b) => b.aiScore - a.aiScore);
}
