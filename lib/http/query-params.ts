/** Parse a positive integer from a query param; invalid or missing → `undefined`. */
export function parseOptionalPositiveInt(raw: string | null): number | undefined {
  if (raw === null || raw === "") return undefined;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n;
}
