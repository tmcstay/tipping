#!/usr/bin/env node
// TDF 2026 rider importer.
//
// Source hierarchy:
//   1. https://www.letour.fr/en/riders                 bib, name, team,
//                                                        race nationality
//   2. UCI public rider-details/search data surface      UCI rider id,
//      (see scripts/uci-client.mjs's module      canonical name,
//      doc comment for how the mechanism was found        DOB, nationality,
//      and verified — no CyclingFantasy/PCS/Wikidata      current team,
//      involved anywhere in this pipeline)                team history
//   3. existing Supabase grandtour_riders                preserve DOB,
//                                                          specialty, and
//                                                          any other valid
//                                                          existing value —
//                                                          never overwrite
//                                                          with null or a
//                                                          lower-confidence
//                                                          value
//
// Default is a dry run: nothing is written to Supabase, and no files are
// written to disk unless --write-csv is passed. See parseImporterArgs for
// every flag.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { decodeJwtRole, isProductionSupabaseUrl } from "./grandtour-apply.mjs";
import { resolveGrandTourId } from "./grandtour-reconciliation-supabase.mjs";
import { normalizeTeamName } from "./tdf-data-utils.mjs";
import {
  createCircuitBreaker,
  createPageCache,
  createRateLimiter,
} from "./source-fetch-utils.mjs";
import { fetchOfficialTourRoster } from "./tdf-2026-rider-parsers.mjs";
import { dbNormalizedName, planRiderImport } from "./tdf-2026-rider-match.mjs";
import { buildYoungRiderEligibility, resolveSpecialty } from "./tdf-2026-rider-specialty.mjs";
import {
  discoverUciCandidates,
  fetchUciRiderProfile,
  UciCircuitBreakerOpenError,
  UCI_ROAD_DISCIPLINE_CODE,
} from "./uci-client.mjs";
import { pickBestUciMatch } from "./uci-match.mjs";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUT_DIR = path.join(ROOT_DIR, "tmp");
const DEFAULT_CACHE_DIR = path.join(ROOT_DIR, "tmp", "tdf-2026-rider-importer-cache");

const DEFAULT_GRAND_TOUR_NAME = "Tour de France";
const DEFAULT_GRAND_TOUR_YEAR = 2026;
const UCI_MIN_REQUEST_INTERVAL_MS = 400;

