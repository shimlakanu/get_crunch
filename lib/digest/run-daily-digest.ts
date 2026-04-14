import { curateAndRank } from "@/lib/ai/curator";
import { markPostsSent, updatePostScore } from "@/lib/db/posts";
import { buildDigestEmailHtml } from "@/lib/email/build-digest-html";
import {
  DIGEST_FROM,
  DIGEST_RECIPIENTS,
  digestEmailSubject,
} from "@/lib/email/digest-config";
import { getResend } from "@/lib/email/resend";
import { fetchTopPostsAndPersist } from "@/lib/hn/fetch-top-posts";
import type { ScoredPost } from "@/lib/types";

export interface DailyDigestResult {
  emailId: string | undefined;
  sentTo: readonly string[];
  topPosts: Array<{ title: string; aiScore: number; reasoning: string }>;
}

export async function runDailyDigest(): Promise<DailyDigestResult> {
  console.log("[send] Starting digest pipeline...");

  const posts = await fetchTopPostsAndPersist();
  if (!Array.isArray(posts) || posts.length === 0) {
    throw new Error("No posts fetched from HN");
  }
  console.log(`[send] Fetched ${posts.length} posts from HN`);

  console.log("[send] Starting AI curation...");
  const scoredPosts = await curateAndRank(posts);
  console.log(`[send] Scored ${scoredPosts.length} posts`);

  for (const post of scoredPosts) {
    await updatePostScore(post.id, post.aiScore, post.reasoning, post.consistencyConfidence);
  }

  const topPosts: ScoredPost[] = scoredPosts.slice(0, 10);

  const resend = getResend();
  const { data, error } = await resend.emails.send({
    from: DIGEST_FROM,
    to: [...DIGEST_RECIPIENTS],
    subject: digestEmailSubject(),
    html: buildDigestEmailHtml(topPosts),
  });

  if (error) {
    console.error("[send] Resend error:", error);
    const detail =
      typeof error === "string"
        ? error
        : JSON.stringify(error);
    throw new Error(`Resend error: ${detail}`);
  }

  await markPostsSent(topPosts.map((p) => p.id));

  console.log(`[send] Success. Email ID: ${data?.id}`);

  return {
    emailId: data?.id,
    sentTo: DIGEST_RECIPIENTS,
    topPosts: topPosts.map((p) => ({
      title: p.title,
      aiScore: p.aiScore,
      reasoning: p.reasoning,
    })),
  };
}
