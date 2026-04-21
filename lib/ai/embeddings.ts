import type { HnPost } from "@/lib/types";

export { embedText } from "./fireworks";

function getSourceDomain(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host === "news.ycombinator.com" ? "self-post" : host;
  } catch {
    return "unknown";
  }
}

/** Short, source-aware string for semantic embedding of an HN post. */
export function buildEmbeddingText(post: HnPost): string {
  const source = getSourceDomain(post.url);
  return `Hacker News post: ${post.title} (source: ${source})`;

}
