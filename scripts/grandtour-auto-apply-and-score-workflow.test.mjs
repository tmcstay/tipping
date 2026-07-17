import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

/**
 * Static/text-based checks against
 * .github/workflows/grandtour-auto-apply-and-score.yml, mirroring
 * grandtour-auto-dry-run-workflow.test.mjs's own conventions (plain
 * substring/regex checks, no YAML parser dependency) but focused on this
 * workflow's own load-bearing safety properties: it owns the schedule slot
 * the dry-run-only workflow gave up, it always passes --confirm-production,
 * it never hard-codes a secret, its kill-switch (missing write-phase
 * credentials) never fails the job, and it reads
 * final-write-summary.json specifically.
 */

const WORKFLOW_PATH = path.resolve(".github", "workflows", "grandtour-auto-apply-and-score.yml");

async function readWorkflow() {
  return fs.readFile(WORKFLOW_PATH, "utf8");
}

test("workflow cron is exactly '30 19 * * *' (stage start 12:00 UTC + 7.5h grace) - the slot the dry-run-only workflow gave up", async () => {
  const source = await readWorkflow();
  assert.match(source, /cron:\s*'30 19 \* \* \*'/);
});

test("workflow calls the write-pipeline orchestrator script, not the plain dry-run script directly", async () => {
  const source = await readWorkflow();
  assert.match(source, /node scripts\/grandtour-auto-apply-and-score\.mjs/);
});

test("--confirm-production is always passed, unconditionally", async () => {
  const source = await readWorkflow();
  const runStepMatch = source.match(/Run GrandTour automatic apply & score pipeline[\s\S]*?run: \|[\s\S]*?(?=\n {6}- name:|$)/);
  assert.ok(runStepMatch, "the main run step must exist");
  assert.match(runStepMatch[0], /--confirm-production/);
  // Must be an unconditional array entry, not gated behind an `if` shell test.
  assert.match(runStepMatch[0], /args=\(\n[\s\S]*?--confirm-production\n[\s\S]*?\)/);
});

test("the four write-phase credentials are wired from secrets into the run step's env, never hard-coded", async () => {
  const source = await readWorkflow();
  const runStepMatch = source.match(/Run GrandTour automatic apply & score pipeline[\s\S]*?(?=\n {6}- name:|$)/);
  assert.ok(runStepMatch, "the main run step must exist");
  const step = runStepMatch[0];
  assert.match(step, /SUPABASE_SERVICE_ROLE_KEY:\s*\$\{\{\s*secrets\.SUPABASE_SERVICE_ROLE_KEY\s*\}\}/);
  assert.match(step, /SUPABASE_ADMIN_EMAIL:\s*\$\{\{\s*secrets\.SUPABASE_ADMIN_EMAIL\s*\}\}/);
  assert.match(step, /SUPABASE_ADMIN_PASSWORD:\s*\$\{\{\s*secrets\.SUPABASE_ADMIN_PASSWORD\s*\}\}/);
  assert.match(step, /ADMIN_USER_ID:\s*\$\{\{\s*secrets\.ADMIN_USER_ID\s*\}\}/);
});

test("write-phase credential presence is only ever checked as a boolean, never printed as a value", async () => {
  const source = await readWorkflow();
  assert.match(source, /HAS_SERVICE_ROLE_KEY:\s*\$\{\{\s*secrets\.SUPABASE_SERVICE_ROLE_KEY\s*!=\s*''\s*\}\}/);
  assert.match(source, /HAS_ADMIN_EMAIL:\s*\$\{\{\s*secrets\.SUPABASE_ADMIN_EMAIL\s*!=\s*''\s*\}\}/);
  assert.match(source, /HAS_ADMIN_PASSWORD:\s*\$\{\{\s*secrets\.SUPABASE_ADMIN_PASSWORD\s*!=\s*''\s*\}\}/);
  assert.match(source, /HAS_ADMIN_USER_ID:\s*\$\{\{\s*secrets\.ADMIN_USER_ID\s*!=\s*''\s*\}\}/);
  // The diagnostics step must echo only the boolean env vars, never a raw secrets.* value.
  const diagBlockMatch = source.match(/Print trigger diagnostics[\s\S]{0,2500}?(?=\n {6}- name:)/);
  assert.ok(diagBlockMatch, "the trigger diagnostics step must exist");
  assert.ok(!/secrets\./.test(diagBlockMatch[0]), "the diagnostics step must never reference secrets.* directly");
  assert.match(diagBlockMatch[0], /::notice title=GrandTour write phase disabled::/);
});

