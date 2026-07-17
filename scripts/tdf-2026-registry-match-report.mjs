#!/usr/bin/env node
// Tour de France 2026 -> master UCI rider registry migration-path report.
//
// Additive, read-only, and does NOT modify scripts/tdf-2026-rider-importer.mjs's
// existing behavior or write anything to public.grandtour_riders. Reuses
// the already-verified official letour.fr roster fetch
// (fetchOfficialTourRoster, scripts/tdf-2026-rider-parsers.mjs) to get
// the 184-rider list, then runs every entry through the generalized
// race-entry-rider-matching.mjs service against the (locally,
// dry-run/apply-populated) public.uci_riders registry, reporting the
// match-coverage breakdown by method (uci_rider_id / canonical_name /
// alias / scored / unresolved) the task's verification plan requires.
//
// This is a diagnostic/reporting tool for deciding whether/how to
// eventually populate grandtour_riders.master_rider_id for the Tour 2026
// roster -- it never writes that column itself.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { decodeJwtRole, isProductionSupabaseUrl } from "./grandtour-apply.mjs";
import { matchRaceEntryToRegistry } from "./race-entry-rider-matching.mjs";
import { createPageCache, createRateLimiter } from "./source-fetch-utils.mjs";
import { chunk, normalizeRiderName } from "./tdf-data-utils.mjs";
import { fetchOfficialTourRoster } from "./tdf-2026-rider-parsers.mjs";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUT_DIR = path.join(ROOT_DIR, "tmp");
const DEFAULT_CACHE_DIR = path.join(ROOT_DIR, "tmp", "tdf-2026-rider-importer-cache");
const DEFAULT_GRAND_TOUR_NAME = "Tour de France";
const DEFAULT_GRAND_TOUR_YEAR = 2026;

export function parseReportArgs(argv) {
  const options = {
    outDir: DEFAULT_OUT_DIR,
    cacheDir: DEFAULT_CACHE_DIR,
    refreshCache: false,
    writeFiles: true,
    apply: false,
    confirmProduction: false,
    grandTourName: DEFAULT_GRAND_TOUR_NAME,
    grandTourYear: DEFAULT_GRAND_TOUR_YEAR,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--refresh-cache") options.refreshCache = true;
    else if (argument === "--no-write-files") options.writeFiles = false;
    else if (argument === "--apply") options.apply = true;
    else if (argument === "--confirm-production") options.confirmProduction = true;
    else if (argument === "--grand-tour-name") {
      const value = argv[++index];
      if (!value) throw new Error("--grand-tour-name requires a value");
      options.grandTourName = value;
    } else if (argument === "--grand-tour-year") {
      const value = argv[++index];
      if (!value || Number.isNaN(Number(value))) throw new Error("--grand-tour-year requires a number");
      options.grandTourYear = Number(value);
    } else if (argument === "--out-dir") {
      const value = argv[++index];
      if (!value) throw new Error("--out-dir requires a path");
      options.outDir = path.resolve(value);
    } else if (argument === "--cache-dir") {
      const value = argv[++index];
      if (!value) throw new Error("--cache-dir requires a path");
      options.cacheDir = path.resolve(value);
    } else {
      throw new Error(`Unknown argument: ${argument}. See the top of scripts/tdf-2026-registry-match-report.mjs for the supported flags.`);
    }
  }
  return options;
}

function requireAnonClient() {
  const url = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY
    ?? process.env.SUPABASE_PUBLISHABLE_KEY
    ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
    ?? process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anonKey) {
    throw new Error("This report requires SUPABASE_URL (or EXPO_PUBLIC_SUPABASE_URL) and SUPABASE_ANON_KEY/SUPABASE_PUBLISHABLE_KEY. Read-only -- never a service-role key.");
  }
  return { url, anonKey };
}

