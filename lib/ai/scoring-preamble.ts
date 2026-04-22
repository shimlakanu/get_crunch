import { buildScoringPrompt } from "./prompts";
import { selectDiverseSample } from "./select-diverse-sample";
import { findSimilarSentPosts, type SemanticSearchHit } from "@/lib/db/vector-search";
import type { HnPost } from "@/lib/types";

export const DEFAULT_SIMILARITY_SEED_N = 5;
export const SIMILAR_SENT_QUERY_LIMIT = 10;

export type CurateAndRankOptions = {
  /** Seed posts (domain round-robin) for vector similarity; default 5. <=0 skips similarity context. */
  sampleSize?: number;
};

export type ScoringPreambleContext = {
  preamble: string;
  seedCount: number;
  recentTitleCount: number;
};

function dedupeTitlesFromHits(hitLists: SemanticSearchHit[][]): string[] {
  const titleKeys = new Set<string>();
  const dedupedTitles: string[] = [];
  for (const hits of hitLists) {
    for (const h of hits) {
      const t = h.title?.trim() ?? "";
      if (!t) continue;
      const key = t.toLowerCase();
      if (titleKeys.has(key)) continue;
      titleKeys.add(key);
      dedupedTitles.push(t);
    }
  }
  return dedupedTitles;
}

/**
 * Builds the batch-scoring preamble, optionally enriched from vector search over sent posts.
 * `sampleSize <= 0` skips DB/embeddings and uses the base rubric only.
 */
export async function resolveScoringPreambleContext(
  posts: HnPost[],
  sampleSize: number
): Promise<ScoringPreambleContext> {
  if (sampleSize <= 0) {
    return {
      preamble: buildScoringPrompt([]),
      seedCount: 0,
      recentTitleCount: 0,
    };
  }

  const seeds = selectDiverseSample(posts, sampleSize);
  try {
    const resultLists = await Promise.all(
      seeds.map((p) =>
        findSimilarSentPosts(p.title, { limit: SIMILAR_SENT_QUERY_LIMIT })
      )
    );
    const dedupedTitles = dedupeTitlesFromHits(resultLists);
    return {
      preamble: buildScoringPrompt(dedupedTitles),
      seedCount: seeds.length,
      recentTitleCount: dedupedTitles.length,
    };
  } catch (err) {
    console.warn(
      "[curator] findSimilarSentPosts failed; scoring without recent-sent context",
      err
    );
    return {
      preamble: buildScoringPrompt([]),
      seedCount: seeds.length,
      recentTitleCount: 0,
    };
  }
}
