import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { fetchReconciliationContext, resolveGrandTourId } from "./grandtour-reconciliation-supabase.mjs";
import { buildReconciliationReport, reconcileStageResult } from "./grandtour-reconciliation.mjs";

/**
 * Validates the read-only reconciliation wiring (grandtour-reconciliation-supabase.mjs
 * + grandtour-reconciliation.mjs) against a REAL local Supabase instance,
 * using hand-built parsed "official-letour" style stage payloads instead of
 * a live letour.fr fetch (the seeded local grand tour has no real
 * letour.fr-published stage). This exercises the actual RLS-gated reads
 * (`grandtour_stages`, `grandtour_riders`, `grandtour_teams`,
 * `grandtour_stage_startlists`) with the
 * public anon key against real seeded data — the CLI's `--reconcile` flag
 * uses these exact same two modules, so this validates that wiring without
 * depending on network access or real Tour de France stage timing.
 *
 * Prerequisites (see docs/grandtour-results-feed.md "Local reconciliation
 * smoke test"):
 *   npx supabase db reset
 *   docker exec -i supabase_db_tipping-suite psql -U postgres -d postgres \
 *     < supabase/seeds/grandtour_reconciliation_smoke.sql
 *   SUPABASE_URL / SUPABASE_ANON_KEY (or EXPO_PUBLIC_* equivalents) set to
 *   the local `npx supabase status -o env` values — anon key only, never
 *   the service-role key.
 *
 * This script only ever reads (via the two modules above). It never writes.
 */

const GRAND_TOUR_NAME = "GrandTour France 2026";
const GRAND_TOUR_YEAR = 2026;

// The official Tour de France 2026 startlist (scripts/load-tdf-2026-startlist.mjs)
// may also be loaded against this same local grand tour: 23 official teams,
// 184 official riders (bibs 1-228, in per-team decade blocks), and 184
// confirmed grandtour_stage_startlists rows per stage. This smoke test's own
// fixture riders/teams (seeded by supabase/seed.sql, bib-numbered by
// supabase/seeds/grandtour_reconciliation_smoke.sql) remain in the same
// grand tour alongside them, marked inactive/status=dns by the loader since
// they are not on the official list — but they are NOT removed, and
// grandtour-reconciliation-supabase.mjs's fetchReconciliationContext() reads
// every rider/team in the grand tour regardless of status. Bib-number
// matching (classifyRiderMatch) is global across the whole grand tour, not
// scoped by status or team, so this fixture's bibs must stay outside the
// official 1-228 range or they would spuriously collide.

// Bib numbers assigned deterministically by grandtour_reconciliation_smoke.sql:
// bib_number = 900 + right(id::text, 3)::int, except riders 001/002 both
// forced to bib 901, and rider 003 deliberately removed from stage 2's
// startlist only (supabase/seed.sql otherwise puts every seeded rider on
// every stage's startlist, so that removal is the only real DB state that
// can produce a "matched rider missing from startlist" case).
const RIDER = {
  duplicateBibA: { id: "40000000-0000-4000-8000-000000000001", name: "Luc Moreau", bib: 901, teamId: "30000000-0000-4000-8000-000000000001" },
  duplicateBibB: { id: "40000000-0000-4000-8000-000000000002", name: "Étienne Caron", bib: 901, teamId: "30000000-0000-4000-8000-000000000001" },
  notOnStage2Startlist: { id: "40000000-0000-4000-8000-000000000003", name: "Mathieu Delorme", bib: 903, teamId: "30000000-0000-4000-8000-000000000001" },
  clean4: { id: "40000000-0000-4000-8000-000000000004", name: "Rémi Vaillant", bib: 904, teamId: "30000000-0000-4000-8000-000000000001" },
  clean5: { id: "40000000-0000-4000-8000-000000000005", name: "Julien Mercier", bib: 905, teamId: "30000000-0000-4000-8000-000000000001" },
  clean6: { id: "40000000-0000-4000-8000-000000000006", name: "Elias Berg", bib: 906, teamId: "30000000-0000-4000-8000-000000000002" },
  // A fourth clean (matched, on-stage-2-startlist) rider, used only as a
  // jersey holder in the "perfect match" scenario below (clean4/5/6 are
  // already used as result-line riders there).
  clean7: { id: "40000000-0000-4000-8000-000000000007", name: "Nils Andersen", bib: 907, teamId: "30000000-0000-4000-8000-000000000002" }
};
const TEAM_ONE_SHORT_NAME = "AUV"; // 30000000-0000-4000-8000-000000000001 in supabase/seed.sql
const TEAM_TWO_SHORT_NAME = "NST"; // 30000000-0000-4000-8000-000000000002 in supabase/seed.sql

