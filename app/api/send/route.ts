// app/api/send/route.ts
import { logRouteErrorResponse } from "@/lib/http/route-error";

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
    return logRouteErrorResponse(err, "send");
  }
}
