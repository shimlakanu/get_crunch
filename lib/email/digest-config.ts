// Why hardcode recipients for now:
// Day 3 introduces per-user profiles and personalization.
// Until then, everyone gets the same digest.
export const DIGEST_RECIPIENTS = [
  "shimla06@student.sust.edu",
  "royantar1@gmail.com",
  "shimlakanu@gmail.com",
] as const;

export const DIGEST_FROM = "get-crunch <digest@shimla.lol>";

export function digestEmailSubject(date: Date = new Date()): string {
  return `🔥 get-crunch — ${date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  })}`;
}