async function buildClient(url, key, deps) {
  const createClient = deps.createClient ?? (await import("@supabase/supabase-js")).createClient;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function fetchRegistry(client) {
  const { data: riders, error: ridersError } = await client
    .from("uci_riders")
    .select("id, uci_rider_id, display_name, normalized_name, nationality, current_team_name, date_of_birth");
  if (ridersError) throw new Error(`Failed to read uci_riders: ${ridersError.message}`);

  const riderIds = (riders ?? []).map((rider) => rider.id);
  // A single .in("rider_id", riderIds) request grows one query-string entry
  // per UUID; with a large registry (hundreds of riders) that URL exceeds
  // PostgREST/Kong's request-line length limit and the request fails
  // outright with "URI too long" (found live against a 300-rider local
  // registry). Chunking keeps each request's id list small regardless of
  // registry size.
  const RIDER_ID_CHUNK_SIZE = 100;
  let aliases = [];
  for (const idChunk of chunk(riderIds, RIDER_ID_CHUNK_SIZE)) {
    if (idChunk.length === 0) continue;
    const { data, error } = await client.from("uci_rider_aliases").select("rider_id, normalized_alias, alias_type, confidence").in("rider_id", idChunk);
    if (error) throw new Error(`Failed to read uci_rider_aliases: ${error.message}`);
    aliases = aliases.concat(data ?? []);
  }
  return { canonicalRiders: riders ?? [], aliases };
}

/**
 * Builds the match-coverage breakdown for a set of already-computed
 * matches. Pure -- no I/O. `unresolvedCount` always equals
 * `matches.length - matched-count`, computed directly rather than
 * inferred, so it can never silently drift from the individual method
 * counts.
 */
export function buildMatchCoverageSummary(matches) {
  const byMethod = { uci_rider_id: 0, canonical_name: 0, alias: 0, scored: 0, external_id: 0 };
  let unresolved = 0;
  for (const match of matches) {
    if (match.matchedRiderId && byMethod[match.matchMethod] !== undefined) {
      byMethod[match.matchMethod] += 1;
    } else if (match.matchedRiderId) {
      byMethod[match.matchMethod] = (byMethod[match.matchMethod] ?? 0) + 1;
    } else {
      unresolved += 1;
    }
  }
  const matchedTotal = matches.length - unresolved;
  return {
    totalEntries: matches.length,
    matchedTotal,
    unresolvedCount: unresolved,
    byMethod,
    matchRate: matches.length > 0 ? matchedTotal / matches.length : 0,
  };
}

/**
 * Fetches the live letour.fr roster and matches every entry against the
 * registry (`client` may be an anon-key client for the dry-run report or a
 * service-role client for --apply -- both can read uci_riders/aliases the
 * same way). Shared by runReport (read-only) and runApply (writes), so the
 * matching itself is computed exactly once per code path, never
 * duplicated/drifted between the two.
 */
async function computeRegistryMatches(client, options, deps) {
  const registry = await fetchRegistry(client);

  const cache = createPageCache(options.cacheDir ?? DEFAULT_CACHE_DIR, { refresh: options.refreshCache });
  const rateLimiter = createRateLimiter();
  const letourTeams = await fetchOfficialTourRoster({ cache, rateLimiter, fetchImpl: deps.fetchImpl });

  const entries = letourTeams.flatMap((team) => team.riders.map((rider) => ({
    entryName: rider.official_name,
    entryTeamName: team.name,
    entryNationality: rider.nationality,
    entryBibNumber: rider.bib_number,
    sourceUrl: rider.profile_url,
  })));

  const matches = entries.map((entry) => ({ entry, ...matchRaceEntryToRegistry(entry, registry) }));
  return { matches, registry };
}

export async function runReport(options = {}, deps = {}) {
  const { url, anonKey } = requireAnonClient();
  const client = await buildClient(url, anonKey, deps);
  const { matches, registry } = await computeRegistryMatches(client, options, deps);
  const summary = buildMatchCoverageSummary(matches);

  const reviewRows = matches
    .filter((match) => match.reviewRequired || !match.matchedRiderId)
    .map((match) => ({
      bib_number: match.entry.entryBibNumber,
      display_name: match.entry.entryName,
      team_name: match.entry.entryTeamName,
      nationality: match.entry.entryNationality,
      review_reason: match.reviewReason ?? "unmatched",
      candidate_ids: (match.evidence?.candidateIds ?? []).join("|"),
    }));

  return { summary, matches, reviewRows, registryRiderCount: registry.canonicalRiders.length };
}

// --- --apply mode: link unambiguous matches, queue everything else -------

const UNAMBIGUOUS_LINK_METHODS = new Set(["uci_rider_id", "canonical_name", "alias"]);

// matchRaceEntryToRegistry's own reviewReason vocabulary onto
// public.uci_rider_review_queue_type's enum values (see
// supabase/migrations/20260717040000_uci_rider_review_queue_and_sync_runs.sql).
// Most map 1:1 by construction; "unmatched_uci_rider_id" (a stale/incorrect
// uci_rider_id already on the entry) has no matching enum value, so it folds
// into "unmatched_startlist_rider" -- from this registry's perspective,
// nothing usable was resolved for that race entry either way.
const REVIEW_REASON_TO_QUEUE_TYPE = {
  ambiguous_candidate: "ambiguous_candidate",
  dob_conflict: "dob_conflict",
  duplicate_uci_identity: "duplicate_uci_identity",
  low_confidence_alias_match: "low_confidence_alias_match",
  unmatched_startlist_rider: "unmatched_startlist_rider",
  unmatched_uci_rider_id: "unmatched_startlist_rider",
};

/**
 * Which uci_rider_review_queue_type applies to a match that isn't getting
 * auto-linked. Pure, no I/O.
 */
export function resolveQueueTypeForMatch(match) {
  if (match.reviewReason && REVIEW_REASON_TO_QUEUE_TYPE[match.reviewReason]) {
    return REVIEW_REASON_TO_QUEUE_TYPE[match.reviewReason];
  }
  // A "scored" (or any other non-exact-identity) match that wasn't flagged
  // reviewRequired still gets queued for human confirmation, not
  // auto-linked -- inferring an identity from fuzzy name/nationality/team
  // evidence is exactly the kind of decision a human should confirm before
  // it's written permanently to grandtour_riders.master_rider_id, unlike an
  // exact uci_rider_id/canonical_name/alias hit.
  if (match.matchedRiderId) return "ambiguous_candidate";
  return "unmatched_startlist_rider";
}

/**
 * The bucketing decision for one already-computed match: "link" (write
 * grandtour_riders.master_rider_id directly, no human needed) or "queue"
 * (insert a uci_rider_review_queue row instead). Pure, no I/O -- the only
 * unambiguous, auto-link-eligible match methods are the three exact-identity
 * tiers (uci_rider_id/canonical_name/alias); everything else (a "scored"
 * inference, or anything already flagged reviewRequired/unresolved) always
 * gets queued for a human to confirm.
 */
export function classifyRegistryApplyAction(match) {
  if (match.matchedRiderId && !match.reviewRequired && UNAMBIGUOUS_LINK_METHODS.has(match.matchMethod)) {
    return { action: "link" };
  }
  return { action: "queue", queueType: resolveQueueTypeForMatch(match) };
}

/**
 * Turns a set of already-computed registry matches into a concrete write
 * plan against the Tour's own grandtour_riders rows. Pure, no I/O --
 * `grandTourRidersByNormalizedName` is a pre-fetched Map (normalized
 * display_name -> {id, display_name, master_rider_id}), built by the caller.
 *
 * A match that would otherwise auto-link but has no corresponding
 * grandtour_riders row yet (this report's letour.fr roster fetch is
 * independent of what's actually been loaded into grandtour_riders locally)
 * is reported as skipped, never silently dropped -- same for a link that
 * would be a genuine no-op (already linked to the same uci_riders id).
 */
export function buildRegistryApplyPlan(matches, grandTourRidersByNormalizedName) {
  const toLink = [];
  const toQueue = [];
  const skipped = [];

  for (const match of matches) {
    const normalizedEntryName = normalizeRiderName(match.entry.entryName ?? "");
    const grandtourRider = grandTourRidersByNormalizedName.get(normalizedEntryName) ?? null;
    const classification = classifyRegistryApplyAction(match);

    if (classification.action === "link") {
      if (!grandtourRider) {
        skipped.push({ entryName: match.entry.entryName, reason: "no_grandtour_rider_row" });
        continue;
      }
      if (grandtourRider.master_rider_id === match.matchedRiderId) {
        skipped.push({ entryName: match.entry.entryName, reason: "already_linked" });
        continue;
      }
      toLink.push({
        grandtourRiderId: grandtourRider.id,
        uciRiderId: match.matchedRiderId,
        entryName: match.entry.entryName,
        matchMethod: match.matchMethod,
      });
      continue;
    }

    toQueue.push({
      queueType: classification.queueType,
      riderId: match.matchedRiderId ?? null,
      grandtourRiderId: grandtourRider?.id ?? null,
      candidatePayload: {
        entryName: match.entry.entryName,
        entryTeamName: match.entry.entryTeamName ?? null,
        entryNationality: match.entry.entryNationality ?? null,
        entryBibNumber: match.entry.entryBibNumber ?? null,
        matchMethod: match.matchMethod,
        confidence: match.confidence,
        evidence: match.evidence,
      },
      reason: match.reviewReason ?? "no_confident_match",
      source: "tdf-2026-registry-match-report",
    });
  }

  return { toLink, toQueue, skipped };
}

async function requireServiceClient(options, deps) {
  const url = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("--apply requires SUPABASE_URL (or EXPO_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.");
  }
  const keyRole = decodeJwtRole(serviceRoleKey);
  if (keyRole !== "service_role") {
    throw new Error(`--apply requires a genuine service-role key; SUPABASE_SERVICE_ROLE_KEY decodes to role ${JSON.stringify(keyRole)}.`);
  }
  if (isProductionSupabaseUrl(url) && !options.confirmProduction) {
    throw new Error(`SUPABASE_URL (${url}) resolves to a known production project. Re-run with --confirm-production to proceed.`);
  }
  return buildClient(url, serviceRoleKey, deps);
}

