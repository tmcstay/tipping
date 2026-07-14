const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildApplyConfirmationMessage,
  canApplyOfficialResult,
  getOfficialCheckStatusMessage,
  OFFICIAL_CHECK_SAFE_MESSAGE,
  summarizeOfficialCheckReport
} = require("../../../dist/mobile-tests/grandtourOfficialCheckExperience.js");

function buildReport(overrides = {}) {
  return {
    fetchedAt: "2026-07-10T17:00:00.000Z",
    provider: "official-letour",
    fromStage: 5,
    toStage: 5,
    parserDriftDetected: false,
    stageFetchMetadata: [
      { stageNumber: 5, status: "ok", rowsMatched: 10, ridersParsed: 10 }
    ],
    jerseyFetchMetadata: [
      { stageNumber: 5, classification: "individual", jerseyType: "yellow", status: "found" },
      { stageNumber: 5, classification: "points", jerseyType: "green", status: "found" }
    ],
    reconciliation: {
      overallSafeToApply: true,
      stages: [
        {
          stageNumber: 5,
          safeToApply: true,
          blockers: [],
          parsedRiders: [
            { position: 2, rider_name: "SECOND RIDER", bib_number: 2, team_name: "Team B" },
            { position: 1, rider_name: "FIRST RIDER", bib_number: 1, team_name: "Team A" }
          ],
          matchedRiders: [
            { riderName: "FIRST RIDER", bibNumber: 1, riderId: "rider-1" },
            { riderName: "SECOND RIDER", bibNumber: 2, riderId: "rider-2" }
          ],
          jerseyHolders: [
            { jerseyType: "yellow", parsedRiderName: "FIRST RIDER", parsedTeamName: "Team A", bibNumber: 1, status: "matched" }
          ]
        }
      ]
    },
    ...overrides
  };
}

test("summarizeOfficialCheckReport extracts parser status, safety flags, and sorts result lines by position", () => {
  const summary = summarizeOfficialCheckReport(buildReport(), 5);

  assert.equal(summary.fetchedAt, "2026-07-10T17:00:00.000Z");
  assert.equal(summary.parserStatus, "ok");
  assert.equal(summary.parserDriftDetected, false);
  assert.equal(summary.safeToApply, true);
  assert.equal(summary.overallSafeToApply, true);
  assert.deepEqual(summary.blockers, []);
  assert.equal(summary.resultLineCount, 2);
  assert.equal(summary.jerseyHolderCount, 1);
  assert.deepEqual(summary.topResultLines.map((line) => line.position), [1, 2]);
  assert.equal(summary.topResultLines[0].riderName, "FIRST RIDER");
});

test("summarizeOfficialCheckReport caps top result lines at 10", () => {
  const parsedRiders = Array.from({ length: 15 }, (_, index) => ({
    position: index + 1,
    rider_name: `RIDER ${index + 1}`,
    bib_number: index + 1,
    team_name: "Team A"
  }));
  const report = buildReport();
  report.reconciliation.stages[0].parsedRiders = parsedRiders;

  const summary = summarizeOfficialCheckReport(report, 5);
  assert.equal(summary.topResultLines.length, 10);
  assert.equal(summary.topResultLines[9].position, 10);
});

test("summarizeOfficialCheckReport surfaces blockers when unsafe", () => {
  const report = buildReport();
  report.reconciliation.overallSafeToApply = false;
  report.reconciliation.stages[0].safeToApply = false;
  report.reconciliation.stages[0].blockers = ["1 rider match(es) are ambiguous."];

  const summary = summarizeOfficialCheckReport(report, 5);
  assert.equal(summary.safeToApply, false);
  assert.equal(summary.overallSafeToApply, false);
  assert.deepEqual(summary.blockers, ["1 rider match(es) are ambiguous."]);
});

