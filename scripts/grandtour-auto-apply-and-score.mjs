/**
 * Automatic GrandTour write pipeline: runs the existing dry-run + reconcile
 * check (scripts/grandtour-auto-dry-run.mjs, completely unchanged), and -
 * ONLY when that dry run finishes with finalStatus "success" (safe to apply,
 * no blockers, no parser drift) - continues straight through apply -> admin
 * check -> finalise -> score, by spawning the already-existing, already-
 * hardened CLIs (scripts/grandtour-feed-import.mjs --apply and
 * scripts/grandtour-admin-stage.mjs --check-finalise-score) exactly as a
 * human operator would run them by hand today. No apply/check/finalise/score
 * logic is reimplemented here - this file only orchestrates.
 *
 * Any outcome other than a clean dry-run "success" (no_eligible_stage,
 * unsafe_review_required, parser_drift, transient_failure_exhausted,
 * configuration_error, unexpected_failure) stops before the write phase ever
 * starts - identical behaviour to the dry-run-only workflow. A write-phase
 * failure (apply, or check/finalise/score) is NEVER retried automatically -
 * a fresh, safe dry-run has just completed, so a write failure at that point
 * is a real blocker or a race condition and needs a human, not another
 * automatic attempt (the same principle apply's own report-freshness check
 * already enforces elsewhere in this pipeline).
 *
 * Write-phase credentials (SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ADMIN_EMAIL,
 * SUPABASE_ADMIN_PASSWORD, and an admin user id) are read from the
 * environment / an --admin-user flag, never generated or guessed here. When
 * any are missing, the write phase is skipped gracefully (not an error) and
 * this behaves exactly like the dry-run-only workflow - this doubles as a
 * kill switch: removing those credentials reverts to dry-run-only behaviour
 * without touching any code.
 *
 * Writes tmp/auto-dry-runs/<run-id>/final-write-summary.json - a strict
 * superset of the dry-run's own final-summary.json shape plus a new
 * `pipelineStatus` field (see computeWriteExitCode below for the full
 * vocabulary) and a `writePhase` field describing what, if anything, the
 * write phase did.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { main as runAutoDryRun } from "./grandtour-auto-dry-run.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FEED_IMPORT_SCRIPT_PATH = path.join(__dirname, "grandtour-feed-import.mjs");
const ADMIN_STAGE_SCRIPT_PATH = path.join(__dirname, "grandtour-admin-stage.mjs");

/**
 * Splits the orchestrator's own two write-phase-only flags (--admin-user,
 * --confirm-production) out of argv, leaving everything else untouched to
 * be handed straight to grandtour-auto-dry-run.mjs's own, unmodified
 * parseAutoDryRunArgs - so every existing dry-run flag (grand tour name/
 * year, provider, stage selection, retry settings, grace hours, etc.)
 * keeps working exactly as documented there, with zero duplication.
 *
 * --admin-user falls back to the ADMIN_USER_ID environment variable when
 * not passed explicitly (matches how the other three write-phase
 * credentials are always read from the environment, never a CLI flag, in
 * both this script and scripts/grandtour-admin-stage.mjs).
 */
export function parseWriteOrchestratorArgs(argv) {
  const dryRunArgv = [];
  const options = { adminUserId: null, confirmProduction: false };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--admin-user") {
      const raw = argv[++index] ?? "";
      if (!raw) throw new Error("--admin-user requires a value");
      options.adminUserId = raw;
    } else if (argument === "--confirm-production") {
      options.confirmProduction = true;
    } else {
      dryRunArgv.push(argument);
    }
  }

  if (!options.adminUserId) {
    options.adminUserId = process.env.ADMIN_USER_ID ?? null;
  }

  return { options, dryRunArgv };
}

/**
 * Reads the four write-phase credentials. serviceRoleKey/adminEmail/
 * adminPassword always come from the environment (never a CLI flag,
 * matching scripts/grandtour-admin-stage.mjs's own convention);
 * adminUserId comes from parseWriteOrchestratorArgs above (its own
 * --admin-user flag or the ADMIN_USER_ID env var).
 */
export function resolveWriteCredentials(adminUserId) {
  return {
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? null,
    adminEmail: process.env.SUPABASE_ADMIN_EMAIL ?? null,
    adminPassword: process.env.SUPABASE_ADMIN_PASSWORD ?? null,
    adminUserId: adminUserId ?? null
  };
}

export function isWriteCredentialsConfigured(credentials) {
  return Boolean(
    credentials.serviceRoleKey && credentials.adminEmail && credentials.adminPassword && credentials.adminUserId
  );
}

function classifySpawnResult(result) {
  if (result.error) return { ok: false, message: result.error.message ?? String(result.error) };
  if (result.status !== 0) return { ok: false, message: `exited with status ${result.status}` };
  return { ok: true, message: null };
}

export function buildApplyArgs({ stageNumber, fromReportPath, applyReportPath, confirmProduction }) {
  const args = [
    FEED_IMPORT_SCRIPT_PATH,
    "--provider", "official-letour",
    "--apply",
    "--confirm-provider", "official-letour",
    "--confirm-stage", String(stageNumber),
    "--from-report", fromReportPath,
    "--report", applyReportPath
  ];
  if (confirmProduction) args.push("--confirm-production");
  return args;
}

