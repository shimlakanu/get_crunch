import { z } from "zod";

export type StructuredFailureStage = "llm_request" | "json_recovery" | "zod_validation";

export interface StructuredOutputFailure {
  attempt: number;
  stage: StructuredFailureStage;
  error?: string;
  issues?: z.ZodIssue[];
  raw?: string;
}

interface RunStructuredOutputOptions<T> {
  basePrompt: string;
  attempts: number;
  schema: Record<string, unknown>;
  zodSchema: z.ZodType<T>;
  request: (prompt: string) => Promise<string>;
  requiredObjectKeys?: string[];
}

export interface RunStructuredOutputResult<T> {
  data: T | null;
  failures: StructuredOutputFailure[];
  attemptsUsed: number;
}

function scoreObjectCandidate(candidate: unknown, requiredKeys: string[]): number {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return -1;
  }
  const obj = candidate as Record<string, unknown>;
  return requiredKeys.reduce((acc, key) => acc + (key in obj ? 1 : 0), 0);
}

export function parseJsonWithRecovery(raw: string, requiredObjectKeys: string[] = []): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    const candidates: unknown[] = [];
    const firstBrace = raw.indexOf("{");
    const lastBrace = raw.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        candidates.push(JSON.parse(raw.slice(firstBrace, lastBrace + 1)));
      } catch {
        // Ignore candidate parse failure.
      }
    }

    const firstBracket = raw.indexOf("[");
    const lastBracket = raw.lastIndexOf("]");
    if (firstBracket !== -1 && lastBracket > firstBracket) {
      try {
        candidates.push(JSON.parse(raw.slice(firstBracket, lastBracket + 1)));
      } catch {
        // Ignore candidate parse failure.
      }
    }

    const objectMatches = raw.match(/\{[\s\S]*?\}/g) ?? [];
    for (const match of objectMatches) {
      try {
        candidates.push(JSON.parse(match));
      } catch {
        // Ignore candidate parse failure.
      }
    }

    const arrayMatches = raw.match(/\[[\s\S]*?\]/g) ?? [];
    for (const match of arrayMatches) {
      try {
        candidates.push(JSON.parse(match));
      } catch {
        // Ignore candidate parse failure.
      }
    }

    if (requiredObjectKeys.length > 0) {
      let bestCandidate: unknown = null;
      let bestScore = -1;
      for (const candidate of candidates) {
        const score = scoreObjectCandidate(candidate, requiredObjectKeys);
        if (score > bestScore) {
          bestScore = score;
          bestCandidate = candidate;
        }
      }
      if (bestCandidate && bestScore > 0) {
        return bestCandidate;
      }
    }

    if (candidates.length > 0) {
      return candidates[0];
    }

    throw new Error("No recoverable JSON payload found in model output.");
  }
}

function buildCorrectionFeedback(schema: Record<string, unknown>): string {
  return `Your previous response was invalid JSON.
Return ONLY valid JSON matching this schema:
${JSON.stringify(schema)}`;
}

export async function runStructuredOutputPipeline<T>(
  options: RunStructuredOutputOptions<T>
): Promise<RunStructuredOutputResult<T>> {
  const failures: StructuredOutputFailure[] = [];
  let correctionFeedback = "";

  for (let attempt = 1; attempt <= options.attempts; attempt++) {
    const prompt =
      correctionFeedback.length > 0
        ? `${options.basePrompt}\n\n${correctionFeedback}`
        : options.basePrompt;

    let raw = "";
    try {
      raw = await options.request(prompt);
    } catch (err) {
      failures.push({
        attempt,
        stage: "llm_request",
        error: err instanceof Error ? err.message : String(err),
      });
      correctionFeedback = buildCorrectionFeedback(options.schema);
      continue;
    }

    let recovered: unknown;
    try {
      recovered = parseJsonWithRecovery(raw, options.requiredObjectKeys ?? []);
    } catch (err) {
      failures.push({
        attempt,
        stage: "json_recovery",
        error: err instanceof Error ? err.message : String(err),
        raw,
      });
      correctionFeedback = buildCorrectionFeedback(options.schema);
      continue;
    }

    const validated = options.zodSchema.safeParse(recovered);
    if (!validated.success) {
      failures.push({
        attempt,
        stage: "zod_validation",
        issues: validated.error.issues,
        raw,
      });
      correctionFeedback = buildCorrectionFeedback(options.schema);
      continue;
    }

    return { data: validated.data, failures, attemptsUsed: attempt };
  }

  return { data: null, failures, attemptsUsed: options.attempts };
}
