// lib/ai/curator.ts
import { fireworks, generateScore } from "./fireworks";
import { SCORING_PROMPT, CONSISTENCY_PROMPT } from "./prompts";
import type { HnPost } from "@/lib/types";
import { updatePostScore } from "@/lib/db/posts";
import type { BatchScoreResponse, ScoredPost } from "@/lib/types";
import { z } from "zod";


const BATCH_SIZE = 5;

const UNCERTAINTY_MIN = 6;
const UNCERTAINTY_MAX = 8;
const SELF_CONSISTENCY_ATTEMPTS = 3;

const SELF_CONSISTENCY_SCHEMA = {
  type: "object",
  properties: {
    score: { type: "number" },
    reasoning: { type: "string" },
    consistencyConfidence: { type: "number" },
  },
  required: ["score", "reasoning", "consistencyConfidence"],
} as const;

const selfConsistencyZodSchema = z.object({
  score: z.number(),
  reasoning: z.string().min(1),
  consistencyConfidence: z.number(),
});

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

  let attempts = 0;
  const MAX_ATTEMPTS = 3;

  while (attempts < MAX_ATTEMPTS) {
    try {
      const scores = await generateScore(prompt, 0.4);
      console.log(`[curator] scored batch at attempt ${attempts + 1} successfully`);
      return scores;
    } catch (err) {
      attempts++;
      if (attempts === MAX_ATTEMPTS) throw err;
        const isOverloaded = err instanceof Error && err.message.includes("503");
        const delay = isOverloaded
      ? Math.min(1000 * 2 ** attempts, 3000) // 2s, 4s, 8s... cap at 30s
      : 2000;

    console.warn(`[curator] Batch failed (attempt ${attempts}), retrying in ${delay}ms...`);
    await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("Failed to score batch after all attempts");
}

function parseJsonWithRecovery(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    const firstBrace = raw.indexOf("{");
    const lastBrace = raw.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      const candidate = raw.slice(firstBrace, lastBrace + 1);
      return JSON.parse(candidate);
    }
    throw new Error("No JSON object found in model output.");
  }
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

  const failures: Array<Record<string, unknown>> = [];
  let correctionFeedback = "";

  for (let attempt = 1; attempt <= SELF_CONSISTENCY_ATTEMPTS; attempt++) {
    const userPrompt =
      correctionFeedback.length > 0 ? `${basePrompt}\n\n${correctionFeedback}` : basePrompt;

    let raw = "";
    try {
      const res = await fireworks.chat.completions.create({
        model: "accounts/fireworks/models/deepseek-v3p2",
        temperature: 0.5,
        max_tokens: 1024,
        messages: [
          {
            role: "system",
            content:
              "Return exactly one valid JSON object and nothing else. No markdown. No extra text.",
          },
          { role: "user", content: userPrompt },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "SelfConsistencyResult",
            schema: SELF_CONSISTENCY_SCHEMA,
          },
        } as unknown as Parameters<typeof fireworks.chat.completions.create>[0]["response_format"],
      });
      raw = res.choices[0]?.message?.content ?? "";
    } catch (err) {
      failures.push({
        attempt,
        stage: "llm_request",
        error: err instanceof Error ? err.message : String(err),
      });
      correctionFeedback = `Your previous response was invalid JSON.
Return ONLY valid JSON matching this schema:
${JSON.stringify(SELF_CONSISTENCY_SCHEMA)}`;
      continue;
    }

    let recovered: unknown;
    try {
      recovered = parseJsonWithRecovery(raw);
    } catch (err) {
      failures.push({
        attempt,
        stage: "json_recovery",
        error: err instanceof Error ? err.message : String(err),
        raw,
      });
      correctionFeedback = `Your previous response was invalid JSON.
Return ONLY valid JSON matching this schema:
${JSON.stringify(SELF_CONSISTENCY_SCHEMA)}`;
      continue;
    }

    const validated = selfConsistencyZodSchema.safeParse(recovered);
    if (!validated.success) {
      failures.push({
        attempt,
        stage: "zod_validation",
        errors: validated.error.issues,
        raw,
      });
      correctionFeedback = `Your previous response was invalid JSON.
Return ONLY valid JSON matching this schema:
${JSON.stringify(SELF_CONSISTENCY_SCHEMA)}`;
      continue;
    }

    const normalizedScore = normalizeConsistencyScore(validated.data.score);
    const normalizedConfidence = normalizeConfidence(validated.data.consistencyConfidence);

    post.aiScore = normalizedScore;
    post.reasoning = validated.data.reasoning.trim();
    post.consistencyConfidence = normalizedConfidence;

    if (failures.length > 0) {
      console.warn("[curator] selfConsistency recovered after retries", {
        postId: post.id,
        attemptsUsed: attempt,
        failures,
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
    failures,
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
  const uncertainPosts = scoredPosts.filter(
    (p) => p.aiScore >= UNCERTAINTY_MIN && p.aiScore <= UNCERTAINTY_MAX
  );

  console.log(`[curator] Running self-consistency on ${uncertainPosts.length} uncertain posts`);

  for (const post of uncertainPosts) {
    await selfConsistency(post);

    // Update MongoDB — reasoning stays the same, only score and confidence update
    await updatePostScore(post.id, post.aiScore, post.reasoning, post.consistencyConfidence ?? 0);

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
