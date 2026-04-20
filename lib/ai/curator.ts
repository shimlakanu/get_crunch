// lib/ai/curator.ts
import { requestSchemaCompletion } from "./fireworks";
import { SCORING_PROMPT, CONSISTENCY_PROMPT } from "./prompts";
import type { HnPost } from "@/lib/types";
import { updatePostScore } from "@/lib/db/posts";
import type { BatchScoreResponse, ScoredPost } from "@/lib/types";
import { runStructuredOutputPipeline } from "./structured-output";
import {
  BATCH_SCORE_SCHEMA,
  batchScoreZodSchema,
  SELF_CONSISTENCY_REQUIRED_KEYS,
  SELF_CONSISTENCY_SCHEMA,
  selfConsistencyZodSchema,
} from "./ai-schemas";


const BATCH_SIZE = 3;

const UNCERTAINTY_MIN = 6;
const UNCERTAINTY_MAX = 8;
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

async function scoreBatch(posts: HnPost[]): Promise<BatchScoreResponse[]> {
  const postsForPrompt = posts.map((p) => ({
    id: p.id,
    title: p.title,
    score: p.score, // HN community score (upvotes)
    comments: p.comments,
    domain: extractDomain(p.url),
  }));

  console.log(`[curator] Scoring batch of ${postsForPrompt[0].title}  ${postsForPrompt[0].id}`);

  const prompt = `${SCORING_PROMPT}\n\nPosts to score:\n${JSON.stringify(postsForPrompt, null, 2)}`;
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
export async function curateAndRank(posts: HnPost[]): Promise<ScoredPost[]> {
  console.log(`[curator] Scoring ${posts.length} posts in batches of ${BATCH_SIZE}`);

  // Step 1: batch score all posts
  const allScores: BatchScoreResponse[] = [];

  for (let i = 0; i < posts.length; i += BATCH_SIZE) {
    const batch = posts.slice(i, i + BATCH_SIZE);
    console.log(`[curator] Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(posts.length / BATCH_SIZE)}`);

    const batchScores = await scoreBatch(batch);
    allScores.push(...batchScores);
    if (i + BATCH_SIZE < posts.length) {
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  // Step 2: merge scores back into post objects
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

  // Step 3: self-consistency for uncertain posts
//   const uncertainPosts = scoredPosts.filter(
//     (p) => p.aiScore >= UNCERTAINTY_MIN && p.aiScore <= UNCERTAINTY_MAX
//   );

//   console.log(`[curator] Running self-consistency on ${uncertainPosts.length} uncertain posts`);

//   for (const post of uncertainPosts) {
    // await selfConsistency(post);

    // Update MongoDB — reasoning stays the same, only score and confidence update
//  await updatePostScore(post.id, post.aiScore, post.reasoning, post.consistencyConfidence ?? 0);

    // await new Promise((r) => setTimeout(r, 500));
//   }

  // Step 4: sort by final AI score, return top posts
  return scoredPosts.sort((a, b) => b.aiScore - a.aiScore);
}

// extractDomain: pull the domain from a URL for the scoring prompt.
// "https://blog.example.com/post/123" → "blog.example.com"
// Why include domain: the scoring model can use domain as a signal
// (github.com → likely technical, substack.com → likely opinion).
function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
