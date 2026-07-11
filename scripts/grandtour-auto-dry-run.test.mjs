import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  classifyAutoDryRunFailure,
  DEFAULT_MAX_RETRIES,
  DEFAULT_RETRY_INTERVAL_MINUTES,
  main,
  parseAutoDryRunArgs,
  resolveStageRange,
  summarizeAutoDryRunReport
} from "./grandtour-auto-dry-run.mjs";

test("parseAutoDryRunArgs applies documented defaults", () => {
  const options = parseAutoDryRunArgs([]);
  assert.equal(options.grandTourName, "Tour de France");
  assert.equal(options.grandTourYear, 2026);
  assert.equal(options.provider, "official-letour");
  assert.equal(options.stageNumber, null);
  assert.equal(options.fromStage, null);
  assert.equal(options.toStage, null);
  assert.equal(options.failOnUnsafe, true);
  assert.equal(options.retryIntervalMinutes, DEFAULT_RETRY_INTERVAL_MINUTES);
  assert.equal(options.maxRetries, DEFAULT_MAX_RETRIES);
  assert.equal(options.noRetry, false);
  assert.equal(DEFAULT_RETRY_INTERVAL_MINUTES, 15);
  assert.equal(DEFAULT_MAX_RETRIES, 8);
});

test("parseAutoDryRunArgs: --stage-number sets from/to to the same single stage", () => {
  const options = parseAutoDryRunArgs(["--stage-number", "5"]);
  assert.equal(options.fromStage, 5);
  assert.equal(options.toStage, 5);
});

test("parseAutoDryRunArgs: --from-stage/--to-stage set a range", () => {
  const options = parseAutoDryRunArgs(["--from-stage", "3", "--to-stage", "6"]);
  assert.equal(options.fromStage, 3);
  assert.equal(options.toStage, 6);
});

test("parseAutoDryRunArgs: --stage-number takes priority over --from-stage/--to-stage", () => {
  const options = parseAutoDryRunArgs(["--from-stage", "3", "--to-stage", "6", "--stage-number", "9"]);
  assert.equal(options.fromStage, 9);
  assert.equal(options.toStage, 9);
});

test("parseAutoDryRunArgs: --from-stage without --to-stage is rejected", () => {
  assert.throws(() => parseAutoDryRunArgs(["--from-stage", "3"]), /must both be provided together/);
});

test("parseAutoDryRunArgs: --to-stage before --from-stage is rejected", () => {
  assert.throws(() => parseAutoDryRunArgs(["--from-stage", "6", "--to-stage", "3"]), /--to-stage must be greater than or equal to --from-stage/);
});

test("parseAutoDryRunArgs: --fail-on-unsafe accepts true/false and rejects other values", () => {
  assert.equal(parseAutoDryRunArgs(["--fail-on-unsafe", "false"]).failOnUnsafe, false);
  assert.equal(parseAutoDryRunArgs(["--fail-on-unsafe", "true"]).failOnUnsafe, true);
  assert.throws(() => parseAutoDryRunArgs(["--fail-on-unsafe", "maybe"]), /requires 'true' or 'false'/);
});

test("parseAutoDryRunArgs: --retry-interval-minutes/--max-retries/--no-retry parse correctly", () => {
  const options = parseAutoDryRunArgs(["--retry-interval-minutes", "10", "--max-retries", "3", "--no-retry"]);
  assert.equal(options.retryIntervalMinutes, 10);
  assert.equal(options.maxRetries, 3);
  assert.equal(options.noRetry, true);
});

test("parseAutoDryRunArgs: --retry-interval-minutes/--max-retries reject invalid values", () => {
  assert.throws(() => parseAutoDryRunArgs(["--retry-interval-minutes", "0"]), /requires a positive number/);
  assert.throws(() => parseAutoDryRunArgs(["--retry-interval-minutes", "nope"]), /requires a positive number/);
  assert.throws(() => parseAutoDryRunArgs(["--max-retries", "-1"]), /requires a non-negative integer/);
  assert.throws(() => parseAutoDryRunArgs(["--max-retries", "1.5"]), /requires a non-negative integer/);
});

