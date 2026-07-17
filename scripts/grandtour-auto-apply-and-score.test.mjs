import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildApplyArgs,
  buildCheckFinaliseScoreArgs,
  computeWriteExitCode,
  extractJsonBlocks,
  extractTipsAffectedFromCheckFinaliseScoreOutput,
  isWriteCredentialsConfigured,
  main,
  parseWriteOrchestratorArgs,
  resolveWriteCredentials
} from "./grandtour-auto-apply-and-score.mjs";

// ---------------------------------------------------------------------------
// parseWriteOrchestratorArgs
// ---------------------------------------------------------------------------

test("parseWriteOrchestratorArgs: strips --admin-user and --confirm-production, passes everything else through unchanged", () => {
  const { options, dryRunArgv } = parseWriteOrchestratorArgs([
    "--stage-number", "5",
    "--admin-user", "11111111-1111-1111-1111-111111111111",
    "--confirm-production",
    "--report-dir", "/tmp/x"
  ]);
  assert.equal(options.adminUserId, "11111111-1111-1111-1111-111111111111");
  assert.equal(options.confirmProduction, true);
  assert.deepEqual(dryRunArgv, ["--stage-number", "5", "--report-dir", "/tmp/x"]);
});

test("parseWriteOrchestratorArgs: --admin-user requires a value", () => {
  assert.throws(() => parseWriteOrchestratorArgs(["--admin-user"]), /--admin-user requires a value/);
});

test("parseWriteOrchestratorArgs: falls back to ADMIN_USER_ID env var when --admin-user is not given", () => {
  const original = process.env.ADMIN_USER_ID;
  process.env.ADMIN_USER_ID = "22222222-2222-2222-2222-222222222222";
  try {
    const { options } = parseWriteOrchestratorArgs(["--stage-number", "5"]);
    assert.equal(options.adminUserId, "22222222-2222-2222-2222-222222222222");
  } finally {
    if (original === undefined) delete process.env.ADMIN_USER_ID;
    else process.env.ADMIN_USER_ID = original;
  }
});

test("parseWriteOrchestratorArgs: adminUserId is null when neither --admin-user nor ADMIN_USER_ID is set", () => {
  const original = process.env.ADMIN_USER_ID;
  delete process.env.ADMIN_USER_ID;
  try {
    const { options } = parseWriteOrchestratorArgs([]);
    assert.equal(options.adminUserId, null);
  } finally {
    if (original !== undefined) process.env.ADMIN_USER_ID = original;
  }
});

// ---------------------------------------------------------------------------
// resolveWriteCredentials / isWriteCredentialsConfigured
// ---------------------------------------------------------------------------

test("isWriteCredentialsConfigured is false when any of the four credentials is missing", () => {
  assert.equal(isWriteCredentialsConfigured({ serviceRoleKey: "a", adminEmail: "b", adminPassword: "c", adminUserId: null }), false);
  assert.equal(isWriteCredentialsConfigured({ serviceRoleKey: null, adminEmail: "b", adminPassword: "c", adminUserId: "d" }), false);
  assert.equal(isWriteCredentialsConfigured({ serviceRoleKey: "a", adminEmail: "b", adminPassword: "c", adminUserId: "d" }), true);
});

