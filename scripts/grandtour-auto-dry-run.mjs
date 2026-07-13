/**
 * Automatic GrandTour results collection: a thin wrapper around
 * scripts/grandtour-feed-import.mjs that resolves which stage to check
 * (explicit stage-number/from-stage/to-stage, or auto-resolved from
 * grandtour_stages.starts_at when none is given), runs a dry-run +
 * reconcile pass, classifies the outcome, and retries ONLY transient
 * technical failures (network/HTTP/Supabase connectivity) on a fixed
 * interval, up to a fixed attempt count. Unsafe/semantic outcomes
 * (parser drift, unmatched/ambiguous riders, missing jersey holders, a
 * malformed-but-fetched payload, invalid input, missing credentials) are
 * never retried - they need a human, not another attempt.
 *
 * This wrapper NEVER applies, finalises, or scores. It never passes
 * --apply to grandtour-feed-import.mjs, and it never reads
 * SUPABASE_SERVICE_ROLE_KEY - only SUPABASE_URL plus SUPABASE_ANON_KEY or
 * SUPABASE_PUBLISHABLE_KEY (read-only reconciliation, same as
 * scripts/grandtour-feed-import.mjs's --reconcile flag).
 *
 * Every run gets a unique runId, shared across all attempts, and writes
 * to tmp/auto-dry-runs/<run-id>/:
 *   attempt-01-report.json    (grandtour-feed-import.mjs's own report, if it produced one)
 *   attempt-01-summary.json   (this wrapper's structured attempt metadata)
 *   attempt-02-report.json / attempt-02-summary.json / ...
 *   final-summary.json        (whole-run outcome, all attempts included)
 */

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { fetchAllGrandTourStages, resolveGrandTourId } from "./grandtour-reconciliation-supabase.mjs";
import { DEFAULT_STAGE_AVAILABILITY_GRACE_HOURS, resolveAutomaticStage } from "./grandtour-stage-calendar.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FEED_IMPORT_SCRIPT_PATH = path.join(__dirname, "grandtour-feed-import.mjs");

export const DEFAULT_REPORT_DIR = path.resolve("tmp", "auto-dry-runs");
export const DEFAULT_RETRY_INTERVAL_MINUTES = 15;
export const DEFAULT_MAX_RETRIES = 8;