/**
 * --apply: for each Tour roster entry already classified by
 * matchRaceEntryToRegistry, auto-links unambiguous matches directly onto
 * grandtour_riders.master_rider_id (via the confirm_grandtour_rider_master_link
 * RPC, p_confirmed_by null since this is an unattended bulk run, not a
 * specific admin's own review) and inserts one uci_rider_review_queue row
 * for everything else. Requires a genuine service-role key (never an anon
 * key) and refuses a known production URL without --confirm-production,
 * same gate as every other apply-mode script in this repo
 * (scripts/grandtour-apply.mjs, scripts/uci-rider-sync.mjs).
 */
export async function runApply(options = {}, deps = {}) {
  const client = await requireServiceClient(options, deps);

  const { data: grandTourRow, error: grandTourError } = await client
    .from("grand_tours")
    .select("id")
    .eq("name", options.grandTourName ?? DEFAULT_GRAND_TOUR_NAME)
    .eq("year", options.grandTourYear ?? DEFAULT_GRAND_TOUR_YEAR)
    .maybeSingle();
  if (grandTourError) throw new Error(`Failed to read grand_tours: ${grandTourError.message}`);
  if (!grandTourRow) {
    throw new Error(
      `--apply found no grand_tours row for name=${JSON.stringify(options.grandTourName)} year=${options.grandTourYear}. `
      + "Pass --grand-tour-name/--grand-tour-year to match your local seed data (local seed data uses \"GrandTour France 2026\", not \"Tour de France\").",
    );
  }

  const { matches } = await computeRegistryMatches(client, options, deps);

  const { data: grandtourRiders, error: ridersError } = await client
    .from("grandtour_riders")
    .select("id, display_name, master_rider_id")
    .eq("grand_tour_id", grandTourRow.id);
  if (ridersError) throw new Error(`Failed to read grandtour_riders: ${ridersError.message}`);

  const grandTourRidersByNormalizedName = new Map(
    (grandtourRiders ?? []).map((rider) => [normalizeRiderName(rider.display_name), rider]),
  );

  const plan = buildRegistryApplyPlan(matches, grandTourRidersByNormalizedName);

  const linkResults = [];
  for (const link of plan.toLink) {
    const { data, error } = await client.rpc("confirm_grandtour_rider_master_link", {
      p_grandtour_rider_id: link.grandtourRiderId,
      p_uci_rider_id: link.uciRiderId,
      p_confirmed_by: null,
    });
    if (error) throw new Error(`confirm_grandtour_rider_master_link failed for ${link.entryName}: ${error.message}`);
    linkResults.push({ ...link, result: data });
  }

  let queueInsertedCount = 0;
  if (plan.toQueue.length > 0) {
    const rows = plan.toQueue.map((item) => ({
      queue_type: item.queueType,
      rider_id: item.riderId,
      grandtour_rider_id: item.grandtourRiderId,
      candidate_payload: item.candidatePayload,
      reason: item.reason,
      source: item.source,
    }));
    const { data, error } = await client.from("uci_rider_review_queue").insert(rows).select("id");
    if (error) throw new Error(`Failed to insert uci_rider_review_queue rows: ${error.message}`);
    queueInsertedCount = (data ?? []).length;
  }

  const queueByType = {};
  for (const item of plan.toQueue) {
    queueByType[item.queueType] = (queueByType[item.queueType] ?? 0) + 1;
  }
  const skippedByReason = {};
  for (const item of plan.skipped) {
    skippedByReason[item.reason] = (skippedByReason[item.reason] ?? 0) + 1;
  }

  return {
    grandTourId: grandTourRow.id,
    totalEntries: matches.length,
    linked: linkResults.length,
    linkResults,
    queued: queueInsertedCount,
    queueByType,
    skipped: plan.skipped.length,
    skippedByReason,
  };
}

