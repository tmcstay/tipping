// Runs before `expo export` (see package.json's web:build and vercel.json's
// buildCommand) - writes the current commit's short SHA into .env.local as
// EXPO_PUBLIC_GIT_SHA, which Expo's own env loading picks up automatically
// (.env.local is gitignored and already loaded/overrides .env) and inlines
// into the client bundle at build time. Prefers Vercel's own
// VERCEL_GIT_COMMIT_SHA build-time env var when present (always accurate,
// no git CLI/history dependency in the build sandbox); falls back to
// `git rev-parse --short HEAD` for local builds; falls back to "dev" if
// neither is available (e.g. a git-less environment) rather than failing
// the build over a version label.
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

function resolveGitSha() {
  const vercelSha = process.env.VERCEL_GIT_COMMIT_SHA;
  if (vercelSha) return vercelSha.slice(0, 7);
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "dev";
  }
}

const sha = resolveGitSha();
const envLocalPath = join(dirname(fileURLToPath(import.meta.url)), "..", ".env.local");

// Only replaces our own line - never clobbers other local overrides a
// developer may have already added to .env.local.
const existingLines = existsSync(envLocalPath)
  ? readFileSync(envLocalPath, "utf8").split("\n").filter((line) => line.trim() && !line.startsWith("EXPO_PUBLIC_GIT_SHA="))
  : [];
writeFileSync(envLocalPath, [...existingLines, `EXPO_PUBLIC_GIT_SHA=${sha}`].join("\n") + "\n");
console.log(`generate-build-info: EXPO_PUBLIC_GIT_SHA=${sha}`);
