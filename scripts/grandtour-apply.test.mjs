import assert from "node:assert/strict";
import test from "node:test";

import {
  ACCEPTABLE_IMPORT_STATUSES,
  buildApplyRpcParams,
  decodeJwtRole,
  interpretRpcResponse,
  isProductionSupabaseUrl,
  mapRowsToResultLines,
  selectJerseyHolderParams,
  selectTopNRows,
  validateReportForApply
} from "./grandtour-apply.mjs";

const STAGE_ID = "11111111-1111-4111-8111-111111111111";
const FIXED_NOW = new Date("2026-07-09T12:00:00.000Z");

function riderRow(position, { name, bib, team = "TEAM A" } = {}) {
  return { position, rider_name: name, bib_number: bib, team_name: team, time: "03h 40' 00\"", gap: position === 1 ? "-" : "+00' 05\"" };
}

function matchedRider({ riderId, bib, name }) {
  return { riderName: name, bibNumber: bib, riderId, matchedBy: "bib_number", nameMismatch: false };
}

function buildTenRiderRows() {
  return Array.from({ length: 10 }, (_, index) => riderRow(index + 1, { name: `RIDER ${index + 1}`, bib: index + 1 }));
}

function buildTenMatchedRiders() {
  return Array.from({ length: 10 }, (_, index) => matchedRider({ riderId: `rider-${index + 1}`, bib: index + 1, name: `RIDER ${index + 1}` }));
}

function jerseyHolder(jerseyType, { riderId, bib, name, status = "matched" }) {
  return {
    jerseyType,
    sourceClassification: { yellow: "individual", green: "points", kom: "climber", white: "youth" }[jerseyType],
    parsedRiderName: name,
    parsedTeamName: "TEAM A",
    bibNumber: bib,
    matchedRiderId: status === "matched" ? riderId : null,
    matchedBy: status === "matched" ? "bib_number" : null,
    nameMismatch: false,
    teamMismatch: false,
    onStartlist: status === "matched",
    status
  };
}

function buildFourMatchedJerseyHolders() {
  return [
    jerseyHolder("yellow", { riderId: "jersey-rider-yellow", bib: 101, name: "YELLOW RIDER" }),
    jerseyHolder("green", { riderId: "jersey-rider-green", bib: 102, name: "GREEN RIDER" }),
    jerseyHolder("kom", { riderId: "jersey-rider-kom", bib: 103, name: "KOM RIDER" }),
    jerseyHolder("white", { riderId: "jersey-rider-white", bib: 104, name: "WHITE RIDER" })
  ];
}

function buildValidReport(overrides = {}, stageOverrides = {}) {
  const stage = {
    stageNumber: 2,
    stageId: STAGE_ID,
    stageDate: "2026-07-05",
    stageType: "hilly",
    isTtt: false,
    missingStageRecord: false,
    parsedRiders: buildTenRiderRows(),
    matchedRiders: buildTenMatchedRiders(),
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
    jerseyHolders: buildFourMatchedJerseyHolders(),
    safeToApply: true,
    blockers: [],
    ...stageOverrides
  };

  return {
    mode: "dry-run",
    provider: "official-letour",
    sourceUrl: "https://www.letour.fr/en/rankings/stage-2",
    fetchedAt: FIXED_NOW.toISOString(),
    fromStage: 2,
    toStage: 2,
    dryRun: true,
    applyEnabled: false,
    importStatus: "review_required",
    parserDriftDetected: false,
    stageFetchMetadata: [
      { stageNumber: 2, url: "https://www.letour.fr/en/rankings/stage-2", httpStatus: 200, status: "ok", rowsMatched: 10, ridersParsed: 10, warningCount: 0 }
    ],
    reconciliation: {
      overallSafeToApply: true,
      stages: [stage]
    },
    ...overrides
  };
}

function validate(report, confirmStage = 2) {
  return validateReportForApply({ report, confirmProvider: "official-letour", confirmStage, now: FIXED_NOW });
}

test("a fully valid report passes with zero errors", () => {
  const { errors, stage } = validate(buildValidReport());
  assert.deepEqual(errors, []);
  assert.equal(stage.stageId, STAGE_ID);
});

test("wrong provider is rejected", () => {
  const { errors } = validate(buildValidReport({ provider: "manual-json" }));
  assert.ok(errors.some((message) => message.includes("official-letour")));
});

