import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildRequestId,
  buildSummary,
  fetchStageState,
  parseAdminStageArgs,
  validateFinalisePreflight,
  validateMarkCheckedPreflight,
  validateScorePreflight
} from "./grandtour-admin-stage.mjs";

const ADMIN_UUID = "11111111-1111-4111-8111-111111111111";

test("parseAdminStageArgs requires exactly one command flag", () => {
  assert.throws(
    () => parseAdminStageArgs(["--stage", "2", "--admin-user", ADMIN_UUID]),
    /Exactly one command flag is required/
  );
});

test("parseAdminStageArgs rejects two conflicting command flags", () => {
  assert.throws(
    () => parseAdminStageArgs(["--mark-checked", "--finalise", "--stage", "2", "--admin-user", ADMIN_UUID]),
    /Only one command flag may be given/
  );
});

test("parseAdminStageArgs allows repeating the same command flag once resolved", () => {
  const options = parseAdminStageArgs(["--finalise", "--finalize", "--stage", "2", "--admin-user", ADMIN_UUID]);
  assert.equal(options.command, "finalise");
});

test("parseAdminStageArgs accepts --finalize as an alias for --finalise", () => {
  const options = parseAdminStageArgs(["--finalize", "--stage", "4", "--admin-user", ADMIN_UUID]);
  assert.equal(options.command, "finalise");
});

test("parseAdminStageArgs accepts --check-finalize-score as an alias for --check-finalise-score", () => {
  const options = parseAdminStageArgs(["--check-finalize-score", "--stage", "4", "--admin-user", ADMIN_UUID]);
  assert.equal(options.command, "check-finalise-score");
});

test("parseAdminStageArgs requires --stage", () => {
  assert.throws(
    () => parseAdminStageArgs(["--mark-checked", "--admin-user", ADMIN_UUID]),
    /--stage <stage_number> is required/
  );
});

test("parseAdminStageArgs rejects a non-positive-integer --stage", () => {
  assert.throws(() => parseAdminStageArgs(["--mark-checked", "--stage", "0", "--admin-user", ADMIN_UUID]), /--stage requires a positive integer/);
  assert.throws(() => parseAdminStageArgs(["--mark-checked", "--stage", "abc", "--admin-user", ADMIN_UUID]), /--stage requires a positive integer/);
});

test("parseAdminStageArgs requires --admin-user", () => {
  assert.throws(() => parseAdminStageArgs(["--mark-checked", "--stage", "2"]), /--admin-user <uuid> is required/);
});

test("parseAdminStageArgs rejects a non-UUID --admin-user", () => {
  assert.throws(
    () => parseAdminStageArgs(["--mark-checked", "--stage", "2", "--admin-user", "not-a-uuid"]),
    /--admin-user requires a UUID/
  );
});

test("parseAdminStageArgs rejects unrecognized arguments", () => {
  assert.throws(
    () => parseAdminStageArgs(["--mark-checked", "--stage", "2", "--admin-user", ADMIN_UUID, "--bogus"]),
    /Unrecognized argument: --bogus/
  );
});

test("parseAdminStageArgs defaults grand tour name/year and optional flags", () => {
  const options = parseAdminStageArgs(["--mark-checked", "--stage", "2", "--admin-user", ADMIN_UUID]);
  assert.equal(options.grandTourName, "Tour de France");
  assert.equal(options.grandTourYear, 2026);
  assert.equal(options.confirmProduction, false);
  assert.equal(options.recalculate, false);
  assert.equal(options.requestId, null);
  assert.equal(options.note, null);
  assert.equal(options.reason, null);
});

test("parseAdminStageArgs parses --confirm-production, --recalculate, --note, --reason, --request-id, --grand-tour-name/year", () => {
  const options = parseAdminStageArgs([
    "--score",
    "--stage", "5",
    "--admin-user", ADMIN_UUID,
    "--confirm-production",
    "--recalculate",
    "--note", "looks right",
    "--reason", "post-stage review",
    "--request-id", "custom-id-1",
    "--grand-tour-name", "Giro d'Italia",
    "--grand-tour-year", "2027"
  ]);
  assert.equal(options.confirmProduction, true);
  assert.equal(options.recalculate, true);
  assert.equal(options.note, "looks right");
  assert.equal(options.reason, "post-stage review");
  assert.equal(options.requestId, "custom-id-1");
  assert.equal(options.grandTourName, "Giro d'Italia");
  assert.equal(options.grandTourYear, 2027);
});

