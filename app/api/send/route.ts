import { Resend } from "resend";
import { HnPost } from "../posts/route";

if (!process.env.RESEND_API_KEY) throw new Error("Missing RESEND_API_KEY")
const resend = new Resend(process.env.RESEND_API_KEY);

const RECIPIENTS = [
  "shimla06@student.sust.edu",
  "royantar1@gmail.com",
  "shimlakanu@gmail.com",
];


function buildEmailHtml(posts: HnPost[]): string {
  const rows = posts
    .map(
      (p, i) => `
    <tr>
      <td style="padding:16px 0;border-bottom:1px solid #eee;">
        <p style="margin:0 0 4px;font-size:15px;font-weight:600;">
          ${i + 1}. <a href="${p.url}" style="color:#e05c00;text-decoration:none;">${p.title}</a>
        </p>
        <p style="margin:0;font-size:12px;color:#888;">
          ▲ ${p.score} points &nbsp;·&nbsp; by ${p.by} &nbsp;·&nbsp;
          <a href="${p.hnLink}" style="color:#888;">💬 ${p.comments} comments</a>
        </p>
      </td>
    </tr>`
    )
    .join("");

  return `
    <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:24px;">
      <h2 style="color:#e05c00;margin-bottom:4px;">🔥 get-crunch — Daily Digest</h2>
      <p style="color:#888;margin-top:0;font-size:13px;">Curated from Hacker News</p>
      <table style="width:100%;border-collapse:collapse;">${rows}</table>
      <p style="font-size:11px;color:#bbb;margin-top:24px;">get-crunch · shimla.lol</p>
    </div>
  `;
}

export async function GET(): Promise<Response> {
  try {
    const baeseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
    const res = await fetch(`${baeseUrl}/api/posts`);
    const posts: HnPost[] = await res.json();

    if (!Array.isArray(posts) || posts.length === 0) {
      return Response.json({ error: "No posts fetched" }, { status: 500 });
    }
    // Take top 10 for now. Day 1 replaces this with AI-scored selection.
    const topPosts = posts.slice(0, 10);

    const { data, error } = await resend.emails.send({
      from: "get-crunch <digest@shimla.lol>",
      to: RECIPIENTS,
      subject: `🔥 get-crunch — ${new Date().toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      })}`,
      html: buildEmailHtml(topPosts),
    });

    if (error) {
      return Response.json({ error }, { status: 500 });
    }
    return Response.json({
          success: true,
          emailId: data?.id,
          sentTo: RECIPIENTS,
          postCount: topPosts.length,
        });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return Response.json({ error: message }, { status: 500 });
    }
}