function csvValue(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(rows, columns) {
  return `${columns.join(",")}\n${rows.map((row) => columns.map((column) => csvValue(row[column])).join(",")).join("\n")}\n`;
}

const REVIEW_CSV_COLUMNS = ["bib_number", "display_name", "team_name", "nationality", "review_reason", "candidate_ids"];

export async function main(argv = process.argv.slice(2), deps = {}) {
  const options = parseReportArgs(argv);

  if (options.apply) {
    const applyResult = await runApply(options, deps);
    console.log(JSON.stringify({ mode: "apply", ...applyResult }, null, 2));
    return;
  }

  const { summary, reviewRows, registryRiderCount } = await runReport(options, deps);

  let writtenFiles = null;
  if (options.writeFiles) {
    await fs.mkdir(options.outDir, { recursive: true });
    const summaryPath = path.join(options.outDir, "tdf-2026-rider-match-summary.json");
    const reviewPath = path.join(options.outDir, "tdf-2026-rider-match-review.csv");
    await Promise.all([
      fs.writeFile(summaryPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), registryRiderCount, ...summary }, null, 2)}\n`, "utf8"),
      fs.writeFile(reviewPath, toCsv(reviewRows, REVIEW_CSV_COLUMNS), "utf8"),
    ]);
    writtenFiles = { summaryPath, reviewPath };
  }

  console.log(JSON.stringify({ registryRiderCount, writtenFiles, ...summary }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    await main();
  } catch (error) {
    console.error(`tdf-2026-registry-match-report failed: ${error.message}`);
    process.exitCode = 1;
  }
}
