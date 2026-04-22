/**
 * Hostname from an absolute URL, for model prompts and bucketing.
 * On parse failure, returns the original string (same as previous curator behavior).
 */
export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