// Expected legacy fixture counts, independent of whether the official TDF
// 2026 startlist has also been loaded into this grand tour.
const LEGACY_RIDER_COUNT = 40;
const LEGACY_TEAM_COUNT = 8;
const LEGACY_STAGE2_STARTLIST_COUNT = 39; // rider 003 deliberately removed
const LEGACY_STAGE4_STARTLIST_COUNT = 40;

// Official TDF 2026 startlist counts (scripts/load-tdf-2026-startlist.mjs),
// present only if that loader has been applied to this grand tour.
const OFFICIAL_TEAM_COUNT = 23;
const OFFICIAL_RIDER_COUNT = 184;
const OFFICIAL_STAGE_STARTLIST_COUNT = 184;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value, message) {
  assert.ok(typeof value === "string" && UUID_PATTERN.test(value), message ?? `expected a UUID, got ${JSON.stringify(value)}`);
}

function parsedRider(rider, overrides = {}) {
  return {
    position: overrides.position ?? 1,
    rider_name: overrides.rider_name ?? rider.name.toUpperCase(),
    bib_number: overrides.bib_number ?? rider.bib,
    team_name: overrides.team_name ?? TEAM_ONE_SHORT_NAME,
    time: "01h 00' 00\"",
    gap: "-"
  };
}

const JERSEY_TYPE_CLASSIFICATION = { yellow: "individual", green: "points", kom: "climber", white: "youth" };

function jerseyRiderEntry(jerseyType, rider, overrides = {}) {
  return {
    jerseyType,
    sourceClassification: JERSEY_TYPE_CLASSIFICATION[jerseyType],
    parsedRiderName: overrides.rider_name ?? rider.name.toUpperCase(),
    parsedTeamName: overrides.team_name ?? TEAM_ONE_SHORT_NAME,
    bibNumber: overrides.bib_number ?? rider.bib
  };
}

const results = [];
function record(name, fn) {
  try {
    fn();
    results.push({ name, status: "pass" });
    console.log(`  PASS  ${name}`);
  } catch (error) {
    results.push({ name, status: "fail", error: error.message });
    console.log(`  FAIL  ${name}`);
    console.log(`        ${error.message}`);
  }
}

