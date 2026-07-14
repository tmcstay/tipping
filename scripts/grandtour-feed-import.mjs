import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  buildFeedReview,
  buildSkippedStageReport,
  buildStageRange,
  ManualJsonGrandTourFeedProvider,
  OfficialLetourGrandTourFeedProvider,
  parseFeedArgs
} from "./grandtour-feed-provider.mjs";
import { loadStageCalendar, lookupStageDate, parisDateISO, resolveScheduledStage } from "./grandtour-stage-calendar.mjs";
import { buildReconciliationReport, reconcileStageResult } from "./grandtour-reconciliation.mjs";
import { fetchReconciliationContext, resolveGrandTourId } from "./grandtour-reconciliation-supabase.mjs";
import {
  buildApplyRpcParams,
  decodeJwtRole,
  interpretRpcResponse,
  isProductionSupabaseUrl,
  mapRowsToResultLines,
  selectJerseyHolderParams,
  selectTopNRows,
  selectTopNTeamResultLines,
  validateReportForApply
} from "./grandtour-apply.mjs";

async function writeReport(review, reportPath) {
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(review, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ...review, reportPath }, null, 2));
}

// Auto-resolution only applies when the caller didn't already pin an explicit
// stage range (manual dispatch and backfills always pass --from-stage/--to-stage).
async function resolveAutoStage(options) {
  const asOfDate = options.asOfDate ?? parisDateISO();
  let calendarRows;
  try {
    calendarRows = await loadStageCalendar(options.stageCalendarPath);
  } catch (error) {
    return { stageNumber: null, stageDate: null, reason: `Unable to load stage calendar: ${error.message}` };
  }
  const resolved = resolveScheduledStage(calendarRows, asOfDate);
  return { ...resolved, asOfDate };
}

// Reconciliation reads only. It requires the public anon key (never the
// service-role key) because grandtour_riders/teams/stages are fully
// public-readable and grandtour_stage_results/*_lines are public-readable
// once final — see scripts/grandtour-reconciliation-supabase.mjs. It is only
// invoked when the caller explicitly passes --reconcile; the scheduled
// GitHub Actions workflow never sets these env vars or this flag.
//
// `deps.createClient` is injectable for tests; defaults to the real
// @supabase/supabase-js import (same convention as runApply below).
async function runReconciliation(options, payload, deps = {}) {
  const url = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY
    ?? process.env.SUPABASE_PUBLISHABLE_KEY
    ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
    ?? process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anonKey) {
    throw new Error("--reconcile requires SUPABASE_URL (or EXPO_PUBLIC_SUPABASE_URL) and SUPABASE_ANON_KEY or SUPABASE_PUBLISHABLE_KEY (or their EXPO_PUBLIC_ equivalents). Reconciliation only ever reads with the public anon/publishable key; it never uses a service-role key.");
  }

  const createClient = deps.createClient ?? (await import("@supabase/supabase-js")).createClient;
  const client = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const grandTourId = options.grandTourId
    ?? await resolveGrandTourId(client, { name: options.grandTourName, year: options.grandTourYear });
  if (!grandTourId) {
    throw new Error(`--reconcile could not find a grand_tours record for name="${options.grandTourName}" year=${options.grandTourYear}. Pass --grand-tour-id explicitly if it uses a different name/year.`);
  }

  const stageNumbers = buildStageRange(options.fromStage, options.toStage);
  const stageReconciliations = [];
  for (const stageNumber of stageNumbers) {
    const parsedStageResult = (payload.stage_results ?? []).find((result) => Number(result.stage_number) === stageNumber) ?? null;
    const context = await fetchReconciliationContext(client, { grandTourId, stageNumber });
    stageReconciliations.push(reconcileStageResult({
      stageNumber,
      stageType: stageNumber === 1 ? "ttt" : "road",
      parsedStageResult,
      ...context
    }));
  }

  return buildReconciliationReport({
    provider: options.provider,
    stageDate: options.stageDate ?? null,
    stageRangeRequested: { fromStage: options.fromStage, toStage: options.toStage },
    stageReconciliations
  });
}

/**
 * Apply mode: reads an existing --reconcile report from disk, validates it
 * (docs/grandtour-apply-mode-spec.md §14.5), and calls
 * apply_grandtour_official_stage_result() exactly once via the service-role
 * key. Never fetches letour.fr live and never re-runs reconciliation — the
 * `--from-report` file is the single source of truth for what gets applied.
 *
 * `deps.createClient` is injectable for tests; defaults to the real
 * @supabase/supabase-js import.
 */