test("parseAutoDryRunArgs rejects an unknown argument", () => {
  assert.throws(() => parseAutoDryRunArgs(["--nope"]), /Unknown argument: --nope/);
});

function buildReport({ parserDriftDetected = false, overallSafeToApply = true, blockers = [], stageFetchStatus = "ok", stageFetchHttpStatus = 200 } = {}) {
  return {
    provider: "official-letour",
    fromStage: 5,
    toStage: 5,
    parserDriftDetected,
    stageFetchMetadata: [
      { stageNumber: 5, status: stageFetchStatus, httpStatus: stageFetchHttpStatus, rowsMatched: stageFetchStatus === "ok" ? 10 : 0, ridersParsed: stageFetchStatus === "ok" ? 10 : 0 }
    ],
    jerseyFetchMetadata: [
      { stageNumber: 5, jerseyType: "yellow", status: "found" },
      { stageNumber: 5, jerseyType: "green", status: "found" }
    ],
    reconciliation: {
      overallSafeToApply,
      stages: [
        { stageNumber: 5, safeToApply: blockers.length === 0, matchedRiders: new Array(10).fill({}), jerseyHolders: new Array(4).fill({}), blockers }
      ]
    }
  };
}

test("summarizeAutoDryRunReport reports safe when there is no drift and safeToApply is true", () => {
  const summary = summarizeAutoDryRunReport(buildReport());
  assert.equal(summary.unsafe, false);
  assert.equal(summary.parserDriftDetected, false);
  assert.equal(summary.overallSafeToApply, true);
  assert.ok(summary.lines.some((line) => line.includes("result lines=10")));
  assert.ok(summary.lines.some((line) => line.includes("jersey holders=4")));
});

test("summarizeAutoDryRunReport flags unsafe when parserDriftDetected is true", () => {
  const summary = summarizeAutoDryRunReport(buildReport({ parserDriftDetected: true }));
  assert.equal(summary.unsafe, true);
});

test("summarizeAutoDryRunReport flags unsafe when overallSafeToApply is false, and lists blockers", () => {
  const summary = summarizeAutoDryRunReport(buildReport({ overallSafeToApply: false, blockers: ["1 rider match(es) are ambiguous."] }));
  assert.equal(summary.unsafe, true);
  assert.ok(summary.lines.some((line) => line.includes("blocker: 1 rider match(es) are ambiguous.")));
  assert.deepEqual(summary.blockers, ["1 rider match(es) are ambiguous."]);
});

test("summarizeAutoDryRunReport treats missing reconciliation as n/a, not unsafe", () => {
  const report = buildReport();
  delete report.reconciliation;
  const summary = summarizeAutoDryRunReport(report);
  assert.equal(summary.overallSafeToApply, null);
  assert.equal(summary.unsafe, false);
});

// ---------------------------------------------------------------------------
// classifyAutoDryRunFailure
// ---------------------------------------------------------------------------

test("classifyAutoDryRunFailure: HTTP 429 (report-based, fetch_error) is transient", () => {
  const report = buildReport({ overallSafeToApply: false, blockers: ["No parsed rider rows to reconcile."], stageFetchStatus: "fetch_error", stageFetchHttpStatus: 429 });
  assert.equal(classifyAutoDryRunFailure(null, report), "transient");
});

test("classifyAutoDryRunFailure: HTTP 500/502/503/504 (report-based) are all transient", () => {
  for (const httpStatus of [500, 502, 503, 504]) {
    const report = buildReport({ overallSafeToApply: false, blockers: ["No parsed rider rows to reconcile."], stageFetchStatus: "fetch_error", stageFetchHttpStatus: httpStatus });
    assert.equal(classifyAutoDryRunFailure(null, report), "transient", `httpStatus=${httpStatus} should be transient`);
  }
});