async function main() {
  const url = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("Set SUPABASE_URL (or EXPO_PUBLIC_SUPABASE_URL) and SUPABASE_ANON_KEY (or EXPO_PUBLIC_SUPABASE_ANON_KEY) to your local `npx supabase status -o env` values before running this smoke test. Anon key only — never the service-role key.");
  }
  if (/service_role/i.test(anonKey)) {
    throw new Error("Refusing to run: the provided key looks like a service-role key. This smoke test must only use the anon key.");
  }

  const { createClient } = await import("@supabase/supabase-js");
  const client = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });

  console.log(`Resolving grand tour "${GRAND_TOUR_NAME}" (${GRAND_TOUR_YEAR}) via anon key...`);
  const grandTourId = await resolveGrandTourId(client, { name: GRAND_TOUR_NAME, year: GRAND_TOUR_YEAR });
  if (!grandTourId) {
    throw new Error(`Could not find grand tour "${GRAND_TOUR_NAME}" (${GRAND_TOUR_YEAR}). Run \`npx supabase db reset\` (which applies supabase/seed.sql) first.`);
  }
  console.log(`  resolved grandTourId=${grandTourId}`);

  console.log("Fetching reconciliation context for stage 2 (road, hilly) via anon key...");
  const roadContext = await fetchReconciliationContext(client, { grandTourId, stageNumber: 2 });
  assert.ok(roadContext.existingStage, "expected stage 2 to be found (RLS/read check)");
  assertUuid(roadContext.existingStage.id, "stage 2's existingStage.id must be a real UUID");

  // fetchReconciliationContext() returns every rider/team in the grand tour
  // regardless of status, so with the official TDF 2026 startlist loaded
  // (scripts/load-tdf-2026-startlist.mjs --apply) this grand tour now
  // legitimately holds both the 40 legacy fixture riders (inactive/dns,
  // never removed) and the 184 active official riders. Confirm the active
  // official count precisely via a direct status-scoped read, since
  // fetchReconciliationContext()'s shape (used by the real reconcile CLI)
  // doesn't carry status/is_active at all.
  const { count: activeRiderCount, error: activeRiderCountError } = await client
    .from("grandtour_riders")
    .select("id", { count: "exact", head: true })
    .eq("grand_tour_id", grandTourId)
    .eq("status", "active");
  if (activeRiderCountError) throw activeRiderCountError;
  assert.equal(
    activeRiderCount,
    OFFICIAL_RIDER_COUNT,
    `expected ${OFFICIAL_RIDER_COUNT} active official riders — run \`node scripts/load-tdf-2026-startlist.mjs --apply --confirm-tour "Tour de France 2026"\` against this local grand tour first`
  );
  assert.equal(
    roadContext.existingRiders.length,
    LEGACY_RIDER_COUNT + OFFICIAL_RIDER_COUNT,
    `expected ${LEGACY_RIDER_COUNT} legacy fixture riders plus ${OFFICIAL_RIDER_COUNT} active official riders to be readable`
  );

  // Legacy fixture teams (supabase/seed.sql) never set team_type; official
  // teams (scripts/load-tdf-2026-startlist.mjs) always do — a convenient,
  // already-present column to distinguish the two groups without coupling
  // this test to the loader's team name list.
  const { count: officialTeamCount, error: officialTeamCountError } = await client
    .from("grandtour_teams")
    .select("id", { count: "exact", head: true })
    .eq("grand_tour_id", grandTourId)
    .not("team_type", "is", null);
  if (officialTeamCountError) throw officialTeamCountError;
  assert.equal(officialTeamCount, OFFICIAL_TEAM_COUNT, `expected ${OFFICIAL_TEAM_COUNT} official teams (team_type set)`);
  assert.equal(
    roadContext.existingTeams.length,
    LEGACY_TEAM_COUNT + OFFICIAL_TEAM_COUNT,
    `expected ${LEGACY_TEAM_COUNT} legacy fixture teams plus ${OFFICIAL_TEAM_COUNT} official teams to be readable`
  );

  assert.equal(
    roadContext.existingStartlist.length,
    LEGACY_STAGE2_STARTLIST_COUNT + OFFICIAL_STAGE_STARTLIST_COUNT,
    `expected ${LEGACY_STAGE2_STARTLIST_COUNT} legacy fixture startlist rows (rider 003 deliberately removed) plus ${OFFICIAL_STAGE_STARTLIST_COUNT} confirmed official startlist rows on stage 2`
  );
  assert.ok(!roadContext.existingStartlist.some((row) => row.riderId === RIDER.notOnStage2Startlist.id), "rider 003 should not be on stage 2's startlist");
  console.log(`  RLS did not block reads: stage=${roadContext.existingStage.id} riders=${roadContext.existingRiders.length} teams=${roadContext.existingTeams.length} startlist=${roadContext.existingStartlist.length}`);

  console.log("Fetching reconciliation context for stage 4 (TTT) via anon key...");
  const tttContext = await fetchReconciliationContext(client, { grandTourId, stageNumber: 4 });
  assert.ok(tttContext.existingStage, "expected stage 4 (TTT) to be found");
  assertUuid(tttContext.existingStage.id, "stage 4's existingStage.id must be a real UUID");
  assert.notEqual(tttContext.existingStage.id, roadContext.existingStage.id, "stage 2 and stage 4 must resolve to different stage UUIDs");
  assert.equal(
    tttContext.existingStartlist.length,
    LEGACY_STAGE4_STARTLIST_COUNT + OFFICIAL_STAGE_STARTLIST_COUNT,
    `expected all ${LEGACY_STAGE4_STARTLIST_COUNT} legacy fixture riders (only stage 2's was modified) plus ${OFFICIAL_STAGE_STARTLIST_COUNT} confirmed official startlist rows on stage 4`
  );

  console.log("Fetching reconciliation context for stage 999 (does not exist)...");
  const missingContext = await fetchReconciliationContext(client, { grandTourId, stageNumber: 999 });
  assert.equal(missingContext.existingStage, null, "expected no stage record for stage 999");

  console.log("\nRunning reconciliation scenarios against real Supabase data:\n");

  record("perfect match: all riders and teams matched, on the startlist, safe to apply", () => {
    const parsedStageResult = {
      stage_number: 2,
      type: "road",
      riders: [
        parsedRider(RIDER.clean4, { position: 1 }),
        parsedRider(RIDER.clean5, { position: 2 }),
        parsedRider(RIDER.clean6, { position: 3, team_name: TEAM_TWO_SHORT_NAME })
      ],
      jersey_holders: [
        jerseyRiderEntry("yellow", RIDER.clean4),
        jerseyRiderEntry("green", RIDER.clean5),
        jerseyRiderEntry("kom", RIDER.clean6, { team_name: TEAM_TWO_SHORT_NAME }),
        jerseyRiderEntry("white", RIDER.clean7, { team_name: TEAM_TWO_SHORT_NAME })
      ]
    };
    const result = reconcileStageResult({
      stageNumber: 2,
      stageType: "road",
      parsedStageResult,
      existingStage: roadContext.existingStage,
      existingRiders: roadContext.existingRiders,
      existingTeams: roadContext.existingTeams,
      existingStartlist: roadContext.existingStartlist
    });
    assert.equal(result.matchedRiders.length, 3);
    assert.deepEqual(result.unmatchedRiders, []);
    assert.deepEqual(result.ambiguousRiders, []);
    assert.equal(result.matchedTeams.length, 3);
    assert.equal(result.matchedRidersOnStartlist.length, 3);
    assert.deepEqual(result.matchedRidersMissingFromStartlist, []);
    assert.equal(result.startlistValidationPassed, true);
    assert.equal(result.noStartlistRowsFound, false);
    assert.equal(result.jerseyHolders.length, 4);
    assert.ok(result.jerseyHolders.every((holder) => holder.status === "matched"), `expected all 4 jersey holders matched, got ${JSON.stringify(result.jerseyHolders.map((h) => [h.jerseyType, h.status]))}`);
    assert.equal(result.safeToApply, true, `expected safe to apply, blockers=${JSON.stringify(result.blockers)}`);
    assertUuid(result.stageId, "road stage reconciliation result must carry a UUID-shaped stageId");
    assert.equal(result.stageId, roadContext.existingStage.id, "stageId must be exactly the stage UUID fetchReconciliationContext read, not re-derived");
    assert.equal(result.stageType, "hilly", "stageType must be the real grandtour_stages.stage_type for stage 2");
  });

  record("unmatched rider: unknown bib and name blocks safe-to-apply", () => {
    const parsedStageResult = {
      stage_number: 2,
      type: "road",
      riders: [
        parsedRider(RIDER.clean4, { position: 1 }),
        parsedRider({ name: "Unknown Rider", bib: 99999, teamId: null }, { position: 2, rider_name: "X. NOBODY" })
      ]
    };
    const result = reconcileStageResult({
      stageNumber: 2,
      stageType: "road",
      parsedStageResult,
      existingStage: roadContext.existingStage,
      existingRiders: roadContext.existingRiders,
      existingTeams: roadContext.existingTeams,
      existingStartlist: roadContext.existingStartlist
    });
    assert.equal(result.unmatchedRiders.length, 1);
    assert.equal(result.unmatchedRiders[0].riderName, "X. NOBODY");
    assert.equal(result.safeToApply, false);
  });

  record("startlist validation: a real matched rider (bib 3) removed from stage 2's startlist blocks safe-to-apply", () => {
    const parsedStageResult = {
      stage_number: 2,
      type: "road",
      riders: [
        parsedRider(RIDER.notOnStage2Startlist, { position: 1 }),
        parsedRider(RIDER.clean4, { position: 2 })
      ]
    };
    const result = reconcileStageResult({
      stageNumber: 2,
      stageType: "road",
      parsedStageResult,
      existingStage: roadContext.existingStage,
      existingRiders: roadContext.existingRiders,
      existingTeams: roadContext.existingTeams,
      existingStartlist: roadContext.existingStartlist
    });
    assert.equal(result.matchedRiders.length, 2);
    assert.equal(result.matchedRidersOnStartlist.length, 1);
    assert.equal(result.matchedRidersOnStartlist[0].riderId, RIDER.clean4.id);
    assert.equal(result.matchedRidersMissingFromStartlist.length, 1);
    assert.equal(result.matchedRidersMissingFromStartlist[0].riderId, RIDER.notOnStage2Startlist.id);
    assert.equal(result.startlistValidationPassed, false);
    assert.equal(result.noStartlistRowsFound, false);
    assert.equal(result.safeToApply, false);
    assert.ok(result.blockers.some((blocker) => blocker.includes("not on the stage 2 startlist")));
  });

  record("startlist validation: no startlist rows found blocks safe-to-apply", () => {
    const parsedStageResult = {
      stage_number: 2,
      type: "road",
      riders: [parsedRider(RIDER.clean4, { position: 1 })]
    };
    const result = reconcileStageResult({
      stageNumber: 2,
      stageType: "road",
      parsedStageResult,
      existingStage: roadContext.existingStage,
      existingRiders: roadContext.existingRiders,
      existingTeams: roadContext.existingTeams,
      existingStartlist: [] // deliberately overridden, independent of real DB state, to exercise this specific code path
    });
    assert.equal(result.matchedRiders.length, 1);
    assert.equal(result.matchedRidersMissingFromStartlist.length, 1);
    assert.equal(result.noStartlistRowsFound, true);
    assert.equal(result.startlistValidationPassed, false);
    assert.equal(result.safeToApply, false);
    assert.ok(result.blockers.some((blocker) => blocker.includes("No grandtour_stage_startlists rows were found")));
  });

  record("ambiguous rider: bib 901 matches two real seeded riders", () => {
    const parsedStageResult = {
      stage_number: 2,
      type: "road",
      riders: [
        parsedRider({ name: "unused", bib: 901, teamId: null }, { position: 1, rider_name: "SOME RIDER" })
      ]
    };
    const result = reconcileStageResult({
      stageNumber: 2,
      stageType: "road",
      parsedStageResult,
      existingStage: roadContext.existingStage,
      existingRiders: roadContext.existingRiders,
      existingTeams: roadContext.existingTeams
    });
    assert.equal(result.ambiguousRiders.length, 1);
    assert.deepEqual(
      result.ambiguousRiders[0].candidateIds.sort(),
      [RIDER.duplicateBibA.id, RIDER.duplicateBibB.id].sort()
    );
    assert.equal(result.safeToApply, false);
  });

  record("duplicate bib conflict: two parsed rows share a bib number", () => {
    const parsedStageResult = {
      stage_number: 2,
      type: "road",
      riders: [
        parsedRider(RIDER.clean4, { position: 1, bib_number: 50 }),
        parsedRider(RIDER.clean5, { position: 2, bib_number: 50 })
      ]
    };
    const result = reconcileStageResult({
      stageNumber: 2,
      stageType: "road",
      parsedStageResult,
      existingStage: roadContext.existingStage,
      existingRiders: roadContext.existingRiders,
      existingTeams: roadContext.existingTeams,
      existingStartlist: roadContext.existingStartlist
    });
    assert.equal(result.duplicateBibConflicts.length, 1);
    assert.equal(result.duplicateBibConflicts[0].bibNumber, 50);
    assert.equal(result.safeToApply, false);
  });

  record("unmatched team: real rider, unrecognized team name", () => {
    const parsedStageResult = {
      stage_number: 2,
      type: "road",
      riders: [
        parsedRider(RIDER.clean4, { position: 1, team_name: "NONEXISTENT SPONSOR TEAM" })
      ]
    };
    const result = reconcileStageResult({
      stageNumber: 2,
      stageType: "road",
      parsedStageResult,
      existingStage: roadContext.existingStage,
      existingRiders: roadContext.existingRiders,
      existingTeams: roadContext.existingTeams,
      existingStartlist: roadContext.existingStartlist
    });
    assert.equal(result.unmatchedTeams.length, 1);
    assert.equal(result.matchedRiders.length, 1);
    assert.equal(result.safeToApply, false);
  });

  record("missing stage: stage 999 has no grandtour_stages record", () => {
    const parsedStageResult = {
      stage_number: 999,
      type: "road",
      riders: [parsedRider(RIDER.clean4, { position: 1 })]
    };
    const result = reconcileStageResult({
      stageNumber: 999,
      stageType: "road",
      parsedStageResult,
      existingStage: missingContext.existingStage,
      existingRiders: missingContext.existingRiders,
      existingTeams: missingContext.existingTeams,
      existingStartlist: missingContext.existingStartlist
    });
    assert.equal(result.missingStageRecord, true);
    assert.equal(result.stageId, null, "a missing stage record must yield a null stageId, never a stale/guessed UUID");
    assert.equal(result.safeToApply, false);
  });

  record("TTT stage 4 is never safe to apply, even when rider matching and startlist validation both pass cleanly", () => {
    const parsedStageResult = {
      stage_number: 4,
      type: "ttt",
      riders: [
        parsedRider(RIDER.notOnStage2Startlist, { position: 1 }), // on stage 4's startlist; only removed from stage 2's
        parsedRider(RIDER.clean4, { position: 2 }),
        parsedRider(RIDER.clean5, { position: 3 })
      ]
    };
    const result = reconcileStageResult({
      stageNumber: 4,
      stageType: "ttt",
      parsedStageResult,
      existingStage: tttContext.existingStage,
      existingRiders: tttContext.existingRiders,
      existingTeams: tttContext.existingTeams,
      existingStartlist: tttContext.existingStartlist
    });
    assert.equal(result.isTtt, true);
    assert.equal(result.matchedRiders.length, 3, "clean rider match should still succeed for a TTT stage");
    assert.equal(result.startlistValidationPassed, true, "startlist check itself should pass on stage 4 since only stage 2's startlist row was removed");
    assert.equal(result.safeToApply, false, "TTT must stay unsafe even though the startlist check passed");
    assert.ok(result.blockers.some((blocker) => blocker.includes("TTT")));
    assertUuid(result.stageId, "TTT stage reconciliation result must also carry a UUID-shaped stageId, even though it's unsafe to apply");
    assert.equal(result.stageId, tttContext.existingStage.id, "stageId must be exactly the stage UUID fetchReconciliationContext read, not re-derived");
    assert.equal(result.stageType, "team_time_trial", "stageType must be the real grandtour_stages.stage_type for stage 4");
  });

  const report = buildReconciliationReport({
    provider: "official-letour-local-smoke",
    stageRangeRequested: { fromStage: 2, toStage: 4 },
    stageReconciliations: []
  });
  assert.equal(report.dryRun, true);
  assert.equal(report.applyEnabled, false);
  assert.equal(report.reconciliationOnly, true);

  const reportPath = path.resolve("tmp", "grandtour-reconciliation-local-smoke-report.json");
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify({ results, sampleReportMetadata: report }, null, 2)}\n`, "utf8");

  const failures = results.filter((entry) => entry.status === "fail");
  console.log(`\n${results.length - failures.length}/${results.length} scenarios passed. Report written to ${reportPath}.`);
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

await main();
