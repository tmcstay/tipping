import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { runApply } from "./grandtour-feed-import.mjs";
import { isProductionSupabaseUrl } from "./grandtour-apply.mjs";

/**
 * Validates the real apply_grandtour_official_stage_result() RPC — via the
 * actual CLI code path (runApply), not a mocked Supabase client — against a
 * REAL local Supabase instance, using a full top-10 report built from real
 * seeded riders. This is the 10-row counterpart to the ad hoc 5-row manual
 * verification done in an earlier task (see docs/grandtour-apply-mode-spec.md
 * §15.3/§16): v1 policy is top-10-only (§14.1), so this script is what
 * should be re-run to confirm the real RPC + CLI wiring after any change to
 * the apply path, instead of a scratch/manual report file.
 *
 * Prerequisites (same as docs/grandtour-results-feed.md's "Local
 * reconciliation smoke test" and "Applying an official result" sections):
 *   npx supabase db reset
 *   docker exec -i supabase_db_tipping-suite psql -U postgres -d postgres \
 *     < supabase/seeds/grandtour_reconciliation_smoke.sql
 *   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY set to the local
 *   `npx supabase status -o env` values — service-role key, because this
 *   script exercises the real write path (unlike the anon-key-only
 *   reconciliation smoke test).
 *
 * This script performs REAL writes against the target database, then
 * cleans them up (deletes the created grandtour_stage_results/*_lines and
 * grandtour_feed_import_runs/*_snapshots rows) before exiting, using the
 * same service-role client. It refuses to run at all against a production
 * Supabase URL — there is no override flag, unlike the real CLI's
 * --confirm-production (this script is a disposable dev convenience, not
 * an operational tool, so it should never need one).
 */

const GRAND_TOUR_STAGE_2_ID = "50000000-0000-4000-8000-000000000002";
const STAGE_NUMBER = 2;

// Riders 004-013 (bib 4-13): all real seeded riders, all confirmed present
// on stage 2's startlist by supabase/seeds/grandtour_reconciliation_smoke.sql
// (which only removes rider 003 from stage 2's startlist; every other
// active rider stays on every stage's startlist per supabase/seed.sql's
// "MVP simplification"). Team short names (AUV/NST/VLC) are real values
// from supabase/seed.sql.
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