test("classifyAutoDryRunFailure: HTTP 429/500-504 are also transient via a thrown error carrying a status code", () => {
  for (const httpStatus of [429, 500, 502, 503, 504]) {
    const error = Object.assign(new Error(`Request failed with status ${httpStatus}`), { status: httpStatus });
    assert.equal(classifyAutoDryRunFailure(error, null), "transient", `httpStatus=${httpStatus} should be transient`);
  }
});

test("classifyAutoDryRunFailure: network timeout is transient", () => {
  const error = Object.assign(new Error("fetch failed"), { cause: { code: "ETIMEDOUT" } });
  assert.equal(classifyAutoDryRunFailure(error, null), "transient");
});

test("classifyAutoDryRunFailure: DNS failure and connection reset are transient", () => {
  const dnsError = Object.assign(new Error("fetch failed"), { cause: { code: "ENOTFOUND" } });
  assert.equal(classifyAutoDryRunFailure(dnsError, null), "transient");
  const resetError = Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
  assert.equal(classifyAutoDryRunFailure(resetError, null), "transient");
});

test("classifyAutoDryRunFailure: an aborted provider request is transient", () => {
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  assert.equal(classifyAutoDryRunFailure(error, null), "transient");
});

test("classifyAutoDryRunFailure: safeToApply=false (no transient fetch signal) is classified unsafe, not retried", () => {
  const report = buildReport({ overallSafeToApply: false, blockers: ["1 rider match(es) are ambiguous."], stageFetchStatus: "ok" });
  assert.equal(classifyAutoDryRunFailure(null, report), "unsafe");
});

test("classifyAutoDryRunFailure: parser drift is classified parser_drift, non-retryable", () => {
  const driftFlag = buildReport({ parserDriftDetected: true });
  assert.equal(classifyAutoDryRunFailure(null, driftFlag), "parser_drift");

  const driftStatus = buildReport({ overallSafeToApply: false, blockers: ["No parsed rider rows to reconcile."], stageFetchStatus: "table_not_found" });
  assert.equal(classifyAutoDryRunFailure(null, driftStatus), "parser_drift");
});

test("classifyAutoDryRunFailure: a missing jersey holder blocker (fetch itself was fine) is unsafe, non-retryable", () => {
  const report = buildReport({ overallSafeToApply: false, blockers: ["Missing yellow jersey holder."], stageFetchStatus: "ok" });
  assert.equal(classifyAutoDryRunFailure(null, report), "unsafe");
});

test("classifyAutoDryRunFailure: missing credentials is classified configuration, non-retryable", () => {
  const error = new Error("Resolving the current stage from grandtour_stages requires SUPABASE_URL and SUPABASE_ANON_KEY or SUPABASE_PUBLISHABLE_KEY when --stage-number/--from-stage/--to-stage are not given.");
  assert.equal(classifyAutoDryRunFailure(error, null), "configuration");
});

test("classifyAutoDryRunFailure: invalid CLI input is classified invalid_input, non-retryable", () => {
  assert.equal(classifyAutoDryRunFailure(new Error("Unknown argument: --nope"), null), "invalid_input");
  assert.equal(classifyAutoDryRunFailure(new Error("--max-retries requires a non-negative integer"), null), "invalid_input");
});

test("classifyAutoDryRunFailure: a safe report is success", () => {
  assert.equal(classifyAutoDryRunFailure(null, buildReport()), "success");
});

test("classifyAutoDryRunFailure: a skipped/no-eligible-stage report is classified no_eligible_stage", () => {
  const report = { mode: "dry-run", importStatus: "skipped", fromStage: null, toStage: null };
  assert.equal(classifyAutoDryRunFailure(null, report), "no_eligible_stage");
});