export function parseAutoDryRunArgs(argv) {
  const options = {
    grandTourName: "Tour de France",
    grandTourYear: 2026,
    provider: "official-letour",
    stageNumber: null,
    fromStage: null,
    toStage: null,
    failOnUnsafe: true,
    reportDir: DEFAULT_REPORT_DIR,
    asOfDate: null,
    retryIntervalMinutes: DEFAULT_RETRY_INTERVAL_MINUTES,
    maxRetries: DEFAULT_MAX_RETRIES,
    noRetry: false,
    stageAvailabilityGraceHours: DEFAULT_STAGE_AVAILABILITY_GRACE_HOURS,
    allowRerunCompleted: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--grand-tour-name") {
      options.grandTourName = argv[++index] ?? "";
      if (!options.grandTourName) throw new Error("--grand-tour-name requires a value");
    } else if (argument === "--grand-tour-year") {
      options.grandTourYear = Number(argv[++index] ?? "");
      if (!Number.isInteger(options.grandTourYear)) throw new Error("--grand-tour-year requires an integer");
    } else if (argument === "--provider") {
      options.provider = argv[++index] ?? "";
      if (!options.provider) throw new Error("--provider requires a value");
    } else if (argument === "--stage-number") {
      options.stageNumber = Number(argv[++index] ?? "");
      if (!Number.isInteger(options.stageNumber) || options.stageNumber <= 0) {
        throw new Error("--stage-number requires a positive integer");
      }
    } else if (argument === "--from-stage") {
      options.fromStage = Number(argv[++index] ?? "");
      if (!Number.isInteger(options.fromStage) || options.fromStage <= 0) {
        throw new Error("--from-stage requires a positive integer");
      }
    } else if (argument === "--to-stage") {
      options.toStage = Number(argv[++index] ?? "");
      if (!Number.isInteger(options.toStage) || options.toStage <= 0) {
        throw new Error("--to-stage requires a positive integer");
      }
    } else if (argument === "--fail-on-unsafe") {
      // Deprecated/inert: parsed only for CLI/workflow backward
      // compatibility. computeExitCode() below no longer consults this -
      // an unsafe_review_required outcome is a valid completed dry run and
      // always exits 0, regardless of this flag's value.
      const value = (argv[++index] ?? "").toLowerCase();
      if (!["true", "false"].includes(value)) throw new Error("--fail-on-unsafe requires 'true' or 'false'");
      options.failOnUnsafe = value === "true";
    } else if (argument === "--report-dir") {
      const value = argv[++index] ?? "";
      if (!value) throw new Error("--report-dir requires a path");
      options.reportDir = path.resolve(value);
    } else if (argument === "--as-of-date") {
      options.asOfDate = argv[++index] ?? "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(options.asOfDate)) throw new Error("--as-of-date requires a YYYY-MM-DD value");
    } else if (argument === "--retry-interval-minutes") {
      options.retryIntervalMinutes = Number(argv[++index] ?? "");
      if (!Number.isFinite(options.retryIntervalMinutes) || options.retryIntervalMinutes <= 0) {
        throw new Error("--retry-interval-minutes requires a positive number");
      }
    } else if (argument === "--max-retries") {
      options.maxRetries = Number(argv[++index] ?? "");
      if (!Number.isInteger(options.maxRetries) || options.maxRetries < 0) {
        throw new Error("--max-retries requires a non-negative integer");
      }
    } else if (argument === "--no-retry") {
      options.noRetry = true;
    } else if (argument === "--stage-availability-grace-hours") {
      options.stageAvailabilityGraceHours = Number(argv[++index] ?? "");
      if (!Number.isFinite(options.stageAvailabilityGraceHours) || options.stageAvailabilityGraceHours < 0) {
        throw new Error("--stage-availability-grace-hours requires a non-negative number");
      }
    } else if (argument === "--allow-rerun-completed") {
      options.allowRerunCompleted = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  // Priority order matches the required workflow behaviour: an explicit
  // single stage wins over an explicit range, which wins over auto-resolution.
  if (options.stageNumber !== null) {
    options.fromStage = options.stageNumber;
    options.toStage = options.stageNumber;
  } else if (options.fromStage !== null || options.toStage !== null) {
    if (options.fromStage === null || options.toStage === null) {
      throw new Error("--from-stage and --to-stage must both be provided together.");
    }
    if (options.toStage < options.fromStage) {
      throw new Error("--to-stage must be greater than or equal to --from-stage.");
    }
  }

  return options;
}

/**
 * Turns a grandtour-feed-import.mjs dry-run+reconcile report into a short,
 * human-readable summary, and decides whether the report counts as
 * "unsafe" (parser drift and/or safeToApply=false) - independent of
 * classifyAutoDryRunFailure's retry decision below, which additionally
 * distinguishes *why* it's unsafe.
 */
export function summarizeAutoDryRunReport(report) {
  const lines = [];
  const reconciliation = report.reconciliation ?? null;
  const overallSafeToApply = reconciliation?.overallSafeToApply ?? null;
  const stages = reconciliation?.stages ?? [];
  const parserDriftDetected = report.parserDriftDetected === true;

  lines.push(`Provider: ${report.provider ?? "unknown"}`);
  lines.push(`Stage range: ${report.fromStage ?? "?"}-${report.toStage ?? "?"}`);
  lines.push(`Parser status: ${parserDriftDetected ? "DRIFT DETECTED" : "ok"}`);
  lines.push(`parserDriftDetected: ${parserDriftDetected}`);
  lines.push(`Overall safe to apply: ${overallSafeToApply === null ? "n/a (no reconciliation)" : overallSafeToApply}`);

  for (const entry of report.stageFetchMetadata ?? []) {
    lines.push(`Stage ${entry.stageNumber}: parser status=${entry.status}, rows matched=${entry.rowsMatched}, riders parsed=${entry.ridersParsed}`);
  }

  for (const stage of stages) {
    lines.push(`Stage ${stage.stageNumber}: safeToApply=${stage.safeToApply}, result lines=${stage.matchedRiders?.length ?? 0}, jersey holders=${stage.jerseyHolders?.length ?? 0}`);
    for (const blocker of stage.blockers ?? []) {
      lines.push(`  blocker: ${blocker}`);
    }
  }

  const jerseyStatusesByStage = new Map();
  for (const entry of report.jerseyFetchMetadata ?? []) {
    const list = jerseyStatusesByStage.get(entry.stageNumber) ?? [];
    list.push(`${entry.jerseyType ?? entry.classification}=${entry.status}`);
    jerseyStatusesByStage.set(entry.stageNumber, list);
  }
  for (const [stageNumber, statuses] of jerseyStatusesByStage) {
    lines.push(`Stage ${stageNumber} jersey fetch: ${statuses.join(", ")}`);
  }

  const blockers = stages.flatMap((stage) => stage.blockers ?? []);
  const unsafe = parserDriftDetected || overallSafeToApply === false;
  return { lines, unsafe, overallSafeToApply, parserDriftDetected, blockers };
}

const TRANSIENT_HTTP_STATUSES = new Set([429, 500, 502, 503, 504]);
const TRANSIENT_ERROR_CODES = new Set([
  "ETIMEDOUT", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED",
  "ENETUNREACH", "ENETDOWN", "EPIPE", "ECONNABORTED", "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_SOCKET"
]);
const PARSER_DRIFT_STAGE_STATUSES = new Set(["table_not_found", "parse_empty"]);
const PARSER_DRIFT_JERSEY_STATUSES = new Set(["table_not_found", "unsupported_markup"]);

function isTransientFetchEntry(entry) {
  if (!entry) return false;
  if (entry.status === "fetch_error") return true;
  return TRANSIENT_HTTP_STATUSES.has(entry.httpStatus);
}

/**
 * Classifies a completed attempt (either a thrown `error`, or a
 * successfully-produced `report`, never both) into exactly one of:
 * "success" | "transient" | "unsafe" | "parser_drift" | "configuration" |
 * "invalid_input" | "no_eligible_stage" | "unknown_non_retryable".
 *
 * Only "transient" is ever retried. Priority, when a report exists:
 * no_eligible_stage > parser_drift > safe (success) > transient (unsafe
 * purely because a fetch technically failed, e.g. HTTP 429/500-504,
 * network reset/timeout, DNS) > unsafe (a real semantic/reconciliation
 * problem: unmatched/ambiguous riders, missing jersey holders that were
 * actually fetched but not matched, startlist validation failure, a
 * malformed-but-successfully-fetched payload, etc).
 *
 * When there's a thrown `error` instead (the subprocess never produced a
 * report - e.g. it crashed, or stage resolution itself failed), this
 * inspects HTTP status / errno-style codes / message patterns, per the
 * documented retryable/non-retryable lists - never as a substitute for
 * structured report fields when a report is available.
 */
export function classifyAutoDryRunFailure(error, report) {
  if (report) {
    if (report.importStatus === "skipped") return "no_eligible_stage";

    const stageFetchMetadata = report.stageFetchMetadata ?? [];
    const jerseyFetchMetadata = report.jerseyFetchMetadata ?? [];

    const hasParserDrift = report.parserDriftDetected === true
      || stageFetchMetadata.some((entry) => PARSER_DRIFT_STAGE_STATUSES.has(entry.status))
      || jerseyFetchMetadata.some((entry) => PARSER_DRIFT_JERSEY_STATUSES.has(entry.status));
    if (hasParserDrift) return "parser_drift";

    const stage = report.reconciliation?.stages?.[0] ?? null;
    const overallSafeToApply = report.reconciliation?.overallSafeToApply ?? null;
    const safeToApply = stage?.safeToApply ?? overallSafeToApply;

    if (safeToApply !== false) return "success";

    const hasTransientFetchIssue = stageFetchMetadata.some(isTransientFetchEntry)
      || jerseyFetchMetadata.some(isTransientFetchEntry);
    if (hasTransientFetchIssue) return "transient";

    return "unsafe";
  }

  if (!error) return "unknown_non_retryable";

  const message = String(error.message ?? error);
  const httpStatus = error.httpStatus ?? error.status ?? error.statusCode ?? null;
  if (httpStatus !== null && TRANSIENT_HTTP_STATUSES.has(httpStatus)) return "transient";

  const code = error.cause?.code ?? error.code ?? null;
  if (code && TRANSIENT_ERROR_CODES.has(code)) return "transient";

  if (error.name === "AbortError" || /\babort(ed)?\b/i.test(message) || /\breset\b/i.test(message)) return "transient";
  if (/fetch failed|network error|ETIMEDOUT|ECONNRESET|ENOTFOUND/i.test(message)) return "transient";

  if (/SUPABASE_URL|SUPABASE_ANON_KEY|SUPABASE_PUBLISHABLE_KEY|SUPABASE_SERVICE_ROLE_KEY|is not configured|not configured with/i.test(message)) {
    return "configuration";
  }

  if (/requires a value|requires an integer|requires a positive integer|requires a non-negative integer|requires a path|requires a YYYY-MM-DD value|requires 'true' or 'false'|must both be provided together|must be greater than or equal to|^Unknown argument:/i.test(message)) {
    return "invalid_input";
  }

  return "unknown_non_retryable";
}

/**
 * Resolves the stage range to run. Explicit --stage-number/--from-stage/
 * --to-stage always win (`resolutionSource: "manual_input"`) and never
 * touch Supabase. Otherwise, reads grandtour_stages (anon key only,
 * including per-stage isFinal status) and picks a stage via
 * resolveAutomaticStage's UTC-instant grace-cutoff rule (see
 * scripts/grandtour-stage-calendar.mjs): normally the most recently
 * started eligible stage (`"database_schedule"`), falling back to an
 * older still-unresolved eligible stage if the latest one is already
 * finalised and reruns are disabled (`"unresolved_stage"`) - never an
 * exact calendar-date match, and never a hardcoded stage number, so a
 * stalled/unprocessed stage is retried on a later scheduled run instead
 * of being silently skipped forever, and a stage that can never become
 * final through this pipeline (e.g. an unconfirmed TTT) never
 * permanently starves out later stages either. Logs the resolution
 * source, selected stage number/start time, current time, and why, on
 * every call - see resolveAutomaticStage's doc comment for the full
 * rationale (including the real "stuck on stage 1" bug this replaced).
 *
 * `options.now` (a Date), when set, overrides "the current instant" for
 * resolution - used by tests. `options.asOfDate` (YYYY-MM-DD) is a
 * lower-precision fallback for the same purpose, treated as that date's UTC
 * midnight; `options.now` wins if both are set. Neither is read from live
 * clock time when either is supplied. `deps.createClient` is injectable for
 * tests. Called fresh on every attempt (see runAttempt) so a transient
 * Supabase issue here is retried exactly like a transient letour.fr fetch
 * issue.
 */
export async function resolveStageRange(options, deps = {}) {
  if (options.fromStage !== null && options.toStage !== null) {
    const resolutionSource = "manual_input";
    console.log(`Stage resolution source: ${resolutionSource}`);
    console.log(`Selected stage number(s): ${options.fromStage}-${options.toStage} (explicit input, database not consulted)`);
    return {
      fromStage: options.fromStage,
      toStage: options.toStage,
      skippedReason: null,
      resolutionSource,
      selectedStartsAt: null,
      reason: `Explicit --stage-number/--from-stage/--to-stage was supplied (${options.fromStage}-${options.toStage}); auto-resolution was not used.`
    };
  }

  const url = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY
    ?? process.env.SUPABASE_PUBLISHABLE_KEY
    ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
    ?? process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anonKey) {
    throw new Error("Resolving the current stage from grandtour_stages requires SUPABASE_URL and SUPABASE_ANON_KEY or SUPABASE_PUBLISHABLE_KEY when --stage-number/--from-stage/--to-stage are not given.");
  }

  const createClient = deps.createClient ?? (await import("@supabase/supabase-js")).createClient;
  const client = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const grandTourId = await resolveGrandTourId(client, { name: options.grandTourName, year: options.grandTourYear });
  if (!grandTourId) {
    const reason = `No grand_tours record found for name=${options.grandTourName} year=${options.grandTourYear}.`;
    console.log(`Stage resolution source: none`);
    console.log(`Why: ${reason}`);
    return { fromStage: null, toStage: null, skippedReason: reason, resolutionSource: "none", selectedStartsAt: null, reason };
  }

  const stageRows = await fetchAllGrandTourStages(client, { grandTourId });
  const now = options.now ?? (options.asOfDate ? new Date(`${options.asOfDate}T00:00:00Z`) : new Date());
  const resolved = resolveAutomaticStage(stageRows, {
    now,
    graceHours: options.stageAvailabilityGraceHours ?? DEFAULT_STAGE_AVAILABILITY_GRACE_HOURS,
    allowRerunCompleted: options.allowRerunCompleted ?? false
  });

  // Required logging (resolution source, selected stage, its start time,
  // the current time, and why it was eligible) so a scheduled run's log is
  // self-explanatory without needing to reproduce the decision locally.
  console.log(`Stage resolution source: ${resolved.resolutionSource}`);
  console.log(`Current time (UTC): ${now.toISOString()}`);
  console.log(`Selected stage number: ${resolved.stageNumber ?? "(none)"}`);
  console.log(`Selected stage start time: ${resolved.startsAt ?? "(none)"}`);
  console.log(`Why: ${resolved.reason}`);

  if (resolved.stageNumber === null) {
    return {
      fromStage: null,
      toStage: null,
      skippedReason: resolved.reason,
      resolutionSource: resolved.resolutionSource,
      selectedStartsAt: null,
      reason: resolved.reason
    };
  }
  return {
    fromStage: resolved.stageNumber,
    toStage: resolved.stageNumber,
    skippedReason: null,
    resolutionSource: resolved.resolutionSource,
    selectedStartsAt: resolved.startsAt,
    reason: resolved.reason
  };
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function extractSafetyFields(report) {
  if (!report) return { safeToApply: null, parserDriftDetected: null, blockers: [] };
  const stage = report.reconciliation?.stages?.[0] ?? null;
  const overallSafeToApply = report.reconciliation?.overallSafeToApply ?? null;
  return {
    safeToApply: stage?.safeToApply ?? overallSafeToApply,
    parserDriftDetected: report.parserDriftDetected === true,
    blockers: stage?.blockers ?? []
  };
}

/**
 * Runs exactly one attempt: resolve the stage range fresh, spawn
 * grandtour-feed-import.mjs --dry-run --reconcile, read back its report,
 * and classify the outcome. Never throws - all failures are captured and
 * classified instead, so the retry loop can decide what to do uniformly.
 */
async function runAttempt({ attemptNumber, options, runDir, deps }) {
  const startedAt = new Date();
  let report = null;
  let error = null;
  let range = null;
  let reportPath = null;

  try {
    range = await resolveStageRange(options, deps);
    if (range.skippedReason) {
      return {
        attemptNumber,
        startedAt,
        finishedAt: new Date(),
        range: null,
        classification: "no_eligible_stage",
        report: null,
        error: null,
        skippedReason: range.skippedReason,
        reportPath: null
      };
    }

    reportPath = path.join(runDir, `attempt-${pad2(attemptNumber)}-report.json`);
    const args = [
      FEED_IMPORT_SCRIPT_PATH,
      "--provider", options.provider,
      "--reconcile",
      "--report", reportPath,
      "--from-stage", String(range.fromStage),
      "--to-stage", String(range.toStage),
      "--grand-tour-name", options.grandTourName,
      "--grand-tour-year", String(options.grandTourYear)
    ];

    const run = deps.spawnSync ?? spawnSync;
    const result = run(process.execPath, args, { stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`grandtour-feed-import.mjs exited with status ${result.status}.`);
    }

    const reportRaw = await fs.readFile(reportPath, "utf8");
    report = JSON.parse(reportRaw);
  } catch (caughtError) {
    error = caughtError;
  }

  const classification = classifyAutoDryRunFailure(error, report);
  return { attemptNumber, startedAt, finishedAt: new Date(), range, classification, report, error, skippedReason: null, reportPath };
}

function buildAttemptSummary(attempt, retryable) {
  const { safeToApply, parserDriftDetected, blockers } = extractSafetyFields(attempt.report);
  return {
    attemptNumber: attempt.attemptNumber,
    startedAt: attempt.startedAt.toISOString(),
    finishedAt: attempt.finishedAt.toISOString(),
    stageNumber: attempt.range && attempt.range.fromStage === attempt.range.toStage ? attempt.range.fromStage : null,
    fromStage: attempt.range?.fromStage ?? null,
    toStage: attempt.range?.toStage ?? null,
    classification: attempt.classification,
    retryable,
    reportPath: attempt.reportPath,
    errorMessage: attempt.error ? (attempt.error.message ?? String(attempt.error)) : null,
    skippedReason: attempt.skippedReason,
    safeToApply,
    parserDriftDetected,
    blockers
  };
}

const RETRYABLE_CLASSIFICATIONS = new Set(["transient"]);
const TERMINAL_CLASSIFICATIONS = new Set(["success", "no_eligible_stage"]);

// The final summary always reports exactly one of these seven values -
// never a bare classification string - so a scheduled run finding no
// eligible stage (a normal daily outcome) is never confused with an actual
// broken workflow.
function mapClassificationToFinalStatus(classification) {
  switch (classification) {
    case "success": return "success";
    case "no_eligible_stage": return "no_eligible_stage";
    case "transient": return "transient_failure_exhausted";
    case "configuration": return "configuration_error";
    case "invalid_input": return "configuration_error";
    case "unsafe": return "unsafe_review_required";
    case "parser_drift": return "parser_drift";
    default: return "unexpected_failure"; // unknown_non_retryable
  }
}

/**
 * A completed dry run whose worst outcome is "a human needs to review this"
 * (unsafe_review_required - e.g. a TTT stage whose official team-result
 * source isn't confirmed, or unmatched/ambiguous riders) is a valid,
 * successfully-completed collection run, not a technical failure - it
 * produced a real report and there's nothing to retry or fix in CI. Exit
 * code 1 is reserved for genuine technical failures: an unhandled
 * exception, a provider/network request that failed after every retry was
 * exhausted (transient_failure_exhausted), invalid configuration (missing
 * credentials, bad CLI input), a letour.fr markup change the parser can no
 * longer read (parser_drift), or any other unrecognised failure
 * (unexpected_failure). `finalError` (a thrown exception's message) is
 * checked first and unconditionally forces exit 1 - a completed report was
 * genuinely never produced in that case.
 *
 * The `--fail-on-unsafe` flag/option is intentionally no longer consulted
 * here (kept parsed, for CLI/workflow backward compatibility, but inert) -
 * a valid review-required outcome must never fail the job regardless of
 * how that flag is set.
 */
function computeExitCode(finalStatus, finalError) {
  if (finalError) return 1;
  if (finalStatus === "success" || finalStatus === "no_eligible_stage" || finalStatus === "unsafe_review_required") return 0;
  return 1; // parser_drift, transient_failure_exhausted, configuration_error, unexpected_failure always fail loudly
}

function defaultWait(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/**
 * Orchestrates the whole run: one initial attempt, then up to
 * `options.maxRetries` further attempts (skipped entirely if
 * `options.noRetry`), waiting `options.retryIntervalMinutes` between each,
 * but ONLY when the previous attempt classified as "transient". Any other
 * classification (including the first attempt) stops immediately - no
 * unsafe/semantic/config/invalid-input outcome is ever retried.
 *
 * `deps.spawnSync`/`deps.createClient`/`deps.wait`/`deps.generateRunId`
 * are injectable so tests never spawn a real subprocess, hit real
 * Supabase/letour.fr, or actually wait 15 minutes.
 */
export async function main(argv = process.argv.slice(2), deps = {}) {
  const options = parseAutoDryRunArgs(argv);
  const runId = deps.generateRunId ? deps.generateRunId() : `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const runDir = path.join(options.reportDir, runId);
  await fs.mkdir(runDir, { recursive: true });

  const maxAttempts = options.noRetry ? 1 : options.maxRetries + 1;
  const wait = deps.wait ?? defaultWait;
  const startedAt = new Date();
  const attemptSummaries = [];
  let finalAttempt = null;

  for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber += 1) {
    console.log(`\n=== GrandTour auto dry-run: attempt ${attemptNumber}/${maxAttempts} (run ${runId}) ===`);
    console.log(`Started (UTC): ${new Date().toISOString()}`);

    // eslint-disable-next-line no-await-in-loop
    const attempt = await runAttempt({ attemptNumber, options, runDir, deps });
    finalAttempt = attempt;

    const stageDescription = attempt.range
      ? (attempt.range.fromStage === attempt.range.toStage ? String(attempt.range.fromStage) : `${attempt.range.fromStage}-${attempt.range.toStage}`)
      : (attempt.skippedReason ?? "n/a");
    const isLastAttempt = attemptNumber === maxAttempts;
    const retryable = RETRYABLE_CLASSIFICATIONS.has(attempt.classification) && !isLastAttempt && !options.noRetry;

    console.log(`Stage selected: ${stageDescription}`);
    console.log(`Failure classification: ${attempt.classification}`);
    console.log(`Retryable: ${retryable}`);
    if (attempt.error) console.log(`Error: ${attempt.error.message ?? attempt.error}`);

    const attemptSummary = buildAttemptSummary(attempt, retryable);
    attemptSummaries.push(attemptSummary);
    // eslint-disable-next-line no-await-in-loop
    await fs.writeFile(
      path.join(runDir, `attempt-${pad2(attemptNumber)}-summary.json`),
      `${JSON.stringify(attemptSummary, null, 2)}\n`,
      "utf8"
    );

    if (TERMINAL_CLASSIFICATIONS.has(attempt.classification)) break;
    if (!retryable) break;

    const retryIntervalMs = options.retryIntervalMinutes * 60000;
    const nextRetryAt = new Date(Date.now() + retryIntervalMs);
    console.log(`Next retry at (UTC): ${nextRetryAt.toISOString()}`);
    // eslint-disable-next-line no-await-in-loop
    await wait(retryIntervalMs);
  }

  const finishedAt = new Date();
  const finalStatus = mapClassificationToFinalStatus(finalAttempt.classification);
  const finalErrorMessage = finalAttempt.error ? (finalAttempt.error.message ?? String(finalAttempt.error)) : null;
  const exitCode = computeExitCode(finalStatus, finalErrorMessage);
  const { safeToApply, parserDriftDetected, blockers } = extractSafetyFields(finalAttempt.report);

  // A review-required outcome is a valid, completed dry run - surface it as
  // a GitHub Actions warning annotation (visible on the job summary/PR
  // checks UI) rather than a failed step, since exitCode is 0 for this case.
  if (finalStatus === "unsafe_review_required") {
    const blockerText = blockers.length > 0 ? blockers.join(" ") : "See the final summary and uploaded report for details.";
    console.log(`::warning title=GrandTour review required::${blockerText}`);
  }

  const finalSummary = {
    runId,
    provider: options.provider,
    grandTourName: options.grandTourName,
    grandTourYear: options.grandTourYear,
    stageNumber: finalAttempt.range && finalAttempt.range.fromStage === finalAttempt.range.toStage ? finalAttempt.range.fromStage : null,
    fromStage: finalAttempt.range?.fromStage ?? null,
    toStage: finalAttempt.range?.toStage ?? null,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    attemptsMade: attemptSummaries.length,
    maxRetries: options.maxRetries,
    retryIntervalMinutes: options.retryIntervalMinutes,
    stageAvailabilityGraceHours: options.stageAvailabilityGraceHours,
    allowRerunCompleted: options.allowRerunCompleted,
    finalStatus,
    safeToApply,
    parserDriftDetected,
    blockers,
    finalError: finalErrorMessage,
    attempts: attemptSummaries
  };

  await fs.writeFile(
    path.join(runDir, "final-summary.json"),
    `${JSON.stringify(finalSummary, null, 2)}\n`,
    "utf8"
  );

  if (finalAttempt.report) {
    const readable = summarizeAutoDryRunReport(finalAttempt.report);
    console.log("\n=== Last attempt report summary ===");
    for (const line of readable.lines) console.log(line);
  }

  console.log("\n=== GrandTour auto dry-run FINAL SUMMARY ===");
  console.log(JSON.stringify(finalSummary, null, 2));
  console.log(`Run directory: ${runDir}`);
  console.log("====================================");

  return { runId, runDir, finalSummary, exitCode };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main()
    .then((result) => { process.exitCode = result.exitCode; })
    .catch((error) => {
      console.error(error.message ?? error);
      process.exitCode = 1;
    });
}