export function buildCheckFinaliseScoreArgs({ stageNumber, adminUserId, grandTourName, grandTourYear, confirmProduction }) {
  const args = [
    ADMIN_STAGE_SCRIPT_PATH,
    "--check-finalise-score",
    "--stage", String(stageNumber),
    "--admin-user", adminUserId,
    "--grand-tour-name", grandTourName,
    "--grand-tour-year", String(grandTourYear)
  ];
  if (confirmProduction) args.push("--confirm-production");
  return args;
}

/**
 * Extracts every top-level JSON value from a block of mixed console
 * output - used to read the machine-readable outcome objects
 * grandtour-admin-stage.mjs's own printOutcome() already prints to
 * stdout (one per phase: mark-checked, finalise, score), interleaved
 * with its own plain-text log lines (e.g. "Stage N is already
 * admin_checked..."). Tracks JSON string/escape state so a brace inside
 * a string value (e.g. a note field) never throws off bracket counting.
 * Any substring that fails to JSON.parse is silently skipped - this is
 * best-effort, used only to surface a human-readable participant count
 * in a notification email, never for anything safety-critical (the
 * actual scoring decision was already made by the RPC itself).
 */
export function extractJsonBlocks(text) {
  const blocks = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escapeNext = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escapeNext) escapeNext = false;
      else if (char === "\\") escapeNext = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
    } else if (char === "}") {
      if (depth > 0) {
        depth -= 1;
        if (depth === 0 && start !== -1) {
          const candidate = text.slice(start, index + 1);
          try {
            blocks.push(JSON.parse(candidate));
          } catch {
            // Not valid JSON on its own (e.g. a brace that was actually
            // part of unrelated log text) - skip it.
          }
          start = -1;
        }
      }
    }
  }

  return blocks;
}

/**
 * Finds the LAST "score" command outcome block printed by
 * grandtour-admin-stage.mjs --check-finalise-score's stdout (the last
 * one wins, matching what actually happened - there is only ever one
 * per run in practice, but "last" is the correct tiebreaker if that ever
 * changes) and returns its rpc_response.tips_affected, or null if no
 * score block was found or it wasn't a number.
 */
export function extractTipsAffectedFromCheckFinaliseScoreOutput(stdout) {
  const blocks = extractJsonBlocks(stdout ?? "");
  const scoreBlocks = blocks.filter((block) => block && block.command === "score");
  const lastScoreBlock = scoreBlocks[scoreBlocks.length - 1];
  const tipsAffected = lastScoreBlock?.rpc_response?.tips_affected;
  return typeof tipsAffected === "number" ? tipsAffected : null;
}

/**
 * The write pipeline's own exit-code policy, deliberately separate from
 * (and stricter than) the dry-run's own computeExitCode: a completed dry
 * run that never reached the write phase still follows the dry-run's own
 * rules (success/no_eligible_stage/unsafe_review_required all exit 0;
 * everything else exits 1 - see grandtour-auto-dry-run.mjs). But
 * "apply_failed" and "review_incomplete_after_apply" always exit 1 here,
 * even though "the dry run itself succeeded" - because in this pipeline a
 * safe dry run that then failed to actually apply/score IS the failure
 * worth a human's attention, and CI must surface it as such.
 */
export function computeWriteExitCode(pipelineStatus) {
  if (pipelineStatus === "applied_and_scored") return 0;
  if (pipelineStatus === "apply_failed") return 1;
  if (pipelineStatus === "review_incomplete_after_apply") return 1;
  if (pipelineStatus === "success" || pipelineStatus === "no_eligible_stage" || pipelineStatus === "unsafe_review_required") return 0;
  return 1; // parser_drift, transient_failure_exhausted, configuration_error, unexpected_failure
}

async function finalizeWriteSummary({ dryRunSummary, runDir, writePhase, pipelineStatus, deps }) {
  const finalWriteSummary = {
    ...dryRunSummary,
    pipelineStatus,
    writePhase
  };

  const writeFile = deps.writeFile ?? fs.writeFile;
  await writeFile(
    path.join(runDir, "final-write-summary.json"),
    `${JSON.stringify(finalWriteSummary, null, 2)}\n`,
    "utf8"
  );

  console.log("\n=== GrandTour auto write pipeline FINAL SUMMARY ===");
  console.log(JSON.stringify(finalWriteSummary, null, 2));
  console.log(`Run directory: ${runDir}`);
  console.log("====================================================");

  return { runDir, finalWriteSummary, exitCode: computeWriteExitCode(pipelineStatus) };
}

/**
 * `deps.spawnSync`/`deps.writeFile` are injectable for tests (never spawn a
 * real subprocess or touch disk in a unit test); every dep also flows
 * straight through to runAutoDryRun for the dry-run phase, unchanged.
 */
