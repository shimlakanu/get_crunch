// lib/ai/curator.ts
import { generateJson, generateScore } from "./fireworks";
import { parseBatchScoresText } from "@/lib/ai/parse-batch-scores";
import { SCORING_PROMPT, CONSISTENCY_PROMPT } from "./prompts";
import type { HnPost } from "@/lib/types";
import { updatePostScore } from "@/lib/db/posts";
import type { BatchScoreResponse, ConsistencyScoreJson, ScoredPost } from "@/lib/types";

const BATCH_SIZE = 25;

const UNCERTAINTY_MIN = 5;
const UNCERTAINTY_MAX = 10;

async function scoreBatch(posts: HnPost[]): Promise<BatchScoreResponse[]> {
  const postsForPrompt = posts.map((p) => ({
    id: p.id,
    title: p.title,
    score: p.score, // HN community score (upvotes)
    comments: p.comments,
    domain: extractDomain(p.url),
  }));

  const prompt = `${SCORING_PROMPT}\n\nPosts to score:\n${JSON.stringify(postsForPrompt, null, 2)}`;

  let attempts = 0;
  const MAX_ATTEMPTS = 3;

  while (attempts < MAX_ATTEMPTS) {
    try {
      const text = await generateScore(prompt);

      // Plain completion; model may still add fences or stray text — parseBatchScoresText handles it.
      return parseBatchScoresText(text);
    } catch (err) {
      attempts++;
      if (attempts === MAX_ATTEMPTS) {
        console.error(`scoreBatch failed after ${MAX_ATTEMPTS} attempts:`, err);
        return []; // return empty, not throw — don't crash the whole cron run
      }
      // Wait 2 seconds before retry — gives the API time to recover from rate limits
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  return [];
}

async function selfConsistency(post: HnPost): Promise<{ score: number; confidence: number }> {
  const prompt = `${CONSISTENCY_PROMPT}\n\nTitle: ${post.title}\nHN Score: ${post.score}\nComments: ${post.comments}\nDomain: ${extractDomain(post.url)}`;

  const scores: number[] = [];
  for (let i = 0; i < 3; i++) {
    try {
      const parsed = await generateJson<ConsistencyScoreJson>(prompt, 0.7);
      if (typeof parsed.score === "number") {
        scores.push(Math.min(10, Math.max(0, Math.round(parsed.score))));
      }
    } catch {
      console.error(`selfConsistency failed for post ${post.id} on attempt ${i + 1}`);
    }
    if (i < 2) await new Promise((r) => setTimeout(r, 500));
  }


  // Sort and take the median score.
  // Why median: for 3 values, median = the middle value after sorting.
  // [3, 7, 7] → median 7, confidence 2/3 = 0.67
  // [5, 5, 5] → median 5, confidence 3/3 = 1.0
  // This is more robust than mean when one run is an outlier.
  scores.sort((a, b) => a - b);
  const medianScore = scores[Math.floor(scores.length / 2)];

  // Confidence = fraction of runs that agreed with the median
  const agreeing = scores.filter((s) => s === medianScore).length;
  const confidence = agreeing / scores.length;

  return { score: medianScore, confidence };
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

    // 1 second between batches — prevent hitting 15 RPM limit
    // 2 batches of 50 = 2 API calls. Well within limits.
    if (i + BATCH_SIZE < posts.length) {
      await new Promise((r) => setTimeout(r, 1000));
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
    .filter((p) => p.aiScore > 0); // remove posts the model couldn't score

  // Step 3: self-consistency for uncertain posts
  const uncertainPosts = scoredPosts.filter(
    (p) => p.aiScore >= UNCERTAINTY_MIN && p.aiScore <= UNCERTAINTY_MAX
  );

  console.log(`[curator] Running self-consistency on ${uncertainPosts.length} uncertain posts`);

  for (const post of uncertainPosts) {
    const { score, confidence } = await selfConsistency(post);

    // Update in-memory object
    post.aiScore = score;
    post.consistencyConfidence = confidence;

    // Update MongoDB — reasoning stays the same, only score and confidence update
    await updatePostScore(post.id, score, post.reasoning, confidence);

    await new Promise((r) => setTimeout(r, 500));
  }

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
