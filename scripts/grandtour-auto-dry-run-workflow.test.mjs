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

test("workflow cron is exactly '30 19 * * *' (stage start 12:00 UTC + 7.5h grace)", async () => {
  const source = await readWorkflow();
  assert.match(source, /cron:\s*'30 19 \* \* \*'/);
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
  const uploadBlockMatch = source.match(/Upload auto dry-run report artifacts[\s\S]{0,1500}/);
  assert.ok(uploadBlockMatch, "the artifact upload step must exist");
  assert.match(uploadBlockMatch[0], /if:\s*always\(\)/);
});

test("print final summary step uses if: always()", async () => {
  const source = await readWorkflow();
  const stepBlockMatch = source.match(/Print final summary[\s\S]{0,1000}/);
  assert.ok(stepBlockMatch, "the print-final-summary step must exist");
  assert.match(stepBlockMatch[0], /if:\s*always\(\)/);
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
  // Defaults match the wrapper's own defaults, applied in the "Resolve
  // effective parameters" step rather than scattered `||` fallbacks on
  // github.event.inputs.* throughout the run command.
  assert.match(source, /retry_interval_minutes='15'/);
  assert.match(source, /max_retries='8'/);
  assert.match(source, /IN_RETRY_INTERVAL_MINUTES:-15/);
  assert.match(source, /IN_MAX_RETRIES:-8/);
});

test("new stage-availability-grace-hours/allow-rerun-completed inputs are declared and passed through", async () => {
  const source = await readWorkflow();
  assert.match(source, /stage_availability_grace_hours:/);
  assert.match(source, /allow_rerun_completed:/);
  assert.match(source, /--stage-availability-grace-hours "\$STAGE_AVAILABILITY_GRACE_HOURS"/);
  assert.match(source, /--allow-rerun-completed/);
  assert.match(source, /stage_availability_grace_hours='7\.5'/);
  assert.match(source, /allow_rerun_completed='false'/);
});

test("effective parameters are resolved once into step outputs, not scattered as github.event.inputs.* through the run command", async () => {
  const source = await readWorkflow();
  assert.match(source, /Resolve effective parameters/);
  assert.match(source, /id:\s*params/);
  assert.match(source, />> "\$GITHUB_OUTPUT"/);
  assert.match(source, /if \[ "\$EVENT_NAME" = "schedule" \]/);

  // The run step (env: block) must only read steps.params.outputs.*, never
  // github.event.inputs.* directly - the concurrency: block is the one
  // documented, unavoidable exception (it runs before any step and cannot
  // reference step outputs).
  const runStepMatch = source.match(/Run GrandTour automatic dry-run collection[\s\S]*?run: \|[\s\S]*?(?=\n {6}- name:|$)/);
  assert.ok(runStepMatch, "the main run step must exist");
  assert.ok(!/github\.event\.inputs/.test(runStepMatch[0]), "the run step must read steps.params.outputs.*, not github.event.inputs.* directly");
  assert.match(runStepMatch[0], /steps\.params\.outputs\.grand_tour_name/);
});

test("trigger diagnostics step prints event/ref/default-branch/UTC time and resolved parameters, never secrets", async () => {
  const source = await readWorkflow();
  const diagBlockMatch = source.match(/Print trigger diagnostics[\s\S]{0,2000}?(?=\n {6}- name:)/);
  assert.ok(diagBlockMatch, "the trigger diagnostics step must exist");
  const diag = diagBlockMatch[0];
  assert.match(diag, /github\.event_name/);
  assert.match(diag, /github\.ref/);
  assert.match(diag, /github\.event\.repository\.default_branch/);
  assert.match(diag, /date -u/);
  assert.match(diag, /auto_resolution_used/);
  assert.ok(!/secrets\./.test(diag), "the diagnostics step must never print a secret");
});