test("--confirm-provider not equal to official-letour is rejected even if report.provider is correct", () => {
  const { errors } = validateReportForApply({
    report: buildValidReport(),
    confirmProvider: "manual-json",
    confirmStage: 2,
    now: FIXED_NOW
  });
  assert.ok(errors.some((message) => message.includes("--confirm-provider")));
});

test("stage mismatch (confirmStage does not match report's stage range) is rejected", () => {
  const { errors } = validate(buildValidReport(), 3);
  assert.ok(errors.some((message) => message.includes("must both equal --confirm-stage")));
});

test("stage mismatch (confirmStage does not match reconciliation.stages[0].stageNumber) is rejected", () => {
  const { errors } = validate(buildValidReport({}, { stageNumber: 99 }));
  assert.ok(errors.some((message) => message.includes("stageNumber") && message.includes("does not match")));
});

test("missing stageId is rejected", () => {
  const { errors } = validate(buildValidReport({}, { stageId: null }));
  assert.ok(errors.some((message) => message.includes("stageId must be a UUID")));
});

test("non-UUID stageId is rejected", () => {
  const { errors } = validate(buildValidReport({}, { stageId: "not-a-uuid" }));
  assert.ok(errors.some((message) => message.includes("stageId must be a UUID")));
});

test("parser drift is rejected", () => {
  const { errors } = validate(buildValidReport({ parserDriftDetected: true }));
  assert.ok(errors.some((message) => message.includes("parserDriftDetected must be false")));
});

test("unsafe reconciliation (safeToApply false) is rejected", () => {
  const { errors } = validate(buildValidReport({}, { safeToApply: false, blockers: ["something is wrong"] }));
  assert.ok(errors.some((message) => message.includes("safeToApply must be true")));
});

test("unsafe reconciliation (startlistValidationPassed false) is rejected", () => {
  const { errors } = validate(buildValidReport({}, { startlistValidationPassed: false }));
  assert.ok(errors.some((message) => message.includes("startlistValidationPassed must be true")));
});

test("overallSafeToApply false is rejected even when the single stage looks safe", () => {
  const report = buildValidReport();
  report.reconciliation.overallSafeToApply = false;
  const { errors } = validate(report);
  assert.ok(errors.some((message) => message.includes("overallSafeToApply must be true")));
});

test("TTT stage is rejected via isTtt", () => {
  const { errors } = validate(buildValidReport({}, { isTtt: true }));
  assert.ok(errors.some((message) => message.includes("isTtt must be false")));
});

test("TTT stage is rejected via stageType even when isTtt is (incorrectly) false", () => {
  const { errors } = validate(buildValidReport({}, { stageType: "team_time_trial" }));
  assert.ok(errors.some((message) => message.includes("stageType") && message.includes("team_time_trial")));
});

test("importStatus outside the acceptable set is rejected", () => {
  const { errors } = validate(buildValidReport({ importStatus: "failed" }));
  assert.ok(errors.some((message) => message.includes("importStatus")));
  assert.deepEqual(ACCEPTABLE_IMPORT_STATUSES, ["validated", "review_required"]);
});

test("dryRun not true or applyEnabled not false are rejected", () => {
  const dryRunErrors = validate(buildValidReport({ dryRun: false })).errors;
  assert.ok(dryRunErrors.some((message) => message.includes("dryRun must be true")));

  const applyEnabledErrors = validate(buildValidReport({ applyEnabled: true })).errors;
  assert.ok(applyEnabledErrors.some((message) => message.includes("applyEnabled must be false")));
});

test("missing reconciliation object is rejected with a re-run hint", () => {
  const report = buildValidReport();
  delete report.reconciliation;
  const { errors, stage } = validate(report);
  assert.ok(errors.some((message) => message.includes("--reconcile")));
  assert.equal(stage, null);
});

test("multi-stage reconciliation.stages is rejected", () => {
  const report = buildValidReport();
  report.reconciliation.stages.push({ ...report.reconciliation.stages[0], stageNumber: 3 });
  const { errors } = validate(report);
  assert.ok(errors.some((message) => message.includes("exactly one entry")));
});

test("a stale report (older than the max age) is rejected", () => {
  const staleReport = buildValidReport({ fetchedAt: new Date(FIXED_NOW.getTime() - 7 * 60 * 60 * 1000).toISOString() });
  const { errors } = validateReportForApply({
    report: staleReport,
    confirmProvider: "official-letour",
    confirmStage: 2,
    now: FIXED_NOW,
    maxAgeMs: 6 * 60 * 60 * 1000
  });
  assert.ok(errors.some((message) => message.includes("max age")));
});

