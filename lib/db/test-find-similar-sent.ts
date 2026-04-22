// Smoke-test findSimilarSentPosts against Atlas + Fireworks embeddings.
// Prereqs in .env.local: MONGODB_URI, MONGODB_VECTOR_SEARCH_INDEX, FIREWORKS_API_KEY.
// Atlas vector index must include sentAt as a filter field; posts need sentAt + embedding or results stay empty.

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/** Load .env.local so keys are set before vector-search → embeddings → fireworks load. */
function loadEnvLocal(): void {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  const content = readFileSync(path, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

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
