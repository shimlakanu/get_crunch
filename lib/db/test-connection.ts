// lib/db/test-connection.ts
// This file is temporary — delete it after step 0.4.8 succeeds.
import { getErrorMessage } from "@/lib/http/route-error";
import { getDb } from "./client";

async function main() {
  console.log("Connecting to MongoDB...");
  const db = await getDb();
  
  // Insert a test document
  await db.collection("connection-test").insertOne({
    message: "Day 0 connection test",
    timestamp: new Date(),
  });
  
  console.log("✓ MongoDB connected and write successful");
  
  // Clean up the test document
  await db.collection("connection-test").deleteMany({});
  console.log("✓ Test document cleaned up");
  
  process.exit(0);
}

main().catch((err) => {
  console.error("✗ MongoDB connection failed:", getErrorMessage(err));
  process.exit(1);
});