test("classifyAutoDryRunFailure: an unrecognized thrown error is unknown_non_retryable", () => {
  assert.equal(classifyAutoDryRunFailure(new Error("something completely unexpected"), null), "unknown_non_retryable");
});

// ---------------------------------------------------------------------------
// resolveStageRange
// ---------------------------------------------------------------------------

test("resolveStageRange returns the explicit range unchanged and never touches Supabase", async () => {
  const options = { fromStage: 5, toStage: 5 };
  const range = await resolveStageRange(options, { createClient: () => { throw new Error("should not be called"); } });
  assert.deepEqual(range, { fromStage: 5, toStage: 5, skippedReason: null });
});

function fakeSupabaseClient({ grandTourId, stageRows }) {
  return {
    from(table) {
      if (table === "grand_tours") {
        return {
          select() { return this; },
          eq() { return this; },
          limit() { return this; },
          async maybeSingle() {
            return { data: grandTourId ? { id: grandTourId } : null, error: null };
          }
        };
      }
      if (table === "grandtour_stages") {
        const builder = {
          select() { return builder; },
          eq() { return builder; },
          then(resolve) {
            return resolve({ data: stageRows, error: null });
          }
        };
        return builder;
      }
      throw new Error(`Unexpected table: ${table}`);
    }
  };
}

test("resolveStageRange auto-resolves from grandtour_stages when no explicit stage is given", async () => {
  process.env.SUPABASE_URL = "http://127.0.0.1:54321";
  process.env.SUPABASE_ANON_KEY = "anon-key";
  try {
    const options = { fromStage: null, toStage: null, grandTourName: "Tour de France", grandTourYear: 2026, asOfDate: "2026-07-09" };
    const client = fakeSupabaseClient({
      grandTourId: "tour-1",
      stageRows: [{ stage_number: 6, starts_at: "2026-07-09T10:00:00+00:00" }]
    });
    const range = await resolveStageRange(options, { createClient: () => client });
    assert.deepEqual(range, { fromStage: 6, toStage: 6, skippedReason: null });
  } finally {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
  }
});

test("resolveStageRange is skipped (not an error) when no stage starts on the resolved date", async () => {
  process.env.SUPABASE_URL = "http://127.0.0.1:54321";
  process.env.SUPABASE_PUBLISHABLE_KEY = "publishable-key";
  try {
    const options = { fromStage: null, toStage: null, grandTourName: "Tour de France", grandTourYear: 2026, asOfDate: "2026-07-14" };
    const client = fakeSupabaseClient({
      grandTourId: "tour-1",
      stageRows: [{ stage_number: 6, starts_at: "2026-07-09T10:00:00+00:00" }]
    });
    const range = await resolveStageRange(options, { createClient: () => client });
    assert.equal(range.fromStage, null);
    assert.match(range.skippedReason, /No grandtour_stages row starts on 2026-07-14/);
  } finally {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
  }
});

test("resolveStageRange throws when neither SUPABASE_ANON_KEY nor SUPABASE_PUBLISHABLE_KEY is set", async () => {
  const originalUrl = process.env.SUPABASE_URL;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;
  delete process.env.SUPABASE_PUBLISHABLE_KEY;
  try {
    await assert.rejects(
      () => resolveStageRange({ fromStage: null, toStage: null, grandTourName: "Tour de France", grandTourYear: 2026 }, {}),
      /requires SUPABASE_URL and SUPABASE_ANON_KEY or SUPABASE_PUBLISHABLE_KEY/
    );
  } finally {
    if (originalUrl !== undefined) process.env.SUPABASE_URL = originalUrl;
  }
});

// ---------------------------------------------------------------------------
// main() retry orchestration
// ---------------------------------------------------------------------------