test("workflow documents that scheduled runs use only the default-branch workflow file", async () => {
  const source = await readWorkflow();
  assert.match(source, /schedule.*trigger.*default[- ]branch|default[- ]branch.*schedule/is);
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

test("workflow builds and sends an admin notification email using SMTP secrets, never a hard-coded password", async () => {
  const source = await readWorkflow();
  assert.match(source, /Build admin notification email/);
  assert.match(source, /node scripts\/grandtour-auto-dry-run-notify\.mjs/);
  assert.match(source, /Send admin notification email/);
  assert.match(source, /dawidd6\/action-send-mail@v4/);
  assert.match(source, /secrets\.SMTP_SERVER/);
  assert.match(source, /secrets\.SMTP_PORT/);
  assert.match(source, /secrets\.SMTP_USERNAME/);
  assert.match(source, /secrets\.SMTP_PASSWORD/);
  assert.match(source, /secrets\.ADMIN_EMAIL/);
  assert.match(source, /steps\.notify\.outputs\.should_send == 'true'/);
});

test("SMTP secrets are mapped into job-level env vars, never referenced directly inside an if: expression", async () => {
  const source = await readWorkflow();

  // Job-level `env:` block mapping every SMTP secret (plus the recipient)
  // to a plain env var - this is what makes it safe to test them in `if:`.
  assert.match(source, /env:\s*\n\s*SMTP_SERVER:\s*\$\{\{\s*secrets\.SMTP_SERVER\s*\}\}/);
  assert.match(source, /SMTP_PORT:\s*\$\{\{\s*secrets\.SMTP_PORT\s*\}\}/);
  assert.match(source, /SMTP_USERNAME:\s*\$\{\{\s*secrets\.SMTP_USERNAME\s*\}\}/);
  assert.match(source, /SMTP_PASSWORD:\s*\$\{\{\s*secrets\.SMTP_PASSWORD\s*\}\}/);
  assert.match(source, /ADMIN_EMAIL:\s*\$\{\{\s*secrets\.ADMIN_EMAIL\s*\}\}/);

  // No `if:` line anywhere in the file may reference secrets.* directly.
  const ifLines = source.split("\n").filter((line) => /^\s*if:/.test(line) || /^\s*(always\(\)|env\.)/.test(line.trim()));
  for (const line of ifLines) {
    assert.ok(!/secrets\./.test(line), `if-expression line must not reference secrets.* directly: ${line}`);
  }
});

test("the mail step is guarded on env.SMTP_*/env.ADMIN_EMAIL all being non-empty, and never fails the job when they are not set", async () => {
  const source = await readWorkflow();
  const mailStepMatch = source.match(/Send admin notification email[\s\S]*?(?=\n {6}- name:)/);
  assert.ok(mailStepMatch, "the mail step must exist");
  const mailStep = mailStepMatch[0];

  assert.match(mailStep, /always\(\)/);
  assert.match(mailStep, /env\.SMTP_SERVER\s*!=\s*''/);
  assert.match(mailStep, /env\.SMTP_PORT\s*!=\s*''/);
  assert.match(mailStep, /env\.SMTP_USERNAME\s*!=\s*''/);
  assert.match(mailStep, /env\.SMTP_PASSWORD\s*!=\s*''/);
  assert.match(mailStep, /env\.ADMIN_EMAIL\s*!=\s*''/);
});

test("a separate step notices (without failing the job) when SMTP is not configured", async () => {
  const source = await readWorkflow();
  const noticeStepMatch = source.match(/- name: Notify - SMTP not configured[\s\S]*?(?=\n {6}- name:|$)/);
  assert.ok(noticeStepMatch, "an SMTP-not-configured notice step must exist");
  const noticeStep = noticeStepMatch[0];

  assert.match(noticeStep, /always\(\)/);
  assert.match(noticeStep, /::notice/);
  // Must never itself set a failing exit code / use `exit 1` etc.
  assert.ok(!/exit 1/.test(noticeStep));
});