export function titleCaseName(value) {
  return value
    .toLocaleLowerCase("en")
    .replace(/(^|[\s\-'’])([\p{L}])/gu, (_, prefix, letter) => `${prefix}${letter.toLocaleUpperCase("en")}`);
}

export function parseImporterArgs(argv) {
  const options = {
    dryRun: true,
    apply: false,
    writeCsv: false,
    refreshCache: false,
    limit: null,
    riderFilter: null,
    grandTourName: DEFAULT_GRAND_TOUR_NAME,
    grandTourYear: DEFAULT_GRAND_TOUR_YEAR,
    confirmProduction: false,
    outDir: DEFAULT_OUT_DIR,
    cacheDir: DEFAULT_CACHE_DIR,
    disableUci: false,
    uciId: null,
    uciSearchOnly: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--apply") { options.apply = true; options.dryRun = false; }
    else if (argument === "--write-csv") options.writeCsv = true;
    else if (argument === "--refresh-cache") options.refreshCache = true;
    else if (argument === "--confirm-production") options.confirmProduction = true;
    else if (argument === "--disable-uci") options.disableUci = true;
    else if (argument === "--uci-search-only") options.uciSearchOnly = true;
    else if (argument === "--uci-id") {
      const value = argv[++index];
      if (!value) throw new Error("--uci-id requires a UCI rider id");
      options.uciId = value;
    } else if (argument === "--limit") {
      const value = argv[++index];
      if (!value || Number.isNaN(Number(value))) throw new Error("--limit requires a number");
      options.limit = Number(value);
    } else if (argument === "--rider") {
      const value = argv[++index];
      if (!value) throw new Error("--rider requires a value (name substring or bib number — filtering happens before UCI lookup, so a UCI rider id can't be used as the filter itself; use --uci-id for that)");
      options.riderFilter = value;
    } else if (argument === "--grand-tour-name") {
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
      throw new Error(`Unknown argument: ${argument}. See the top of scripts/tdf-2026-rider-importer.mjs for the supported flags.`);
    }
  }
  if (options.apply && options.dryRun) options.dryRun = false;
  return options;
}

/**
 * Whether an incoming rider survives a `--rider`/`--limit` filter. Uses a
 * plain case-insensitive substring/equality check — a CLI filter value is
 * operator-typed free text, not a value that needs to round-trip through
 * the database's own normalization rule.
 */
export function riderMatchesFilter(incoming, riderFilter) {
  if (!riderFilter) return true;
  const needle = riderFilter.toLowerCase();
  return (
    incoming.normalized_name?.toLowerCase().includes(needle) ||
    String(incoming.bib_number ?? "") === riderFilter ||
    incoming.uci_rider_id === riderFilter ||
    incoming.source_url?.toLowerCase().includes(needle)
  );
}

/**
 * Combines one letour roster entry with (optionally) its matched+fetched
 * UCI profile into the incoming-rider record the rest of the pipeline
 * (matching, CSV/JSON output) operates on. Pure — no I/O.
 *
 * `date_of_birth`/`uci_match_confidence` here are the *raw* candidate
 * values — `date_of_birth` is not yet confidence-gated or reconciled
 * against any existing Supabase row; see `tdf-2026-rider-match.mjs`'s
 * `mergeDateOfBirth` (called from inside `planRiderImport`), which is
 * where "only high/medium confidence populates DOB" and "a genuine
 * conflict keeps the trusted existing value" are actually enforced.
 * Likewise `specialities` here is always `null` — this importer never
 * computes a fresh specialty (see tdf-2026-rider-specialty.mjs's module
 * doc comment); the display-only primary/secondary/specialty_source
 * fields are attached after matching, from whatever existing DB value
 * the rider ends up matched to (see `attachDisplayFields` below).
 */
export function buildIncomingRider({ letourRider, teamCode, teamId, uciResult, grandTourId }) {
  const uciProfile = uciResult?.profile ?? null;
  const canonicalName = uciProfile?.canonicalName
    ? titleCaseName(uciProfile.canonicalName)
    : titleCaseName(letourRider.official_name);

  return {
    grand_tour_id: grandTourId,
    source_url: letourRider.profile_url,
    bib_number: letourRider.bib_number,
    team_code: teamCode,
    team_id: teamId,
    display_name: canonicalName,
    normalized_name: dbNormalizedName(canonicalName),
    nationality: letourRider.nationality ?? null,
    date_of_birth: uciProfile?.dateOfBirth ?? null,
    status: null, // not present on the letour.fr /en/riders roster markup
    data_confidence: uciResult?.confidence === "high" ? "high" : "medium",
    specialities: null, // never computed fresh by this importer — see module doc comment
    uci_match_confidence: uciResult?.confidence ?? null,
    uci_match_reasons: uciResult?.reasons ?? [],
    uci_rider_id: uciResult?.candidate?.uciRiderId ?? null,
    uci_profile_url: uciProfile?.profileUrl ?? null,
    uci_canonical_name: uciProfile?.canonicalName ?? null,
    uci_nationality: uciProfile?.nationality ?? uciResult?.candidate?.countryCode ?? null,
    uci_current_team: uciProfile?.currentTeam ?? uciResult?.candidate?.teamName ?? null,
    uci_team_history: uciProfile?.teamHistory ?? [],
  };
}

function csvValue(value) {
  if (value === null || value === undefined) return "";
  const text = Array.isArray(value)
    ? (typeof value[0] === "object" ? JSON.stringify(value) : value.join("|"))
    : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(rows, columns) {
  return `${columns.join(",")}\n${rows.map((row) => columns.map((column) => csvValue(row[column])).join(",")).join("\n")}\n`;
}

const ROSTER_CSV_COLUMNS = [
  "grand_tour_id", "source_url", "bib_number", "team_code", "team_id",
  "display_name", "normalized_name", "nationality", "date_of_birth", "date_of_birth_source", "dob_conflict",
  "status", "data_confidence",
  "uci_rider_id", "uci_profile_url", "uci_canonical_name", "uci_nationality", "uci_current_team",
  "uci_team_history", "uci_match_confidence", "uci_match_reasons",
  "primary_specialty", "secondary_specialty", "specialty_source",
  "young_rider_eligible", "eligibility_cutoff_date", "eligibility_rule_source",
  "match_action", "match_method", "existing_rider_id",
];

const REVIEW_CSV_COLUMNS = [
  "reason", "bib_number", "display_name", "normalized_name", "source_url", "uci_rider_id", "uci_match_confidence", "candidate_ids", "detail",
];

/**
 * Computes the display-only fields (resolved DOB, its source, specialty,
 * eligibility) for one plan entry, uniformly across insert/update/
 * unresolved shapes. Never re-derives a DB write decision — `entry.row`
 * (present for inserts/updates, from `planRiderImport`'s own
 * `mergeRiderRecord`/`mergeDateOfBirth` calls) is always the source of
 * truth for what a resolved DOB actually is; an unresolved entry (no
 * `row` at all — no DB write will happen for it this run) still applies
 * the same confidence gate locally so its *display* DOB is never a
 * misleadingly-shown low-confidence guess.
 */
function attachDisplayFields(entry, raceYear) {
  const { incoming } = entry;
  const existingSpecialities = entry.existing?.specialities ?? null;
  const specialty = resolveSpecialty({ existingSpecialities });

  const resolvedDob = entry.row
    ? entry.row.date_of_birth
    : ((incoming.uci_match_confidence === "high" || incoming.uci_match_confidence === "medium") ? incoming.date_of_birth : null);
  const dateOfBirthSource = entry.dateOfBirthSource ?? (resolvedDob ? "uci" : "unknown");
  const dobConflict = entry.dateOfBirthConflict ?? false;
  const eligibility = buildYoungRiderEligibility(resolvedDob, raceYear);

  return {
    ...incoming,
    date_of_birth: resolvedDob,
    date_of_birth_source: dateOfBirthSource,
    dob_conflict: dobConflict,
    primary_specialty: specialty.primarySpecialty,
    secondary_specialty: specialty.secondarySpecialty,
    specialty_source: specialty.specialtySource,
    young_rider_eligible: eligibility.young_rider_eligible,
    eligibility_cutoff_date: eligibility.eligibility_cutoff_date,
    eligibility_rule_source: eligibility.eligibility_rule_source,
  };
}

export function buildSourceSummary({ rosterRows, plan, sourceFailures, uciSearchStats, circuitBreakerState }) {
  const dobKnown = rosterRows.filter((rider) => rider.date_of_birth).length;
  const uciDobPopulated = rosterRows.filter((rider) => rider.date_of_birth_source === "uci").length;
  const retainedExistingDob = rosterRows.filter((rider) => rider.date_of_birth_source === "existing_supabase" && rider.date_of_birth).length;
  const dobConflicts = rosterRows.filter((rider) => rider.dob_conflict).length;
  const nationalityConflicts = rosterRows.filter((rider) => rider.uci_match_reasons?.includes("nationality_conflict")).length;
  const teamMismatches = rosterRows.filter((rider) => rider.uci_match_reasons?.includes("team_differs_naming_convention") || rider.uci_match_reasons?.includes("team_missing")).length;
  const missingUciProfiles = rosterRows.filter((rider) => !rider.uci_rider_id).length;
  const specialtyKnown = rosterRows.filter((rider) => rider.primary_specialty !== "unknown").length;

  return {
    officialRosterCount: rosterRows.length,
    uciSearchesAttempted: uciSearchStats.searchesAttempted,
    uciCandidatesFound: uciSearchStats.candidatesFound,
    highConfidenceMatches: rosterRows.filter((rider) => rider.uci_match_confidence === "high").length,
    mediumConfidenceMatches: rosterRows.filter((rider) => rider.uci_match_confidence === "medium").length,
    lowConfidenceOrAmbiguousMatches: rosterRows.filter((rider) => rider.uci_match_confidence === "low").length,
    uciDobCoverage: { known: uciDobPopulated, total: rosterRows.length, ratio: rosterRows.length ? uciDobPopulated / rosterRows.length : 0 },
    retainedExistingDobCount: retainedExistingDob,
    dobConflicts,
    uciNationalityConflicts: nationalityConflicts,
    uciTeamMismatches: teamMismatches,
    missingUciProfiles,
    circuitBreakerActivations: circuitBreakerState.open ? 1 : 0,
    circuitBreakerState,
    specialtyCoverageFromExisting: { known: specialtyKnown, total: rosterRows.length, ratio: rosterRows.length ? specialtyKnown / rosterRows.length : 0 },
    specialtyUnknownCount: rosterRows.length - specialtyKnown,
    youngRiderEligibleCount: rosterRows.filter((rider) => rider.young_rider_eligible === true).length,
    reviewRequiredCount: plan.unresolved.length,
    matchedCount: plan.summary.matched,
    insertedCount: plan.summary.inserted,
    duplicateMatches: plan.duplicateMatches.length,
    dobCoverage: { known: dobKnown, total: rosterRows.length, ratio: rosterRows.length ? dobKnown / rosterRows.length : 0 },
    sourceFailures,
  };
}

async function resolveTeamIds(client, grandTourId) {
  const { data, error } = await client
    .from("grandtour_teams")
    .select("id, code, name")
    .eq("grand_tour_id", grandTourId);
  if (error) throw new Error(`Failed to read grandtour_teams: ${error.message}`);
  const byCode = new Map();
  const byNormalizedName = new Map();
  for (const team of data ?? []) {
    if (team.code) byCode.set(team.code, team.id);
    byNormalizedName.set(normalizeTeamName(team.name), team.id);
  }
  return { byCode, byNormalizedName };
}

async function resolveExistingRiders(client, grandTourId) {
  const { data, error } = await client
    .from("grandtour_riders")
    .select("id, display_name, normalized_name, nationality, date_of_birth, bib_number, team_id, status, source_url, specialities, data_confidence")
    .eq("grand_tour_id", grandTourId);
  if (error) throw new Error(`Failed to read grandtour_riders: ${error.message}`);
  return data ?? [];
}

function requireAnonClient() {
  const url = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY
    ?? process.env.SUPABASE_PUBLISHABLE_KEY
    ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
    ?? process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "This importer requires SUPABASE_URL (or EXPO_PUBLIC_SUPABASE_URL) and SUPABASE_ANON_KEY/SUPABASE_PUBLISHABLE_KEY "
      + "(or their EXPO_PUBLIC_ equivalents) to read existing riders/teams for reconciliation. It only ever reads with the "
      + "public anon/publishable key — never a service-role key — for this step.",
    );
  }
  return { url, anonKey };
}

async function buildClient(url, key, deps) {
  const createClient = deps.createClient ?? (await import("@supabase/supabase-js")).createClient;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function applyToSupabase({ plan, options, deps }) {
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

  const client = await buildClient(url, serviceRoleKey, deps);
  const rows = [...plan.inserts, ...plan.updates].map(({ row }) => {
    const { id, ...rest } = row;
    return id ? { id, ...rest } : rest;
  });
  if (rows.length === 0) return { upserted: 0 };

  const { error } = await client.from("grandtour_riders").upsert(rows);
  if (error) throw new Error(`Failed to upsert grandtour_riders: ${error.message}`);
  return { upserted: rows.length };
}

/**
 * Runs UCI discovery + profile fetch for one official Tour rider, honoring
 * the shared circuit breaker. Never throws for an ordinary "no match"
 * outcome (that's a valid, expected `confidence: "low"`/`candidate: null`
 * result) — only a genuine fetch failure or an already-open breaker
 * propagates, and the caller decides whether that's worth recording.
 */
async function lookupUciRider(letourRider, teamName, { year, cache, rateLimiter, circuitBreaker, fetchImpl }) {
  const officialRider = { officialName: titleCaseName(letourRider.official_name), nationality: letourRider.nationality, teamName };
  const { candidates, attempts } = await discoverUciCandidates(officialRider, {
    year, disciplineCode: UCI_ROAD_DISCIPLINE_CODE, cache, rateLimiter, circuitBreaker, fetchImpl,
  });
  const picked = pickBestUciMatch(officialRider, candidates);
  let profile = null;
  if (picked.candidate?.uciRiderId) {
    profile = await fetchUciRiderProfile(picked.candidate.uciRiderId, { cache, rateLimiter, circuitBreaker, fetchImpl });
  }
  return { ...picked, profile, searchAttempts: attempts };
}

export async function runImport(options, deps = {}) {
  const sourceFailures = [];
  const cache = createPageCache(options.cacheDir, { refresh: options.refreshCache });
  const letourRateLimiter = createRateLimiter();
  const uciRateLimiter = createRateLimiter(UCI_MIN_REQUEST_INTERVAL_MS);
  const circuitBreaker = createCircuitBreaker();
  const fetchImpl = deps.fetchImpl;

  const { url, anonKey } = requireAnonClient();
  const client = await buildClient(url, anonKey, deps);
  const grandTourId = await resolveGrandTourId(client, { name: options.grandTourName, year: options.grandTourYear });
  if (!grandTourId) {
    throw new Error(
      `No grand_tours row found for name=${JSON.stringify(options.grandTourName)} year=${options.grandTourYear}. `
      + "Pass --grand-tour-name/--grand-tour-year to match the row in the target Supabase project "
      + "(local seed data uses a different name than production — see CLAUDE.md).",
    );
  }

  let letourTeams = [];
  try {
    letourTeams = await fetchOfficialTourRoster({ cache, rateLimiter: letourRateLimiter, fetchImpl });
  } catch (error) {
    throw new Error(`Failed to fetch/parse the official letour.fr start list (source #1, required): ${error.message}`, { cause: error });
  }

  const { byCode: teamIdsByCode, byNormalizedName: teamIdsByName } = await resolveTeamIds(client, grandTourId);
  const existingRiders = await resolveExistingRiders(client, grandTourId);

  let letourEntries = letourTeams.flatMap((team) => team.riders.map((letourRider) => ({ letourRider, team })));
  letourEntries = letourEntries.filter(({ letourRider }) => riderMatchesFilter(
    { normalized_name: dbNormalizedName(titleCaseName(letourRider.official_name)), bib_number: letourRider.bib_number, source_url: letourRider.profile_url, uci_rider_id: null },
    options.riderFilter,
  ));
  letourEntries.sort((a, b) => (a.letourRider.bib_number ?? 0) - (b.letourRider.bib_number ?? 0));
  if (options.limit !== null) letourEntries = letourEntries.slice(0, options.limit);

  const uciSearchStats = { searchesAttempted: 0, candidatesFound: 0 };
  const incomingRiders = [];

  for (const { letourRider, team } of letourEntries) {
    const teamId = teamIdsByCode.get(team.code) ?? teamIdsByName.get(normalizeTeamName(team.name)) ?? null;
    let uciResult = null;

    if (!options.disableUci && !circuitBreaker.isOpen()) {
      try {
        uciResult = await lookupUciRider(letourRider, team.name, {
          year: options.grandTourYear, cache, rateLimiter: uciRateLimiter, circuitBreaker, fetchImpl,
        });
        uciSearchStats.searchesAttempted += uciResult.searchAttempts.length;
        uciSearchStats.candidatesFound += uciResult.candidates.length;
      } catch (error) {
        if (error instanceof UciCircuitBreakerOpenError) {
          // Handled once, below, after the loop — never one row per rider.
        } else {
          sourceFailures.push({ source: "uci.org", url: letourRider.profile_url, message: error.message });
        }
      }
    }

    incomingRiders.push(buildIncomingRider({ letourRider, teamCode: team.code, teamId, uciResult, grandTourId }));
  }

  if (circuitBreaker.isOpen()) {
    const state = circuitBreaker.getState();
    sourceFailures.push({
      source: "uci.org",
      url: "https://www.uci.org/api/riders",
      message: `UCI circuit breaker opened after ${state.consecutiveAccessDeniedCount} consecutive ${state.triggeringStatus} responses at ${state.openedAt}. `
        + "Remaining riders were still imported from the official Tour roster (source #1); UCI enrichment was skipped for them this run.",
    });
  }

  const plan = planRiderImport(incomingRiders, existingRiders);

  const rosterRows = [
    ...plan.inserts.map((entry) => ({ ...attachDisplayFields(entry, options.grandTourYear), match_action: "insert", match_method: entry.matchMethod, existing_rider_id: "" })),
    ...plan.updates.map((entry) => ({ ...attachDisplayFields(entry, options.grandTourYear), match_action: "update", match_method: entry.matchMethod, existing_rider_id: entry.existing.id })),
    ...plan.unresolved.map((entry) => ({ ...attachDisplayFields(entry, options.grandTourYear), match_action: "unresolved", match_method: "", existing_rider_id: "" })),
  ].sort((a, b) => (a.bib_number ?? 0) - (b.bib_number ?? 0));

  const reviewRows = [
    ...plan.unresolved.map((entry) => ({
      reason: entry.reason,
      bib_number: entry.incoming.bib_number,
      display_name: entry.incoming.display_name,
      normalized_name: entry.incoming.normalized_name,
      source_url: entry.incoming.source_url,
      uci_rider_id: entry.incoming.uci_rider_id,
      uci_match_confidence: entry.incoming.uci_match_confidence,
      candidate_ids: entry.candidateIds?.join("|") ?? "",
      detail: "",
    })),
    ...rosterRows.filter((row) => row.dob_conflict).map((row) => ({
      reason: "dob_conflict",
      bib_number: row.bib_number,
      display_name: row.display_name,
      normalized_name: row.normalized_name,
      source_url: row.source_url,
      uci_rider_id: row.uci_rider_id,
      uci_match_confidence: row.uci_match_confidence,
      candidate_ids: "",
      detail: "Existing Supabase date_of_birth differs from the UCI-matched value; the existing (trusted) value was kept.",
    })),
    ...rosterRows.filter((row) => row.uci_match_confidence === "low").map((row) => ({
      reason: "low_confidence_uci_match",
      bib_number: row.bib_number,
      display_name: row.display_name,
      normalized_name: row.normalized_name,
      source_url: row.source_url,
      uci_rider_id: row.uci_rider_id,
      uci_match_confidence: row.uci_match_confidence,
      candidate_ids: "",
      detail: (row.uci_match_reasons ?? []).join("; "),
    })),
    ...sourceFailures.map((failure) => ({
      reason: "source_failure",
      bib_number: "",
      display_name: "",
      normalized_name: "",
      source_url: failure.url,
      uci_rider_id: "",
      uci_match_confidence: "",
      candidate_ids: "",
      detail: `${failure.source}: ${failure.message}`,
    })),
  ];

  const summary = buildSourceSummary({ rosterRows, plan, sourceFailures, uciSearchStats, circuitBreakerState: circuitBreaker.getState() });

  let applyResult = null;
  if (options.apply) {
    applyResult = await applyToSupabase({ plan, options, deps });
  }

  return { incomingRiders, rosterRows, reviewRows, plan, summary, applyResult, grandTourId };
}

/** `--uci-id <id>`: fetch and print one known UCI rider profile directly, bypassing search/roster/Supabase entirely. */
export async function runUciIdLookup(uciId, options, deps = {}) {
  const cache = createPageCache(options.cacheDir, { refresh: options.refreshCache });
  const rateLimiter = createRateLimiter(UCI_MIN_REQUEST_INTERVAL_MS);
  const profile = await fetchUciRiderProfile(uciId, { cache, rateLimiter, fetchImpl: deps.fetchImpl });
  return profile;
}

/** `--uci-search-only`: run UCI candidate discovery for the (possibly filtered/limited) official roster with no Supabase reads/writes at all. */
export async function runUciSearchOnly(options, deps = {}) {
  const cache = createPageCache(options.cacheDir, { refresh: options.refreshCache });
  const rateLimiter = createRateLimiter(UCI_MIN_REQUEST_INTERVAL_MS);
  const circuitBreaker = createCircuitBreaker();
  const letourRateLimiter = createRateLimiter();

  const letourTeams = await fetchOfficialTourRoster({ cache, rateLimiter: letourRateLimiter, fetchImpl: deps.fetchImpl });
  let entries = letourTeams.flatMap((team) => team.riders.map((letourRider) => ({ letourRider, team })));
  entries = entries.filter(({ letourRider }) => riderMatchesFilter(
    { normalized_name: dbNormalizedName(titleCaseName(letourRider.official_name)), bib_number: letourRider.bib_number, source_url: letourRider.profile_url, uci_rider_id: null },
    options.riderFilter,
  ));
  entries.sort((a, b) => (a.letourRider.bib_number ?? 0) - (b.letourRider.bib_number ?? 0));
  if (options.limit !== null) entries = entries.slice(0, options.limit);

  const results = [];
  for (const { letourRider, team } of entries) {
    if (circuitBreaker.isOpen()) {
      results.push({ officialName: letourRider.official_name, bibNumber: letourRider.bib_number, skipped: "circuit_breaker_open" });
      continue;
    }
    const officialRider = { officialName: titleCaseName(letourRider.official_name), nationality: letourRider.nationality, teamName: team.name };
    const { candidates, attempts } = await discoverUciCandidates(officialRider, {
      year: options.grandTourYear, disciplineCode: UCI_ROAD_DISCIPLINE_CODE, cache, rateLimiter, circuitBreaker, fetchImpl: deps.fetchImpl,
    });
    const picked = pickBestUciMatch(officialRider, candidates);
    results.push({
      officialName: letourRider.official_name,
      bibNumber: letourRider.bib_number,
      searchAttempts: attempts,
      candidateCount: candidates.length,
      confidence: picked.confidence,
      reasons: picked.reasons,
      chosenCandidate: picked.candidate,
    });
  }
  return { results, circuitBreakerState: circuitBreaker.getState() };
}

async function writeOutputs({ rosterRows, reviewRows, incomingRiders, summary, options }) {
  await fs.mkdir(options.outDir, { recursive: true });
  const csvPath = path.join(options.outDir, "tdf-2026-riders.csv");
  const jsonPath = path.join(options.outDir, "tdf-2026-riders.json");
  const reviewPath = path.join(options.outDir, "tdf-2026-riders-review.csv");
  const summaryPath = path.join(options.outDir, "tdf-2026-rider-source-summary.json");

  await Promise.all([
    fs.writeFile(csvPath, toCsv(rosterRows, ROSTER_CSV_COLUMNS), "utf8"),
    fs.writeFile(jsonPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), summary, riders: rosterRows }, null, 2)}\n`, "utf8"),
    fs.writeFile(reviewPath, toCsv(reviewRows, REVIEW_CSV_COLUMNS), "utf8"),
    fs.writeFile(summaryPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), ...summary }, null, 2)}\n`, "utf8"),
  ]);

  return { csvPath, jsonPath, reviewPath, summaryPath };
}

