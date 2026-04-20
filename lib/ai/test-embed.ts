// Throwaway — delete after embedding pipeline is verified end-to-end.
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/** Load .env.local so FIREWORKS_API_KEY is set before fireworks.ts is evaluated. */
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