// A fake spawnSync that simulates grandtour-feed-import.mjs by writing the
// next report from `reports` (consumed one per call) synchronously to
// whatever --report path it was called with, exactly like the real
// subprocess (invoked with stdio: "inherit", so main() always reads the
// report back from disk rather than from stdout).
function fakeSpawnSyncSequence(reports, { captureArgsList } = {}) {
  let callIndex = 0;
  return (command, args) => {
    captureArgsList?.push(args);
    const report = reports[Math.min(callIndex, reports.length - 1)];
    callIndex += 1;
    const reportPath = args[args.indexOf("--report") + 1];
    writeFileSync(reportPath, JSON.stringify(report), "utf8");
    return { status: 0, error: null };
  };
}

function noWaitTracking() {
  const calls = [];
  const wait = async (ms) => { calls.push(ms); };
  return { wait, calls };
}

async function withTempReportDir(fn) {
  const reportDir = await fs.mkdtemp(path.join(os.tmpdir(), "grandtour-auto-dry-run-"));
  try {
    return await fn(reportDir);
  } finally {
    await fs.rm(reportDir, { recursive: true, force: true });
  }
}

test("main never passes --apply to grandtour-feed-import.mjs across any attempt", async () => {
  await withTempReportDir(async (reportDir) => {
    const capturedArgsList = [];
    const { wait } = noWaitTracking();
    const result = await main(["--stage-number", "5", "--report-dir", reportDir], {
      spawnSync: fakeSpawnSyncSequence([buildReport()], { captureArgsList: capturedArgsList }),
      wait
    });
    assert.equal(result.finalSummary.finalStatus, "success");
    assert.ok(capturedArgsList.length >= 1);
    for (const args of capturedArgsList) {
      assert.ok(!args.includes("--apply"), "no attempt may ever pass --apply");
      assert.ok(args.includes("--reconcile"));
    }
  });
});

test("main never reads SUPABASE_SERVICE_ROLE_KEY (source scan)", async () => {
  const source = await fs.readFile(new URL("./grandtour-auto-dry-run.mjs", import.meta.url), "utf8");
  // The doc comment mentions the env var name in prose (explaining that
  // it's never used) - that's expected. What must never appear is an
  // actual read of it.
  assert.ok(!source.includes("process.env.SUPABASE_SERVICE_ROLE_KEY"), "the wrapper must never read the service-role key");
});

test("main: a transient failure that succeeds on a later retry stops immediately (no more attempts)", async () => {
  await withTempReportDir(async (reportDir) => {
    const transientReport = buildReport({ overallSafeToApply: false, blockers: ["No parsed rider rows to reconcile."], stageFetchStatus: "fetch_error", stageFetchHttpStatus: 503 });
    const safeReport = buildReport();
    const { wait, calls } = noWaitTracking();

    const result = await main(["--stage-number", "5", "--report-dir", reportDir, "--max-retries", "5"], {
      spawnSync: fakeSpawnSyncSequence([transientReport, safeReport]),
      wait
    });

    assert.equal(result.finalSummary.finalStatus, "success");
    assert.equal(result.finalSummary.attemptsMade, 2);
    assert.equal(calls.length, 1, "must wait exactly once, between attempt 1 and attempt 2");
    assert.equal(result.exitCode, 0);
  });
});

test("main: transient failures exhaust all retries and fail the run", async () => {
  await withTempReportDir(async (reportDir) => {
    const transientReport = buildReport({ overallSafeToApply: false, blockers: ["No parsed rider rows to reconcile."], stageFetchStatus: "fetch_error", stageFetchHttpStatus: 500 });
    const { wait, calls } = noWaitTracking();

    const result = await main(["--stage-number", "5", "--report-dir", reportDir, "--max-retries", "2"], {
      spawnSync: fakeSpawnSyncSequence([transientReport]),
      wait
    });

    assert.equal(result.finalSummary.finalStatus, "transient_failure_exhausted");
    assert.equal(result.finalSummary.attemptsMade, 3, "1 initial + 2 retries");
    assert.equal(calls.length, 2, "waits between attempts 1->2 and 2->3, not after the last attempt");
    assert.equal(result.exitCode, 1);
  });
});

