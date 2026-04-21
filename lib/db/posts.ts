import { Collection } from "mongodb";
import { getDb } from "./client";
import type { HnPost, StoredPost } from "@/lib/types";


async function getPostsCollection(): Promise<Collection<StoredPost>> {
  const db = await getDb();
  // MongoDB creates the "posts" collection automatically on first write.
  // The generic <StoredPost> tells TypeScript what shape documents in
  // this collection have — gives you autocomplete and type checking on queries.
  return db.collection<StoredPost>("posts");
}

// storePosts: save a batch of fetched posts to MongoDB.
// Uses upsert (update if exists, insert if not) keyed on the HN post id.
// Why upsert and not insert: the same post may appear in top stories
// across multiple fetches. Upsert prevents duplicate documents.
export async function storePosts(posts: HnPost[]): Promise<void> {
  const collection = await getPostsCollection();
  
  const operations = posts.map((post) => ({
    updateOne: {
      filter: { id: post.id },
      update: {
        $set: {
          ...post,
          fetchedAt: new Date(),
        },
      },
      upsert: true, // create document if id doesn't exist
    },
  }));

  // bulkWrite sends all operations in one network round-trip.
  // Why not insertMany: insertMany fails if any document already exists.
  // Why not a loop of updateOne calls: each would be a separate network round-trip.
  await collection.bulkWrite(operations);
}

// updatePostScore: add AI scoring fields to an existing post document.
// Called after agent returns scores for a batch.
export async function updatePostScore(
  postId: number,
  score: number,
  reasoning: string,
  consistencyConfidence?: number
): Promise<void> {
  const collection = await getPostsCollection();
  await collection.updateOne(
    { id: postId },
    {
      $set: {
        aiScore: score,
        reasoning,
        ...(consistencyConfidence !== undefined && { consistencyConfidence }),
      },
    }
  );
}

// updatePostEmbedding: persist the semantic vector for a post (768 dims with current model).
export async function updatePostEmbedding(
  postId: number,
  embedding: number[]
): Promise<void> {
  const collection = await getPostsCollection();
  await collection.updateOne({ id: postId }, { $set: { embedding } });
}

// getTopScoredPosts: retrieve the N highest-scored posts from today's fetch.
// "Today" = fetched within the last 4 hours (2 cron runs per day means
// the freshest batch is always within 12 hours, but 4 hours is a safe window).
export async function getTopScoredPosts(limit: number = 10): Promise<StoredPost[]> {
  const collection = await getPostsCollection();
  const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);

  return collection
    .find({
      aiScore: { $exists: true }, // only posts that have been scored
      fetchedAt: { $gte: fourHoursAgo }, // from the recent fetch batch
    })
    .sort({ aiScore: -1 }) // highest score first
    .limit(limit)
    .toArray();
}

// markPostsSent: record when posts were included in an email.
// Used Day 2+ for RAG deduplication (don't send the same topic twice this week).
export async function markPostsSent(postIds: number[]): Promise<void> {
  const collection = await getPostsCollection();
  await collection.updateMany(
    { id: { $in: postIds } },
    { $set: { sentAt: new Date() } }
  );
}