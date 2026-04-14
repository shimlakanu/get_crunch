// app/api/posts/route.ts
import { fetchTopPostsAndPersist } from "@/lib/hn/fetch-top-posts";

export async function GET(): Promise<Response> {
  try {
    const posts = await fetchTopPostsAndPersist();
    return Response.json(posts);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[posts] Error:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