test("a missing write-phase credential never fails the job (the orchestrator itself gracefully skips the write phase)", async () => {
  const source = await readWorkflow();
  const diagBlockMatch = source.match(/Print trigger diagnostics[\s\S]{0,2500}?(?=\n {6}- name:)/);
  assert.ok(diagBlockMatch);
  assert.ok(!/exit 1/.test(diagBlockMatch[0]), "the diagnostics step must never itself fail the job over missing credentials");
});

test("reads final-write-summary.json specifically, never the plain final-summary.json", async () => {
  const source = await readWorkflow();
  assert.match(source, /-name\s+final-write-summary\.json/);
  assert.ok(!/-name\s+final-summary\.json/.test(source), "must look for the write pipeline's own superset summary file, not the plain dry-run one");
});

test("uses a distinct artifact name from the dry-run-only workflow's own upload", async () => {
  const source = await readWorkflow();
  assert.match(source, /name:\s*grandtour-auto-apply-and-score-report/);
  assert.ok(!/name:\s*grandtour-auto-dry-run-report/.test(source));
});

test("uses a distinct concurrency group from the dry-run-only workflow", async () => {
  const source = await readWorkflow();
  assert.match(source, /concurrency:/);
  assert.match(source, /group:\s*grandtour-auto-apply-and-score-/);
  assert.match(source, /cancel-in-progress:\s*false/);
});

test("workflow job timeout is at least as generous as the dry-run-only workflow's own budget", async () => {
  const source = await readWorkflow();
  const match = source.match(/timeout-minutes:\s*(\d+)/);
  assert.ok(match, "timeout-minutes must be set on the job");
  assert.ok(Number(match[1]) >= 150, `timeout-minutes (${match[1]}) should be at least 150`);
});

test("workflow uses Node-24-compatible action versions and Node 24 runtime", async () => {
  const source = await readWorkflow();
  assert.match(source, /actions\/checkout@v5/);
  assert.match(source, /actions\/setup-node@v5/);
  assert.match(source, /node-version:\s*'24'/);
});

test("workflow builds and sends an admin notification email using SMTP secrets, never a hard-coded password", async () => {
  const source = await readWorkflow();
  assert.match(source, /Build admin notification email/);
  assert.match(source, /node scripts\/grandtour-auto-dry-run-notify\.mjs/);
  assert.match(source, /Send admin notification email/);
  assert.match(source, /dawidd6\/action-send-mail@v4/);
  assert.match(source, /secrets\.SMTP_SERVER/);
  assert.match(source, /secrets\.SMTP_PASSWORD/);
  assert.match(source, /secrets\.ADMIN_EMAIL/);
  assert.match(source, /steps\.notify\.outputs\.should_send == 'true'/);
});

test("the mail step is guarded on env.SMTP_*/env.ADMIN_EMAIL all being non-empty, and never fails the job when they are not set", async () => {
  const source = await readWorkflow();
  const mailStepMatch = source.match(/Send admin notification email[\s\S]*?(?=\n {6}- name:)/);
  assert.ok(mailStepMatch, "the mail step must exist");
  assert.match(mailStepMatch[0], /always\(\)/);
  assert.match(mailStepMatch[0], /env\.SMTP_SERVER\s*!=\s*''/);
  assert.match(mailStepMatch[0], /env\.ADMIN_EMAIL\s*!=\s*''/);
});

test("a separate step notices (without failing the job) when SMTP is not configured", async () => {
  const source = await readWorkflow();
  const noticeStepMatch = source.match(/- name: Notify - SMTP not configured[\s\S]*?(?=\n {6}- name:|$)/);
  assert.ok(noticeStepMatch, "an SMTP-not-configured notice step must exist");
  assert.match(noticeStepMatch[0], /always\(\)/);
  assert.match(noticeStepMatch[0], /::notice/);
  assert.ok(!/exit 1/.test(noticeStepMatch[0]));
});

test("workflow_dispatch is supported for ad hoc runs, alongside the schedule", async () => {
  const source = await readWorkflow();
  assert.match(source, /workflow_dispatch:/);
  assert.match(source, /schedule:/);
});
