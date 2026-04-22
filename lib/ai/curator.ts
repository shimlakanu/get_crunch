// lib/ai/curator.ts
import { requestSchemaCompletion } from "./fireworks";
import { buildScoringPrompt, CONSISTENCY_PROMPT } from "./prompts";
import type { HnPost } from "@/lib/types";
import { updatePostScore } from "@/lib/db/posts";
import { findSimilarSentPosts } from "@/lib/db/vector-search";
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
const DEFAULT_SIMILARITY_SEED_N = 5;
const SIMILAR_SENT_LIMIT = 10;

export type CurateAndRankOptions = {
  /** Seed posts (domain round-robin) for vector similarity; default 5. <=0 skips similarity context. */
  sampleSize?: number;
};

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
  let scoringPreamble = buildScoringPrompt([]);

  // sampleSize <= 0 skips vector similarity and keeps the base-only scoring rubric.
  if (sampleSize > 0) {
    const seeds = selectDiverseSample(posts, sampleSize);
    try {
      const resultLists = await Promise.all(
        seeds.map((p) => findSimilarSentPosts(p.title, { limit: SIMILAR_SENT_LIMIT }))
      );
      const dedupedTitles: string[] = [];
      const titleKeys = new Set<string>();
      for (const hits of resultLists) {
        for (const h of hits) {
          const t = h.title?.trim() ?? "";
          if (!t) continue;
          const key = t.toLowerCase();
          if (titleKeys.has(key)) continue;
          titleKeys.add(key);
          dedupedTitles.push(t);
        }
      }
      console.log(`[curator] Deduped: ${dedupedTitles.length} titles`);
      scoringPreamble = buildScoringPrompt(dedupedTitles);
      console.log(
        `[curator] Similarity seeds=${seeds.length}, deduped recent-sent titles=${dedupedTitles.length}`
      );
    } catch (err) {
      console.warn(
        "[curator] findSimilarSentPosts failed; scoring without recent-sent context",
        err
      );
    }
  }

  // Step 1: batch score all posts
  const allScores: BatchScoreResponse[] = [];

  for (let i = 0; i < posts.length; i += BATCH_SIZE) {
    const batch = posts.slice(i, i + BATCH_SIZE);
    console.log(`[curator] Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(posts.length / BATCH_SIZE)}`);

    const batchScores = await scoreBatch(batch, scoringPreamble);
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

/** Pick up to `n` posts by round-robin across URL domains (deterministic, without replacement). */
export function selectDiverseSample(hnPosts: HnPost[], n: number): HnPost[] {
  if (hnPosts.length === 0 || n <= 0) return [];
  if (hnPosts.length <= n) return [...hnPosts];

  const buckets = new Map<string, HnPost[]>();
  for (const p of hnPosts) {
    const d = extractDomain(p.url);
    const list = buckets.get(d);
    if (list) list.push(p);
    else buckets.set(d, [p]);
  }

  const domainOrder = [...buckets.keys()].sort((a, b) => a.localeCompare(b));
  const picked: HnPost[] = [];
  const nextIndex = new Map<string, number>();
  for (const d of domainOrder) nextIndex.set(d, 0);

  while (picked.length < n) {
    let progressed = false;
    for (const d of domainOrder) {
      const list = buckets.get(d)!;
      const i = nextIndex.get(d)!;
      if (i < list.length) {
        picked.push(list[i]!);
        nextIndex.set(d, i + 1);
        progressed = true;
        if (picked.length >= n) break;
      }
    }
    if (!progressed) break;
  }

  return picked;
}
