import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { isProductionSupabaseUrl } from "./grandtour-apply.mjs";
import { runSync } from "./uci-rider-sync.mjs";

/**
 * Real local-Supabase end-to-end smoke test for the UCI rider registry
 * sync (scripts/uci-rider-sync.mjs + friends), following the established
 * `-local-smoke.mjs` convention (see scripts/grandtour-apply-local-smoke.mjs):
 * pre-flight dirty-state check, record()-wrapped scenarios, full cleanup
 * of every row it creates, isProductionSupabaseUrl refusal with no
 * override flag (a disposable dev tool, never meant to run against
 * production).
 *
 * Uses an injected fake fetchImpl (a small, fixed 3-rider fake UCI
 * listing + profiles) rather than hitting the real uci.org API -- this
 * keeps the smoke test fast, deterministic, and independent of UCI's
 * live data changing under it; the live-API verification is a separate,
 * explicit step (see the task's own verification plan). A dedicated,
 * never-real discipline code ("SMK") keeps every row this script creates
 * trivially distinguishable and safely cleanable, even if a real sync
 * has also been run against the same local database.
 */

const SMOKE_DISCIPLINE = "SMK";
const SMOKE_YEAR = 9999;

// Real UCI rider ids are purely numeric (uci-parsers.mjs's
// uciRiderIdFromUrl only matches \d+ in a /rider-details/<id> path) --
// these fixture ids use a distinctive 9000xx prefix, both to match that
// real shape and to make them trivially recognizable as smoke-test data
// if cleanup were ever to fail.
const FAKE_RIDERS = [
  { uciRiderId: "900001", givenName: "Ana", familyName: "Rider", countryCode: "AUS", teamName: "Smoke Team A", dob: "01.01.1998" },
  { uciRiderId: "900002", givenName: "Ben", familyName: "Cyclist", countryCode: "FRA", teamName: "Smoke Team B", dob: "02.02.1999" },
  { uciRiderId: "900003", givenName: "Cara", familyName: "Racer", countryCode: "ESP", teamName: "Smoke Team C", dob: "03.03.2000" },
];

function fakeListingResponse(page) {
  if (page === 1) {
    return {
      totalItems: 3,
      page: 1,
      pageSize: 3,
      items: FAKE_RIDERS.map((rider) => ({
        givenName: rider.givenName,
        familyName: rider.familyName,
        countryCode: rider.countryCode,
        teamName: rider.teamName,
        url: `/rider-details/${rider.uciRiderId}`,
      })),
    };
  }
  return { totalItems: 3, page, pageSize: 3, items: [] };
}

function fakeProfileHtml(rider) {
  const props = JSON.stringify({
    details: {
      givenName: rider.givenName,
      familyName: rider.familyName,
      dob: rider.dob,
      nationality: rider.countryCode,
      location: rider.teamName,
    },
    history: { teams: [{ year: SMOKE_YEAR, teamName: rider.teamName, teamCode: null, countryCode: rider.countryCode }] },
  }).replaceAll('"', "&quot;");
  return `<div data-component="RiderDetailsModule" data-props="${props}"></div>`;
}

function fakeFetchImpl(url) {
  const parsed = new URL(url);
  if (parsed.pathname.startsWith("/api/riders/")) {
    const page = Number(parsed.searchParams.get("page") ?? 1);
    return Promise.resolve({ ok: true, status: 200, statusText: "OK", text: async () => JSON.stringify(fakeListingResponse(page)) });
  }
  const riderIdMatch = parsed.pathname.match(/\/rider-details\/(.+)$/);
  const rider = FAKE_RIDERS.find((r) => r.uciRiderId === riderIdMatch?.[1]);
  if (!rider) {
    return Promise.resolve({ ok: true, status: 200, statusText: "OK", text: async () => "<html></html>" });
  }
  return Promise.resolve({ ok: true, status: 200, statusText: "OK", text: async () => fakeProfileHtml(rider) });
}

const results = [];
function record(name, fn) {
  return (async () => {
    try {
      await fn();
      results.push({ name, status: "pass" });
      console.log(`  PASS  ${name}`);
    } catch (error) {
      results.push({ name, status: "fail", error: error.message });
      console.log(`  FAIL  ${name}`);
      console.log(`        ${error.message}`);
    }
  })();
}