export async function runApply(options, deps = {}) {
  const url = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("--apply requires SUPABASE_URL (or EXPO_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY. Apply mode never accepts the anon/publishable key.");
  }

  const keyRole = decodeJwtRole(serviceRoleKey);
  if (keyRole !== "service_role") {
    throw new Error(`--apply requires a genuine service-role key; SUPABASE_SERVICE_ROLE_KEY decodes to role ${JSON.stringify(keyRole)}, not "service_role". Refusing to run with an anon/public key.`);
  }

  if (isProductionSupabaseUrl(url) && !options.confirmProduction) {
    throw new Error(`SUPABASE_URL (${url}) resolves to a known production project. Re-run with --confirm-production to proceed. See docs/grandtour-apply-mode-spec.md §14.3 gate 5.`);
  }

  let reportRaw;
  try {
    reportRaw = await fs.readFile(options.fromReportPath, "utf8");
  } catch (error) {
    throw new Error(`Unable to read --from-report file at ${options.fromReportPath}: ${error.message}`);
  }

  let report;
  try {
    report = JSON.parse(reportRaw);
  } catch (error) {
    throw new Error(`--from-report file at ${options.fromReportPath} is not valid JSON: ${error.message}`);
  }

  const { errors, stage } = validateReportForApply({
    report,
    confirmProvider: options.confirmProvider,
    confirmStage: options.confirmStage
  });
  if (errors.length > 0) {
    throw new Error(`Report at ${options.fromReportPath} failed apply validation:\n- ${errors.join("\n- ")}`);
  }

  // A supported (ttt_timing_rule='individual_time') TTT stage builds team
  // result lines from the already-matched tttTeamResult.teams instead of
  // rider result lines - see selectTopNTeamResultLines/reconcileStageResult.
  // Every other stage (non-TTT, or an unsupported-timing-rule TTT, which
  // validateReportForApply already refused above) takes the original
  // rider-line path unchanged.
  let resultLines = [];
  let teamResultLines = [];
  if (stage.isSupportedTtt) {
    const { resultLines: teamLines, error: teamSelectionError } = selectTopNTeamResultLines(stage.tttTeamResult?.teams);
    if (teamSelectionError) {
      throw new Error(teamSelectionError);
    }
    teamResultLines = teamLines;
  } else {
    const { rows, error: selectionError } = selectTopNRows(stage.parsedRiders);
    if (selectionError) {
      throw new Error(selectionError);
    }

    const { resultLines: riderLines, error: mappingError } = mapRowsToResultLines(rows, stage.matchedRiders);
    if (mappingError) {
      throw new Error(mappingError);
    }
    resultLines = riderLines;
  }

  const { jerseyHolderParams, error: jerseyError } = selectJerseyHolderParams(stage);
  if (jerseyError) {
    throw new Error(jerseyError);
  }

  const rpcParams = buildApplyRpcParams({ report, stage, resultLines, teamResultLines, jerseyHolderParams, reason: options.reason, requestId: options.requestId });

  const createClient = deps.createClient ?? (await import("@supabase/supabase-js")).createClient;
  const client = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data, error } = await client.rpc("apply_grandtour_official_stage_result", rpcParams);
  const outcome = interpretRpcResponse({ data, error });

  const report_ = {
    mode: "apply",
    fromReportPath: options.fromReportPath,
    confirmStage: options.confirmStage,
    stageId: stage.stageId,
    requestedAt: new Date().toISOString(),
    rpcParams,
    rpcResponse: { data: data ?? null, error: error ? { message: error.message, code: error.code ?? null } : null },
    outcome
  };
  await writeReport(report_, options.reportPath);

  console.log(outcome.message);
  if (outcome.exitCode !== 0) {
    throw new Error(outcome.message);
  }
}

/**
 * The shared dry-run core: fetches results for an explicit stage range
 * (manual-json or official-letour) and, when `options.reconcile` is true,
 * reconciles them against Supabase. This is reused by the CLI (`main()`
 * below, after it resolves --dry-run's auto-stage/stage-date concerns) and
 * by any other caller — notably the admin UI's server-side "Run Official
 * Check" route (apps/mobile/api/admin/grandtour/run-official-check.mjs).
 *
 * This function has NO apply capability at all: it never accepts a
 * service-role key, never calls apply_grandtour_official_stage_result, and
 * never writes to Supabase or disk — writing the report (writeReport) is
 * always the caller's separate, explicit responsibility. `options.fromStage`/
 * `options.toStage` must already be resolved to concrete stage numbers
 * (auto-stage-resolution, if any, is the caller's job — see
 * resolveAutoStage below for the CLI's CSV-based version and
 * scripts/grandtour-auto-dry-run.mjs for the Supabase-based one).
 *
 * `deps.createClient` is injectable for tests (passed through to
 * runReconciliation).
 */
export async function runDryRunReconcile(options, deps = {}) {
  let provider;
  if (options.provider === "manual-json") {
    provider = new ManualJsonGrandTourFeedProvider({ sourceFile: options.sourceFile ?? null });
  } else if (options.provider === "official-letour") {
    provider = new OfficialLetourGrandTourFeedProvider({
      fromStage: options.fromStage,
      toStage: options.toStage,
      allCompleted: options.allCompleted ?? false
    });
  } else {
    throw new Error(`Unsupported provider: ${options.provider}`);
  }

  const payload = await provider.readPayload();
  const review = buildFeedReview({
    payload,
    mode: "dry-run",
    options: {
      backfill: options.backfill ?? false,
      allCompleted: options.allCompleted ?? false,
      fromStage: options.fromStage,
      toStage: options.toStage,
      stageDate: options.stageDate ?? null
    }
  });

  if (options.reconcile) {
    review.reconciliation = await runReconciliation(options, payload, deps);
  }

  return review;
}

async function main() {
  const options = parseFeedArgs(process.argv.slice(2));

  if (options.apply) {
    await runApply(options);
    return;
  }

  const needsAutoStage = options.provider === "official-letour"
    && options.fromStage === null
    && options.toStage === null
    && !options.allCompleted;

  if (needsAutoStage) {
    const resolved = await resolveAutoStage(options);
    if (resolved.stageNumber === null) {
      const review = buildSkippedStageReport({
        provider: options.provider,
        asOfDate: resolved.asOfDate,
        reason: resolved.reason
      });
      await writeReport(review, options.reportPath);
      return;
    }
    options.fromStage = resolved.stageNumber;
    options.toStage = resolved.stageNumber;
    options.stageDate = resolved.stageDate;
  }

  if (options.provider === "official-letour" && options.stageDate === undefined && options.fromStage === options.toStage) {
    try {
      const calendarRows = await loadStageCalendar(options.stageCalendarPath);
      options.stageDate = lookupStageDate(calendarRows, options.fromStage);
    } catch {
      options.stageDate = null;
    }
  }

  const review = await runDryRunReconcile(options);
  await writeReport(review, options.reportPath);
}

export { main };

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
