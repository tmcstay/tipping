/**
 * Automatic GrandTour results collection: a thin wrapper around
 * scripts/grandtour-feed-import.mjs that resolves which stage to check
 * (explicit stage-number/from-stage/to-stage, or auto-resolved from
 * grandtour_stages.starts_at when none is given), runs a dry-run +
 * reconcile pass, writes the report under tmp/auto-dry-runs/, prints a
 * readable summary, and decides the process exit code from --fail-on-unsafe.
 *
 * This wrapper NEVER applies, finalises, or scores. It never passes
 * --apply to grandtour-feed-import.mjs, and it never reads
 * SUPABASE_SERVICE_ROLE_KEY — only SUPABASE_URL plus SUPABASE_ANON_KEY or
 * SUPABASE_PUBLISHABLE_KEY (read-only reconciliation, same as
 * scripts/grandtour-feed-import.mjs's --reconcile flag).
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { fetchAllGrandTourStages, resolveGrandTourId } from "./grandtour-reconciliation-supabase.mjs";
import { parisDateISO, resolveStageFromGrandTourStages } from "./grandtour-stage-calendar.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FEED_IMPORT_SCRIPT_PATH = path.join(__dirname, "grandtour-feed-import.mjs");

export const DEFAULT_REPORT_DIR = path.resolve("tmp", "auto-dry-runs");

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
    asOfDate: null
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

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "");
}

/**
 * Report filenames encode provider, grand tour name/year, stage number or
 * range, and a timestamp, so artifacts from different runs never collide
 * and are identifiable at a glance in the GitHub Actions artifact list.
 * `timestamp` is passed in (rather than computed here) so this stays pure
 * and testable.
 */
export function buildReportFileName({ provider, grandTourName, grandTourYear, fromStage, toStage, timestamp }) {
  const stagePart = fromStage === toStage ? `stage-${fromStage}` : `stages-${fromStage}-to-${toStage}`;
  return `${slugify(provider)}_${slugify(grandTourName)}-${grandTourYear}_${stagePart}_${slugify(timestamp)}.json`;
}

/**
 * Turns a grandtour-feed-import.mjs dry-run+reconcile report into a short,
 * human-readable summary for the GitHub Actions log, and decides whether
 * the report counts as "unsafe" (parser drift and/or safeToApply=false)
 * independent of --fail-on-unsafe, which only decides what happens next.
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

  const unsafe = parserDriftDetected || overallSafeToApply === false;
  return { lines, unsafe, overallSafeToApply, parserDriftDetected };
}

/**
 * Resolves the stage range to run. Explicit --stage-number/--from-stage/
 * --to-stage always win and never touch Supabase. Otherwise, reads
 * grandtour_stages (anon key only) and picks the stage whose starts_at
 * falls on `asOfDate` (Paris calendar date, matching the existing daily
 * dry-run workflow's "today's stage" convention). `deps.createClient` is
 * injectable for tests.
 */
export async function resolveStageRange(options, deps = {}) {
  if (options.fromStage !== null && options.toStage !== null) {
    return { fromStage: options.fromStage, toStage: options.toStage, skippedReason: null };
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
    return { fromStage: null, toStage: null, skippedReason: `No grand_tours record found for name=${options.grandTourName} year=${options.grandTourYear}.` };
  }

  const stageRows = await fetchAllGrandTourStages(client, { grandTourId });
  const resolved = resolveStageFromGrandTourStages(stageRows, options.asOfDate ?? parisDateISO());
  if (resolved.stageNumber === null) {
    return { fromStage: null, toStage: null, skippedReason: resolved.reason };
  }
  return { fromStage: resolved.stageNumber, toStage: resolved.stageNumber, skippedReason: null };
}

/**
 * `deps.spawnSync`/`deps.createClient` are injectable so tests never spawn
 * a real subprocess or hit real Supabase/letour.fr.
 */
export async function main(argv = process.argv.slice(2), deps = {}) {
  const options = parseAutoDryRunArgs(argv);
  const range = await resolveStageRange(options, deps);

  if (range.skippedReason) {
    console.log(`GrandTour auto dry-run: skipped — ${range.skippedReason}`);
    return { skipped: true, exitCode: 0 };
  }

  const timestamp = new Date().toISOString();
  const fileName = buildReportFileName({
    provider: options.provider,
    grandTourName: options.grandTourName,
    grandTourYear: options.grandTourYear,
    fromStage: range.fromStage,
    toStage: range.toStage,
    timestamp
  });
  const reportPath = path.join(options.reportDir, fileName);
  await fs.mkdir(options.reportDir, { recursive: true });

  // Dry-run + reconcile only: --apply is never passed, and this never
  // touches finalise/score. grandtour-feed-import.mjs's --reconcile path
  // itself only ever reads with the anon/publishable key (never
  // SUPABASE_SERVICE_ROLE_KEY) - see runReconciliation() there.
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
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    // grandtour-feed-import.mjs's dry-run/reconcile path does not throw on
    // an unsafe report (see its main()) - a non-zero exit here means the
    // subprocess itself failed to run (bad args, an uncaught exception),
    // not merely that the reconciliation was unsafe.
    throw new Error(`grandtour-feed-import.mjs exited with status ${result.status}.`);
  }

  const reportRaw = await fs.readFile(reportPath, "utf8");
  const report = JSON.parse(reportRaw);
  const summary = summarizeAutoDryRunReport(report);

  console.log("");
  console.log("=== GrandTour auto dry-run summary ===");
  for (const line of summary.lines) console.log(line);
  console.log(`Report: ${reportPath}`);
  console.log("=======================================");

  if (summary.unsafe) {
    if (options.failOnUnsafe) {
      throw new Error("GrandTour auto dry-run report is unsafe (parser drift and/or safeToApply=false) - failing per --fail-on-unsafe true. See the uploaded report artifact for details.");
    }
    console.warn("WARNING: GrandTour auto dry-run report is unsafe (parser drift and/or safeToApply=false), but --fail-on-unsafe is false - completing without failing the workflow.");
  }

  return { skipped: false, exitCode: 0, reportPath, summary };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error.message ?? error);
    process.exitCode = 1;
  });
}