export async function main(argv = process.argv.slice(2), deps = {}) {
  const { options, dryRunArgv } = parseWriteOrchestratorArgs(argv);

  const { finalSummary: dryRunSummary, runDir } = await runAutoDryRun(dryRunArgv, deps);

  // Anything other than a clean, safe "success" stops here - identical to
  // the dry-run-only workflow's own behaviour, nothing new to verify.
  if (dryRunSummary.finalStatus !== "success") {
    return finalizeWriteSummary({ dryRunSummary, runDir, writePhase: null, pipelineStatus: dryRunSummary.finalStatus, deps });
  }

  // Apply is one-stage-only by design (see scripts/grandtour-apply.mjs). A
  // multi-stage --from-stage/--to-stage backfill range (ad hoc manual
  // dispatch only - the scheduled cron never requests a range) has no
  // single stageNumber and can never safely enter the write phase.
  const stageNumber = dryRunSummary.stageNumber;
  const credentials = resolveWriteCredentials(options.adminUserId);
  const canRunWritePhase = stageNumber !== null && isWriteCredentialsConfigured(credentials);

  if (!canRunWritePhase) {
    if (stageNumber === null) {
      console.log("Dry run succeeded for a multi-stage range, not a single stage - the write phase only ever applies one stage at a time. Skipping apply/check/finalise/score.");
    } else {
      console.log("Write-phase credentials are not fully configured (SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ADMIN_EMAIL / SUPABASE_ADMIN_PASSWORD / --admin-user or ADMIN_USER_ID). Skipping apply/check/finalise/score - this run behaves exactly like the dry-run-only workflow.");
    }
    return finalizeWriteSummary({ dryRunSummary, runDir, writePhase: null, pipelineStatus: dryRunSummary.finalStatus, deps });
  }

  const lastAttempt = dryRunSummary.attempts[dryRunSummary.attempts.length - 1];
  const fromReportPath = lastAttempt.reportPath;
  const applyReportPath = path.join(runDir, "apply-report.json");

  const spawn = deps.spawnSync ?? spawnSync;

  console.log(`\n=== GrandTour auto write: apply phase (stage ${stageNumber}) ===`);
  const applyArgs = buildApplyArgs({
    stageNumber,
    fromReportPath,
    applyReportPath,
    confirmProduction: options.confirmProduction
  });
  const applyResult = spawn(process.execPath, applyArgs, { stdio: "inherit" });
  const applyOutcome = classifySpawnResult(applyResult);
  if (!applyOutcome.ok) {
    console.log(`Apply phase failed: ${applyOutcome.message}`);
    return finalizeWriteSummary({
      dryRunSummary,
      runDir,
      writePhase: { phase: "apply", ok: false, message: applyOutcome.message, applyReportPath, tipsAffected: null },
      pipelineStatus: "apply_failed",
      deps
    });
  }

  console.log(`\n=== GrandTour auto write: check -> finalise -> score phase (stage ${stageNumber}) ===`);
  const checkFinaliseScoreArgs = buildCheckFinaliseScoreArgs({
    stageNumber,
    adminUserId: credentials.adminUserId,
    grandTourName: dryRunSummary.grandTourName,
    grandTourYear: dryRunSummary.grandTourYear,
    confirmProduction: options.confirmProduction
  });
  // stdout/stderr are captured (not "inherit") so the score phase's own
  // machine-readable outcome (printed as JSON by printOutcome() inside
  // grandtour-admin-stage.mjs) can be read back for the real
  // participant-count in the notification email below - both streams
  // are still echoed to this job's own log immediately after, so nothing
  // about the visible output changes.
  const checkFinaliseScoreResult = spawn(process.execPath, checkFinaliseScoreArgs, {
    stdio: ["inherit", "pipe", "pipe"],
    encoding: "utf8"
  });
  if (checkFinaliseScoreResult.stdout) process.stdout.write(checkFinaliseScoreResult.stdout);
  if (checkFinaliseScoreResult.stderr) process.stderr.write(checkFinaliseScoreResult.stderr);

  const checkFinaliseScoreOutcome = classifySpawnResult(checkFinaliseScoreResult);
  if (!checkFinaliseScoreOutcome.ok) {
    console.log(`Check/finalise/score phase failed: ${checkFinaliseScoreOutcome.message}`);
    return finalizeWriteSummary({
      dryRunSummary,
      runDir,
      writePhase: { phase: "check-finalise-score", ok: false, message: checkFinaliseScoreOutcome.message, applyReportPath, tipsAffected: null },
      pipelineStatus: "review_incomplete_after_apply",
      deps
    });
  }

  const tipsAffected = extractTipsAffectedFromCheckFinaliseScoreOutput(checkFinaliseScoreResult.stdout);
  return finalizeWriteSummary({
    dryRunSummary,
    runDir,
    writePhase: { phase: "check-finalise-score", ok: true, message: null, applyReportPath, tipsAffected },
    pipelineStatus: "applied_and_scored",
    deps
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main()
    .then((result) => { process.exitCode = result.exitCode; })
    .catch((error) => {
      console.error(error.message ?? error);
      process.exitCode = 1;
    });
}
