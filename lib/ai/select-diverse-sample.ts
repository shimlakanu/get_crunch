import type { HnPost } from "@/lib/types";
import { extractDomain } from "@/lib/url/extract-domain";

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