export async function main(argv = process.argv.slice(2), deps = {}) {
  const options = parseImporterArgs(argv);

  if (options.uciId) {
    const profile = await runUciIdLookup(options.uciId, options, deps);
    console.log(JSON.stringify({ mode: "uci-id-lookup", uciId: options.uciId, profile }, null, 2));
    return;
  }

  if (options.uciSearchOnly) {
    const result = await runUciSearchOnly(options, deps);
    console.log(JSON.stringify({ mode: "uci-search-only", ...result }, null, 2));
    return;
  }

  const result = await runImport(options, deps);

  let writtenFiles = null;
  if (options.writeCsv) {
    writtenFiles = await writeOutputs({
      rosterRows: result.rosterRows,
      reviewRows: result.reviewRows,
      incomingRiders: result.incomingRiders,
      summary: result.summary,
      options,
    });
  }

  console.log(JSON.stringify({
    mode: options.apply ? "apply" : "dry-run",
    grandTourId: result.grandTourId,
    writtenFiles,
    ...result.summary,
    applyResult: result.applyResult,
  }, null, 2));
}

// No `process.exit()` anywhere in this file (async workers included) — an
// explicit call can truncate in-flight I/O (a partially-written output
// file, an unflushed console.log) out from under Node's own event loop.
// `process.exitCode` is only ever set here, after `main()` has fully
// settled (either way), so Node's normal event-loop drain decides the
// actual process lifetime.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    await main();
  } catch (error) {
    console.error(`tdf-2026-rider-importer failed: ${error.message}`);
    if (error.cause) console.error(`Caused by: ${error.cause.message ?? error.cause}`);
    process.exitCode = 1;
  }
}
