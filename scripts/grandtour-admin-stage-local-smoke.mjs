import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { runApply } from "./grandtour-feed-import.mjs";
import { isProductionSupabaseUrl } from "./grandtour-apply.mjs";
import {
  fetchStageState,
  runCheckFinaliseScore,
  runFinalise,
  runMarkChecked,
  runScore,
  validateFinalisePreflight
} from "./grandtour-admin-stage.mjs";

/**
 * Real end-to-end verification of scripts/grandtour-admin-stage.mjs against
 * a REAL local Supabase instance - the mark-checked -> finalise -> score
 * counterpart to grandtour-apply-local-smoke.mjs's apply coverage. Uses the
 * actual runMarkChecked/runFinalise/runScore/runCheckFinaliseScore CLI
 * functions (not mocked), against the real RPCs.
 *
 * Prerequisites, identical to grandtour-apply-local-smoke.mjs:
 *   npx supabase db reset
 *   SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY set to the
 *   local `npx supabase status -o env` values.
 *
 * This script performs REAL writes (apply, mark-checked, finalise, score),
 * then cleans everything up, including the throwaway admin auth.users row
 * it creates. It refuses to run against a known production Supabase URL,
 * with no override flag.
 *
 * The "summary totals aren't inflated by a join" property is instead
 * verified deterministically with a fake-client unit test in
 * scripts/grandtour-admin-stage.test.mjs (fetchStageState's four queries
 * are each scoped to a single table, so this is exact and doesn't depend on
 * fabricating schema-valid tip/score fixtures against the real, evolving
 * grandtour_tips/grandtour_stage_scores constraints).
 */

const GRAND_TOUR_STAGE_2_ID = "50000000-0000-4000-8000-000000000002";
const STAGE_NUMBER = 2;

const RIDERS = [
  { bib: 4, id: "40000000-0000-4000-8000-000000000004", name: "Rémi Vaillant", team: "AUV" },
  { bib: 5, id: "40000000-0000-4000-8000-000000000005", name: "Julien Mercier", team: "AUV" },
  { bib: 6, id: "40000000-0000-4000-8000-000000000006", name: "Elias Berg", team: "NST" },
  { bib: 7, id: "40000000-0000-4000-8000-000000000007", name: "Nils Andersen", team: "NST" },
  { bib: 8, id: "40000000-0000-4000-8000-000000000008", name: "Soren Lindholm", team: "NST" },
  { bib: 9, id: "40000000-0000-4000-8000-000000000009", name: "Mikkel Vester", team: "NST" },
  { bib: 10, id: "40000000-0000-4000-8000-000000000010", name: "Oskar Nyberg", team: "NST" },
  { bib: 11, id: "40000000-0000-4000-8000-000000000011", name: "Matteo Rinaldi", team: "VLC" },
  { bib: 12, id: "40000000-0000-4000-8000-000000000012", name: "Luca Ferretti", team: "VLC" },
  { bib: 13, id: "40000000-0000-4000-8000-000000000013", name: "Davide Conti", team: "VLC" }
];

function buildJerseyHolders() {
  const holders = [
    { jerseyType: "yellow", rider: RIDERS[0] },
    { jerseyType: "green", rider: RIDERS[1] },
    { jerseyType: "kom", rider: RIDERS[2] },
    { jerseyType: "white", rider: RIDERS[3] }
  ];
  return holders.map(({ jerseyType, rider }) => ({
    jerseyType,
    parsedRiderName: rider.name.toUpperCase(),
    parsedTeamName: rider.team,
    bibNumber: rider.bib,
    matchedRiderId: rider.id,
    matchedBy: "bib_number",
    nameMismatch: true,
    teamMismatch: false,
    onStartlist: true,
    status: "matched"
  }));
}