test("summarizeOfficialCheckReport returns nulls/empties when the stage is missing from the report", () => {
  const report = buildReport();
  const summary = summarizeOfficialCheckReport(report, 99);

  assert.equal(summary.parserStatus, null);
  assert.equal(summary.safeToApply, null);
  assert.deepEqual(summary.blockers, []);
  assert.deepEqual(summary.topResultLines, []);
  assert.deepEqual(summary.jerseyHolders, []);
});

test("summarizeOfficialCheckReport filters jersey fetch metadata to the requested stage only", () => {
  const report = buildReport({
    jerseyFetchMetadata: [
      { stageNumber: 5, classification: "individual", jerseyType: "yellow", status: "found" },
      { stageNumber: 6, classification: "individual", jerseyType: "yellow", status: "found" }
    ]
  });
  const summary = summarizeOfficialCheckReport(report, 5);
  assert.equal(summary.jerseyFetchMetadata.length, 1);
  assert.equal(summary.jerseyFetchMetadata[0].jerseyType, "yellow");
});

test("summarizeOfficialCheckReport derives team result lines for a TTT stage instead of individual rider lines", () => {
  const report = buildReport();
  report.reconciliation.stages[0].isTtt = true;
  report.reconciliation.stages[0].isSupportedTtt = true;
  report.reconciliation.stages[0].tttTeamResult = {
    blockers: [],
    teams: [
      { position: 2, teamId: "team-b", teamName: "Team B" },
      { position: 1, teamId: "team-a", teamName: "Team A" }
    ]
  };

  const summary = summarizeOfficialCheckReport(report, 5);

  assert.equal(summary.isTtt, true);
  assert.deepEqual(summary.topResultLines, []);
  assert.deepEqual(summary.topTeamLines.map((line) => line.position), [1, 2]);
  assert.equal(summary.topTeamLines[0].teamName, "Team A");
  assert.equal(summary.resultLineCount, 2);
});

test("summarizeOfficialCheckReport caps derived team lines at 10 for a TTT stage", () => {
  const report = buildReport();
  report.reconciliation.stages[0].isTtt = true;
  report.reconciliation.stages[0].tttTeamResult = {
    blockers: [],
    teams: Array.from({ length: 15 }, (_, index) => ({ position: index + 1, teamId: `team-${index + 1}`, teamName: `Team ${index + 1}` }))
  };

  const summary = summarizeOfficialCheckReport(report, 5);
  assert.equal(summary.topTeamLines.length, 10);
  assert.equal(summary.topTeamLines[9].position, 10);
});

test("getOfficialCheckStatusMessage returns the exact required copy when safe", () => {
  assert.equal(getOfficialCheckStatusMessage(true), OFFICIAL_CHECK_SAFE_MESSAGE);
  assert.equal(OFFICIAL_CHECK_SAFE_MESSAGE, "Official check passed. Review result details before applying.");
});

test("getOfficialCheckStatusMessage returns null when unsafe or unknown", () => {
  assert.equal(getOfficialCheckStatusMessage(false), null);
  assert.equal(getOfficialCheckStatusMessage(null), null);
});

test("canApplyOfficialResult requires a safe check result and a non-final stage", () => {
  const safeSummary = summarizeOfficialCheckReport(buildReport(), 5);
  assert.equal(canApplyOfficialResult(safeSummary, false), true);
  assert.equal(canApplyOfficialResult(safeSummary, true), false, "must not apply to an already-final stage");
  assert.equal(canApplyOfficialResult(null, false), false, "must not apply before any check has run");

  const unsafeReport = buildReport();
  unsafeReport.reconciliation.stages[0].safeToApply = false;
  const unsafeSummary = summarizeOfficialCheckReport(unsafeReport, 5);
  assert.equal(canApplyOfficialResult(unsafeSummary, false), false);
});

test("buildApplyConfirmationMessage includes the stage number and an ISO timestamp", () => {
  const message = buildApplyConfirmationMessage(5, new Date("2026-07-10T17:00:00.000Z"));
  assert.match(message, /Stage 5/);
  assert.match(message, /2026-07-10T17:00:00\.000Z/);
});