// Reuses four of the same real seeded/on-startlist riders as jersey
// holders (a rider being both top-10 and a classification leader is
// completely realistic). RIDERS[8] (bib 12, position 9) is deliberately
// left out of the jersey set so it's available as a distinct "swap" target
// for the on-conflict idempotency scenario below.
function buildJerseyHolders({ whiteRider = RIDERS[3] } = {}) {
  const holders = [
    { jerseyType: "yellow", rider: RIDERS[0], sourceClassification: "individual" },
    { jerseyType: "green", rider: RIDERS[1], sourceClassification: "points" },
    { jerseyType: "kom", rider: RIDERS[2], sourceClassification: "climber" },
    { jerseyType: "white", rider: whiteRider, sourceClassification: "youth" }
  ];
  return holders.map(({ jerseyType, rider, sourceClassification }) => ({
    jerseyType,
    sourceClassification,
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

function buildTenRowReport({ whiteJerseyRider } = {}) {
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
  const jerseyHolders = buildJerseyHolders(whiteJerseyRider ? { whiteRider: whiteJerseyRider } : {});

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
        jerseyHolders,
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
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to your local `npx supabase status -o env` values before running this smoke test.");
  }
  if (isProductionSupabaseUrl(url)) {
    throw new Error(`Refusing to run: ${url} resolves to a known production project. This script never runs against production, with no override.`);
  }

  const { createClient } = await import("@supabase/supabase-js");
  const client = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  console.log("Confirming no pre-existing grandtour_stage_results row for stage 2...");
  const { data: preExisting, error: preExistingError } = await client
    .from("grandtour_stage_results")
    .select("id")
    .eq("stage_id", GRAND_TOUR_STAGE_2_ID)
    .maybeSingle();
  if (preExistingError) throw preExistingError;
  if (preExisting) {
    throw new Error(`Stage 2 already has a grandtour_stage_results row (${preExisting.id}). Run \`npx supabase db reset\` for a clean local database before running this smoke test.`);
  }

  const reportPath = path.resolve("tmp", "grandtour-apply-local-smoke-report.json");
  const outcomePath = path.resolve("tmp", "grandtour-apply-local-smoke-outcome.json");
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, JSON.stringify(buildTenRowReport(), null, 2), "utf8");

  const options = {
    fromReportPath: reportPath,
    confirmProvider: "official-letour",
    confirmStage: STAGE_NUMBER,
    confirmProduction: false,
    reason: "grandtour-apply-local-smoke.mjs verification run",
    requestId: `local-smoke-${Date.now()}`,
    reportPath: outcomePath
  };

  let stageResultId = null;
  let importRunId = null;

  await record("real apply: a valid top-10 report is applied via the actual RPC", async () => {
    await runApply(options);
    const outcome = JSON.parse(await fs.readFile(outcomePath, "utf8"));
    assert.equal(outcome.outcome.status, "applied");
    stageResultId = outcome.rpcResponse.data.stage_result_id;
    importRunId = outcome.rpcResponse.data.import_run_id;
    assert.ok(stageResultId, "expected a stage_result_id in the RPC response");
  });

  await record("real apply: the draft result and exactly 10 result lines exist, in the correct positions", async () => {
    const { data: resultRow, error: resultError } = await client
      .from("grandtour_stage_results")
      .select("id, is_final")
      .eq("id", stageResultId)
      .single();
    if (resultError) throw resultError;
    assert.equal(resultRow.is_final, false);

    const { data: lines, error: linesError } = await client
      .from("grandtour_stage_result_lines")
      .select("rider_id, actual_position")
      .eq("stage_result_id", stageResultId)
      .order("actual_position");
    if (linesError) throw linesError;
    assert.equal(lines.length, 10);
    assert.deepEqual(lines.map((line) => line.actual_position), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.deepEqual(lines.map((line) => line.rider_id), RIDERS.map((rider) => rider.id));
  });

  await record("real apply: exactly 4 jersey holder rows were written, correctly mapped, and zero team result lines", async () => {
    const { data: jerseyHolders, error: jerseyError } = await client
      .from("grandtour_stage_jersey_holders")
      .select("jersey_type, rider_id")
      .eq("stage_id", GRAND_TOUR_STAGE_2_ID)
      .order("jersey_type");
    if (jerseyError) throw jerseyError;
    assert.equal(jerseyHolders.length, 4);
    const byType = Object.fromEntries(jerseyHolders.map((row) => [row.jersey_type, row.rider_id]));
    assert.equal(byType.yellow, RIDERS[0].id);
    assert.equal(byType.green, RIDERS[1].id);
    assert.equal(byType.kom, RIDERS[2].id);
    assert.equal(byType.white, RIDERS[3].id);

    const { data: teamLines, error: teamLinesError } = await client
      .from("grandtour_stage_team_result_lines")
      .select("id")
      .eq("stage_result_id", stageResultId);
    if (teamLinesError) throw teamLinesError;
    assert.equal(teamLines.length, 0);
  });

  await record("real apply: result remains is_final=false and scores remain 0 (no scoring RPC was called)", async () => {
    const { data: resultRow, error: resultError } = await client
      .from("grandtour_stage_results")
      .select("is_final")
      .eq("id", stageResultId)
      .single();
    if (resultError) throw resultError;
    assert.equal(resultRow.is_final, false, "apply mode must never finalize automatically");

    const { data: scores, error: scoresError } = await client
      .from("grandtour_stage_scores")
      .select("id")
      .eq("stage_id", GRAND_TOUR_STAGE_2_ID);
    if (scoresError) throw scoresError;
    assert.equal(scores.length, 0, "apply mode must never trigger scoring");
  });

  await record("real apply: an audit run and snapshot row were written", async () => {
    const { data: importRun, error: importRunError } = await client
      .from("grandtour_feed_import_runs")
      .select("id, mode, import_status, provider_name")
      .eq("id", importRunId)
      .single();
    if (importRunError) throw importRunError;
    assert.equal(importRun.mode, "apply");
    assert.equal(importRun.import_status, "applied");
    assert.equal(importRun.provider_name, "official-letour");

    const { data: snapshots, error: snapshotError } = await client
      .from("grandtour_feed_snapshots")
      .select("id, segment")
      .eq("import_run_id", importRunId);
    if (snapshotError) throw snapshotError;
    assert.equal(snapshots.length, 1);
    assert.equal(snapshots[0].segment, "stage_result");
  });

  await record("real apply: an official_import_applied row was written to grandtour_result_audit_log", async () => {
    // Scoped by stage_result_id (unique to this run's freshly-created draft
    // row), not just stage_id — the audit log is append-only and stage_id
    // is the same real stage across every past run of this script, so
    // historical official_import_applied rows from earlier runs persist.
    const { data: auditRows, error: auditError } = await client
      .from("grandtour_result_audit_log")
      .select("action, changed_by, stage_result_id")
      .eq("stage_result_id", stageResultId)
      .eq("action", "official_import_applied");
    if (auditError) throw auditError;
    assert.equal(auditRows.length, 1, "exactly one official_import_applied audit row must exist after apply");
    assert.equal(auditRows[0].stage_result_id, stageResultId);
    assert.equal(auditRows[0].changed_by, null, "apply has no acting admin user, so changed_by is expected to be null");
  });

  await record("real apply: an identical reapply is idempotent (no_change, no new rows)", async () => {
    await runApply(options);
    const outcome = JSON.parse(await fs.readFile(outcomePath, "utf8"));
    assert.equal(outcome.outcome.status, "no_change");
    assert.equal(outcome.rpcResponse.data.jersey_holder_count, 4);

    const { data: lines, error: linesError } = await client
      .from("grandtour_stage_result_lines")
      .select("id")
      .eq("stage_result_id", stageResultId);
    if (linesError) throw linesError;
    assert.equal(lines.length, 10, "identical reapply must not duplicate result lines");

    const { data: jerseyHolders, error: jerseyError } = await client
      .from("grandtour_stage_jersey_holders")
      .select("id")
      .eq("stage_id", GRAND_TOUR_STAGE_2_ID);
    if (jerseyError) throw jerseyError;
    assert.equal(jerseyHolders.length, 4, "identical reapply must not duplicate jersey holder rows");
  });

  await record("real apply: reapplying with an unchanged result but a corrected jersey holder upserts on (stage_id, jersey_type) — result stays no_change", async () => {
    // RIDERS[8] (bib 12) is a real seeded, on-startlist rider not used as a
    // jersey holder above — a plausible "we got the white jersey wrong,
    // here's the correction" scenario, with the top-10 result unchanged.
    const correctedReport = buildTenRowReport({ whiteJerseyRider: RIDERS[8] });
    await fs.writeFile(reportPath, JSON.stringify(correctedReport, null, 2), "utf8");

    await runApply(options);
    const outcome = JSON.parse(await fs.readFile(outcomePath, "utf8"));
    // Result lines are byte-identical to what's already applied, so this is
    // still reported as "no_change" for the result — but the jersey holder
    // upsert (on conflict (stage_id, jersey_type) do update) still runs.
    assert.equal(outcome.outcome.status, "no_change");
    assert.equal(outcome.rpcResponse.data.jersey_holder_count, 4);

    const { data: whiteRow, error: whiteError } = await client
      .from("grandtour_stage_jersey_holders")
      .select("rider_id, updated_at")
      .eq("stage_id", GRAND_TOUR_STAGE_2_ID)
      .eq("jersey_type", "white")
      .single();
    if (whiteError) throw whiteError;
    assert.equal(whiteRow.rider_id, RIDERS[8].id, "on-conflict upsert must update rider_id to the corrected jersey holder");

    const { data: allHolders, error: allHoldersError } = await client
      .from("grandtour_stage_jersey_holders")
      .select("id")
      .eq("stage_id", GRAND_TOUR_STAGE_2_ID);
    if (allHoldersError) throw allHoldersError;
    assert.equal(allHolders.length, 4, "correcting one jersey holder must not create a duplicate row, only update it in place");

    // Restore the original report (bib 7 as white) for the remaining scenarios below.
    await fs.writeFile(reportPath, JSON.stringify(buildTenRowReport(), null, 2), "utf8");
  });

  await record("real apply: a changed reapply is rejected, original lines remain unchanged", async () => {
    const changedReport = buildTenRowReport();
    // Swap positions 1 and 2 — same 10 riders, different official order.
    const stage = changedReport.reconciliation.stages[0];
    [stage.parsedRiders[0].bib_number, stage.parsedRiders[1].bib_number] = [stage.parsedRiders[1].bib_number, stage.parsedRiders[0].bib_number];
    [stage.parsedRiders[0].rider_name, stage.parsedRiders[1].rider_name] = [stage.parsedRiders[1].rider_name, stage.parsedRiders[0].rider_name];
    await fs.writeFile(reportPath, JSON.stringify(changedReport, null, 2), "utf8");

    let threw = false;
    try {
      await runApply(options);
    } catch (error) {
      threw = true;
      assert.match(error.message, /different draft result/);
    }
    assert.ok(threw, "a changed reapply must throw, not silently succeed");

    const { data: lines, error: linesError } = await client
      .from("grandtour_stage_result_lines")
      .select("rider_id, actual_position")
      .eq("stage_result_id", stageResultId)
      .order("actual_position");
    if (linesError) throw linesError;
    assert.deepEqual(lines.map((line) => line.rider_id), RIDERS.map((rider) => rider.id), "original result lines must be byte-for-byte unchanged after a rejected changed-result reapply");
  });

  // mark_grandtour_stage_result_checked/finalize_grandtour_stage_result take
  // p_checked_by/p_finalized_by as a uuid FK'd to auth.users(id)
  // (grandtour_stage_results.admin_checked_by/finalised_by), so a real user
  // must exist first. The same signed-up user is reused for scoring below,
  // since recalculate_grandtour_stage_scores is security invoker and
  // requires an authenticated cycling-admin session (auth.uid()-based).
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!anonKey) {
    throw new Error("Set SUPABASE_ANON_KEY (or EXPO_PUBLIC_SUPABASE_ANON_KEY) to also verify the admin-check -> finalize -> score workflow; mark_grandtour_stage_result_checked/finalize_grandtour_stage_result require a real auth.users row, and recalculate_grandtour_stage_scores additionally requires an authenticated cycling-admin session.");
  }

  // grandtour_result_audit_log is append-only and stage_id is the same real
  // stage across every run of this script, so historical rows from earlier
  // runs accumulate there permanently. This run's own rows are scoped by
  // created_at from this point on, not by "every row for this stage".
  const workflowStartedAt = new Date().toISOString();

  const adminSuffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const adminEmail = `finalize-smoke-admin-${adminSuffix}@example.test`;
  const adminPassword = `Finalize-smoke-${adminSuffix}!`;

  const anonClient = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const adminSignUp = await anonClient.auth.signUp({ email: adminEmail, password: adminPassword });
  if (adminSignUp.error) throw adminSignUp.error;
  const adminUserId = adminSignUp.data.user.id;
  const adminSession = adminSignUp.data.session;

  try {
    const { data: cyclingApp, error: appError } = await client.from("apps").select("id").eq("code", "cycling").single();
    if (appError) throw appError;

    const { error: promoteError } = await client
      .from("user_app_memberships")
      .update({ role: "admin" })
      .eq("user_id", adminUserId)
      .eq("app_id", cyclingApp.id);
    if (promoteError) throw promoteError;

    const adminClient = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    await adminClient.auth.setSession({ access_token: adminSession.access_token, refresh_token: adminSession.refresh_token });

    await record("real mark_checked: refuses to check a stage with no draft result at all", async () => {
      const { data, error } = await client.rpc("mark_grandtour_stage_result_checked", {
        p_stage_id: "50000000-0000-4000-8000-000000000099",
        p_checked_by: adminUserId
      });
      assert.ok(error, "mark_checked of a stage with no draft result must error, not silently succeed");
      assert.match(error.message, /no grandtour_stages row found|has no draft result/);
      assert.equal(data, null);
    });

    await record("real finalize: refuses before admin_checked", async () => {
      const { data, error } = await client.rpc("finalize_grandtour_stage_result", {
        p_stage_id: GRAND_TOUR_STAGE_2_ID,
        p_finalized_by: adminUserId
      });
      assert.ok(error, "finalize before admin_checked must error, not silently succeed");
      assert.match(error.message, /not admin_checked/);
      assert.equal(data, null);
    });

    await record("real mark_checked: checks the valid draft (10 lines + 4 jersey holders), review_status becomes admin_checked", async () => {
      const { data, error } = await client.rpc("mark_grandtour_stage_result_checked", {
        p_stage_id: GRAND_TOUR_STAGE_2_ID,
        p_checked_by: adminUserId,
        p_note: "grandtour-apply-local-smoke.mjs admin-check verification run",
        p_request_id: `local-smoke-check-${Date.now()}`
      });
      if (error) throw error;
      assert.equal(data.status, "checked");
      assert.equal(data.review_status, "admin_checked");

      const { data: resultRow, error: resultError } = await client
        .from("grandtour_stage_results")
        .select("review_status, admin_checked_by, is_final")
        .eq("id", stageResultId)
        .single();
      if (resultError) throw resultError;
      assert.equal(resultRow.review_status, "admin_checked");
      assert.equal(resultRow.admin_checked_by, adminUserId);
      assert.equal(resultRow.is_final, false, "mark_checked must never set is_final");
    });

    let finalizeOutcome = null;

    await record("real finalize: finalizes after admin_checked, is_final becomes true, lines/jerseys unchanged, scores stay 0", async () => {
      const { data, error } = await client.rpc("finalize_grandtour_stage_result", {
        p_stage_id: GRAND_TOUR_STAGE_2_ID,
        p_finalized_by: adminUserId,
        p_reason: "grandtour-apply-local-smoke.mjs finalize verification run",
        p_request_id: `local-smoke-finalize-${Date.now()}`
      });
      if (error) throw error;
      finalizeOutcome = data;
      assert.equal(data.status, "finalized");
      assert.equal(data.is_final, true);
      assert.equal(data.review_status, "finalised");

      const { data: resultRow, error: resultError } = await client
        .from("grandtour_stage_results")
        .select("is_final, review_status, finalised_by")
        .eq("id", stageResultId)
        .single();
      if (resultError) throw resultError;
      assert.equal(resultRow.is_final, true, "grandtour_stage_results.is_final must be true after finalize");
      assert.equal(resultRow.review_status, "finalised");
      assert.equal(resultRow.finalised_by, adminUserId);

      const { data: lines, error: linesError } = await client
        .from("grandtour_stage_result_lines")
        .select("id")
        .eq("stage_result_id", stageResultId);
      if (linesError) throw linesError;
      assert.equal(lines.length, 10, "finalize must not change the result-line count");

      const { data: jerseyHolders, error: jerseyError } = await client
        .from("grandtour_stage_jersey_holders")
        .select("id")
        .eq("stage_id", GRAND_TOUR_STAGE_2_ID);
      if (jerseyError) throw jerseyError;
      assert.equal(jerseyHolders.length, 4, "finalize must not change the jersey-holder count");

      const { data: scores, error: scoresError } = await client
        .from("grandtour_stage_scores")
        .select("id")
        .eq("stage_id", GRAND_TOUR_STAGE_2_ID);
      if (scoresError) throw scoresError;
      assert.equal(scores.length, 0, "finalize itself must never create score rows");
    });

    await record("real finalize: re-finalizing an already-final result returns no_change, not an error", async () => {
      const { data, error } = await client.rpc("finalize_grandtour_stage_result", {
        p_stage_id: GRAND_TOUR_STAGE_2_ID,
        p_finalized_by: adminUserId
      });
      if (error) throw error;
      assert.equal(data.status, "no_change");
      assert.equal(data.stage_result_id, finalizeOutcome.stage_result_id);
    });

    await record("real audit log: admin_checked and finalised rows were written to grandtour_result_audit_log", async () => {
      // Scoped to this workflow's own rows by created_at: the audit log is
      // append-only and stage_id is the same real stage across every past
      // run of this script, so unscoped historical rows (some with
      // changed_by nulled by an earlier run's now-deleted test user) would
      // otherwise pollute this check.
      const { data: auditRows, error: auditError } = await client
        .from("grandtour_result_audit_log")
        .select("action, changed_by")
        .eq("stage_id", GRAND_TOUR_STAGE_2_ID)
        .gte("created_at", workflowStartedAt)
        .order("created_at");
      if (auditError) throw auditError;
      const actions = auditRows.map((row) => row.action);
      assert.ok(actions.includes("admin_checked"), `expected an admin_checked audit row, got ${JSON.stringify(actions)}`);
      assert.ok(actions.includes("finalised"), `expected a finalised audit row, got ${JSON.stringify(actions)}`);
      assert.ok(auditRows.every((row) => row.changed_by === adminUserId), "the admin_checked/finalised audit rows must record the acting admin");
    });

    await record("real score: recalculate_grandtour_stage_scores no longer refuses now that the result is final (finalize -> score handoff)", async () => {
      const { data: scoreCount, error: scoreError } = await adminClient.rpc("recalculate_grandtour_stage_scores", {
        p_stage_id: GRAND_TOUR_STAGE_2_ID,
        p_reason: "grandtour-apply-local-smoke.mjs finalize -> score handoff verification",
        p_request_id: `local-smoke-score-${Date.now()}`
      });
      if (scoreError) throw scoreError;
      // "Scoring requires a final stage result" no longer fires — that is
      // the specific handoff this smoke test verifies. scoreCount itself
      // (tips affected) is expected to be 0 here since this smoke test
      // does not fabricate a real submitted tip for stage 2; genuine
      // score-row creation from a real tip is covered by
      // supabase/tests/canonical_grandtour_tipping.sql.
      assert.equal(typeof scoreCount, "number");
      console.log(`    (recalculate_grandtour_stage_scores affected ${scoreCount} tip(s); 0 is expected here since no tip fixture exists for this stage in this smoke test)`);
    });
  } finally {
    await client.auth.admin.deleteUser(adminUserId);
  }

  console.log("\nReopening the finalized result (is_final -> false) so cleanup can remove it...");
  // grandtour_stage_result_lines/grandtour_stage_jersey_holders both refuse
  // deletion while their parent result is final (prevent_final_*_delete
  // triggers) — including via ON DELETE CASCADE from deleting the
  // grandtour_stage_results row itself, since cascade deletes still fire
  // child BEFORE DELETE triggers. Reopening first (no validation trigger
  // blocks is_final true -> false) lets the existing cleanup below work
  // unchanged. review_status must move off 'finalised' in the same update,
  // since grandtour_stage_results_final_review_status_check requires
  // is_final = (review_status = 'finalised').
  const { error: reopenError } = await client
    .from("grandtour_stage_results")
    .update({ is_final: false, review_status: "draft" })
    .eq("id", stageResultId);
  if (reopenError) throw reopenError;

  console.log("\nCleaning up rows created by this smoke test...");
  // grandtour_stage_jersey_holders keys off stage_id (grandtour_stages),
  // not stage_result_id — it is NOT cascade-deleted by removing the
  // grandtour_stage_results row below, so it must be cleaned up explicitly.
  await client.from("grandtour_stage_jersey_holders").delete().eq("stage_id", GRAND_TOUR_STAGE_2_ID);
  await client.from("grandtour_feed_snapshots").delete().eq("import_run_id", importRunId);
  await client.from("grandtour_feed_import_runs").delete().eq("id", importRunId);
  await client.from("grandtour_stage_results").delete().eq("id", stageResultId);
  await fs.rm(reportPath, { force: true });
  await fs.rm(outcomePath, { force: true });

  const { data: cleanupCheck, error: cleanupCheckError } = await client
    .from("grandtour_stage_results")
    .select("id")
    .eq("stage_id", GRAND_TOUR_STAGE_2_ID)
    .maybeSingle();
  if (cleanupCheckError) throw cleanupCheckError;

  const { data: jerseyCleanupCheck, error: jerseyCleanupCheckError } = await client
    .from("grandtour_stage_jersey_holders")
    .select("id")
    .eq("stage_id", GRAND_TOUR_STAGE_2_ID);
  if (jerseyCleanupCheckError) throw jerseyCleanupCheckError;

  if (cleanupCheck) {
    console.log(`  WARNING: cleanup did not remove stage_result ${cleanupCheck.id}; delete it manually.`);
  } else if (jerseyCleanupCheck.length > 0) {
    console.log(`  WARNING: cleanup did not remove ${jerseyCleanupCheck.length} jersey holder row(s) for stage 2; delete them manually.`);
  } else {
    console.log("  Cleanup confirmed: no grandtour_stage_results or grandtour_stage_jersey_holders rows remain for stage 2.");
  }

  const failures = results.filter((entry) => entry.status === "fail");
  console.log(`\n${results.length - failures.length}/${results.length} scenarios passed.`);
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

await main();
