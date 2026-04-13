import { Collection, Document } from "mongodb";
import { getDb } from "./client";
import { HnPost } from "@/app/api/posts/route";

// StoredPost: what we actually persist in MongoDB.
// Extends HnPost with AI scoring fields that get added during curation.
// Fields optional because a freshly fetched post doesn't have scores yet.
export interface StoredPost extends HnPost {
  aiScore?: number;
  reasoning?: string;
  consistencyConfidence?: number; // only present on posts that went through self-consistency
  embedding?: number[];           // added Day 2
  enrichment?: PostEnrichment;    // added Day 4
  fetchedAt: Date;                // when this post was retrieved from HN API
  sentAt?: Date;                  // when this post was included in an email
}

// PostEnrichment: added Day 4, defined here so the StoredPost type is stable.
// Defining it now prevents TypeScript errors when you reference it later.
export interface PostEnrichment {
  keyInsight: string;
  controversyScore: number;
  consensusView: string;
  commentHighlight: string;
  enrichedAt: Date;
}

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
// Called after Gemini returns scores for a batch.
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