test("parseAdminStageArgs --help short-circuits without requiring other args", () => {
  const options = parseAdminStageArgs(["--help"]);
  assert.equal(options.help, true);
});

test("buildRequestId is stable, timestamped, and includes the command and stage number", () => {
  const now = new Date("2026-07-10T12:34:56.789Z");
  const id = buildRequestId("mark-checked", 4, now);
  assert.equal(id, "mark-checked-stage4-2026-07-10T12-34-56-789Z");
});

test("buildRequestId changes when the timestamp changes", () => {
  const idA = buildRequestId("finalise", 4, new Date("2026-07-10T12:00:00.000Z"));
  const idB = buildRequestId("finalise", 4, new Date("2026-07-10T12:00:01.000Z"));
  assert.notEqual(idA, idB);
});

function baseState(overrides = {}) {
  return {
    resultExists: true,
    resultId: "result-1",
    isFinal: false,
    reviewStatus: "imported",
    lineCount: 10,
    jerseyCount: 4,
    scoreCount: 0,
    totalScoreAwarded: 0,
    top5ScoreAwarded: 0,
    jerseyScoreAwarded: 0,
    bonusScoreAwarded: 0,
    ...overrides
  };
}

test("validateMarkCheckedPreflight passes on a valid draft state", () => {
  const { errors } = validateMarkCheckedPreflight(baseState());
  assert.deepEqual(errors, []);
});

test("validateMarkCheckedPreflight passes even when already admin_checked (idempotent no-change)", () => {
  const { errors } = validateMarkCheckedPreflight(baseState({ reviewStatus: "admin_checked" }));
  assert.deepEqual(errors, []);
});

test("validateMarkCheckedPreflight fails when no result exists", () => {
  const { errors } = validateMarkCheckedPreflight(baseState({ resultExists: false, resultId: null, reviewStatus: null }));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /No draft\/imported grandtour_stage_results row exists/);
});

test("validateMarkCheckedPreflight fails when already final", () => {
  const { errors } = validateMarkCheckedPreflight(baseState({ isFinal: true, reviewStatus: "finalised" }));
  assert.ok(errors.some((message) => /already final/.test(message)));
});

test("validateMarkCheckedPreflight fails on wrong line/jersey/score counts", () => {
  const { errors } = validateMarkCheckedPreflight(baseState({ lineCount: 9, jerseyCount: 3, scoreCount: 1 }));
  assert.equal(errors.length, 3);
  assert.ok(errors.some((message) => /exactly 10 result lines/.test(message)));
  assert.ok(errors.some((message) => /exactly 4 jersey holders/.test(message)));
  assert.ok(errors.some((message) => /0 score rows before admin-check/.test(message)));
});

test("validateFinalisePreflight passes when admin_checked with 10 lines/4 jerseys/0 scores", () => {
  const { errors } = validateFinalisePreflight(baseState({ reviewStatus: "admin_checked" }));
  assert.deepEqual(errors, []);
});

test("validateFinalisePreflight fails when review_status is not admin_checked", () => {
  const { errors } = validateFinalisePreflight(baseState({ reviewStatus: "imported" }));
  assert.ok(errors.some((message) => /must be "admin_checked"/.test(message)));
});

test("validateFinalisePreflight fails when no result exists", () => {
  const { errors } = validateFinalisePreflight(baseState({ resultExists: false, resultId: null, reviewStatus: null }));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /No draft\/imported grandtour_stage_results row exists/);
});

test("validateFinalisePreflight fails on wrong line/jersey/score counts", () => {
  const { errors } = validateFinalisePreflight(baseState({ reviewStatus: "admin_checked", lineCount: 5, jerseyCount: 0, scoreCount: 2 }));
  assert.ok(errors.some((message) => /exactly 10 result lines/.test(message)));
  assert.ok(errors.some((message) => /exactly 4 jersey holders/.test(message)));
  assert.ok(errors.some((message) => /0 score rows before finalising/.test(message)));
});

test("validateScorePreflight passes when finalised with 10 lines/4 jerseys and no prior scores", () => {
  const { errors } = validateScorePreflight(baseState({ isFinal: true, reviewStatus: "finalised" }));
  assert.deepEqual(errors, []);
});

test("validateScorePreflight fails when review_status is not finalised or is_final is false", () => {
  const { errors } = validateScorePreflight(baseState({ isFinal: false, reviewStatus: "admin_checked" }));
  assert.ok(errors.some((message) => /must be "finalised"/.test(message)));
  assert.ok(errors.some((message) => /must be final \(is_final=true\)/.test(message)));
});

