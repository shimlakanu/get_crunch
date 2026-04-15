// app/api/send/route.ts
export async function GET(): Promise<Response> {
  try {
    const { runDailyDigest } = await import("@/lib/digest/run-daily-digest");
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