test("main: an unsafe (non-transient) failure on the very first attempt is never retried", async () => {
  await withTempReportDir(async (reportDir) => {
    const unsafeReport = buildReport({ overallSafeToApply: false, blockers: ["1 rider match(es) are ambiguous."], stageFetchStatus: "ok" });
    const { wait, calls } = noWaitTracking();

    const result = await main(["--stage-number", "5", "--report-dir", reportDir, "--max-retries", "8"], {
      spawnSync: fakeSpawnSyncSequence([unsafeReport]),
      wait
    });

    assert.equal(result.finalSummary.finalStatus, "unsafe_review_required");
    assert.equal(result.finalSummary.attemptsMade, 1);
    assert.equal(calls.length, 0, "an unsafe/semantic failure must never be retried");
    assert.equal(result.exitCode, 1);
  });
});

test("main: --fail-on-unsafe false makes an unsafe outcome exit 0 (still not retried)", async () => {
  await withTempReportDir(async (reportDir) => {
    const unsafeReport = buildReport({ overallSafeToApply: false, blockers: ["1 rider match(es) are ambiguous."], stageFetchStatus: "ok" });
    const { wait, calls } = noWaitTracking();

    const result = await main(["--stage-number", "5", "--report-dir", reportDir, "--fail-on-unsafe", "false"], {
      spawnSync: fakeSpawnSyncSequence([unsafeReport]),
      wait
    });

    assert.equal(result.finalSummary.finalStatus, "unsafe_review_required");
    assert.equal(result.exitCode, 0);
    assert.equal(calls.length, 0);
  });
});

test("main: --no-retry performs exactly one attempt even on a transient failure", async () => {
  await withTempReportDir(async (reportDir) => {
    const transientReport = buildReport({ overallSafeToApply: false, blockers: ["No parsed rider rows to reconcile."], stageFetchStatus: "fetch_error", stageFetchHttpStatus: 502 });
    const { wait, calls } = noWaitTracking();

    const result = await main(["--stage-number", "5", "--report-dir", reportDir, "--no-retry", "--max-retries", "8"], {
      spawnSync: fakeSpawnSyncSequence([transientReport]),
      wait
    });

    assert.equal(result.finalSummary.attemptsMade, 1);
    assert.equal(calls.length, 0);
    assert.equal(result.finalSummary.finalStatus, "transient_failure_exhausted");
  });
});

test("main: manual retry-interval-minutes/max-retries override the defaults", async () => {
  await withTempReportDir(async (reportDir) => {
    const transientReport = buildReport({ overallSafeToApply: false, blockers: ["No parsed rider rows to reconcile."], stageFetchStatus: "fetch_error", stageFetchHttpStatus: 500 });
    const { wait, calls } = noWaitTracking();

    const result = await main(["--stage-number", "5", "--report-dir", reportDir, "--retry-interval-minutes", "10", "--max-retries", "3"], {
      spawnSync: fakeSpawnSyncSequence([transientReport]),
      wait
    });

    assert.equal(result.finalSummary.attemptsMade, 4, "1 initial + 3 retries");
    assert.equal(result.finalSummary.retryIntervalMinutes, 10);
    assert.equal(result.finalSummary.maxRetries, 3);
    assert.equal(calls.length, 3);
    for (const ms of calls) assert.equal(ms, 10 * 60000);
  });
});

