#!/usr/bin/env node
// UCI master rider registry weekly sync CLI.
//
// Paginates UCI's public rider listing (see scripts/uci-client.mjs's
// module doc comment for how that data surface was found/verified),
// following the response's own totalItems/page/pageSize -- never a
// hardcoded page count -- dedupes by uci_rider_id across pages, fetches
// a full profile only when the listing-derived fields suggest something
// changed (or the existing row is still missing a DOB), plans registry
// (uci_riders)/alias/team-history/specialty writes, and optionally
// applies them (service-role only). Default is a dry run: nothing is
// written to Supabase, and no files are written unless --write-files is
// passed. See parseSyncArgs for every flag.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { decodeJwtRole, isProductionSupabaseUrl } from "./grandtour-apply.mjs";
import { planRiderAliasSync } from "./uci-rider-aliases.mjs";
import {
  INACTIVITY_THRESHOLD_CONSECUTIVE_SYNCS,
} from "./uci-rider-inactivity-policy.mjs";
import { planRegistrySync } from "./uci-rider-registry.mjs";
import { planRiderSpecialtySync } from "./uci-rider-specialty.mjs";
import { buildTeamLookupIndex, planRiderTeamHistorySync } from "./uci-rider-team-history.mjs";
import {
  applyAliasInserts,
  applyRegistryPlan,
  applySpecialtyPlan,
  applyTeamHistoryPlan,
  fetchExistingAliasesForRiders,
  fetchExistingSpecialtiesForRiders,
  fetchExistingTeamHistoryForRiders,
  fetchExistingUciRiders,
  fetchGrandTourTeamsIndex,
  insertReviewItems,
  insertSyncRun,
  updateSyncRun,
} from "./uci-rider-sync-supabase.mjs";
import {
  createCircuitBreaker,
  createPageCache,
  createRateLimiter,
  fetchTextCached,
} from "./source-fetch-utils.mjs";
import { DEFAULT_UCI_TEAM_CATEGORIES, discoverUciCandidates, fetchUciRiderProfile, uciSearchUrl, UciCircuitBreakerOpenError } from "./uci-client.mjs";
import { pickBestUciMatch } from "./uci-match.mjs";
import { fetchOfficialTourRoster } from "./tdf-2026-rider-parsers.mjs";
import { parseUciRiderSearchResponse } from "./uci-parsers.mjs";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUT_DIR = path.join(ROOT_DIR, "tmp");
const DEFAULT_CACHE_DIR = path.join(ROOT_DIR, "tmp", "uci-rider-sync-cache");
const DEFAULT_DISCIPLINE = "ROA";
const DEFAULT_YEAR = 2026;
const UCI_MIN_REQUEST_INTERVAL_MS = 400;

export function parseSyncArgs(argv) {
  const options = {
    dryRun: true,
    apply: false,
    writeFiles: false,
    refreshCache: false,
    discipline: DEFAULT_DISCIPLINE,
    year: DEFAULT_YEAR,
    page: null,
    fromPage: null,
    toPage: null,
    search: null,
    riderId: null,
    categories: DEFAULT_UCI_TEAM_CATEGORIES,
    seedFromRoster: null,
    limit: null,
    compareProduction: false,
    confirmProduction: false,
    outDir: DEFAULT_OUT_DIR,
    cacheDir: DEFAULT_CACHE_DIR,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--apply") { options.apply = true; options.dryRun = false; }
    else if (argument === "--write-files") options.writeFiles = true;
    else if (argument === "--refresh-cache") options.refreshCache = true;
    else if (argument === "--compare-production") options.compareProduction = true;
    else if (argument === "--confirm-production") options.confirmProduction = true;
    else if (argument === "--discipline") {
      const value = argv[++index];
      if (!value) throw new Error("--discipline requires a value (e.g. ROA)");
      options.discipline = value;
    } else if (argument === "--year") {
      const value = argv[++index];
      if (!value || Number.isNaN(Number(value))) throw new Error("--year requires a number");
      options.year = Number(value);
    } else if (argument === "--page") {
      const value = argv[++index];
      if (!value || Number.isNaN(Number(value))) throw new Error("--page requires a number");
      options.page = Number(value);
    } else if (argument === "--from-page") {
      const value = argv[++index];
      if (!value || Number.isNaN(Number(value))) throw new Error("--from-page requires a number");
      options.fromPage = Number(value);
    } else if (argument === "--to-page") {
      const value = argv[++index];
      if (!value || Number.isNaN(Number(value))) throw new Error("--to-page requires a number");
      options.toPage = Number(value);
    } else if (argument === "--search") {
      const value = argv[++index];
      if (!value) throw new Error("--search requires a query string");
      options.search = value;
    } else if (argument === "--rider-id") {
      const value = argv[++index];
      if (!value) throw new Error("--rider-id requires a UCI rider id");
      options.riderId = value;
    } else if (argument === "--category") {
      const value = argv[++index];
      if (!value) throw new Error("--category requires one or more comma-separated codes (e.g. WTT,PRT,CTM)");
      options.categories = value.split(",").map((code) => code.trim()).filter(Boolean);
    } else if (argument === "--all-categories") {
      options.categories = [];
    } else if (argument === "--seed-from-roster") {
      const value = argv[++index];
      if (!value) throw new Error("--seed-from-roster requires a roster source (currently only \"letour\" is implemented)");
      options.seedFromRoster = value;
    } else if (argument === "--limit") {
      const value = argv[++index];
      if (!value || Number.isNaN(Number(value)) || Number(value) <= 0) throw new Error("--limit requires a positive number");
      options.limit = Number(value);
    } else if (argument === "--out-dir") {
      const value = argv[++index];
      if (!value) throw new Error("--out-dir requires a path");
      options.outDir = path.resolve(value);
    } else if (argument === "--cache-dir") {
      const value = argv[++index];
      if (!value) throw new Error("--cache-dir requires a path");
      options.cacheDir = path.resolve(value);
    } else {
      throw new Error(`Unknown argument: ${argument}. See the top of scripts/uci-rider-sync.mjs for the supported flags.`);
    }
  }
  if (options.apply && options.dryRun) options.dryRun = false;
  return options;
}

