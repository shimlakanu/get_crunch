// app/api/search/route.ts
import { semanticSearch } from "@/lib/db/vector-search";

export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q");
    if (!q?.trim()) {
      return Response.json({ error: "Missing q" }, { status: 400 });
    }

    const limitRaw = searchParams.get("limit");
    const limit =
      limitRaw === null || limitRaw === ""
        ? undefined
        : Number.parseInt(limitRaw, 10);
    const limitOpt =
      Number.isFinite(limit) && limit !== undefined ? limit : undefined;

    const results = await semanticSearch(q, { limit: limitOpt });
    return Response.json({ query: q, results });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[search] Error:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
