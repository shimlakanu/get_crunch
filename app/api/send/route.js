import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

const RECIPIENTS = [
  "shimla06@student.sust.edu",
  "royantar1@gmail.com",
  "shimlakanu@gmail.com",
];

function buildEmailHtml(posts) {
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
          <a href="${p.hnLink}" style="color:#888;">💬 ${p.comments} comments</a> &nbsp;·&nbsp;
          posted ${new Date(p.postedAt).toUTCString()}
        </p>
      </td>
    </tr>`
    )
    .join("");

  return `
    <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:24px;">
      <h2 style="color:#e05c00;margin-bottom:4px;">🔥 HN Top 5 — Latest Stories</h2>
      <p style="color:#888;margin-top:0;font-size:13px;">Top 5 most recent stories from Hacker News top posts</p>
      <table style="width:100%;border-collapse:collapse;">
        ${rows}
      </table>
      <p style="font-size:11px;color:#bbb;margin-top:24px;">Sent by hn-digest · shimla.lol</p>
    </div>
  `;
}

export async function GET() {
  try {
    // Fetch posts from our own /api/posts
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
    const res = await fetch(`${baseUrl}/api/posts`);
    const posts = await res.json();

    if (!posts.length) {
      return Response.json({ error: "No posts fetched" }, { status: 500 });
    }

    const { data, error } = await resend.emails.send({
      from: "HN Digest <digest@shimla.lol>",
      to: RECIPIENTS,
      subject: `🔥 HN Top 5 — ${new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}`,
      html: buildEmailHtml(posts),
    });

    if (error) {
      return Response.json({ error }, { status: 500 });
    }

    return Response.json({ success: true, emailId: data.id, sentTo: RECIPIENTS, posts });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}