const HN_BASE = "https://hacker-news.firebaseio.com/v0";

async function fetchStory(id) {
  const res = await fetch(`${HN_BASE}/item/${id}.json`);
  return res.json();
}

export async function GET() {
  try {
    // Fetch top story IDs (up to 500), we'll sample top 200
    const idsRes = await fetch(`${HN_BASE}/topstories.json`);
    const allIds = await idsRes.json();
    const ids = allIds.slice(0, 200);

    // Fetch all 200 stories in parallel
    const stories = await Promise.all(ids.map(fetchStory));

    // Filter out non-stories (jobs, polls etc) and sort by time descending
    const sorted = stories
      .filter((s) => s && s.type === "story" && s.time)
      .sort((a, b) => b.time - a.time)
      .slice(0, 5)
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

    return Response.json(sorted);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}