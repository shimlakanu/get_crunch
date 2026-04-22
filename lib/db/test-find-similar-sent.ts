// Smoke-test findSimilarSentPosts against Atlas + Fireworks embeddings.
// Prereqs in .env.local: MONGODB_URI, MONGODB_VECTOR_SEARCH_INDEX, FIREWORKS_API_KEY.
// Atlas vector index must include sentAt as a filter field; posts need sentAt + embedding or results stay empty.

import { loadEnvLocal } from "@/lib/load-env-local";

async function main() {
  loadEnvLocal();
  const { findSimilarSentPosts } = await import("./vector-search");

  const query =
    typeof process.argv[2] === "string" && process.argv[2].trim().length > 0
      ? process.argv[2].trim()
      : "make code run faster";

  const limitArg = process.argv[3];
  const limitParsed = limitArg !== undefined ? Number.parseInt(limitArg, 10) : NaN;
  const limit = Number.isFinite(limitParsed) && limitParsed > 0 ? limitParsed : 5;

  const results = await findSimilarSentPosts(query, { limit });

  console.log(
    JSON.stringify(
      {
        query,
        count: results.length,
        results: results.map((r) => ({
          id: r.id,
          title: r.title,
          vectorScore: r.vectorScore,
          sentAt: r.sentAt,
        })),
      },
      null,
      2
    )
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err?.message ?? err);
  process.exit(1);
});
