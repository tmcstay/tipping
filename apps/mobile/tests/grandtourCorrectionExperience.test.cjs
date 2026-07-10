const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildCorrectionConfirmationMessage,
  canApplyCorrection,
  computeCorrectionDiff,
  getCorrectionWarnings,
  parseCorrectionReport
} = require("../../../dist/mobile-tests/grandtourCorrectionExperience.js");

const STAGE_ID = "stage-uuid-2";
const RIDER = (n) => `rider-uuid-${n}`;

function buildValidReportObject({ fetchedAt = new Date().toISOString(), swapFirstTwo = false } = {}) {
  const order = swapFirstTwo ? [2, 1, 3, 4, 5, 6, 7, 8, 9, 10] : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  return {
    provider: "official-letour",
    dryRun: true,
    applyEnabled: false,
    parserDriftDetected: false,
    fetchedAt,
    reconciliation: {
      stages: [{
        stageNumber: 2,
        isTtt: false,
        missingStageRecord: false,
        startlistValidationPassed: true,
        safeToApply: true,
        unmatchedRiders: [],
        ambiguousRiders: [],
        unmatchedTeams: [],
        ambiguousTeams: [],
        duplicateBibConflicts: [],
        parsedRiders: order.map((n, index) => ({ position: index + 1, bib_number: n, rider_name: `Rider ${n}` })),
        matchedRiders: order.map((n) => ({ riderId: RIDER(n), bibNumber: n, riderName: `Rider ${n}` })),
        jerseyHolders: [
          { jerseyType: "yellow", matchedRiderId: RIDER(1), status: "matched" },
          { jerseyType: "green", matchedRiderId: RIDER(2), status: "matched" },
          { jerseyType: "kom", matchedRiderId: RIDER(3), status: "matched" },
          { jerseyType: "white", matchedRiderId: RIDER(4), status: "matched" }
        ]
      }]
    }
  };
}

test("parseCorrectionReport parses a valid report into 10 result lines and 4 jersey holders", () => {
  const { report, errors } = parseCorrectionReport(JSON.stringify(buildValidReportObject()), STAGE_ID, 2);
  assert.deepEqual(errors, []);
  assert.ok(report);
  assert.equal(report.resultLines.length, 10);
  assert.equal(report.jerseyHolders.length, 4);
  assert.equal(report.resultLines[0].rider_id, RIDER(1));
  assert.equal(report.resultLines[0].actual_position, 1);
});

test("parseCorrectionReport rejects invalid JSON", () => {
  const { report, errors } = parseCorrectionReport("{not json", STAGE_ID, 2);
  assert.equal(report, null);
  assert.ok(errors[0].includes("Not valid JSON"));
});

test("parseCorrectionReport rejects a stale report (older than 6 hours)", () => {
  const staleTimestamp = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
  const { report, errors } = parseCorrectionReport(JSON.stringify(buildValidReportObject({ fetchedAt: staleTimestamp })), STAGE_ID, 2);
  assert.equal(report, null);
  assert.ok(errors.some((message) => message.includes("older than")));
});

test("parseCorrectionReport rejects safeToApply=false", () => {
  const reportObject = buildValidReportObject();
  reportObject.reconciliation.stages[0].safeToApply = false;
  const { report, errors } = parseCorrectionReport(JSON.stringify(reportObject), STAGE_ID, 2);
  assert.equal(report, null);
  assert.ok(errors.some((message) => message.includes("safeToApply")));
});

test("parseCorrectionReport rejects a mismatched stage number", () => {
  const { report, errors } = parseCorrectionReport(JSON.stringify(buildValidReportObject()), STAGE_ID, 5);
  assert.equal(report, null);
  assert.ok(errors.some((message) => message.includes("stage 5")));
});

test("parseCorrectionReport rejects a TTT stage", () => {
  const reportObject = buildValidReportObject();
  reportObject.reconciliation.stages[0].isTtt = true;
  const { report, errors } = parseCorrectionReport(JSON.stringify(reportObject), STAGE_ID, 2);
  assert.equal(report, null);
  assert.ok(errors.some((message) => message.includes("TTT")));
});

test("computeCorrectionDiff reports no changes when current matches incoming exactly", () => {
  const { report } = parseCorrectionReport(JSON.stringify(buildValidReportObject()), STAGE_ID, 2);
  const currentByPosition = new Map(report.resultLines.map((line) => [line.actual_position, line.rider_id]));
  const currentByJersey = new Map(report.jerseyHolders.map((holder) => [holder.jersey_type, holder.rider_id]));
  const diff = computeCorrectionDiff(currentByPosition, currentByJersey, report);
  assert.equal(diff.resultLinesChanged, false);
  assert.equal(diff.jerseyHoldersChanged, false);
  assert.deepEqual(diff.changedLines, []);
});

test("computeCorrectionDiff detects a position swap", () => {
  const { report: current } = parseCorrectionReport(JSON.stringify(buildValidReportObject()), STAGE_ID, 2);
  const { report: incoming } = parseCorrectionReport(JSON.stringify(buildValidReportObject({ swapFirstTwo: true })), STAGE_ID, 2);
  const currentByPosition = new Map(current.resultLines.map((line) => [line.actual_position, line.rider_id]));
  const currentByJersey = new Map(current.jerseyHolders.map((holder) => [holder.jersey_type, holder.rider_id]));
  const diff = computeCorrectionDiff(currentByPosition, currentByJersey, incoming);
  assert.equal(diff.resultLinesChanged, true);
  assert.equal(diff.changedLines.length, 2);
  assert.deepEqual(diff.changedLines.map((line) => line.position).sort(), [1, 2]);
});

test("getCorrectionWarnings is empty for a plain draft, unscored stage", () => {
  assert.deepEqual(getCorrectionWarnings({ isFinal: false, scoreCount: 0, reviewStatus: "imported" }), []);
});

test("getCorrectionWarnings warns about finalisation and existing scores", () => {
  const warnings = getCorrectionWarnings({ isFinal: true, scoreCount: 3, reviewStatus: "finalised" });
  assert.equal(warnings.length, 3);
  assert.ok(warnings[0].includes("already been finalised"));
  assert.ok(warnings[1].includes("existing scores"));
  assert.ok(warnings[2].includes("correction_required"));
});

test("canApplyCorrection requires safeToApply, an actual difference, and a non-blank reason", () => {
  const diff = { resultLinesChanged: true, jerseyHoldersChanged: false, changedLines: [{ position: 1, currentRiderId: "a", incomingRiderId: "b" }], changedJerseys: [] };
  assert.equal(canApplyCorrection({ safeToApply: true, diff, reason: "fixing a bad import" }), true);
  assert.equal(canApplyCorrection({ safeToApply: false, diff, reason: "fixing a bad import" }), false);
  assert.equal(canApplyCorrection({ safeToApply: true, diff: null, reason: "fixing a bad import" }), false);
  assert.equal(canApplyCorrection({ safeToApply: true, diff, reason: "   " }), false);
  const noDiff = { resultLinesChanged: false, jerseyHoldersChanged: false, changedLines: [], changedJerseys: [] };
  assert.equal(canApplyCorrection({ safeToApply: true, diff: noDiff, reason: "fixing a bad import" }), false);
});

test("buildCorrectionConfirmationMessage includes the stage number, the required attestation text, and a timestamp", () => {
  const now = new Date("2026-07-12T10:00:00.000Z");
  const message = buildCorrectionConfirmationMessage(5, now);
  assert.equal(
    message,
    "I understand this will update an existing result for Stage 5 and may require rescoring, at 2026-07-12T10:00:00.000Z."
  );
});