test("validateScorePreflight refuses to rescore existing score rows without --recalculate", () => {
  const { errors } = validateScorePreflight(baseState({ isFinal: true, reviewStatus: "finalised", scoreCount: 3 }), { recalculate: false });
  assert.ok(errors.some((message) => /pass --recalculate/.test(message)));
});

test("validateScorePreflight allows rescoring existing score rows with --recalculate", () => {
  const { errors } = validateScorePreflight(baseState({ isFinal: true, reviewStatus: "finalised", scoreCount: 3 }), { recalculate: true });
  assert.deepEqual(errors, []);
});

test("buildSummary maps stage + state into the required snake_case fields", () => {
  const stage = { stageNumber: 4, stageId: "stage-4-id" };
  const state = baseState({
    reviewStatus: "finalised",
    isFinal: true,
    scoreCount: 2,
    totalScoreAwarded: 55,
    top5ScoreAwarded: 35,
    jerseyScoreAwarded: 15,
    bonusScoreAwarded: 5
  });
  assert.deepEqual(buildSummary(stage, state), {
    stage_number: 4,
    stage_id: "stage-4-id",
    stage_result_id: "result-1",
    is_final: true,
    review_status: "finalised",
    result_line_count: 10,
    jersey_holder_count: 4,
    score_count: 2,
    total_score_awarded: 55,
    top5_score_awarded: 35,
    jersey_score_awarded: 15,
    bonus_score_awarded: 5
  });
});

// fetchStageState issues one query per table (grandtour_stage_results,
// grandtour_stage_result_lines, grandtour_stage_jersey_holders,
// grandtour_stage_scores), never a query joined across them. This fake
// client scripts a distinct, deliberately mismatched row count per table
// (10 lines, 4 jerseys, 2 score rows) so that if fetchStageState were ever
// changed to compute any of these via a join, the resulting counts/sums
// would come out multiplied (e.g. score_count landing on some multiple of
// 10 x 4 x 2) instead of the true per-table values asserted below.
function thenable(response) {
  return {
    then(onFulfilled, onRejected) {
      return Promise.resolve(response).then(onFulfilled, onRejected);
    },
    async maybeSingle() {
      return response;
    }
  };
}

function fakeStageStateClient(responsesByTable) {
  return {
    from(table) {
      return {
        select() {
          return {
            eq() {
              return thenable(responsesByTable[table]);
            }
          };
        }
      };
    }
  };
}

test("fetchStageState derives counts/sums from four separate un-joined per-table queries, not a multiplied join", async () => {
  const client = fakeStageStateClient({
    grandtour_stage_results: { data: { id: "result-x", is_final: true, review_status: "finalised" }, error: null },
    grandtour_stage_result_lines: { count: 10, error: null },
    grandtour_stage_jersey_holders: { count: 4, error: null },
    grandtour_stage_scores: {
      data: [
        { total_score: 35, top5_score: 20, jersey_score: 10, bonus_score: 5 },
        { total_score: 20, top5_score: 15, jersey_score: 5, bonus_score: 0 }
      ],
      error: null
    }
  });

  const state = await fetchStageState(client, { stageId: "stage-x" });

  assert.equal(state.lineCount, 10);
  assert.equal(state.jerseyCount, 4);
  assert.equal(state.scoreCount, 2, "score_count must equal the real number of score rows (2), not a value inflated by joining against the 10 lines or 4 jerseys");
  assert.equal(state.totalScoreAwarded, 55);
  assert.equal(state.top5ScoreAwarded, 35);
  assert.equal(state.jerseyScoreAwarded, 15);
  assert.equal(state.bonusScoreAwarded, 5);
});

test("fetchStageState reports resultExists=false and zero counts when no result row exists yet", async () => {
  const client = fakeStageStateClient({
    grandtour_stage_results: { data: null, error: null },
    grandtour_stage_jersey_holders: { count: 0, error: null },
    grandtour_stage_scores: { data: [], error: null }
  });

  const state = await fetchStageState(client, { stageId: "stage-x" });

  assert.equal(state.resultExists, false);
  assert.equal(state.resultId, null);
  assert.equal(state.lineCount, 0, "result_line_count must stay 0 without ever querying grandtour_stage_result_lines when no result row exists");
  assert.equal(state.jerseyCount, 0);
  assert.equal(state.scoreCount, 0);
});