test("resolveWriteCredentials reads the three secret fields from the environment", () => {
  const original = {
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
    email: process.env.SUPABASE_ADMIN_EMAIL,
    password: process.env.SUPABASE_ADMIN_PASSWORD
  };
  process.env.SUPABASE_SERVICE_ROLE_KEY = "svc-key";
  process.env.SUPABASE_ADMIN_EMAIL = "admin@example.test";
  process.env.SUPABASE_ADMIN_PASSWORD = "hunter2";
  try {
    const credentials = resolveWriteCredentials("uid-1");
    assert.deepEqual(credentials, {
      serviceRoleKey: "svc-key",
      adminEmail: "admin@example.test",
      adminPassword: "hunter2",
      adminUserId: "uid-1"
    });
  } finally {
    for (const [key, value] of [
      ["SUPABASE_SERVICE_ROLE_KEY", original.key],
      ["SUPABASE_ADMIN_EMAIL", original.email],
      ["SUPABASE_ADMIN_PASSWORD", original.password]
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

// ---------------------------------------------------------------------------
// buildApplyArgs / buildCheckFinaliseScoreArgs
// ---------------------------------------------------------------------------

test("buildApplyArgs never includes --confirm-production unless requested", () => {
  const args = buildApplyArgs({ stageNumber: 5, fromReportPath: "/a/report.json", applyReportPath: "/a/apply.json", confirmProduction: false });
  assert.ok(!args.includes("--confirm-production"));
  assert.ok(args.includes("--apply"));
  assert.ok(args.includes("--confirm-stage"));
  assert.equal(args[args.indexOf("--confirm-stage") + 1], "5");
  assert.equal(args[args.indexOf("--from-report") + 1], "/a/report.json");
  assert.equal(args[args.indexOf("--report") + 1], "/a/apply.json");
});

test("buildApplyArgs includes --confirm-production when requested", () => {
  const args = buildApplyArgs({ stageNumber: 5, fromReportPath: "/a/report.json", applyReportPath: "/a/apply.json", confirmProduction: true });
  assert.ok(args.includes("--confirm-production"));
});

test("buildCheckFinaliseScoreArgs passes the admin user id and grand tour identity through", () => {
  const args = buildCheckFinaliseScoreArgs({
    stageNumber: 5,
    adminUserId: "uid-1",
    grandTourName: "Tour de France",
    grandTourYear: 2026,
    confirmProduction: false
  });
  assert.ok(args.includes("--check-finalise-score"));
  assert.equal(args[args.indexOf("--stage") + 1], "5");
  assert.equal(args[args.indexOf("--admin-user") + 1], "uid-1");
  assert.equal(args[args.indexOf("--grand-tour-name") + 1], "Tour de France");
  assert.equal(args[args.indexOf("--grand-tour-year") + 1], "2026");
  assert.ok(!args.includes("--confirm-production"));
});

// ---------------------------------------------------------------------------
// computeWriteExitCode
// ---------------------------------------------------------------------------

test("computeWriteExitCode: apply_failed and review_incomplete_after_apply always fail the job, even though the dry run itself was safe", () => {
  assert.equal(computeWriteExitCode("apply_failed"), 1);
  assert.equal(computeWriteExitCode("review_incomplete_after_apply"), 1);
});

test("computeWriteExitCode: applied_and_scored is a clean success", () => {
  assert.equal(computeWriteExitCode("applied_and_scored"), 0);
});

test("computeWriteExitCode: dry-run-only pass-through statuses keep the dry-run's own exit-code rules", () => {
  assert.equal(computeWriteExitCode("success"), 0);
  assert.equal(computeWriteExitCode("no_eligible_stage"), 0);
  assert.equal(computeWriteExitCode("unsafe_review_required"), 0);
  assert.equal(computeWriteExitCode("parser_drift"), 1);
  assert.equal(computeWriteExitCode("transient_failure_exhausted"), 1);
  assert.equal(computeWriteExitCode("configuration_error"), 1);
  assert.equal(computeWriteExitCode("unexpected_failure"), 1);
});

// ---------------------------------------------------------------------------
// extractJsonBlocks / extractTipsAffectedFromCheckFinaliseScoreOutput
// ---------------------------------------------------------------------------

test("extractJsonBlocks finds every top-level JSON object in mixed console output, ignoring plain-text lines and braces inside strings", () => {
  const text = [
    JSON.stringify({ command: "mark-checked", note: "has a { brace } inside a string" }, null, 2),
    "Stage 4 is already admin_checked; re-running to refresh the note.",
    JSON.stringify({ command: "finalise" }, null, 2),
    JSON.stringify({ command: "score", rpc_response: { tips_affected: 137 } }, null, 2)
  ].join("\n");

  const blocks = extractJsonBlocks(text);
  assert.equal(blocks.length, 3);
  assert.equal(blocks[0].command, "mark-checked");
  assert.equal(blocks[1].command, "finalise");
  assert.equal(blocks[2].command, "score");
  assert.equal(blocks[2].rpc_response.tips_affected, 137);
});

test("extractJsonBlocks returns an empty array for plain text with no JSON at all", () => {
  assert.deepEqual(extractJsonBlocks("nothing to see here"), []);
});

test("extractTipsAffectedFromCheckFinaliseScoreOutput returns the score block's tips_affected", () => {
  const stdout = [
    JSON.stringify({ command: "mark-checked" }, null, 2),
    JSON.stringify({ command: "finalise" }, null, 2),
    JSON.stringify({ command: "score", rpc_response: { tips_affected: 42 } }, null, 2)
  ].join("\n");
  assert.equal(extractTipsAffectedFromCheckFinaliseScoreOutput(stdout), 42);
});

test("extractTipsAffectedFromCheckFinaliseScoreOutput returns null when no score block is present", () => {
  const stdout = JSON.stringify({ command: "mark-checked" }, null, 2);
  assert.equal(extractTipsAffectedFromCheckFinaliseScoreOutput(stdout), null);
});

test("extractTipsAffectedFromCheckFinaliseScoreOutput returns null when tips_affected isn't a number", () => {
  const stdout = JSON.stringify({ command: "score", rpc_response: { tips_affected: null } }, null, 2);
  assert.equal(extractTipsAffectedFromCheckFinaliseScoreOutput(stdout), null);
});

test("extractTipsAffectedFromCheckFinaliseScoreOutput handles empty/undefined input without throwing", () => {
  assert.equal(extractTipsAffectedFromCheckFinaliseScoreOutput(undefined), null);
  assert.equal(extractTipsAffectedFromCheckFinaliseScoreOutput(""), null);
});

// ---------------------------------------------------------------------------
// main() orchestration - fakes both the dry-run subprocess and the two
// write-phase subprocesses via a single injected spawnSync, dispatching on
// which flags each call carries (mirrors grandtour-auto-dry-run.test.mjs's
// own fakeSpawnSyncSequence convention for the dry-run call specifically).
// ---------------------------------------------------------------------------

function buildDryRunReport({ blockers = [] } = {}) {
  return {
    provider: "official-letour",
    fromStage: 5,
    toStage: 5,
    parserDriftDetected: false,
    stageFetchMetadata: [{ stageNumber: 5, status: "ok", httpStatus: 200, rowsMatched: 10, ridersParsed: 10 }],
    jerseyFetchMetadata: [],
    reconciliation: {
      overallSafeToApply: blockers.length === 0,
      stages: [
        { stageNumber: 5, safeToApply: blockers.length === 0, matchedRiders: new Array(10).fill({}), jerseyHolders: new Array(4).fill({}), blockers }
      ]
    }
  };
}

function makeFakeSpawnSync({ dryRunReport = buildDryRunReport(), applyResult = { status: 0, error: null }, checkFinaliseScoreResult = {} } = {}) {
  const calls = [];
  const cfs = {
    status: 0,
    error: null,
    stdout: JSON.stringify({ command: "score", stage_number: 5, stage_id: "stage-5", rpc_response: { tips_affected: 42 }, summary: {} }, null, 2),
    stderr: "",
    ...checkFinaliseScoreResult
  };

  const fn = (command, args) => {
    calls.push(args);
    if (args.includes("--reconcile")) {
      const reportPath = args[args.indexOf("--report") + 1];
      writeFileSync(reportPath, JSON.stringify(dryRunReport), "utf8");
      return { status: 0, error: null };
    }
    if (args.includes("--apply")) {
      return { status: applyResult.status, error: applyResult.error };
    }
    if (args.includes("--check-finalise-score")) {
      return cfs;
    }
    throw new Error(`Unexpected spawnSync call: ${JSON.stringify(args)}`);
  };
  fn.calls = calls;
  return fn;
}

async function withTempReportDir(fn) {
  const reportDir = await fs.mkdtemp(path.join(os.tmpdir(), "grandtour-auto-write-"));
  try {
    return await fn(reportDir);
  } finally {
    await fs.rm(reportDir, { recursive: true, force: true });
  }
}

function withEnv(vars, fn) {
  const original = {};
  for (const key of Object.keys(vars)) original[key] = process.env[key];
  for (const [key, value] of Object.entries(vars)) {
    if (value === null) delete process.env[key];
    else process.env[key] = value;
  }
  return (async () => {
    try {
      return await fn();
    } finally {
      for (const [key, value] of Object.entries(original)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  })();
}

const FULL_CREDENTIALS_ENV = {
  SUPABASE_SERVICE_ROLE_KEY: "svc-key",
  SUPABASE_ADMIN_EMAIL: "admin@example.test",
  SUPABASE_ADMIN_PASSWORD: "hunter2",
  ADMIN_USER_ID: null // set per-test via --admin-user instead
};

test("main: a dry run that is not a clean success never starts the write phase", async () => {
  await withTempReportDir(async (reportDir) => {
    await withEnv(FULL_CREDENTIALS_ENV, async () => {
      const spawnSync = makeFakeSpawnSync({ dryRunReport: buildDryRunReport({ blockers: ["1 rider match(es) are ambiguous."] }) });
      const result = await main([
        "--stage-number", "5",
        "--report-dir", reportDir,
        "--admin-user", "11111111-1111-1111-1111-111111111111"
      ], { spawnSync });

      assert.equal(result.finalWriteSummary.finalStatus, "unsafe_review_required");
      assert.equal(result.finalWriteSummary.pipelineStatus, "unsafe_review_required");
      assert.equal(result.finalWriteSummary.writePhase, null);
      assert.equal(result.exitCode, 0);
      assert.ok(!spawnSync.calls.some((args) => args.includes("--apply")), "apply must never be attempted after an unsafe dry run");
      assert.ok(!spawnSync.calls.some((args) => args.includes("--check-finalise-score")));
    });
  });
});

test("main: a safe dry run with no write-phase credentials configured behaves exactly like the dry-run-only workflow", async () => {
  await withTempReportDir(async (reportDir) => {
    await withEnv({ SUPABASE_SERVICE_ROLE_KEY: null, SUPABASE_ADMIN_EMAIL: null, SUPABASE_ADMIN_PASSWORD: null, ADMIN_USER_ID: null }, async () => {
      const spawnSync = makeFakeSpawnSync();
      const result = await main(["--stage-number", "5", "--report-dir", reportDir], { spawnSync });

      assert.equal(result.finalWriteSummary.finalStatus, "success");
      assert.equal(result.finalWriteSummary.pipelineStatus, "success");
      assert.equal(result.finalWriteSummary.writePhase, null);
      assert.equal(result.exitCode, 0);
      assert.ok(!spawnSync.calls.some((args) => args.includes("--apply")));
    });
  });
});

test("main: a safe dry run for a multi-stage range never enters the write phase even with full credentials", async () => {
  await withTempReportDir(async (reportDir) => {
    await withEnv(FULL_CREDENTIALS_ENV, async () => {
      const spawnSync = makeFakeSpawnSync();
      const result = await main([
        "--from-stage", "3", "--to-stage", "6",
        "--report-dir", reportDir,
        "--admin-user", "11111111-1111-1111-1111-111111111111"
      ], { spawnSync });

      assert.equal(result.finalWriteSummary.stageNumber, null);
      assert.equal(result.finalWriteSummary.pipelineStatus, "success");
      assert.equal(result.finalWriteSummary.writePhase, null);
      assert.ok(!spawnSync.calls.some((args) => args.includes("--apply")));
    });
  });
});

test("main: full success runs apply then check-finalise-score and captures the real tips_affected count", async () => {
  await withTempReportDir(async (reportDir) => {
    await withEnv(FULL_CREDENTIALS_ENV, async () => {
      const spawnSync = makeFakeSpawnSync();
      const result = await main([
        "--stage-number", "5",
        "--report-dir", reportDir,
        "--admin-user", "11111111-1111-1111-1111-111111111111",
        "--confirm-production"
      ], { spawnSync });

      assert.equal(result.finalWriteSummary.pipelineStatus, "applied_and_scored");
      assert.equal(result.finalWriteSummary.writePhase.ok, true);
      assert.equal(result.finalWriteSummary.writePhase.tipsAffected, 42);
      assert.equal(result.exitCode, 0);

      const applyCall = spawnSync.calls.find((args) => args.includes("--apply"));
      assert.ok(applyCall, "apply must have been called");
      assert.ok(applyCall.includes("--confirm-production"));
      assert.equal(applyCall[applyCall.indexOf("--confirm-stage") + 1], "5");

      const cfsCall = spawnSync.calls.find((args) => args.includes("--check-finalise-score"));
      assert.ok(cfsCall, "check-finalise-score must have been called");
      assert.ok(cfsCall.includes("--confirm-production"));
      assert.equal(cfsCall[cfsCall.indexOf("--admin-user") + 1], "11111111-1111-1111-1111-111111111111");

      // Verify the written final-write-summary.json on disk matches what main() returned.
      const writtenSummary = JSON.parse(await fs.readFile(path.join(result.runDir, "final-write-summary.json"), "utf8"));
      assert.equal(writtenSummary.pipelineStatus, "applied_and_scored");
    });
  });
});

test("main: an apply failure stops before check-finalise-score is ever attempted", async () => {
  await withTempReportDir(async (reportDir) => {
    await withEnv(FULL_CREDENTIALS_ENV, async () => {
      const spawnSync = makeFakeSpawnSync({ applyResult: { status: 1, error: null } });
      const result = await main([
        "--stage-number", "5",
        "--report-dir", reportDir,
        "--admin-user", "11111111-1111-1111-1111-111111111111"
      ], { spawnSync });

      assert.equal(result.finalWriteSummary.pipelineStatus, "apply_failed");
      assert.equal(result.finalWriteSummary.writePhase.phase, "apply");
      assert.equal(result.finalWriteSummary.writePhase.ok, false);
      assert.equal(result.exitCode, 1);
      assert.ok(!spawnSync.calls.some((args) => args.includes("--check-finalise-score")), "check-finalise-score must never run after apply fails");
    });
  });
});

test("main: a check-finalise-score failure is reported as review_incomplete_after_apply (apply already succeeded)", async () => {
  await withTempReportDir(async (reportDir) => {
    await withEnv(FULL_CREDENTIALS_ENV, async () => {
      const spawnSync = makeFakeSpawnSync({ checkFinaliseScoreResult: { status: 1, stdout: "" } });
      const result = await main([
        "--stage-number", "5",
        "--report-dir", reportDir,
        "--admin-user", "11111111-1111-1111-1111-111111111111"
      ], { spawnSync });

      assert.equal(result.finalWriteSummary.pipelineStatus, "review_incomplete_after_apply");
      assert.equal(result.finalWriteSummary.writePhase.phase, "check-finalise-score");
      assert.equal(result.finalWriteSummary.writePhase.ok, false);
      assert.equal(result.finalWriteSummary.writePhase.tipsAffected, null);
      assert.equal(result.exitCode, 1);
      assert.ok(spawnSync.calls.some((args) => args.includes("--apply")), "apply must have already succeeded before this phase ran");
    });
  });
});

test("main: never reads or forwards SUPABASE_ADMIN_PASSWORD into any spawned argv (only via inherited env)", async () => {
  await withTempReportDir(async (reportDir) => {
    await withEnv(FULL_CREDENTIALS_ENV, async () => {
      const spawnSync = makeFakeSpawnSync();
      await main([
        "--stage-number", "5",
        "--report-dir", reportDir,
        "--admin-user", "11111111-1111-1111-1111-111111111111"
      ], { spawnSync });
      for (const args of spawnSync.calls) {
        assert.ok(!args.some((arg) => typeof arg === "string" && arg.includes("hunter2")), "a secret value must never appear as a literal CLI argument");
      }
    });
  });
});
