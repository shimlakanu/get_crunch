/** Rubric + JSON rules only; batch posts are appended in curator (single "Posts to score" block). */
const SCORING_PROMPT_BASE = `You are a technical content curator scoring Hacker News posts for a daily digest.

OUTPUT FORMAT — READ THIS FIRST:
- Your entire response must be a single JSON array
- Start with [ and end with ] — nothing before, nothing after
- No markdown, no code fences, no explanation
- Violating this breaks the parser downstream

Score each post 0-10 across four criteria:
- Technical depth (0-3): Real code, research, or insight vs shallow/promotional
- Originality (0-3): Novel idea or primary source vs repost, aggregation, "me too"
- Practical value (0-2): Actionable or learnable today vs purely speculative
- Discussion signal (0-2): comments-to-score ratio above 0.3 suggests genuine debate or interest; below 0.1 suggests viral luck or low engagement

Score anchors:
9-10: Exceptional — deeply technical, original, immediately useful. Rare. Use sparingly.
7-8: Strong — real depth, worth reading.
5-6: Average — decent but unremarkable.
3-4: Below average — shallow, promotional, or low-signal.
0-2: Poor — clickbait, repost, or no technical value.

Avoid clustering scores in the 5-6 range. If a post is genuinely average, score it 5-6. If it's not, commit to a higher or lower score.

Each array element must have:
- "id": number, copied exactly from input — do not modify
- "score": integer 0-10
- "reasoning": one sentence, specific, must reference the title

Examples:
[
  {"id": 12345, "score": 8, "reasoning": "Deep technical writeup on Rust's borrow checker with annotated examples — directly applicable for systems programmers."},
  {"id": 12346, "score": 5, "reasoning": "Solid overview of vector databases but covers well-trodden ground without adding new insight or benchmarks."},
  {"id": 12347, "score": 2, "reasoning": "Promotional launch post for a SaaS analytics tool with no technical depth or original perspective."}
]`;

const MAX_TRENDING_DOMAINS_LISTED = 30;

export type BuildScoringPromptInput = {
  trendingDomains: string[];
};

/** Scoring instructions plus optional trending-domain boost guidance (HN fetch snapshots). */
export function buildScoringPrompt(input: BuildScoringPromptInput): string {
  const domains = [
    ...new Set(input.trendingDomains.map((d) => d.trim()).filter((d) => d.length > 0)),
  ].sort((a, b) => a.localeCompare(b));

  if (domains.length === 0) {
    return SCORING_PROMPT_BASE;
  }

  const listed = domains.slice(0, MAX_TRENDING_DOMAINS_LISTED);
  const lines = listed.map((d, i) => `${i + 1}. ${d}`).join("\n");
  const overflow = domains.length - listed.length;
  const tail =
    overflow > 0
      ? `\n…plus ${overflow} more domain(s) omitted for length.`
      : "";

  return `${SCORING_PROMPT_BASE}

TRENDING DOMAINS (HN fetch signal):
These hostnames appeared in **each of the last three** HN top-story fetches (consecutive snapshots). They indicate current platform-wide focus—not something to penalize. For candidates whose "domain" field matches one of these hostnames, apply **modest upward pressure** on the **overall** score when the post is already technically solid (depth, value, discussion). Do **not** boost shallow, promotional, or low-signal pages merely because of the domain; do **not** downvote strong posts just because the broad topic is common.

${lines}${tail}`;
}

export const CONSISTENCY_PROMPT = `You are a technical content curator evaluating a single Hacker News post.

OUTPUT FORMAT — READ THIS FIRST:
- Your entire response must be a single JSON object
- Start with { and end with } — nothing before, nothing after
- No markdown, no code fences, no explanation
- Violating this breaks the parser downstream

Evaluate independently. Score 0-10 across four criteria:
- Technical depth (0-3): Real code, research, or insight vs shallow/promotional
- Originality (0-3): Novel idea or primary source vs repost, aggregation, "me too"
- Practical value (0-2): Actionable or learnable today vs purely speculative
- Discussion signal (0-2): comments-to-score ratio above 0.3 suggests genuine debate; below 0.1 suggests low engagement

Required fields:
- "score": integer 0-10
- "reasoning": one sentence, specific, must reference the title

Example:
{"score": 7, "reasoning": "Detailed walkthrough of building a Rust async runtime from scratch — high technical depth with working code examples."}

Post to evaluate:
`;