/**
 * Paginates the UCI listing for one discipline/year, following the
 * response's own totalItems/page/pageSize -- never a hardcoded page
 * count. `fromPage`/`toPage` (both inclusive, both optional) bound the
 * range fetched -- useful for a single verification page, or to cap a
 * very large discipline/year listing to a manageable slice. Dedupes by
 * uciRiderId across pages (the same rider can, in principle, appear on
 * more than one page if the underlying data shifts between requests).
 *
 * `categories` (default `DEFAULT_UCI_TEAM_CATEGORIES` -- men's
 * WorldTeams/ProTeams/Continental Teams only) restricts the crawl to
 * those team categories. UCI's own `category` query param only accepts
 * one value per request (confirmed live: a comma-separated value returns
 * zero results) -- categories are mutually exclusive, so this runs one
 * full paginated crawl per category and merges into the same dedupe map
 * (concatenation is safe: a rider cannot appear in two categories at
 * once). Pass `categories: []` for the old unfiltered "ALL CATEGORIES"
 * crawl.
 */
export async function fetchAllUciListingPages({ discipline, year, fromPage, toPage, categories = DEFAULT_UCI_TEAM_CATEGORIES, cache, rateLimiter, circuitBreaker, fetchImpl }) {
  const byId = new Map();
  let pagesRequested = 0;
  let recordsReceived = 0;
  let totalItems = 0;
  const categoryList = categories && categories.length > 0 ? categories : [undefined];

  for (const category of categoryList) {
    let pageSize = null;
    let page = fromPage ?? 1;
    let categoryTotalItems = null;

    while (true) {
      if (circuitBreaker?.isOpen()) break;
      const url = uciSearchUrl({ disciplineCode: discipline, year, page, category });
      const { body } = await fetchTextCached(url, { cache, rateLimiter, fetchImpl, headers: { Accept: "application/json" } });
      circuitBreaker?.recordSuccess();
      const parsed = parseUciRiderSearchResponse(body);
      pagesRequested += 1;
      recordsReceived += parsed.items.length;
      categoryTotalItems = parsed.totalItems;
      pageSize = parsed.pageSize || parsed.items.length || pageSize;

      for (const item of parsed.items) {
        if (item.uciRiderId) byId.set(item.uciRiderId, item);
      }

      const totalPages = pageSize > 0 ? Math.ceil(categoryTotalItems / pageSize) : page;
      const upperBound = toPage ?? totalPages;
      if (page >= upperBound || parsed.items.length === 0) break;
      page += 1;
    }

    totalItems += categoryTotalItems ?? 0;
    if (circuitBreaker?.isOpen()) break;
  }

  return {
    riders: [...byId.values()],
    pagesRequested,
    recordsReceived,
    uniqueRidersReceived: byId.size,
    totalItems,
  };
}

/**
 * Whether a fresh profile fetch is worth doing for one listing item,
 * given the corresponding existing uci_riders row (or null for a
 * brand-new rider). A profile fetch is always needed for a new rider or
 * one still missing a DOB; otherwise it's skipped when every
 * listing-derived field already matches what's stored -- saving a
 * network round trip for the common "nothing changed this week" case.
 * Pure -- no I/O.
 */
export function shouldFetchUciProfile(listingItem, existingRider) {
  if (!existingRider) return true;
  if (!existingRider.date_of_birth) return true;
  if (existingRider.given_name !== (listingItem.givenName ?? null)) return true;
  if (existingRider.family_name !== (listingItem.familyName ?? null)) return true;
  if (existingRider.nationality !== (listingItem.countryCode ?? null)) return true;
  if ((existingRider.current_team_name ?? null) !== (listingItem.teamName ?? null)) return true;
  return false;
}

