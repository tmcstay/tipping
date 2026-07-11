import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

/**
 * Static/text-based checks against .github/workflows/grandtour-auto-dry-run.yml.
 * No YAML parser is a declared dependency of this project, so these are
 * plain substring/regex checks against the raw file - sufficient for the
 * specific, narrow properties below (a real parser wouldn't meaningfully
 * improve confidence here, and would add an undeclared/transitive
 * dependency this repo doesn't otherwise rely on).
 */

// Resolved relative to the current working directory, matching every other
// script in this repo (e.g. DEFAULT_REPORT_DIR in grandtour-auto-dry-run.mjs) -
// npm run test:data (and this file directly) are always run from the repo root.
const WORKFLOW_PATH = path.resolve(".github", "workflows", "grandtour-auto-dry-run.yml");

async function readWorkflow() {
  return fs.readFile(WORKFLOW_PATH, "utf8");
}

test("workflow cron is exactly '17 17 * * *'", async () => {
  const source = await readWorkflow();
  assert.match(source, /cron:\s*'17 17 \* \* \*'/);
});

test("workflow job timeout is sufficient for 1 initial + 8 retries * 15 minutes", async () => {
  const source = await readWorkflow();
  const match = source.match(/timeout-minutes:\s*(\d+)/);
  assert.ok(match, "timeout-minutes must be set on the job");
  const timeoutMinutes = Number(match[1]);
  // 8 retries * 15 minutes = 120 minutes of pure waiting at default
  // settings, plus per-attempt processing time.
  assert.ok(timeoutMinutes >= 150, `timeout-minutes (${timeoutMinutes}) should be at least 150`);
});

test("artifact upload step uses if: always()", async () => {
  const source = await readWorkflow();
  const uploadBlockMatch = source.match(/Upload auto dry-run report artifacts[\s\S]{0,600}/);
  assert.ok(uploadBlockMatch, "the artifact upload step must exist");
  assert.match(uploadBlockMatch[0], /if:\s*always\(\)/);
});

test("workflow never actually reads a service-role secret (prose mentioning the name is fine; an env/secrets reference is not)", async () => {
  const source = await readWorkflow();
  assert.ok(!/secrets\.SUPABASE_SERVICE_ROLE_KEY/i.test(source), "the workflow must never reference secrets.SUPABASE_SERVICE_ROLE_KEY");
  assert.ok(!/^\s*SUPABASE_SERVICE_ROLE_KEY:/im.test(source), "the workflow must never set a SUPABASE_SERVICE_ROLE_KEY env var");
});

test("workflow never actually invokes --apply, finalise, or score commands (prose explaining that it doesn't is fine)", async () => {
  const source = await readWorkflow();
  assert.ok(!/node scripts\/[\w.-]+\.mjs[^\n]*--apply/.test(source), "no node invocation may pass --apply");
  assert.ok(!/finalize_grandtour_stage_result|--finalise\b|--finalize\b/.test(source));
  assert.ok(!/recalculate_grandtour_stage_scores|--score\b/.test(source));
});

test("retry inputs (retry_interval_minutes, max_retries, no_retry) are declared and passed through to the wrapper", async () => {
  const source = await readWorkflow();
  assert.match(source, /retry_interval_minutes:/);
  assert.match(source, /max_retries:/);
  assert.match(source, /no_retry:/);
  assert.match(source, /--retry-interval-minutes "\$RETRY_INTERVAL_MINUTES"/);
  assert.match(source, /--max-retries "\$MAX_RETRIES"/);
  assert.match(source, /--no-retry/);
  // Defaults match the wrapper's own defaults.
  assert.match(source, /retry_interval_minutes \|\| '15'/);
  assert.match(source, /max_retries \|\| '8'/);
});

test("workflow uses a concurrency group and does not cancel in-progress runs", async () => {
  const source = await readWorkflow();
  assert.match(source, /concurrency:/);
  assert.match(source, /group:\s*grandtour-auto-dry-run-/);
  assert.match(source, /cancel-in-progress:\s*false/);
});

test("workflow uses Node-24-compatible action versions and Node 24 runtime", async () => {
  const source = await readWorkflow();
  assert.match(source, /actions\/checkout@v5/);
  assert.match(source, /actions\/setup-node@v5/);
  assert.match(source, /node-version:\s*'24'/);
});

test("workflow supports workflow_dispatch alongside the schedule", async () => {
  const source = await readWorkflow();
  assert.match(source, /workflow_dispatch:/);
  assert.match(source, /schedule:/);
});
