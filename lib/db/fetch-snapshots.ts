import type { Collection } from "mongodb";
import { getDb } from "./client";
import type { HnPost } from "@/lib/types";
import { extractDomain } from "@/lib/url/extract-domain";

const COLLECTION = "fetch_domain_snapshots";
const SNAPSHOTS_FOR_TRENDING = 3;

export type FetchDomainSnapshotDoc = {
  fetchedAt: Date;
  domainCounts: Record<string, number>;
};

async function getSnapshotsCollection(): Promise<Collection<FetchDomainSnapshotDoc>> {
  const db = await getDb();
  return db.collection<FetchDomainSnapshotDoc>(COLLECTION);
}

/** Per-fetch hostname counts for the top-story batch (same hostnames as scoring `domain`). */
export function domainHistogramFromPosts(posts: HnPost[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const p of posts) {
    const d = extractDomain(p.url);
    counts[d] = (counts[d] ?? 0) + 1;
  }
  return counts;
}

/** Append one snapshot after a successful HN fetch (digest or /api/posts). */
export async function recordFetchDomainSnapshot(posts: HnPost[]): Promise<void> {
  const coll = await getSnapshotsCollection();
  await coll.insertOne({
    fetchedAt: new Date(),
    domainCounts: domainHistogramFromPosts(posts),
  });
}

/**
 * Domains that appear in **all** of the last three stored fetch snapshots (each with count ≥ 1).
 * Fewer than three snapshots → empty (cold start).
 */
export async function getTrendingDomainsAcrossLastFetches(): Promise<string[]> {
  const coll = await getSnapshotsCollection();
  const docs = await coll
    .find({})
    .sort({ fetchedAt: -1 })
    .limit(SNAPSHOTS_FOR_TRENDING)
    .toArray();

  if (docs.length < SNAPSHOTS_FOR_TRENDING) return [];

  const domainSets = docs.map((d) => {
    const s = new Set<string>();
    for (const [host, n] of Object.entries(d.domainCounts)) {
      if (n >= 1) s.add(host);
    }
    return s;
  });

  const [first, ...rest] = domainSets;
  if (!first || rest.length !== SNAPSHOTS_FOR_TRENDING - 1) return [];

  const out: string[] = [];
  for (const dom of first) {
    if (rest.every((set) => set.has(dom))) out.push(dom);
  }
  return out.sort((a, b) => a.localeCompare(b));
}