function buildTenRowReport() {
  const parsedRiders = RIDERS.map((rider, index) => ({
    position: index + 1,
    rider_name: rider.name.toUpperCase(),
    bib_number: rider.bib,
    team_name: rider.team,
    time: "03h 40' 00\"",
    gap: index === 0 ? "-" : `+00' ${String(index * 3).padStart(2, "0")}"`
  }));
  const matchedRiders = RIDERS.map((rider) => ({
    riderName: rider.name,
    bibNumber: rider.bib,
    riderId: rider.id,
    matchedBy: "bib_number",
    nameMismatch: true
  }));

  return {
    mode: "dry-run",
    provider: "official-letour",
    sourceUrl: `https://www.letour.fr/en/rankings/stage-${STAGE_NUMBER}`,
    fetchedAt: new Date().toISOString(),
    fromStage: STAGE_NUMBER,
    toStage: STAGE_NUMBER,
    dryRun: true,
    applyEnabled: false,
    importStatus: "review_required",
    parserDriftDetected: false,
    stageFetchMetadata: [
      { stageNumber: STAGE_NUMBER, url: `https://www.letour.fr/en/rankings/stage-${STAGE_NUMBER}`, httpStatus: 200, status: "ok", rowsMatched: 10, ridersParsed: 10, warningCount: 0 }
    ],
    reconciliation: {
      overallSafeToApply: true,
      stages: [{
        stageNumber: STAGE_NUMBER,
        stageId: GRAND_TOUR_STAGE_2_ID,
        stageDate: "2026-07-05",
        stageType: "hilly",
        isTtt: false,
        missingStageRecord: false,
        parsedRiders,
        matchedRiders,
        unmatchedRiders: [],
        ambiguousRiders: [],
        matchedTeams: [],
        unmatchedTeams: [],
        ambiguousTeams: [],
        duplicateBibConflicts: [],
        matchedRidersOnStartlist: [],
        matchedRidersMissingFromStartlist: [],
        startlistValidationPassed: true,
        noStartlistRowsFound: false,
        jerseyHolders: buildJerseyHolders(),
        safeToApply: true,
        blockers: []
      }]
    }
  };
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
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceRoleKey) {
    throw new Error("Set SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY to your local `npx supabase status -o env` values before running this smoke test.");
  }
  if (isProductionSupabaseUrl(url)) {
    throw new Error(`Refusing to run: ${url} resolves to a known production project. This script never runs against production, with no override.`);
  }

  const { createClient } = await import("@supabase/supabase-js");
  const serviceClient = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  console.log("Confirming no pre-existing grandtour_stage_results row for stage 2...");
  const { data: preExisting, error: preExistingError } = await serviceClient
    .from("grandtour_stage_results")
    .select("id")
    .eq("stage_id", GRAND_TOUR_STAGE_2_ID)
    .maybeSingle();
  if (preExistingError) throw preExistingError;
  if (preExisting) {
    throw new Error(`Stage 2 already has a grandtour_stage_results row (${preExisting.id}). Run \`npx supabase db reset\` for a clean local database before running this smoke test.`);
  }

  // --- Set up apply-shaped stage data (this smoke test's own responsibility, per task requirements) ---
  const reportPath = path.resolve("tmp", "grandtour-admin-stage-local-smoke-report.json");
  const applyOutcomePath = path.resolve("tmp", "grandtour-admin-stage-local-smoke-apply-outcome.json");
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, JSON.stringify(buildTenRowReport(), null, 2), "utf8");

  let stageResultId = null;
  await record("apply-shaped stage data exists: a real top-10 + 4-jersey draft is applied via the actual apply RPC", async () => {
    await runApply({
      fromReportPath: reportPath,
      confirmProvider: "official-letour",
      confirmStage: STAGE_NUMBER,
      confirmProduction: false,
      reason: "grandtour-admin-stage-local-smoke.mjs setup",
      requestId: `admin-stage-smoke-setup-${Date.now()}`,
      reportPath: applyOutcomePath
    });
    const outcome = JSON.parse(await fs.readFile(applyOutcomePath, "utf8"));
    assert.equal(outcome.outcome.status, "applied");
    stageResultId = outcome.rpcResponse.data.stage_result_id;
    assert.ok(stageResultId);
  });

  // --- Create a real admin user and sign in with a real password, matching how a genuine operator would run --score ---
  const adminSuffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const adminEmail = `admin-stage-smoke-${adminSuffix}@example.test`;
  const adminPassword = `Admin-stage-smoke-${adminSuffix}!`;

  const anonClient = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const adminSignUp = await anonClient.auth.signUp({ email: adminEmail, password: adminPassword });
  if (adminSignUp.error) throw adminSignUp.error;
  const adminUserId = adminSignUp.data.user.id;

  const { data: cyclingApp, error: appError } = await serviceClient.from("apps").select("id").eq("code", "cycling").single();
  if (appError) throw appError;
  const { error: promoteError } = await serviceClient
    .from("user_app_memberships")
    .update({ role: "admin" })
    .eq("user_id", adminUserId)
    .eq("app_id", cyclingApp.id);
  if (promoteError) throw promoteError;

  process.env.SUPABASE_ADMIN_EMAIL = adminEmail;
  process.env.SUPABASE_ADMIN_PASSWORD = adminPassword;

  const baseOptions = {
    stageNumber: STAGE_NUMBER,
    // Matches supabase/seed.sql's local grand_tours fixture name, not the
    // CLI's real-world default ("Tour de France") - production's actual
    // grand_tours row uses that real name/year instead.
    grandTourName: "GrandTour France 2026",
    grandTourYear: 2026,
    adminUser: adminUserId,
    confirmProduction: false,
    note: "grandtour-admin-stage-local-smoke.mjs verification run",
    reason: "grandtour-admin-stage-local-smoke.mjs verification run",
    requestId: null,
    recalculate: false
  };

  try {
    await record("wrong stage number fails safely: no partial writes, clean error", async () => {
      const before = await fetchStageState(serviceClient, { stageId: GRAND_TOUR_STAGE_2_ID });
      let threw = false;
      try {
        await runMarkChecked({ ...baseOptions, stageNumber: 9999 }, { serviceClient });
      } catch (error) {
        threw = true;
        assert.match(error.message, /No grandtour_stages row found for stage 9999/);
      }
      assert.ok(threw, "an unresolvable stage number must throw, not silently succeed");
      const after = await fetchStageState(serviceClient, { stageId: GRAND_TOUR_STAGE_2_ID });
      assert.deepEqual(after, before, "a failed resolution for a bogus stage must not touch the real stage's state");
    });

    await record("mark_checked works: preflight passes, RPC succeeds, review_status becomes admin_checked", async () => {
      const outcome = await runMarkChecked(baseOptions, { serviceClient });
      assert.equal(outcome.rpcResponse.status, "checked");
      assert.equal(outcome.summary.review_status, "admin_checked");
      assert.equal(outcome.summary.is_final, false);
      assert.equal(outcome.summary.result_line_count, 10);
      assert.equal(outcome.summary.jersey_holder_count, 4);
      assert.equal(outcome.summary.score_count, 0);
      assert.equal(outcome.summary.stage_result_id, stageResultId);
    });

    await record("mark_checked is idempotent when already admin_checked (no-change in effect, not refused)", async () => {
      const outcome = await runMarkChecked(baseOptions, { serviceClient });
      assert.equal(outcome.rpcResponse.status, "checked");
      assert.equal(outcome.summary.review_status, "admin_checked");
    });

    await record("finalise refuses via preflight when preconditions are not met (simulated: wrong review_status)", async () => {
      const badState = { resultExists: true, resultId: stageResultId, isFinal: false, reviewStatus: "imported", lineCount: 10, jerseyCount: 4, scoreCount: 0 };
      const { errors } = validateFinalisePreflight(badState);
      assert.ok(errors.some((message) => /must be "admin_checked"/.test(message)));
    });

    await record("finalise works: preflight passes, RPC succeeds, is_final becomes true, lines/jerseys unchanged", async () => {
      const outcome = await runFinalise(baseOptions, { serviceClient });
      assert.equal(outcome.rpcResponse.status, "finalized");
      assert.equal(outcome.summary.is_final, true);
      assert.equal(outcome.summary.review_status, "finalised");
      assert.equal(outcome.summary.result_line_count, 10);
      assert.equal(outcome.summary.jersey_holder_count, 4);
      assert.equal(outcome.summary.score_count, 0);
    });

    await record("finalise is idempotent when already finalised (no_change from the RPC, not refused)", async () => {
      const outcome = await runFinalise(baseOptions, { serviceClient });
      assert.equal(outcome.rpcResponse.status, "no_change");
      assert.equal(outcome.summary.is_final, true);
    });

    await record("score preflight requires an authenticated admin session, not a service-role key", async () => {
      let threw = false;
      try {
        await runScore(baseOptions, { adminClient: serviceClient });
      } catch {
        threw = true;
      }
      // Not asserting a specific message here: passing the service-role
      // client through deps.adminClient bypasses this script's own
      // sign-in check entirely, so this instead exercises that
      // recalculate_grandtour_stage_scores itself (security invoker,
      // auth.uid()-based) rejects a service-role-authenticated call.
      assert.ok(threw, "recalculate_grandtour_stage_scores must not be callable via a service-role client");
    });

    await record("score refuses when the signed-in admin does not match --admin-user", async () => {
      let threw = false;
      try {
        await runScore({ ...baseOptions, adminUser: "00000000-0000-4000-8000-000000000000" }, {});
      } catch (error) {
        threw = true;
        assert.match(error.message, /does not match --admin-user/);
      }
      assert.ok(threw, "a mismatched --admin-user must be refused before the RPC is called");
    });

    await record("missing --confirm-production blocks production write mode before any client is created", async () => {
      // A known production project ref, swapped in only for the duration of
      // this check - assertProductionConfirmed() throws synchronously
      // before resolveServiceClient() ever calls createClient()/attempts a
      // network call, so this never actually contacts a production host.
      const originalUrl = process.env.SUPABASE_URL;
      process.env.SUPABASE_URL = "https://nsdpilmmrfobiapbwona.supabase.co";
      try {
        let threw = false;
        try {
          await runMarkChecked({ ...baseOptions, confirmProduction: false }, {});
        } catch (error) {
          threw = true;
          assert.match(error.message, /resolves to a known production project/);
        }
        assert.ok(threw, "a known-production SUPABASE_URL without --confirm-production must be refused before any write is attempted");
      } finally {
        process.env.SUPABASE_URL = originalUrl;
      }
    });

    await record("score works: preflight passes, RPC succeeds against real (zero-tip) data, counts stay correct", async () => {
      const outcome = await runScore(baseOptions, {});
      assert.equal(typeof outcome.rpcResponse.tips_affected, "number");
      assert.equal(outcome.summary.is_final, true);
      assert.equal(outcome.summary.review_status, "finalised");
      // No real tip fixture exists for stage 2 in this smoke test (matching
      // grandtour-apply-local-smoke.mjs's own note on this), so score_count
      // stays 0 here - but result_line_count/jersey_holder_count staying
      // correctly at 10/4 alongside a real, freshly-queried score_count of
      // 0 is itself real-DB evidence that fetchStageState's per-table
      // queries aren't cross-contaminating each other's counts.
      assert.equal(outcome.summary.result_line_count, 10);
      assert.equal(outcome.summary.jersey_holder_count, 4);
      assert.equal(outcome.summary.score_count, 0);
    });

    await record("check-finalise-score chains all three phases, each running its own fresh preflight", async () => {
      // Reopen the result to a fresh draft/imported state so the full chain
      // (mark-checked -> finalise -> score) can be exercised end to end in
      // one call, exactly as a real operator would use --check-finalise-score.
      const { error: reopenError } = await serviceClient
        .from("grandtour_stage_results")
        .update({ is_final: false, review_status: "imported", admin_checked_at: null, admin_checked_by: null, finalised_at: null, finalised_by: null })
        .eq("id", stageResultId);
      if (reopenError) throw reopenError;

      const chainOutcome = await runCheckFinaliseScore(baseOptions, { serviceClient, adminClient: undefined });
      assert.equal(chainOutcome.markChecked.summary.review_status, "admin_checked");
      assert.equal(chainOutcome.finalise.summary.is_final, true);
      assert.equal(chainOutcome.finalise.summary.review_status, "finalised");
      assert.equal(chainOutcome.score.summary.review_status, "finalised");
    });
  } finally {
    console.log("\nReopening the finalized result (is_final -> false) so cleanup can remove it...");
    const { error: reopenError } = await serviceClient
      .from("grandtour_stage_results")
      .update({ is_final: false, review_status: "draft" })
      .eq("id", stageResultId);
    if (reopenError) throw reopenError;

    console.log("Cleaning up rows created by this smoke test...");
    const { data: importRuns } = await serviceClient
      .from("grandtour_feed_import_runs")
      .select("id")
      .eq("provider_name", "official-letour")
      .contains("summary", { stage_result_id: stageResultId });
    for (const run of importRuns ?? []) {
      await serviceClient.from("grandtour_feed_snapshots").delete().eq("import_run_id", run.id);
      await serviceClient.from("grandtour_feed_import_runs").delete().eq("id", run.id);
    }
    await serviceClient.from("grandtour_stage_jersey_holders").delete().eq("stage_id", GRAND_TOUR_STAGE_2_ID);
    await serviceClient.from("grandtour_stage_results").delete().eq("id", stageResultId);
    await fs.rm(reportPath, { force: true });
    await fs.rm(applyOutcomePath, { force: true });

    await serviceClient.auth.admin.deleteUser(adminUserId);
    delete process.env.SUPABASE_ADMIN_EMAIL;
    delete process.env.SUPABASE_ADMIN_PASSWORD;

    const { data: cleanupCheck } = await serviceClient
      .from("grandtour_stage_results")
      .select("id")
      .eq("stage_id", GRAND_TOUR_STAGE_2_ID)
      .maybeSingle();
    if (cleanupCheck) {
      console.log(`  WARNING: cleanup did not remove stage_result ${cleanupCheck.id}; delete it manually.`);
    } else {
      console.log("  Cleanup confirmed: no grandtour_stage_results row remains for stage 2.");
    }
  }

  const failures = results.filter((entry) => entry.status === "fail");
  console.log(`\n${results.length - failures.length}/${results.length} scenarios passed.`);
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

await main();