async function main() {
  const url = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !serviceRoleKey || !anonKey) {
    throw new Error("Set SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY to your local `npx supabase status -o env` values before running this smoke test.");
  }
  if (isProductionSupabaseUrl(url)) {
    throw new Error(`Refusing to run: ${url} resolves to a known production project. This script never runs against production, with no override.`);
  }

  const { createClient } = await import("@supabase/supabase-js");
  const client = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  console.log("Confirming no pre-existing SMOKE-discipline rows...");
  const { data: preExisting, error: preExistingError } = await client.from("uci_riders").select("id").eq("discipline", "smk").limit(1);
  if (preExistingError) throw preExistingError;
  if (preExisting && preExisting.length > 0) {
    throw new Error("Found pre-existing discipline='smk' rows from a previous incomplete run. Delete them manually (or via this script's own cleanup) before re-running.");
  }

  const options = { discipline: SMOKE_DISCIPLINE, year: SMOKE_YEAR, apply: true, dryRun: false, confirmProduction: false, cacheDir: null, refreshCache: true };
  const deps = { fetchImpl: fakeFetchImpl, createClient: () => client };

  // Bypass the on-disk page cache entirely for this smoke test (no
  // cacheDir writes) by overriding createPageCache's effect: runSync
  // always builds its own cache via createPageCache(options.cacheDir),
  // which writes lazily only on a miss -- passing a dedicated throwaway
  // directory keeps this fully isolated and easy to clean up.
  options.cacheDir = "tmp/uci-rider-sync-local-smoke-cache";

  let firstRunResult = null;

  await record("real sync --apply: a fresh 3-rider fake UCI listing is inserted end-to-end (riders, aliases, team history, specialties, sync run)", async () => {
    firstRunResult = await runSync(options, deps);
    assert.equal(firstRunResult.summary.inserted, 3);
    assert.equal(firstRunResult.summary.unchanged, 0);
    assert.ok(firstRunResult.syncRunId);
    assert.equal(firstRunResult.runStatus, "completed");
  });

  await record("real sync: exactly 3 uci_riders rows exist for the smoke discipline, each with a DOB from the fetched profile", async () => {
    const { data, error } = await client.from("uci_riders").select("id, uci_rider_id, date_of_birth, discipline").eq("discipline", "smk");
    if (error) throw error;
    assert.equal(data.length, 3);
    assert.ok(data.every((row) => row.date_of_birth), "every smoke rider should have a DOB from its fetched profile");
  });

  await record("real sync: aliases were generated and inserted for each rider", async () => {
    const { data: riders, error: ridersError } = await client.from("uci_riders").select("id").eq("discipline", "smk");
    if (ridersError) throw ridersError;
    const { data: aliases, error: aliasError } = await client.from("uci_rider_aliases").select("id, rider_id").in("rider_id", riders.map((r) => r.id));
    if (aliasError) throw aliasError;
    assert.ok(aliases.length >= 3, "expected at least one alias per rider");
  });

  await record("real sync: team history rows were written for the smoke season", async () => {
    const { data: riders, error: ridersError } = await client.from("uci_riders").select("id").eq("discipline", "smk");
    if (ridersError) throw ridersError;
    const { data: history, error: historyError } = await client.from("uci_rider_team_history").select("id, rider_id, season_year").in("rider_id", riders.map((r) => r.id));
    if (historyError) throw historyError;
    assert.equal(history.length, 3);
    assert.ok(history.every((row) => row.season_year === SMOKE_YEAR));
  });

  await record("real sync: a uci_rider_sync_runs row records mode=apply, status=completed, and the correct counts", async () => {
    const { data, error } = await client.from("uci_rider_sync_runs").select("mode, status, inserted_count, unique_riders_received").eq("id", firstRunResult.syncRunId).single();
    if (error) throw error;
    assert.equal(data.mode, "apply");
    assert.equal(data.status, "completed");
    assert.equal(data.inserted_count, 3);
    assert.equal(data.unique_riders_received, 3);
  });

  let secondRunResult = null;
  await record("real sync: an identical re-run is idempotent -- zero inserts/updates, everything reported unchanged", async () => {
    secondRunResult = await runSync(options, deps);
    assert.equal(secondRunResult.summary.inserted, 0);
    assert.equal(secondRunResult.summary.updated, 0);
    assert.equal(secondRunResult.summary.unchanged, 3);

    const { data, error } = await client.from("uci_riders").select("id").eq("discipline", "smk");
    if (error) throw error;
    assert.equal(data.length, 3, "a re-run must never duplicate rider rows");

    const { data: aliasesAfter, error: aliasError } = await client.from("uci_rider_aliases").select("id").in("rider_id", data.map((r) => r.id));
    if (aliasError) throw aliasError;
    const { data: riders, error: ridersError } = await client.from("uci_riders").select("id").eq("discipline", "smk");
    if (ridersError) throw ridersError;
    const { data: aliasesCheck, error: aliasCheckError } = await client.from("uci_rider_aliases").select("id").in("rider_id", riders.map((r) => r.id));
    if (aliasCheckError) throw aliasCheckError;
    assert.equal(aliasesCheck.length, aliasesAfter.length, "a re-run must never duplicate alias rows");
  });

  let reviewItemId = null;
  await record("real review queue: manually inserting a review item and resolving it via the RPC works end-to-end, including alias creation", async () => {
    const { data: rider, error: riderError } = await client.from("uci_riders").select("id").eq("discipline", "smk").limit(1).single();
    if (riderError) throw riderError;

    const { data: inserted, error: insertError } = await client
      .from("uci_rider_review_queue")
      .insert({ queue_type: "ambiguous_candidate", rider_id: rider.id, reason: "smoke test", source: "uci_rider_sync_local_smoke" })
      .select("id")
      .single();
    if (insertError) throw insertError;
    reviewItemId = inserted.id;

    const { data: rpcResult, error: rpcError } = await client.rpc("resolve_uci_rider_review_item", {
      p_item_id: reviewItemId,
      p_status: "matched",
      p_resolved_by: null,
      p_note: "resolved by uci-rider-sync-local-smoke.mjs",
      p_create_alias: { rider_id: rider.id, alias_text: "Smoke Alias", alias_type: "manual" },
    });
    if (rpcError) throw rpcError;
    assert.equal(rpcResult.status, "resolved");
    assert.ok(rpcResult.alias_id, "expected the manual alias to be created in the same call");

    const { data: aliasRow, error: aliasRowError } = await client.from("uci_rider_aliases").select("id, alias_type").eq("id", rpcResult.alias_id).single();
    if (aliasRowError) throw aliasRowError;
    assert.equal(aliasRow.alias_type, "manual");
  });

  console.log("\nCleaning up rows created by this smoke test...");
  const { data: smokeRiders } = await client.from("uci_riders").select("id").eq("discipline", "smk");
  const smokeRiderIds = (smokeRiders ?? []).map((rider) => rider.id);
  if (smokeRiderIds.length > 0) {
    // uci_rider_aliases/uci_rider_team_history/uci_rider_specialties are
    // all `on delete cascade` from uci_riders, and
    // uci_rider_review_queue.rider_id is `on delete set null` -- deleting
    // the rider rows is sufficient for the first three tables; the
    // review-queue row survives (by design, for audit purposes) and is
    // cleaned up explicitly below.
    await client.from("uci_riders").delete().in("id", smokeRiderIds);
  }
  if (reviewItemId) {
    await client.from("uci_rider_review_queue").delete().eq("id", reviewItemId);
  }
  await client.from("uci_rider_sync_runs").delete().in("id", [firstRunResult?.syncRunId, secondRunResult?.syncRunId].filter(Boolean));
  await fs.rm(options.cacheDir, { recursive: true, force: true });

  const { data: cleanupCheck, error: cleanupCheckError } = await client.from("uci_riders").select("id").eq("discipline", "smk");
  if (cleanupCheckError) throw cleanupCheckError;
  if (cleanupCheck.length > 0) {
    console.log(`  WARNING: cleanup did not remove ${cleanupCheck.length} smoke uci_riders row(s); delete them manually.`);
  } else {
    console.log("  Cleanup confirmed: no smoke-discipline uci_riders rows remain.");
  }

  const failures = results.filter((entry) => entry.status === "fail");
  console.log(`\n${results.length - failures.length}/${results.length} scenarios passed.`);
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

await main();
