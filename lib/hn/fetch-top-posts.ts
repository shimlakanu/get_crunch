import { storePosts } from "@/lib/db/posts";
import type { HnPost, HnRawStory } from "@/lib/types";

const HN_BASE = "https://hacker-news.firebaseio.com/v0";

async function fetchStory(id: number): Promise<HnRawStory | null> {
  try {
    const res = await fetch(`${HN_BASE}/item/${id}.json`, {
      // next: { revalidate: 0 } disables Next.js fetch caching.
      next: { revalidate: 0 },
    });
    return res.json();
  } catch {
    return null;
  }
}

/** Fetches top HN stories, persists to MongoDB, returns the normalized posts. */
export async function fetchTopPostsAndPersist(): Promise<HnPost[]> {
  const idsRes = await fetch(`${HN_BASE}/topstories.json`, {
    next: { revalidate: 0 },
  });
  const allIds: number[] = await idsRes.json();
  const ids = allIds.slice(0, 500);

  console.log(`[posts] Fetching ${ids.length} stories from HN...`);
  const stories = await Promise.all(ids.map(fetchStory));

  const posts: HnPost[] = stories
    .filter((s): s is HnRawStory =>
      s !== null && s.type === "story" && !!s.time && !!s.title
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, 50)
    .map((s) => ({
      id: s.id,
      title: s.title,
      url: s.url || `https://news.ycombinator.com/item?id=${s.id}`,
      score: s.score,
      by: s.by,
      comments: s.descendants || 0,
      postedAt: new Date(s.time * 1000).toISOString(),
      hnLink: `https://news.ycombinator.com/item?id=${s.id}`,
    }));

  console.log(`[posts] Storing ${posts.length} posts to MongoDB...`);
  await storePosts(posts);
  console.log(`[posts] Done. Returning ${posts.length} posts.`);

  return posts;
}
