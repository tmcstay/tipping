import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";

import { buildNotificationEmail } from "./grandtour-auto-dry-run-notify.mjs";

function baseSummary(overrides = {}) {
  return {
    runId: "run-123",
    provider: "official-letour",
    grandTourName: "Tour de France",
    grandTourYear: 2026,
    stageNumber: 5,
    fromStage: 5,
    toStage: 5,
    attemptsMade: 1,
    maxRetries: 8,
    retryIntervalMinutes: 15,
    finalStatus: "success",
    safeToApply: true,
    parserDriftDetected: false,
    blockers: [],
    finalError: null,
    ...overrides
  };
}

test("buildNotificationEmail returns null for no_eligible_stage (never pages the admin for a routine day)", () => {
  assert.equal(buildNotificationEmail(baseSummary({ finalStatus: "no_eligible_stage" })), null);
});

test("buildNotificationEmail returns null for an unrecognized finalStatus", () => {
  assert.equal(buildNotificationEmail(baseSummary({ finalStatus: "something_new" })), null);
});

test("buildNotificationEmail: success email is plain-English and mentions the stage/tour", () => {
  const email = buildNotificationEmail(baseSummary());
  assert.match(email.subject, /Stage 5/);
  assert.match(email.subject, /Tour de France 2026/);
  assert.match(email.subject, /succeeded/);
  assert.match(email.body, /completed successfully/);
  assert.match(email.body, /safe to apply/i);
  assert.match(email.body, /Run ID: run-123/);
});

test("buildNotificationEmail: unsafe_review_required explains why in plain speak and lists blockers", () => {
  const email = buildNotificationEmail(baseSummary({
    finalStatus: "unsafe_review_required",
    safeToApply: false,
    blockers: ["1 rider match(es) are ambiguous.", "Missing yellow jersey holder."]
  }));
  assert.match(email.subject, /needs manual review/);
  assert.match(email.body, /NOT safe to apply automatically/);
  assert.match(email.body, /A human needs to review/);
  assert.match(email.body, /- 1 rider match\(es\) are ambiguous\./);
  assert.match(email.body, /- Missing yellow jersey holder\./);
});

test("buildNotificationEmail: parser_drift explains the likely cause and who needs to act", () => {
  const email = buildNotificationEmail(baseSummary({ finalStatus: "parser_drift", parserDriftDetected: true }));
  assert.match(email.subject, /letour\.fr page format may have changed/);
  assert.match(email.body, /letour\.fr changed their page layout/);
  assert.match(email.body, /a developer to update it/);
});

test("buildNotificationEmail: configuration_error explains nothing was fetched", () => {
  const email = buildNotificationEmail(baseSummary({
    finalStatus: "configuration_error",
    safeToApply: null,
    finalError: "Resolving the current stage from grandtour_stages requires SUPABASE_URL..."
  }));
  assert.match(email.subject, /configuration problem/);
  assert.match(email.body, /could not even start/);
  assert.match(email.body, /Error: Resolving the current stage/);
});

test("buildNotificationEmail: transient_failure_exhausted explains the retry count in plain speak", () => {
  const email = buildNotificationEmail(baseSummary({
    finalStatus: "transient_failure_exhausted",
    safeToApply: false,
    attemptsMade: 3,
    maxRetries: 2
  }));
  assert.match(email.subject, /failed after repeated retries/);
  assert.match(email.body, /gave up after 3 attempt\(s\)/);
  assert.match(email.body, /1 initial \+ up to 2 retries/);
  assert.match(email.body, /often resolves itself/);
});

test("buildNotificationEmail: unexpected_failure tells the admin a developer needs to look at logs", () => {
  const email = buildNotificationEmail(baseSummary({ finalStatus: "unexpected_failure", safeToApply: null, finalError: "boom" }));
  assert.match(email.subject, /failed unexpectedly/);
  assert.match(email.body, /doesn't match any known, expected failure type/);
  assert.match(email.body, /Error: boom/);
});

test("buildNotificationEmail includes the run URL when provided", () => {
  const email = buildNotificationEmail(baseSummary({ runUrl: "https://github.com/tmcstay/tipping/actions/runs/999" }));
  assert.match(email.body, /View full run: https:\/\/github\.com\/tmcstay\/tipping\/actions\/runs\/999/);
});

test("buildNotificationEmail never includes a secret-looking field even if accidentally present on the input object", () => {
  const email = buildNotificationEmail(baseSummary({ SUPABASE_SERVICE_ROLE_KEY: "shhh" }));
  assert.ok(!email.body.includes("shhh"));
  assert.ok(!email.subject.includes("shhh"));
});

test("buildNotificationEmail describes a stage range when stageNumber is absent", () => {
  const email = buildNotificationEmail(baseSummary({ stageNumber: null, fromStage: 3, toStage: 6 }));
  assert.match(email.subject, /Stages 3-6/);
  assert.match(email.body, /Stages 3-6/);
});

// ---------------------------------------------------------------------------
// CLI: prepares should_send/subject/body_path via $GITHUB_OUTPUT and writes
// the body to a file, matching what the workflow step expects to read.
// ---------------------------------------------------------------------------

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "grandtour-notify-"));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("CLI: writes should_send=true, a subject, and a body file to $GITHUB_OUTPUT for a paging outcome", async () => {
  await withTempDir(async (dir) => {
    const summaryPath = path.join(dir, "final-summary.json");
    await fs.writeFile(summaryPath, JSON.stringify(baseSummary()), "utf8");
    const githubOutputPath = path.join(dir, "github-output.txt");
    await fs.writeFile(githubOutputPath, "", "utf8");

    execFileSync(process.execPath, [
      new URL("./grandtour-auto-dry-run-notify.mjs", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
      summaryPath,
      "--run-url", "https://example.test/run/1",
      "--out-dir", dir
    ], {
      env: { ...process.env, GITHUB_OUTPUT: githubOutputPath }
    });

    const output = await fs.readFile(githubOutputPath, "utf8");
    assert.match(output, /should_send=true/);
    assert.match(output, /subject=\[GrandTour\]/);
    assert.match(output, /body_path=/);

    const bodyPath = path.join(dir, "notify-email-body.txt");
    const body = await fs.readFile(bodyPath, "utf8");
    assert.match(body, /completed successfully/);
    assert.match(body, /View full run: https:\/\/example\.test\/run\/1/);
  });
});

test("CLI: writes should_send=false for no_eligible_stage and does not write a body file", async () => {
  await withTempDir(async (dir) => {
    const summaryPath = path.join(dir, "final-summary.json");
    await fs.writeFile(summaryPath, JSON.stringify(baseSummary({ finalStatus: "no_eligible_stage" })), "utf8");
    const githubOutputPath = path.join(dir, "github-output.txt");
    await fs.writeFile(githubOutputPath, "", "utf8");

    execFileSync(process.execPath, [
      new URL("./grandtour-auto-dry-run-notify.mjs", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
      summaryPath,
      "--out-dir", dir
    ], {
      env: { ...process.env, GITHUB_OUTPUT: githubOutputPath }
    });

    const output = await fs.readFile(githubOutputPath, "utf8");
    assert.match(output, /should_send=false/);

    const bodyPath = path.join(dir, "notify-email-body.txt");
    await assert.rejects(() => fs.access(bodyPath));
  });
});
