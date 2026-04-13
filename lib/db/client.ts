// lib/db/client.ts
import { MongoClient, Db } from "mongodb";

// Why module-level variables instead of creating a new client every request:
// Vercel runs your code in serverless functions. A "warm" invocation reuses
// the same module (and these variables) from the previous call. A "cold"
// invocation starts fresh. By storing the client at module level, warm
// invocations reuse the existing TCP connection to Atlas instead of
// opening a new one — saves ~200-400ms per request.
let client: MongoClient | null = null;
let dbInstance: Db | null = null;

export async function getDb(): Promise<Db> {
  if (dbInstance) return dbInstance; // warm path — reuse

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error(
      "MONGODB_URI is not set. Add it to .env.local and Vercel environment variables."
    );
  }

  client = new MongoClient(uri);
  await client.connect();

  // "get-crunch" is the MongoDB database name.
  // Atlas creates it automatically the first time you write to it.
  // You do NOT need to create it manually in the Atlas UI.
  dbInstance = client.db("get-crunch");
  return dbInstance;
}