test("a report fresh within the max age is accepted", () => {
  const freshReport = buildValidReport({ fetchedAt: new Date(FIXED_NOW.getTime() - 5 * 60 * 60 * 1000).toISOString() });
  const { errors } = validateReportForApply({
    report: freshReport,
    confirmProvider: "official-letour",
    confirmStage: 2,
    now: FIXED_NOW,
    maxAgeMs: 6 * 60 * 60 * 1000
  });
  assert.deepEqual(errors, []);
});

test("missing stageFetchMetadata entry for the confirmed stage is rejected", () => {
  const { errors } = validate(buildValidReport({ stageFetchMetadata: [] }));
  assert.ok(errors.some((message) => message.includes("stageFetchMetadata has no entry")));
});

test("stageFetchMetadata status other than ok is rejected", () => {
  const { errors } = validate(buildValidReport({
    stageFetchMetadata: [{ stageNumber: 2, url: "https://example.test", status: "pending" }]
  }));
  assert.ok(errors.some((message) => message.includes('not "ok"')));
});

test("selectTopNRows: exactly 10 rows selects all of them by position", () => {
  const { rows, error } = selectTopNRows(buildTenRiderRows());
  assert.equal(error, null);
  assert.equal(rows.length, 10);
  assert.deepEqual(rows.map((row) => row.position), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test("selectTopNRows: more than 10 rows truncates to positions 1-10 only", () => {
  const rows15 = Array.from({ length: 15 }, (_, index) => riderRow(index + 1, { name: `R${index + 1}`, bib: index + 1 }));
  const { rows, error } = selectTopNRows(rows15);
  assert.equal(error, null);
  assert.equal(rows.length, 10);
  assert.equal(Math.max(...rows.map((row) => row.position)), 10);
});

test("selectTopNRows: exactly 5 rows is rejected — v1 policy is top-10-only, never top-5", () => {
  const rows5 = Array.from({ length: 5 }, (_, index) => riderRow(index + 1, { name: `R${index + 1}`, bib: index + 1 }));
  const { rows, error } = selectTopNRows(rows5);
  assert.deepEqual(rows, []);
  assert.match(error, /requires exactly 10/);
});

for (const count of [1, 2, 3, 4]) {
  test(`selectTopNRows: ${count} row(s) (fewer than 5) is rejected`, () => {
    const rows = Array.from({ length: count }, (_, index) => riderRow(index + 1, { name: `R${index + 1}`, bib: index + 1 }));
    const { rows: selected, error } = selectTopNRows(rows);
    assert.deepEqual(selected, []);
    assert.match(error, /requires exactly 10/);
  });
}

for (const count of [6, 7, 8, 9]) {
  test(`selectTopNRows: ${count} rows (6-9) is rejected`, () => {
    const rows = Array.from({ length: count }, (_, index) => riderRow(index + 1, { name: `R${index + 1}`, bib: index + 1 }));
    const { rows: selected, error } = selectTopNRows(rows);
    assert.deepEqual(selected, []);
    assert.match(error, /requires exactly 10/);
  });
}

test("selectTopNRows: zero rows is rejected", () => {
  const { rows, error } = selectTopNRows([]);
  assert.deepEqual(rows, []);
  assert.match(error, /requires exactly 10/);
});

test("selectTopNRows: duplicate positions among the parsed rows are rejected, not silently deduplicated", () => {
  const rows = buildTenRiderRows();
  rows[3] = { ...rows[3], position: rows[2].position }; // rows[2] and rows[3] now both claim the same position
  const { rows: selected, error } = selectTopNRows(rows);
  assert.deepEqual(selected, []);
  assert.match(error, /duplicate position/);
});

test("selectTopNRows: rows with a missing/non-integer position are excluded, and the resulting shortfall is rejected", () => {
  const rows = buildTenRiderRows().map((row, index) => (index === 5 ? { ...row, position: null } : row));
  const { rows: selected, error } = selectTopNRows(rows);
  assert.deepEqual(selected, []);
  assert.match(error, /9 official finisher row\(s\)/);
});

test("selectTopNRows: 11 rows where positions 1-10 are all present still selects exactly those 10, ignoring position 11", () => {
  const rows = [...buildTenRiderRows(), riderRow(11, { name: "R11", bib: 11 })];
  const { rows: selected, error } = selectTopNRows(rows);
  assert.equal(error, null);
  assert.equal(selected.length, 10);
  assert.ok(!selected.some((row) => row.position === 11));
});

test("mapRowsToResultLines: maps by bib number and preserves original position (not renumbered)", () => {
  const rows = [riderRow(1, { name: "A", bib: 5 }), riderRow(3, { name: "B", bib: 9 })];
  const matchedRiders = [matchedRider({ riderId: "rider-a", bib: 5, name: "A" }), matchedRider({ riderId: "rider-b", bib: 9, name: "B" })];

  const { resultLines, error } = mapRowsToResultLines(rows, matchedRiders);
  assert.equal(error, null);
  assert.deepEqual(resultLines, [
    { rider_id: "rider-a", actual_position: 1 },
    { rider_id: "rider-b", actual_position: 3 }
  ]);
});

test("mapRowsToResultLines: falls back to normalized rider name when bib doesn't match", () => {
  const rows = [riderRow(1, { name: "T. Rider", bib: null })];
  const matchedRiders = [{ riderName: "t. rider", bibNumber: null, riderId: "rider-x", matchedBy: "name", nameMismatch: false }];

  const { resultLines, error } = mapRowsToResultLines(rows, matchedRiders);
  assert.equal(error, null);
  assert.deepEqual(resultLines, [{ rider_id: "rider-x", actual_position: 1 }]);
});

test("mapRowsToResultLines: an unresolvable row is a hard failure, not a silent skip", () => {
  const rows = [riderRow(1, { name: "Known", bib: 1 }), riderRow(2, { name: "Unknown Rider", bib: 999 })];
  const matchedRiders = [matchedRider({ riderId: "rider-1", bib: 1, name: "Known" })];

  const { resultLines, error } = mapRowsToResultLines(rows, matchedRiders);
  assert.equal(resultLines, null);
  assert.match(error, /could not be matched/);
});

test("buildApplyRpcParams: assembles the exact 8 parameters per spec §14.2, with p_finalize always false", () => {
  const report = buildValidReport();
  const stage = report.reconciliation.stages[0];
  const resultLines = [{ rider_id: "rider-1", actual_position: 1 }];

  const params = buildApplyRpcParams({ report, stage, resultLines, reason: "custom reason", requestId: "custom-request-id" });

  assert.equal(params.p_stage_id, STAGE_ID);
  assert.deepEqual(params.p_result_lines, resultLines);
  assert.equal(params.p_reconciliation, stage);
  assert.deepEqual(params.p_dry_run_status, { parserStatus: "ok", parserDriftDetected: false });
  assert.deepEqual(params.p_source, {
    provider_name: "official-letour",
    source_url: "https://www.letour.fr/en/rankings/stage-2",
    fetched_at: report.fetchedAt,
    confidence: "official"
  });
  assert.equal(params.p_finalize, false);
  assert.equal(params.p_reason, "custom reason");
  assert.equal(params.p_request_id, "custom-request-id");
});

test("buildApplyRpcParams: defaults p_reason and p_request_id when not supplied", () => {
  const report = buildValidReport();
  const stage = report.reconciliation.stages[0];
  const params = buildApplyRpcParams({ report, stage, resultLines: [] });

  assert.match(params.p_reason, /--apply --confirm-stage=2/);
  assert.match(params.p_request_id, /^apply-2-\d+$/);
});

test("buildApplyRpcParams: includes p_jersey_holders, defaulting to an empty array when not supplied", () => {
  const report = buildValidReport();
  const stage = report.reconciliation.stages[0];

  const withoutJerseys = buildApplyRpcParams({ report, stage, resultLines: [] });
  assert.deepEqual(withoutJerseys.p_jersey_holders, []);

  const jerseyHolderParams = [
    { jersey_type: "yellow", rider_id: "jersey-rider-yellow" },
    { jersey_type: "green", rider_id: "jersey-rider-green" },
    { jersey_type: "kom", rider_id: "jersey-rider-kom" },
    { jersey_type: "white", rider_id: "jersey-rider-white" }
  ];
  const withJerseys = buildApplyRpcParams({ report, stage, resultLines: [], jerseyHolderParams });
  assert.deepEqual(withJerseys.p_jersey_holders, jerseyHolderParams);
});

test("selectJerseyHolderParams: all four matched jersey holders map to {jersey_type, rider_id} pairs", () => {
  const stage = buildValidReport().reconciliation.stages[0];
  const { jerseyHolderParams, error } = selectJerseyHolderParams(stage);

  assert.equal(error, null);
  assert.deepEqual(
    jerseyHolderParams.map((entry) => entry.jersey_type).sort(),
    ["green", "kom", "white", "yellow"]
  );
  const yellow = jerseyHolderParams.find((entry) => entry.jersey_type === "yellow");
  assert.equal(yellow.rider_id, "jersey-rider-yellow");
});

test("selectJerseyHolderParams: refuses when a jersey holder is missing", () => {
  const stage = buildValidReport({}, {
    jerseyHolders: buildFourMatchedJerseyHolders().filter((holder) => holder.jerseyType !== "kom")
  }).reconciliation.stages[0];

  const { jerseyHolderParams, error } = selectJerseyHolderParams(stage);
  assert.equal(jerseyHolderParams, null);
  assert.match(error, /"kom" is missing or unmatched/);
});

test("selectJerseyHolderParams: refuses when a jersey holder has a non-matched status", () => {
  const jerseyHolders = buildFourMatchedJerseyHolders().map((holder) =>
    holder.jerseyType === "white" ? { ...holder, status: "unmatched", matchedRiderId: null } : holder
  );
  const stage = buildValidReport({}, { jerseyHolders }).reconciliation.stages[0];

  const { jerseyHolderParams, error } = selectJerseyHolderParams(stage);
  assert.equal(jerseyHolderParams, null);
  assert.match(error, /"white" is missing or unmatched/);
});

test("validateReportForApply: refuses a report whose jerseyHolders array is missing an entry, even if safeToApply is (incorrectly) true", () => {
  const report = buildValidReport({}, {
    jerseyHolders: buildFourMatchedJerseyHolders().filter((holder) => holder.jerseyType !== "green")
  });
  const { errors } = validate(report);
  assert.ok(errors.some((error) => error.includes('missing a matched "green" entry')));
});

test("interpretRpcResponse: applied", () => {
  const outcome = interpretRpcResponse({ data: { status: "applied", stage_id: STAGE_ID, stage_result_id: "result-1", import_run_id: "run-1", line_count: 10 }, error: null });
  assert.equal(outcome.status, "applied");
  assert.equal(outcome.exitCode, 0);
  assert.match(outcome.message, /Applied/);
});

test("interpretRpcResponse: no_change is treated as success, not silently identical to applied", () => {
  const outcome = interpretRpcResponse({ data: { status: "no_change", stage_id: STAGE_ID, stage_result_id: "result-1", line_count: 10 }, error: null });
  assert.equal(outcome.status, "no_change");
  assert.equal(outcome.exitCode, 0);
  assert.match(outcome.message, /No changes/);
});

test("interpretRpcResponse: an RPC error is a failure with the error message surfaced verbatim", () => {
  const outcome = interpretRpcResponse({ data: null, error: { message: "apply_grandtour_official_stage_result: stage 2 is a TTT stage; TTT results are not supported by this function." } });
  assert.equal(outcome.status, "error");
  assert.equal(outcome.exitCode, 1);
  assert.equal(outcome.message, "apply_grandtour_official_stage_result: stage 2 is a TTT stage; TTT results are not supported by this function.");
});

test("interpretRpcResponse: an unrecognized response shape is treated as a failure, not a silent success", () => {
  const outcome = interpretRpcResponse({ data: { status: "something_else" }, error: null });
  assert.equal(outcome.status, "error");
  assert.equal(outcome.exitCode, 1);
});

test("isProductionSupabaseUrl matches only the documented production project ref", () => {
  assert.equal(isProductionSupabaseUrl("https://nsdpilmmrfobiapbwona.supabase.co"), true);
  assert.equal(isProductionSupabaseUrl("http://127.0.0.1:54321"), false);
  assert.equal(isProductionSupabaseUrl("https://some-other-project.supabase.co"), false);
  assert.equal(isProductionSupabaseUrl(null), false);
  assert.equal(isProductionSupabaseUrl("not a url"), false);
});

test("decodeJwtRole reads the role claim and fails closed on garbage input", () => {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ role: "service_role", iss: "supabase" })).toString("base64url");
  const token = `${header}.${payload}.signature`;

  assert.equal(decodeJwtRole(token), "service_role");
  assert.equal(decodeJwtRole("not-a-jwt"), null);
  assert.equal(decodeJwtRole(""), null);
  assert.equal(decodeJwtRole(undefined), null);
});

test("decodeJwtRole distinguishes an anon key from a service-role key", () => {
  const anonPayload = Buffer.from(JSON.stringify({ role: "anon" })).toString("base64url");
  const anonToken = `header.${anonPayload}.signature`;
  assert.equal(decodeJwtRole(anonToken), "anon");
});
