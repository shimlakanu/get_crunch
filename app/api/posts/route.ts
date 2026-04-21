// app/api/posts/route.ts
import { buildEmbeddingText, embedText } from "@/lib/ai/embeddings";
import { updatePostEmbedding } from "@/lib/db/posts";
import { fetchTopPostsAndPersist } from "@/lib/hn/fetch-top-posts";

export async function GET(): Promise<Response> {
  try {
    const posts = await fetchTopPostsAndPersist();
    for (const post of posts) {
      const text = buildEmbeddingText(post);
      const vector = await embedText(text);
      await updatePostEmbedding(post.id, vector);
    }
    return Response.json(posts);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[posts] Error:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
