import { buildScoringPrompt } from "./prompts";
import { getTrendingDomainsAcrossLastFetches } from "@/lib/db/fetch-snapshots";

/** Optional second argument to `curateAndRank` for forward-compatible extensions. */
export type CurateAndRankOptions = Record<string, never>;

export type ScoringPreambleContext = {
  preamble: string;
  trendingDomainCount: number;
};

/**
 * Builds the batch-scoring preamble using domain trends from the last three HN fetches.
 */
export async function resolveScoringPreambleContext(): Promise<ScoringPreambleContext> {
  try {
    const trendingDomains = await getTrendingDomainsAcrossLastFetches();
    return {
      preamble: buildScoringPrompt({ trendingDomains }),
      trendingDomainCount: trendingDomains.length,
    };
  } catch (err) {
    console.warn(
      "[curator] getTrendingDomainsAcrossLastFetches failed; using base rubric only",
      err
    );
    return {
      preamble: buildScoringPrompt({ trendingDomains: [] }),
      trendingDomainCount: 0,
    };
  }
}