/**
 * Builds the incoming registry record for one listing item, optionally
 * enriched with a fetched profile. Pure -- no I/O.
 *
 * `matchConfidence` defaults to `"high"`: for the listing-driven sync,
 * `uci_rider_id` is always the confirmed identity for this record (it came
 * directly from the listing's own URL), so a value drawn from a
 * successfully-fetched profile is trusted as high confidence for the
 * DOB/nationality merge gate in scripts/uci-rider-registry.mjs. The
 * roster-seed path (`runRosterSeed` below) is a materially different trust
 * situation -- the identity itself came from a UCI *search* match
 * (scripts/uci-match.mjs's scoreUciCandidate/pickBestUciMatch) that had to
 * be scored against an independent source before being trusted at all --
 * so it passes the real confidence from that pick instead of relying on
 * this default.
 */
export function buildIncomingRegistryRecord(listingItem, profile, { discipline = DEFAULT_DISCIPLINE, matchConfidence = "high" } = {}) {
  const displayName = profile?.canonicalName
    ?? [listingItem.givenName, listingItem.familyName].filter(Boolean).join(" ").trim()
    ?? null;

  return {
    uciRiderId: listingItem.uciRiderId,
    uciCode: null,
    givenName: profile?.givenName ?? listingItem.givenName ?? null,
    familyName: profile?.familyName ?? listingItem.familyName ?? null,
    displayName,
    dateOfBirth: profile?.dateOfBirth ?? null,
    nationality: profile?.nationality ?? listingItem.countryCode ?? null,
    gender: null,
    discipline: discipline === "ROA" ? "road" : discipline.toLowerCase(),
    currentTeamName: profile?.currentTeam ?? listingItem.teamName ?? null,
    currentTeamCode: null,
    uciProfileUrl: profile?.profileUrl ?? (listingItem.uciRiderId ? `https://www.uci.org/rider-details/${listingItem.uciRiderId}` : null),
    matchConfidence,
    teamHistoryRaw: profile?.teamHistoryRaw ?? [],
  };
}

function requireAnonClient() {
  const url = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY
    ?? process.env.SUPABASE_PUBLISHABLE_KEY
    ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
    ?? process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "This sync requires SUPABASE_URL (or EXPO_PUBLIC_SUPABASE_URL) and SUPABASE_ANON_KEY/SUPABASE_PUBLISHABLE_KEY "
      + "to read the existing registry for comparison. Reads never use a service-role key.",
    );
  }
  return { url, anonKey };
}

