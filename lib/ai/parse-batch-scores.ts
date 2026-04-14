import type { BatchScoreResponse } from "@/lib/types";

function stripMarkdownFences(raw: string): string {
  let t = raw.trim();
  if (!t.startsWith("```")) return t;
  const firstNl = t.indexOf("\n");
  if (firstNl === -1) return t.replace(/^```\w*\s*/, "").replace(/```\s*$/, "").trim();
  t = t.slice(firstNl + 1);
  const fenceEnd = t.lastIndexOf("```");
  if (fenceEnd !== -1) {
    t = t.slice(0, fenceEnd);
  }
  return t.trim();
}

function parseJsonArrayLoose(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("[");
    const end = trimmed.lastIndexOf("]");
    if (start === -1 || end === -1 || end <= start) {
      throw new SyntaxError("No JSON array found in model output");
    }
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

/** Parses batch score JSON from plain completion output (may include fences or stray text). */
export function parseBatchScoresText(raw: string): BatchScoreResponse[] {
  const unfenced = stripMarkdownFences(raw);
  const parsed = parseJsonArrayLoose(unfenced);

  if (!Array.isArray(parsed)) {
    throw new Error(`Expected array, got ${typeof parsed}`);
  }

  return parsed.filter(
    (s): s is BatchScoreResponse =>
      typeof s === "object" &&
      s !== null &&
      typeof (s as BatchScoreResponse).id === "number" &&
      typeof (s as BatchScoreResponse).score === "number" &&
      typeof (s as BatchScoreResponse).reasoning === "string"
  );
}
