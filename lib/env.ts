// lib/env.ts
// Why this file exists:
// process.env returns `string | undefined` for every key.
// Without this file, every file that reads env vars has to handle
// the undefined case separately. With this file, you get:
// 1. A single place to see all required env vars
// 2. A clear error at startup if any are missing (not a silent undefined)
// 3. TypeScript knows these values are `string`, not `string | undefined`

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${key}\n` +
      `Add it to .env.local (local dev) and Vercel env vars (production).`
    );
  }
  return value;
}

export const env = {
  RESEND_API_KEY: requireEnv("RESEND_API_KEY"),
  MONGODB_URI: requireEnv("MONGODB_URI"),
  GOOGLE_AI_KEY: requireEnv("GOOGLE_AI_KEY"),
  // BASE_URL has a safe default for local dev, so it's not "required"
  BASE_URL: process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000",
} as const;