async function buildClient(url, key, deps) {
  const createClient = deps.createClient ?? (await import("@supabase/supabase-js")).createClient;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
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

/** `--rider-id <id>`: fetch and print one known UCI rider profile directly, bypassing pagination/Supabase entirely. */
export async function runRiderIdLookup(riderId, options, deps = {}) {
  const cache = createPageCache(options.cacheDir, { refresh: options.refreshCache });
  const rateLimiter = createRateLimiter(UCI_MIN_REQUEST_INTERVAL_MS);
  const profile = await fetchUciRiderProfile(riderId, { cache, rateLimiter, fetchImpl: deps.fetchImpl });
  return profile;
}

/** `--search <query>`: runs one raw UCI listing search query and reports the hits, no Supabase reads/writes. */
export async function runSearchOnly(options, deps = {}) {
  const cache = createPageCache(options.cacheDir, { refresh: options.refreshCache });
  const rateLimiter = createRateLimiter(UCI_MIN_REQUEST_INTERVAL_MS);
  const url = uciSearchUrl({ disciplineCode: options.discipline, year: options.year, query: options.search, page: 1 });
  const { body } = await fetchTextCached(url, { cache, rateLimiter, fetchImpl: deps.fetchImpl, headers: { Accept: "application/json" } });
  return parseUciRiderSearchResponse(body);
}

/**
 * Plans alias/team-history/specialty writes for every rider that will
 * actually exist in the DB after this run (inserts + updates + unchanged
 * -- a rider whose own row failed to resolve has no rider_id to attach
 * satellite rows to yet, so it's excluded by construction: it's simply
 * not part of `resolvableEntries`). Shared by both sync orchestrations
 * (`runSync`/`runRosterSeed`) so this planning logic exists exactly once.
 */
async function planSatelliteWrites(readClient, resolvableEntries, teamHistoryByUciId, { teamsIndex, year }) {
  const aliasPlanByUciId = new Map();
  const teamHistoryPlanByUciId = new Map();
  const specialtyPlanByUciId = new Map();

  const existingRiderIdsForSatellites = resolvableEntries.map((entry) => entry.existingId).filter(Boolean);
  const [existingAliases, existingTeamHistory, existingSpecialties] = await Promise.all([
    fetchExistingAliasesForRiders(readClient, existingRiderIdsForSatellites),
    fetchExistingTeamHistoryForRiders(readClient, existingRiderIdsForSatellites),
    fetchExistingSpecialtiesForRiders(readClient, existingRiderIdsForSatellites, year),
  ]);
  const aliasesByRiderId = new Map();
  for (const alias of existingAliases) {
    const list = aliasesByRiderId.get(alias.rider_id) ?? [];
    list.push(alias);
    aliasesByRiderId.set(alias.rider_id, list);
  }
  const teamHistoryByRiderId = new Map();
  for (const row of existingTeamHistory) {
    const list = teamHistoryByRiderId.get(row.rider_id) ?? [];
    list.push(row);
    teamHistoryByRiderId.set(row.rider_id, list);
  }
  const specialtyByRiderId = new Map(existingSpecialties.map((row) => [row.rider_id, row]));

  for (const entry of resolvableEntries) {
    const uciRiderId = entry.incoming.uciRiderId;
    const riderIdForPlanning = entry.existingId; // null for a not-yet-inserted rider — resolved post-insert below

    const aliasPlan = planRiderAliasSync(
      {
        riderId: riderIdForPlanning,
        givenName: entry.incoming.givenName,
        familyName: entry.incoming.familyName,
        canonicalDisplayName: entry.row.display_name,
        source: "uci",
      },
      riderIdForPlanning ? (aliasesByRiderId.get(riderIdForPlanning) ?? []) : [],
    );
    aliasPlanByUciId.set(uciRiderId, aliasPlan);

    const teamHistoryRaw = teamHistoryByUciId.get(uciRiderId) ?? [];
    const teamHistoryPlan = planRiderTeamHistorySync(
      { riderId: riderIdForPlanning, teamHistoryRaw, teamsIndex, source: "uci" },
      riderIdForPlanning ? (teamHistoryByRiderId.get(riderIdForPlanning) ?? []) : [],
    );
    teamHistoryPlanByUciId.set(uciRiderId, teamHistoryPlan);

    const specialtyPlan = planRiderSpecialtySync({
      riderId: riderIdForPlanning,
      season: year,
      existingSpecialtyRow: riderIdForPlanning ? (specialtyByRiderId.get(riderIdForPlanning) ?? null) : null,
    });
    specialtyPlanByUciId.set(uciRiderId, specialtyPlan);
  }

  return { aliasPlanByUciId, teamHistoryPlanByUciId, specialtyPlanByUciId };
}

/**
 * Applies the registry plan plus every rider's planned alias/team-history/
 * specialty writes, and the plan's own review items. Shared by both sync
 * orchestrations so a mid-run failure's handling (left to the caller's own
 * try/catch around this call) and the exact set of tables written stays
 * identical regardless of which sync mode produced the plans.
 */
async function applyRegistryAndSatellites(serviceClient, { registryPlan, resolvableEntries, aliasPlanByUciId, teamHistoryPlanByUciId, specialtyPlanByUciId }) {
  const registryApply = await applyRegistryPlan(serviceClient, registryPlan);

  // Resolve rider ids for freshly-inserted rows (matched by uci_rider_id,
  // the identity every incoming record carries) so satellite writes can
  // target the correct rider_id even for a brand-new registry row.
  const insertedIdByUciId = new Map(registryApply.insertedIds.map((row) => [row.uci_rider_id, row.id]));

  let aliasInsertedCount = 0;
  let teamHistoryInsertedCount = 0;
  let teamHistoryUpdatedCount = 0;
  let specialtyInsertedCount = 0;
  let specialtyUpdatedCount = 0;

  for (const entry of resolvableEntries) {
    const uciRiderId = entry.incoming.uciRiderId;
    const riderId = entry.existingId ?? insertedIdByUciId.get(uciRiderId);
    if (!riderId) continue;

    const aliasPlan = aliasPlanByUciId.get(uciRiderId);
    const aliasRows = aliasPlan.inserts.map((row) => ({ ...row, rider_id: riderId }));
    const aliasResult = await applyAliasInserts(serviceClient, aliasRows);
    aliasInsertedCount += aliasResult.insertedCount;

    const teamHistoryPlan = teamHistoryPlanByUciId.get(uciRiderId);
    const teamHistoryResult = await applyTeamHistoryPlan(serviceClient, {
      inserts: teamHistoryPlan.inserts.map((row) => ({ ...row, rider_id: riderId })),
      updates: teamHistoryPlan.updates,
    });
    teamHistoryInsertedCount += teamHistoryResult.insertedCount;
    teamHistoryUpdatedCount += teamHistoryResult.updatedCount;

    const specialtyPlan = specialtyPlanByUciId.get(uciRiderId);
    if (specialtyPlan.action !== "unchanged") {
      const row = specialtyPlan.action === "insert" ? { ...specialtyPlan.row, rider_id: riderId } : specialtyPlan.row;
      const specialtyResult = await applySpecialtyPlan(serviceClient, [{ action: specialtyPlan.action, row }]);
      specialtyInsertedCount += specialtyResult.insertedCount;
      specialtyUpdatedCount += specialtyResult.updatedCount;
    }
  }

  const reviewInsertResult = await insertReviewItems(serviceClient, registryPlan.reviewItems.map((item) => ({
    queueType: item.queueType,
    riderId: item.candidateIds?.[0] ?? null,
    candidatePayload: { incoming: item.incoming, candidateIds: item.candidateIds ?? [] },
    reason: item.reason ?? null,
    source: "uci_sync",
  })));

  return {
    registryInserted: registryApply.insertedCount,
    registryUpdated: registryApply.updatedCount,
    aliasInserted: aliasInsertedCount,
    teamHistoryInserted: teamHistoryInsertedCount,
    teamHistoryUpdated: teamHistoryUpdatedCount,
    specialtyInserted: specialtyInsertedCount,
    specialtyUpdated: specialtyUpdatedCount,
    reviewItemsInserted: reviewInsertResult.insertedCount,
  };
}

/**
 * Main sync orchestration: paginate -> fetch profiles as needed -> plan
 * registry/alias/team-history/specialty writes -> optionally apply.
 * Staged: every plan is built in full before any write happens, so a
 * mid-run failure never leaves a half-applied, misleadingly-partial
 * state -- the sync-run row's own status (`completed`/`failed`/
 * `partial`) records exactly what happened, explicitly.
 */
export async function runSync(options, deps = {}) {
  const cache = createPageCache(options.cacheDir, { refresh: options.refreshCache });
  const listingRateLimiter = createRateLimiter();
  const profileRateLimiter = createRateLimiter(UCI_MIN_REQUEST_INTERVAL_MS);
  const circuitBreaker = createCircuitBreaker();
  const fetchImpl = deps.fetchImpl;

  const { url, anonKey } = requireAnonClient();
  const readClient = await buildClient(url, anonKey, deps);

  const listing = await fetchAllUciListingPages({
    discipline: options.discipline,
    year: options.year,
    fromPage: options.page ?? options.fromPage,
    toPage: options.page ?? options.toPage,
    cache,
    rateLimiter: listingRateLimiter,
    circuitBreaker,
    fetchImpl,
  });

  const existingRiders = await fetchExistingUciRiders(readClient, { discipline: options.discipline === "ROA" ? "road" : options.discipline.toLowerCase() });
  const existingById = new Map(existingRiders.filter((r) => r.uci_rider_id).map((r) => [r.uci_rider_id, r]));

  let circuitBreakerActivations = 0;
  const sourceFailures = [];
  const incomingRiders = [];
  const teamHistoryByUciId = new Map();

  for (const item of listing.riders) {
    const existing = existingById.get(item.uciRiderId) ?? null;
    let profile = null;

    if (!circuitBreaker.isOpen() && shouldFetchUciProfile(item, existing)) {
      try {
        profile = await fetchUciRiderProfile(item.uciRiderId, { cache, rateLimiter: profileRateLimiter, circuitBreaker, fetchImpl });
      } catch (error) {
        if (error instanceof UciCircuitBreakerOpenError) {
          // Handled once, below, after the loop.
        } else {
          sourceFailures.push({ uciRiderId: item.uciRiderId, message: error.message });
        }
      }
    }

    const incoming = buildIncomingRegistryRecord(item, profile, { discipline: options.discipline });
    incomingRiders.push(incoming);
    if (incoming.teamHistoryRaw?.length) teamHistoryByUciId.set(item.uciRiderId, incoming.teamHistoryRaw);
  }

  if (circuitBreaker.isOpen()) {
    circuitBreakerActivations = 1;
    const state = circuitBreaker.getState();
    sourceFailures.push({
      uciRiderId: null,
      message: `UCI circuit breaker opened after ${state.consecutiveAccessDeniedCount} consecutive ${state.triggeringStatus} responses at ${state.openedAt}. Remaining riders' profiles were skipped this run; their listing-level data was still recorded.`,
    });
  }

  const registryPlan = planRegistrySync(incomingRiders, existingRiders);

  const teamsIndexRows = await fetchGrandTourTeamsIndex(readClient, { grandTourId: options.grandTourIdForTeamLinkage ?? null });
  const teamsIndex = buildTeamLookupIndex(teamsIndexRows);

  const resolvableEntries = [
    ...registryPlan.inserts.map((entry) => ({ ...entry, existingId: null })),
    ...registryPlan.updates.map((entry) => ({ ...entry, existingId: entry.existing.id })),
    ...registryPlan.unchanged.map((entry) => ({ ...entry, existingId: entry.existing.id, row: entry.existing })),
  ];

  const { aliasPlanByUciId, teamHistoryPlanByUciId, specialtyPlanByUciId } = await planSatelliteWrites(
    readClient, resolvableEntries, teamHistoryByUciId, { teamsIndex, year: options.year },
  );

  const summary = {
    discipline: options.discipline,
    year: options.year,
    pagesRequested: listing.pagesRequested,
    recordsReceived: listing.recordsReceived,
    uniqueRidersReceived: listing.uniqueRidersReceived,
    totalItemsReportedByUci: listing.totalItems,
    inserted: registryPlan.summary.inserted,
    updated: registryPlan.summary.updated,
    unchanged: registryPlan.summary.unchanged,
    reviewItems: registryPlan.summary.reviewItems,
    circuitBreakerActivations,
    sourceFailuresCount: sourceFailures.length,
    aliasInsertsPlanned: [...aliasPlanByUciId.values()].reduce((sum, plan) => sum + plan.inserts.length, 0),
    teamHistoryInsertsPlanned: [...teamHistoryPlanByUciId.values()].reduce((sum, plan) => sum + plan.inserts.length, 0),
    teamHistoryUpdatesPlanned: [...teamHistoryPlanByUciId.values()].reduce((sum, plan) => sum + plan.updates.length, 0),
  };

  let runStatus = "completed";
  if (sourceFailures.length > 0 && (registryPlan.inserts.length > 0 || registryPlan.updates.length > 0)) {
    runStatus = "partial";
  } else if (circuitBreakerActivations > 0 && listing.riders.length === 0) {
    runStatus = "failed";
  }

  let applyResult = null;
  let syncRunId = null;

  if (options.apply) {
    const serviceClient = await requireServiceClient(options, deps);
    syncRunId = await insertSyncRun(serviceClient, {
      provider: "uci",
      discipline: options.discipline,
      season_year: options.year,
      pages_requested: listing.pagesRequested,
      records_received: listing.recordsReceived,
      unique_riders_received: listing.uniqueRidersReceived,
      status: "running",
      mode: "apply",
      source_summary: summary,
    });

    try {
      applyResult = await applyRegistryAndSatellites(serviceClient, {
        registryPlan, resolvableEntries, aliasPlanByUciId, teamHistoryPlanByUciId, specialtyPlanByUciId,
      });

      await updateSyncRun(serviceClient, syncRunId, {
        completed_at: new Date().toISOString(),
        inserted_count: applyResult.registryInserted,
        updated_count: applyResult.registryUpdated,
        unchanged_count: registryPlan.summary.unchanged,
        conflicts_count: registryPlan.reviewItems.filter((item) => item.queueType === "dob_conflict" || item.queueType === "nationality_conflict").length,
        review_items_count: registryPlan.reviewItems.length,
        failed_records_count: sourceFailures.length,
        circuit_breaker_activations: circuitBreakerActivations,
        status: runStatus,
        source_summary: { ...summary, applyResult },
      });
    } catch (error) {
      await updateSyncRun(serviceClient, syncRunId, {
        completed_at: new Date().toISOString(),
        status: "failed",
        error_message: error.message,
        source_summary: summary,
      });
      throw error;
    }
  }

  return { summary, registryPlan, sourceFailures, applyResult, syncRunId, runStatus };
}

/**
 * Roster-driven registry seeding: the real "before seeding a race's
 * riders" workflow, as opposed to `runSync`'s blind paginated crawl.
 * Searches UCI by name for every entrant on the race's own official
 * roster (category-scoped -- men's WorldTeams/ProTeams/Continental Teams
 * by default), mirroring the already-proven per-rider pattern in
 * scripts/tdf-2026-rider-importer.mjs's `lookupUciRider`
 * (discoverUciCandidates -> pickBestUciMatch -> fetchUciRiderProfile),
 * just targeting the canonical uci_riders registry instead of
 * grandtour_riders. Shares planSatelliteWrites/applyRegistryAndSatellites
 * with runSync so both orchestrations write identically.
 *
 * Deliberately does NOT write to uci_rider_review_queue for an entrant
 * UCI can't find at all -- that's a "not found on UCI" outcome, reported
 * only in this command's own summary/`notFound` list (mirroring
 * `runUciSearchOnly`'s existing reporting shape). `registryPlan.reviewItems`
 * (real merge conflicts / ambiguous matches *within* the registry itself,
 * e.g. a DOB conflict against an already-existing row) are still written,
 * exactly like `runSync` does -- that's a different, legitimate kind of
 * review item, not the "not found" case. The separate, already-existing
 * `tdf-2026-registry-match-report.mjs` remains the tool that links race
 * entries to the registry and populates the review queue for that.
 */
export async function runRosterSeed(options, deps = {}) {
  if (options.seedFromRoster !== "letour") {
    throw new Error(`--seed-from-roster only supports "letour" today; got ${JSON.stringify(options.seedFromRoster)}. A future non-Tour race needs its own roster-fetch adapter -- not built speculatively.`);
  }

  const cache = createPageCache(options.cacheDir, { refresh: options.refreshCache });
  const letourRateLimiter = createRateLimiter();
  const uciRateLimiter = createRateLimiter(UCI_MIN_REQUEST_INTERVAL_MS);
  const circuitBreaker = createCircuitBreaker();
  const fetchImpl = deps.fetchImpl;

  const { url, anonKey } = requireAnonClient();
  const readClient = await buildClient(url, anonKey, deps);

  const letourTeams = await fetchOfficialTourRoster({ cache, rateLimiter: letourRateLimiter, fetchImpl });
  let entries = letourTeams.flatMap((team) => team.riders.map((rider) => ({ rider, team })));
  if (options.limit) entries = entries.slice(0, options.limit);

  const existingRiders = await fetchExistingUciRiders(readClient, { discipline: options.discipline === "ROA" ? "road" : options.discipline.toLowerCase() });

  let circuitBreakerActivations = 0;
  let searchesAttempted = 0;
  let candidatesFound = 0;
  const sourceFailures = [];
  const notFound = [];
  const incomingRiders = [];
  const teamHistoryByUciId = new Map();

  for (const { rider, team } of entries) {
    if (circuitBreaker.isOpen()) break;
    const officialRider = { officialName: rider.official_name, nationality: rider.nationality, teamName: team.name };
    let picked = { candidate: null, confidence: "low", reasons: ["no_candidates"] };

    try {
      const { candidates, attempts } = await discoverUciCandidates(officialRider, {
        year: options.year, disciplineCode: options.discipline, categories: options.categories, cache, rateLimiter: uciRateLimiter, circuitBreaker, fetchImpl,
      });
      searchesAttempted += attempts.length;
      candidatesFound += candidates.length;
      picked = pickBestUciMatch(officialRider, candidates);
    } catch (error) {
      if (!(error instanceof UciCircuitBreakerOpenError)) {
        sourceFailures.push({ officialName: rider.official_name, bibNumber: rider.bib_number, message: error.message });
      }
    }

    if (!picked.candidate) {
      notFound.push({ officialName: rider.official_name, bibNumber: rider.bib_number, confidence: picked.confidence, reasons: picked.reasons });
      continue;
    }

    let profile = null;
    if (!circuitBreaker.isOpen()) {
      try {
        profile = await fetchUciRiderProfile(picked.candidate.uciRiderId, { cache, rateLimiter: uciRateLimiter, circuitBreaker, fetchImpl });
      } catch (error) {
        if (!(error instanceof UciCircuitBreakerOpenError)) {
          sourceFailures.push({ officialName: rider.official_name, uciRiderId: picked.candidate.uciRiderId, message: error.message });
        }
      }
    }

    const incoming = buildIncomingRegistryRecord(picked.candidate, profile, { discipline: options.discipline, matchConfidence: picked.confidence });
    incomingRiders.push(incoming);
    if (incoming.teamHistoryRaw?.length) teamHistoryByUciId.set(picked.candidate.uciRiderId, incoming.teamHistoryRaw);
  }

  if (circuitBreaker.isOpen()) {
    circuitBreakerActivations = 1;
    const state = circuitBreaker.getState();
    sourceFailures.push({
      officialName: null,
      message: `UCI circuit breaker opened after ${state.consecutiveAccessDeniedCount} consecutive ${state.triggeringStatus} responses at ${state.openedAt}. Remaining roster entries were skipped this run.`,
    });
  }

  const registryPlan = planRegistrySync(incomingRiders, existingRiders);

  const teamsIndexRows = await fetchGrandTourTeamsIndex(readClient, { grandTourId: options.grandTourIdForTeamLinkage ?? null });
  const teamsIndex = buildTeamLookupIndex(teamsIndexRows);

  const resolvableEntries = [
    ...registryPlan.inserts.map((entry) => ({ ...entry, existingId: null })),
    ...registryPlan.updates.map((entry) => ({ ...entry, existingId: entry.existing.id })),
    ...registryPlan.unchanged.map((entry) => ({ ...entry, existingId: entry.existing.id, row: entry.existing })),
  ];

  const { aliasPlanByUciId, teamHistoryPlanByUciId, specialtyPlanByUciId } = await planSatelliteWrites(
    readClient, resolvableEntries, teamHistoryByUciId, { teamsIndex, year: options.year },
  );

  const summary = {
    rosterSource: options.seedFromRoster,
    discipline: options.discipline,
    year: options.year,
    categories: options.categories,
    rosterEntriesConsidered: entries.length,
    searchesAttempted,
    candidatesFound,
    notFoundCount: notFound.length,
    inserted: registryPlan.summary.inserted,
    updated: registryPlan.summary.updated,
    unchanged: registryPlan.summary.unchanged,
    reviewItems: registryPlan.summary.reviewItems,
    circuitBreakerActivations,
    sourceFailuresCount: sourceFailures.length,
    aliasInsertsPlanned: [...aliasPlanByUciId.values()].reduce((sum, plan) => sum + plan.inserts.length, 0),
    teamHistoryInsertsPlanned: [...teamHistoryPlanByUciId.values()].reduce((sum, plan) => sum + plan.inserts.length, 0),
    teamHistoryUpdatesPlanned: [...teamHistoryPlanByUciId.values()].reduce((sum, plan) => sum + plan.updates.length, 0),
  };

  let runStatus = "completed";
  if (sourceFailures.length > 0 && (registryPlan.inserts.length > 0 || registryPlan.updates.length > 0)) {
    runStatus = "partial";
  } else if (circuitBreakerActivations > 0 && incomingRiders.length === 0) {
    runStatus = "failed";
  }

  let applyResult = null;
  let syncRunId = null;

  if (options.apply) {
    const serviceClient = await requireServiceClient(options, deps);
    syncRunId = await insertSyncRun(serviceClient, {
      provider: "uci",
      discipline: options.discipline,
      season_year: options.year,
      pages_requested: 0,
      records_received: entries.length,
      unique_riders_received: incomingRiders.length,
      status: "running",
      mode: "apply",
      source_summary: summary,
    });

    try {
      applyResult = await applyRegistryAndSatellites(serviceClient, {
        registryPlan, resolvableEntries, aliasPlanByUciId, teamHistoryPlanByUciId, specialtyPlanByUciId,
      });

      await updateSyncRun(serviceClient, syncRunId, {
        completed_at: new Date().toISOString(),
        inserted_count: applyResult.registryInserted,
        updated_count: applyResult.registryUpdated,
        unchanged_count: registryPlan.summary.unchanged,
        conflicts_count: registryPlan.reviewItems.filter((item) => item.queueType === "dob_conflict" || item.queueType === "nationality_conflict").length,
        review_items_count: registryPlan.reviewItems.length,
        failed_records_count: sourceFailures.length,
        circuit_breaker_activations: circuitBreakerActivations,
        status: runStatus,
        source_summary: { ...summary, applyResult },
      });
    } catch (error) {
      await updateSyncRun(serviceClient, syncRunId, {
        completed_at: new Date().toISOString(),
        status: "failed",
        error_message: error.message,
        source_summary: summary,
      });
      throw error;
    }
  }

  return { summary, registryPlan, notFound, sourceFailures, applyResult, syncRunId, runStatus };
}

async function writeOutputs({ summary, registryPlan, sourceFailures, options, outDirNameOverride = "uci-rider-sync" }) {
  await fs.mkdir(options.outDir, { recursive: true });
  const summaryPath = path.join(options.outDir, `${outDirNameOverride}-summary.json`);
  const changesPath = path.join(options.outDir, `${outDirNameOverride}-changes.csv`);
  const reviewPath = path.join(options.outDir, `${outDirNameOverride}-review.csv`);

  const changeRows = [
    ...registryPlan.inserts.map((entry) => ({ action: "insert", uci_rider_id: entry.incoming.uciRiderId, display_name: entry.row.display_name })),
    ...registryPlan.updates.map((entry) => ({ action: "update", uci_rider_id: entry.incoming.uciRiderId, display_name: entry.row.display_name })),
  ];
  const changesCsv = `action,uci_rider_id,display_name\n${changeRows.map((row) => `${row.action},${row.uci_rider_id ?? ""},"${(row.display_name ?? "").replaceAll('"', '""')}"`).join("\n")}\n`;

  const reviewRows = [
    ...registryPlan.reviewItems.map((item) => ({ queue_type: item.queueType, uci_rider_id: item.incoming?.uciRiderId ?? "", display_name: item.incoming?.displayName ?? "", candidate_ids: (item.candidateIds ?? []).join("|") })),
    ...sourceFailures.map((failure) => ({ queue_type: "source_failure", uci_rider_id: failure.uciRiderId ?? "", display_name: "", candidate_ids: failure.message })),
  ];
  const reviewCsv = `queue_type,uci_rider_id,display_name,candidate_ids\n${reviewRows.map((row) => `${row.queue_type},${row.uci_rider_id},"${(row.display_name ?? "").replaceAll('"', '""')}","${(row.candidate_ids ?? "").replaceAll('"', '""')}"`).join("\n")}\n`;

  await Promise.all([
    fs.writeFile(summaryPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), ...summary }, null, 2)}\n`, "utf8"),
    fs.writeFile(changesPath, changesCsv, "utf8"),
    fs.writeFile(reviewPath, reviewCsv, "utf8"),
  ]);

  return { summaryPath, changesPath, reviewPath };
}

export async function main(argv = process.argv.slice(2), deps = {}) {
  const options = parseSyncArgs(argv);

  if (options.riderId) {
    const profile = await runRiderIdLookup(options.riderId, options, deps);
    console.log(JSON.stringify({ mode: "rider-id-lookup", riderId: options.riderId, profile }, null, 2));
    return;
  }

  if (options.search) {
    const result = await runSearchOnly(options, deps);
    console.log(JSON.stringify({ mode: "search-only", query: options.search, ...result }, null, 2));
    return;
  }

  if (options.seedFromRoster) {
    const result = await runRosterSeed(options, deps);
    let writtenFiles = null;
    if (options.writeFiles) {
      writtenFiles = await writeOutputs({ summary: result.summary, registryPlan: result.registryPlan, sourceFailures: result.sourceFailures, options, outDirNameOverride: "uci-rider-roster-seed" });
    }
    console.log(JSON.stringify({
      mode: options.apply ? "roster-seed-apply" : "roster-seed-dry-run",
      writtenFiles,
      ...result.summary,
      notFound: result.notFound,
      applyResult: result.applyResult,
      syncRunId: result.syncRunId,
      runStatus: result.runStatus,
    }, null, 2));
    return;
  }

  const result = await runSync(options, deps);

  let writtenFiles = null;
  if (options.writeFiles) {
    writtenFiles = await writeOutputs({ summary: result.summary, registryPlan: result.registryPlan, sourceFailures: result.sourceFailures, options });
  }

  console.log(JSON.stringify({
    mode: options.apply ? "apply" : "dry-run",
    writtenFiles,
    ...result.summary,
    applyResult: result.applyResult,
    syncRunId: result.syncRunId,
    runStatus: result.runStatus,
  }, null, 2));
}

export { INACTIVITY_THRESHOLD_CONSECUTIVE_SYNCS };

// No process.exit() anywhere (async workers included) -- see the same
// convention/rationale in scripts/tdf-2026-rider-importer.mjs.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    await main();
  } catch (error) {
    console.error(`uci-rider-sync failed: ${error.message}`);
    if (error.cause) console.error(`Caused by: ${error.cause.message ?? error.cause}`);
    process.exitCode = 1;
  }
}