test("main: writes every attempt's report + summary file, plus a final-summary.json covering all attempts", async () => {
  await withTempReportDir(async (reportDir) => {
    const transientReport = buildReport({ overallSafeToApply: false, blockers: ["No parsed rider rows to reconcile."], stageFetchStatus: "fetch_error", stageFetchHttpStatus: 500 });
    const safeReport = buildReport();
    const { wait } = noWaitTracking();

    const result = await main(["--stage-number", "5", "--report-dir", reportDir, "--max-retries", "5"], {
      spawnSync: fakeSpawnSyncSequence([transientReport, safeReport]),
      wait
    });

    const files = (await fs.readdir(result.runDir)).sort();
    assert.deepEqual(files, [
      "attempt-01-report.json",
      "attempt-01-summary.json",
      "attempt-02-report.json",
      "attempt-02-summary.json",
      "final-summary.json"
    ]);

    const finalSummaryRaw = JSON.parse(await fs.readFile(path.join(result.runDir, "final-summary.json"), "utf8"));
    assert.equal(finalSummaryRaw.runId, result.runId);
    assert.equal(finalSummaryRaw.attempts.length, 2);
    assert.equal(finalSummaryRaw.attempts[0].classification, "transient");
    assert.equal(finalSummaryRaw.attempts[1].classification, "success");
    for (const field of ["runId", "provider", "grandTourName", "grandTourYear", "startedAt", "finishedAt", "attemptsMade", "maxRetries", "retryIntervalMinutes", "finalStatus", "safeToApply", "parserDriftDetected", "blockers", "finalError", "attempts"]) {
      assert.ok(field in finalSummaryRaw, `final-summary.json must include ${field}`);
    }

    const attempt1Summary = JSON.parse(await fs.readFile(path.join(result.runDir, "attempt-01-summary.json"), "utf8"));
    assert.equal(attempt1Summary.retryable, true);
    const attempt2Summary = JSON.parse(await fs.readFile(path.join(result.runDir, "attempt-02-summary.json"), "utf8"));
    assert.equal(attempt2Summary.retryable, false);
  });
});

test("main: no eligible stage exits cleanly (exit 0) on the first attempt, without retrying", async () => {
  process.env.SUPABASE_URL = "http://127.0.0.1:54321";
  process.env.SUPABASE_ANON_KEY = "anon-key";
  try {
    await withTempReportDir(async (reportDir) => {
      let spawnCallCount = 0;
      const { wait, calls } = noWaitTracking();
      const client = fakeSupabaseClient({ grandTourId: "tour-1", stageRows: [] });

      const result = await main(["--report-dir", reportDir, "--as-of-date", "2026-07-14", "--max-retries", "8"], {
        createClient: () => client,
        spawnSync: () => { spawnCallCount += 1; return { status: 0, error: null }; },
        wait
      });

      assert.equal(result.exitCode, 0);
      assert.equal(result.finalSummary.finalStatus, "no_eligible_stage");
      assert.equal(result.finalSummary.attemptsMade, 1);
      assert.equal(spawnCallCount, 0, "the subprocess must never be spawned when no stage is eligible");
      assert.equal(calls.length, 0, "must never retry a no-eligible-stage outcome");
    });
  } finally {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
  }
});

test("main: a configuration error (missing credentials while auto-resolving) is not retried", async () => {
  const originalUrl = process.env.SUPABASE_URL;
  const originalAnon = process.env.SUPABASE_ANON_KEY;
  const originalPublishable = process.env.SUPABASE_PUBLISHABLE_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;
  delete process.env.SUPABASE_PUBLISHABLE_KEY;
  try {
    await withTempReportDir(async (reportDir) => {
      const { wait, calls } = noWaitTracking();
      const result = await main(["--report-dir", reportDir, "--max-retries", "8"], { wait });

      assert.equal(result.finalSummary.finalStatus, "configuration_error");
      assert.equal(result.finalSummary.attemptsMade, 1);
      assert.equal(calls.length, 0);
      assert.equal(result.exitCode, 1);
    });
  } finally {
    if (originalUrl !== undefined) process.env.SUPABASE_URL = originalUrl;
    if (originalAnon !== undefined) process.env.SUPABASE_ANON_KEY = originalAnon;
    if (originalPublishable !== undefined) process.env.SUPABASE_PUBLISHABLE_KEY = originalPublishable;
  }
});
