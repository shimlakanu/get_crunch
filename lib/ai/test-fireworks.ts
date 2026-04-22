// lib/ai/test-fireworks.ts
// Temporary — delete after 0.5.4 succeeds.
import { generateScore, embedText } from "./fireworks";

async function main() {
  console.log("Testing generateScore...");
  const text = await generateScore('Say exactly: "get-crunch AI is ready"');
  console.log("✓ Score:", text);

  console.log("\nTesting embedText...");
  const vector = await embedText("Hacker News post about Rust");
  console.log(`✓ Embedding: ${vector.length} dimensions, first value: ${vector[0].toFixed(6)}`);

  process.exit(0);
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("✗ Fireworks test failed:", msg);
  process.exit(1);
});



