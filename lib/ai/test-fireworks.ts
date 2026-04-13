// lib/ai/test-fireworks.ts
// Temporary — delete after 0.5.4 succeeds.
import { generateText, generateJson, embedText } from "./fireworks";

async function main() {
  console.log("Testing generateText...");
  const text = await generateText('Say exactly: "get-crunch AI is ready"');
  console.log("✓ Text:", text);

  console.log("\nTesting generateJson...");
  const parsed = await generateJson<{ status: string }>(
    'Return a JSON object with one key "status" and value "ready"'
  );
  console.log("✓ JSON:", parsed);

  console.log("\nTesting embedText...");
  const vector = await embedText("Hacker News post about Rust");
  console.log(`✓ Embedding: ${vector.length} dimensions, first value: ${vector[0].toFixed(6)}`);

  process.exit(0);
}

main().catch((err) => {
  console.error("✗ Fireworks test failed:", err.message);
  process.exit(1);
});