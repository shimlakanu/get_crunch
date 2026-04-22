// app/api/search/route.ts
import { parseOptionalPositiveInt } from "@/lib/http/query-params";
import { jsonErrorBody, logRouteErrorResponse } from "@/lib/http/route-error";
import { semanticSearch } from "@/lib/db/vector-search";

export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q");
    if (!q?.trim()) {
      return jsonErrorBody("Missing q", 400);
    }

    const limitOpt = parseOptionalPositiveInt(searchParams.get("limit"));

    const results = await semanticSearch(q, { limit: limitOpt });
    return Response.json({ query: q, results });
  } catch (err) {
    return logRouteErrorResponse(err, "search");
  }
}
