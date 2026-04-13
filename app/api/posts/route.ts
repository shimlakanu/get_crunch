// app/api/posts/route.ts
const HN_BASE = "https://hacker-news.firebaseio.com/v0";

// HnRawStory: shape of data that comes FROM the HN Firebase API.
// Fields marked optional (?) can be absent — the HN API omits fields
// when they have no value (e.g. a post with no URL omits the url field entirely).
interface HnRawStory {
  id: number;
  title: string;
  url?: string;          // absent on "Ask HN" posts
  score: number;
  by: string;
  descendants?: number;  // absent when a post has 0 comments
  time: number;          // Unix timestamp in seconds, not milliseconds
  type: string;          // "story", "comment", "job", etc.
}

// HnPost: the shape YOUR app uses everywhere.
// This is what gets stored in MongoDB and passed between functions.
// Export it — other files will import this type.
export interface HnPost {
  id: number;
  title: string;
  url: string;       // always a string — we fill in the HN link if url is absent
  score: number;
  by: string;
  comments: number;
  postedAt: string;  // ISO 8601 string, e.g. "2025-04-09T14:23:00.000Z"
  hnLink: string;    // always links to the HN discussion page
}

async function fetchStory(id: number): Promise<HnRawStory | null> {
  try {
    const res = await fetch(`${HN_BASE}/item/${id}.json`);
    return res.json();
  } catch {
    return null; // if one story fetch fails, don't crash the whole request
  }
}

export async function GET(): Promise<Response> {
  try {
    const idsRes = await fetch(`${HN_BASE}/topstories.json`);
    const allIds: number[] = await idsRes.json();

    // Fetch top 500 (not 200 as before).
    // Why 500: Starting Day 1, Gemini will score these and pick the best 10.
    // Scoring 500 gives Claude more candidates to choose from.
    // Promise.all fetches all in parallel — not sequential.
    const ids = allIds.slice(0, 500);
    const stories = await Promise.all(ids.map(fetchStory));

    const posts: HnPost[] = stories
      .filter((s): s is HnRawStory =>
        // Type guard: tells TypeScript that after this filter,
        // every item in the array is definitely HnRawStory, not null.
        s !== null &&
        s.type === "story" &&
        !!s.time &&
        !!s.title
      )
      .sort((a, b) => b.score - a.score) // sort by score for now; Day 1 replaces this
      .slice(0, 100) // keep top 100 candidates for scoring
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

    return Response.json(posts);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}