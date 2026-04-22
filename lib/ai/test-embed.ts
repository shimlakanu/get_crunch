// Throwaway — delete after embedding pipeline is verified end-to-end.
import { loadEnvLocal } from "@/lib/load-env-local";

async function main() {
  loadEnvLocal();
  const { embedText } = await import("./fireworks");
  const vec = await embedText("hello world");
  console.log(`dimensions: ${vec.length}`);
  console.log(`first 5: ${vec.slice(0, 5).map((n) => n.toFixed(6)).join(", ")}`);
  if (vec.length !== 768) {
    console.error(`✗ expected 768 dims, got ${vec.length}`);
    process.exit(1);
  }
  console.log("✓ embedText round-trip OK");
  process.exit(0);
}

main().catch((err) => {
  console.error("✗ embedText failed:", err?.message ?? err);
  process.exit(1);
});
