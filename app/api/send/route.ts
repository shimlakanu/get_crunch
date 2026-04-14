// app/api/send/route.ts
import { runDailyDigest } from "@/lib/digest/run-daily-digest";

export async function GET(): Promise<Response> {
  try {
    const result = await runDailyDigest();
    return Response.json({
      success: true,
      emailId: result.emailId,
      sentTo: result.sentTo,
      topPosts: result.topPosts,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[send] Error:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
