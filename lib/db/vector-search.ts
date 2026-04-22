// Atlas Vector Search over `posts.embedding` (768-dim, same model as embedText).
//
// Prerequisite: create an Active vector index on database `get-crunch`, collection `posts`:
// - Path: embedding
// - Dimensions: 768
// - Similarity: cosine
// Set MONGODB_VECTOR_SEARCH_INDEX to the index name exactly as defined in Atlas.
//
// findSimilarSentPosts also requires `sentAt` mapped as a filter field on that same index.
import type { Document } from "mongodb";
import { embedText } from "@/lib/ai/embeddings";
import { getDb } from "@/lib/db/client";
import type { StoredPost } from "@/lib/types";

/** Post fields plus vector relevance (not HN points `score`). */
export type SemanticSearchHit = Omit<StoredPost, "embedding"> & {
  vectorScore: number;
};

const projectStage: Document = {
  $project: {
    _id: 0,
    id: 1,
    title: 1,
    url: 1,
    score: 1,
    by: 1,
    comments: 1,
    postedAt: 1,
    hnLink: 1,
    aiScore: 1,
    reasoning: 1,
    consistencyConfidence: 1,
    enrichment: 1,
    fetchedAt: 1,
    sentAt: 1,
    vectorScore: { $meta: "vectorSearchScore" },
  },
};

function roundVectorScore(rows: SemanticSearchHit[]): SemanticSearchHit[] {
  return rows.map((row) => ({
    ...row,
    vectorScore: Math.round(row.vectorScore * 1000) / 1000,
  }));
}

async function executeVectorSearch(
  trimmedQuery: string,
  options?: { limit?: number; numCandidates?: number; filter?: Document }
): Promise<SemanticSearchHit[]> {
  const indexName = process.env.MONGODB_VECTOR_SEARCH_INDEX;
  if (!indexName) {
    throw new Error(
      "MONGODB_VECTOR_SEARCH_INDEX is not set. Create an Atlas vector index on posts.embedding (768 dims, cosine) and set this env var to the index name."
    );
  }

  const limit = Math.min(Math.max(options?.limit ?? 10, 1), 50);
  const numCandidates = Math.min(Math.max(options?.numCandidates ?? 150, limit), 500);

  const queryVector = await embedText(trimmedQuery);
  const db = await getDb();
  const collectionPosts = db.collection<StoredPost>("posts");

  const vectorSearchStage: Document = {
    index: indexName,
    path: "embedding",
    queryVector,
    numCandidates,
    limit,
  };
  if (options?.filter) {
    vectorSearchStage.filter = options.filter;
  }

  const pipeline: Document[] = [{ $vectorSearch: vectorSearchStage }, projectStage];

  const rows = await collectionPosts
    .aggregate<SemanticSearchHit>(pipeline)
    .toArray();

  return roundVectorScore(rows);
}

export async function semanticSearch(
  query: string,
  options?: { limit?: number; numCandidates?: number }
): Promise<SemanticSearchHit[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    throw new Error("semanticSearch query must not be empty");
  }
  return executeVectorSearch(trimmed, options);
}

/** Like semanticSearch, but only posts that have been sent (sentAt set). */
export async function findSimilarSentPosts(
  query: string,
  options?: { limit?: number; numCandidates?: number }
): Promise<SemanticSearchHit[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    throw new Error("findSimilarSentPosts query must not be empty");
  }
  return executeVectorSearch(trimmed, {
    ...options,
    filter: { sentAt: { $exists: true } },
  });
}
