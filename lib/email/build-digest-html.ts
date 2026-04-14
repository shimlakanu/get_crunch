import type { ScoredPost } from "@/lib/types";

export function buildDigestEmailHtml(posts: ScoredPost[]): string {
  const rows = posts
    .map(
      (p, i) => `
    <tr>
      <td style="padding:16px 0;border-bottom:1px solid #eee;">
        <p style="margin:0 0 4px;font-size:15px;font-weight:600;">
          ${i + 1}. <a href="${p.url}" style="color:#e05c00;text-decoration:none;">${p.title}</a>
        </p>
        <p style="margin:0;font-size:12px;color:#888;">
          ▲ ${p.score} HN points &nbsp;·&nbsp; by ${p.by} &nbsp;·&nbsp;
          <a href="${p.hnLink}" style="color:#888;">💬 ${p.comments} comments</a>
        </p>
        <p style="margin:4px 0 0;font-size:12px;color:#666;font-style:italic;">
          AI score: ${p.aiScore}/10 — ${p.reasoning}
        </p>
      </td>
    </tr>`
    )
    .join("");

  return `
    <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:24px;">
      <h2 style="color:#e05c00;margin-bottom:4px;">🔥 get-crunch — Daily Digest</h2>
      <p style="color:#888;margin-top:0;font-size:13px;">
        AI-curated from Hacker News · ${new Date().toLocaleDateString("en-US", {
          weekday: "long", month: "long", day: "numeric",
        })}
      </p>
      <table style="width:100%;border-collapse:collapse;">${rows}</table>
      <p style="font-size:11px;color:#bbb;margin-top:24px;">
        get-crunch · AI scores powered by Gemini 2.0 Flash
      </p>
    </div>
  `;
}
