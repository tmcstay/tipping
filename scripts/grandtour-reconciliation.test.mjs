import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  buildReconciliationReport,
  checkStartlistMembership,
  classifyRiderMatch,
  classifyTeamMatch,
  deriveTeamResultFromRiderRows,
  detectDuplicateBibConflicts,
  reconcileJerseyHolders,
  reconcileStageResult,
  reconcileTeamTimeTrialResult
} from "./grandtour-reconciliation.mjs";

const FIXTURES_DIR = path.resolve("test", "fixtures", "reconciliation");

async function readJsonFixture(name) {
  return JSON.parse(await fs.readFile(path.join(FIXTURES_DIR, name), "utf8"));
}

async function loadContext() {
  const [existingRiders, existingTeams, existingStages] = await Promise.all([
    readJsonFixture("existing-riders.json"),
    readJsonFixture("existing-teams.json"),
    readJsonFixture("existing-stages.json")
  ]);
  return { existingRiders, existingTeams, existingStages };
}

function stageRecordFor(existingStages, stageNumber) {
  return existingStages.find((stage) => stage.stageNumber === stageNumber) ?? null;
}

test("perfect rider/team match: all riders and teams matched, on the startlist, stage safe to apply", async () => {
  const { existingRiders, existingTeams, existingStages } = await loadContext();
  const parsedStageResult = await readJsonFixture("parsed-stage-perfect-match.json");
  const existingStartlist = await readJsonFixture("existing-startlist-stage-2-complete.json");

  const result = reconcileStageResult({
    stageNumber: 2,
    stageType: "road",
    parsedStageResult,
    existingStage: stageRecordFor(existingStages, 2),
    existingRiders,
    existingTeams,
    existingStartlist
  });

  assert.equal(result.missingStageRecord, false);
  assert.equal(result.stageId, "stage-record-2");
  assert.equal(result.stageDate, "2026-07-05");
  assert.equal(result.stageType, "hilly");
  assert.deepEqual(result.parsedRiders, parsedStageResult.riders);
  assert.equal(result.matchedRiders.length, 3);
  assert.deepEqual(result.unmatchedRiders, []);
  assert.deepEqual(result.ambiguousRiders, []);
  assert.equal(result.matchedTeams.length, 3);
  assert.deepEqual(result.unmatchedTeams, []);
  assert.deepEqual(result.ambiguousTeams, []);
  assert.deepEqual(result.duplicateBibConflicts, []);
  assert.equal(result.matchedRidersOnStartlist.length, 3);
  assert.deepEqual(result.matchedRidersMissingFromStartlist, []);
  assert.equal(result.startlistValidationPassed, true);
  assert.equal(result.noStartlistRowsFound, false);
  assert.equal(result.isTtt, false);
  assert.equal(result.safeToApply, true);
  assert.deepEqual(result.blockers, []);
});

test("unmatched rider: a parsed rider with no matching bib or name blocks safe-to-apply", async () => {
  const { existingRiders, existingTeams, existingStages } = await loadContext();
  const parsedStageResult = await readJsonFixture("parsed-stage-unmatched-rider.json");

  const result = reconcileStageResult({
    stageNumber: 4,
    stageType: "road",
    parsedStageResult,
    existingStage: stageRecordFor(existingStages, 4),
    existingRiders,
    existingTeams
  });

  assert.equal(result.matchedRiders.length, 1);
  assert.equal(result.unmatchedRiders.length, 1);
  assert.equal(result.unmatchedRiders[0].riderName, "X. UNKNOWNRIDER");
  assert.match(result.unmatchedRiders[0].reason, /No existing rider found/);
  assert.equal(result.safeToApply, false);
  assert.ok(result.blockers.some((blocker) => blocker.includes("1 parsed rider(s)")));
});

test("ambiguous rider: a name matching two existing riders with no disambiguating bib is reported ambiguous", async () => {
  const { existingRiders, existingTeams, existingStages } = await loadContext();
  const parsedStageResult = await readJsonFixture("parsed-stage-ambiguous-rider.json");

  const result = reconcileStageResult({
    stageNumber: 5,
    stageType: "road",
    parsedStageResult,
    existingStage: stageRecordFor(existingStages, 5),
    existingRiders,
    existingTeams
  });

  assert.equal(result.ambiguousRiders.length, 1);
  assert.equal(result.ambiguousRiders[0].riderName, "G. MARTIN");
  assert.deepEqual(result.ambiguousRiders[0].candidateIds.sort(), ["rider-martin-a", "rider-martin-b"]);
  assert.equal(result.safeToApply, false);
});

test("duplicate bib: two parsed rows sharing a bib number are reported as a conflict", async () => {
  const { existingRiders, existingTeams, existingStages } = await loadContext();
  const parsedStageResult = await readJsonFixture("parsed-stage-duplicate-bib.json");

  const result = reconcileStageResult({
    stageNumber: 6,
    stageType: "road",
    parsedStageResult,
    existingStage: stageRecordFor(existingStages, 6),
    existingRiders,
    existingTeams
  });

  assert.equal(result.duplicateBibConflicts.length, 1);
  assert.equal(result.duplicateBibConflicts[0].bibNumber, 1);
  assert.deepEqual(result.duplicateBibConflicts[0].riderNames.sort(), ["J. VINGEGAARD", "T. POGACAR"]);
  assert.equal(result.safeToApply, false);
  assert.ok(result.blockers.some((blocker) => blocker.includes("duplicate bib")));
});

test("unmatched team: a parsed team name with no matching existing team blocks safe-to-apply", async () => {
  const { existingRiders, existingTeams, existingStages } = await loadContext();
  const parsedStageResult = await readJsonFixture("parsed-stage-unmatched-team.json");

  const result = reconcileStageResult({
    stageNumber: 7,
    stageType: "road",
    parsedStageResult,
    existingStage: stageRecordFor(existingStages, 7),
    existingRiders,
    existingTeams
  });

  assert.equal(result.unmatchedTeams.length, 1);
  assert.equal(result.unmatchedTeams[0].teamName, "SOME NEW SPONSOR CYCLING TEAM");
  assert.equal(result.matchedRiders.length, 1);
  assert.equal(result.safeToApply, false);
});

test("missing stage: no grandtour_stages record blocks safe-to-apply even with perfect rider/team matches", async () => {
  const { existingRiders, existingTeams, existingStages } = await loadContext();
  const parsedStageResult = await readJsonFixture("parsed-stage-perfect-match.json");

  const result = reconcileStageResult({
    stageNumber: 99,
    stageType: "road",
    parsedStageResult,
    existingStage: stageRecordFor(existingStages, 99),
    existingRiders,
    existingTeams
  });

  assert.equal(result.missingStageRecord, true);
  assert.equal(result.stageId, null);
  assert.equal(result.stageDate, null);
  assert.equal(result.stageType, null);
  assert.equal(result.safeToApply, false);
  assert.ok(result.blockers.some((blocker) => blocker.includes("No grandtour_stages record")));
});

test("stage 1 TTT is never safe to apply even with a perfect match", async () => {
  const { existingRiders, existingTeams, existingStages } = await loadContext();
  const parsedStageResult = { ...(await readJsonFixture("parsed-stage-perfect-match.json")), stage_number: 1 };

  const result = reconcileStageResult({
    stageNumber: 1,
    stageType: "ttt",
    parsedStageResult,
    existingStage: { id: "stage-record-1", stageNumber: 1, stageType: "team_time_trial", stageDate: "2026-07-04" },
    existingRiders,
    existingTeams
  });

  assert.equal(result.stageId, "stage-record-1");
  assert.equal(result.stageDate, "2026-07-04");
  assert.equal(result.stageType, "team_time_trial");
  assert.equal(result.isTtt, true);
  assert.equal(result.safeToApply, false);
  assert.ok(result.blockers.some((blocker) => blocker.includes("TTT")));
});

test("startlist validation: a matched rider missing from the stage startlist blocks safe-to-apply", async () => {
  const { existingRiders, existingTeams, existingStages } = await loadContext();
  const parsedStageResult = await readJsonFixture("parsed-stage-perfect-match.json");
  const existingStartlist = await readJsonFixture("existing-startlist-stage-2-missing-rider.json");

  const result = reconcileStageResult({
    stageNumber: 2,
    stageType: "road",
    parsedStageResult,
    existingStage: stageRecordFor(existingStages, 2),
    existingRiders,
    existingTeams,
    existingStartlist
  });

  assert.equal(result.matchedRiders.length, 3);
  assert.equal(result.matchedRidersOnStartlist.length, 2);
  assert.equal(result.matchedRidersMissingFromStartlist.length, 1);
  assert.equal(result.matchedRidersMissingFromStartlist[0].riderId, "rider-evenepoel");
  assert.equal(result.startlistValidationPassed, false);
  assert.equal(result.noStartlistRowsFound, false);
  assert.equal(result.safeToApply, false);
  assert.ok(result.blockers.some((blocker) => blocker.includes("not on the stage 2 startlist")));
});

test("startlist validation: no startlist rows found for the stage is reported distinctly and blocks safe-to-apply", async () => {
  const { existingRiders, existingTeams, existingStages } = await loadContext();
  const parsedStageResult = await readJsonFixture("parsed-stage-perfect-match.json");

  const result = reconcileStageResult({
    stageNumber: 2,
    stageType: "road",
    parsedStageResult,
    existingStage: stageRecordFor(existingStages, 2),
    existingRiders,
    existingTeams,
    existingStartlist: []
  });

  assert.equal(result.matchedRiders.length, 3);
  assert.equal(result.matchedRidersMissingFromStartlist.length, 3);
  assert.equal(result.noStartlistRowsFound, true);
  assert.equal(result.startlistValidationPassed, false);
  assert.equal(result.safeToApply, false);
  assert.ok(result.blockers.some((blocker) => blocker.includes("No grandtour_stage_startlists rows were found")));
});

test("startlist validation: TTT stage remains unsafe to apply even when startlist validation passes cleanly", async () => {
  const { existingRiders, existingTeams } = await loadContext();
  const parsedStageResult = { ...(await readJsonFixture("parsed-stage-perfect-match.json")), stage_number: 1 };
  const existingStartlist = await readJsonFixture("existing-startlist-stage-2-complete.json");

  const result = reconcileStageResult({
    stageNumber: 1,
    stageType: "ttt",
    parsedStageResult,
    existingStage: { id: "stage-record-1", stageNumber: 1, stageType: "team_time_trial", stageDate: "2026-07-04" },
    existingRiders,
    existingTeams,
    existingStartlist
  });

  assert.equal(result.stageId, "stage-record-1");
  assert.equal(result.startlistValidationPassed, true);
  assert.equal(result.isTtt, true);
  assert.equal(result.safeToApply, false);
  assert.ok(result.blockers.some((blocker) => blocker.includes("TTT")));
});

const JERSEY_RIDERS = [
  { id: "rider-yellow", teamId: "team-a", displayName: "Yellow Leader", normalizedName: "yellow leader", bibNumber: 1 },
  { id: "rider-green", teamId: "team-a", displayName: "Green Leader", normalizedName: "green leader", bibNumber: 2 },
  { id: "rider-kom", teamId: "team-b", displayName: "Kom Leader", normalizedName: "kom leader", bibNumber: 3 },
  { id: "rider-white", teamId: "team-b", displayName: "White Leader", normalizedName: "white leader", bibNumber: 4 },
  // Two riders sharing a bib, to exercise the ambiguous case.
  { id: "rider-dup-a", teamId: "team-a", displayName: "Dup A", normalizedName: "dup rider", bibNumber: 99 },
  { id: "rider-dup-b", teamId: "team-a", displayName: "Dup B", normalizedName: "dup rider", bibNumber: 99 }
];
const JERSEY_TEAMS = [
  { id: "team-a", name: "Team Alpha", shortName: "ALP", code: "ALP" },
  { id: "team-b", name: "Team Beta", shortName: "BET", code: "BET" }
];
const JERSEY_STARTLIST = [
  { riderId: "rider-yellow", status: "confirmed" },
  { riderId: "rider-green", status: "confirmed" },
  { riderId: "rider-kom", status: "confirmed" }
  // rider-white deliberately absent, to exercise the "not on startlist" case.
];

function jerseyEntry(jerseyType, overrides = {}) {
  const byType = {
    yellow: { parsedRiderName: "YELLOW LEADER", bibNumber: 1, parsedTeamName: "Team Alpha" },
    green: { parsedRiderName: "GREEN LEADER", bibNumber: 2, parsedTeamName: "Team Alpha" },
    kom: { parsedRiderName: "KOM LEADER", bibNumber: 3, parsedTeamName: "Team Beta" },
    white: { parsedRiderName: "WHITE LEADER", bibNumber: 4, parsedTeamName: "Team Beta" }
  };
  return { jerseyType, sourceClassification: "individual", ...byType[jerseyType], ...overrides };
}

test("reconcileJerseyHolders: all four jersey holders matched -> safeToApply-equivalent (no blockers)", () => {
  const parsed = [jerseyEntry("yellow"), jerseyEntry("green"), jerseyEntry("kom")];
  // White jersey holder is matched by bib but not on the stage startlist —
  // deliberately included in this "otherwise clean" fixture's counterpart
  // test below; this test itself uses a startlist that includes white too.
  const startlistWithWhite = [...JERSEY_STARTLIST, { riderId: "rider-white", status: "confirmed" }];

  const { jerseyHolders, blockers } = reconcileJerseyHolders([...parsed, jerseyEntry("white")], {
    existingRiders: JERSEY_RIDERS,
    existingTeams: JERSEY_TEAMS,
    existingStartlist: startlistWithWhite
  });

  assert.equal(jerseyHolders.length, 4);
  assert.ok(jerseyHolders.every((holder) => holder.status === "matched"));
  assert.deepEqual(blockers, []);
});

test("reconcileJerseyHolders: missing one classification -> blocker and status 'missing'", () => {
  const parsed = [jerseyEntry("yellow"), jerseyEntry("green"), jerseyEntry("kom")]; // white omitted

  const { jerseyHolders, blockers } = reconcileJerseyHolders(parsed, {
    existingRiders: JERSEY_RIDERS,
    existingTeams: JERSEY_TEAMS,
    existingStartlist: JERSEY_STARTLIST
  });

  const white = jerseyHolders.find((holder) => holder.jerseyType === "white");
  assert.equal(white.status, "missing");
  assert.equal(white.matchedRiderId, null);
  assert.deepEqual(blockers, ["Missing white jersey holder."]);
});

test("reconcileJerseyHolders: unmatched rider -> blocker and status 'unmatched'", () => {
  const parsed = [
    jerseyEntry("yellow"),
    jerseyEntry("green", { parsedRiderName: "NOBODY KNOWN", bibNumber: 999 }),
    jerseyEntry("kom"),
    jerseyEntry("white")
  ];

  const { jerseyHolders, blockers } = reconcileJerseyHolders(parsed, {
    existingRiders: JERSEY_RIDERS,
    existingTeams: JERSEY_TEAMS,
    existingStartlist: JERSEY_STARTLIST
  });

  const green = jerseyHolders.find((holder) => holder.jerseyType === "green");
  assert.equal(green.status, "unmatched");
  assert.equal(green.matchedRiderId, null);
  assert.ok(blockers.includes("Unmatched green jersey holder."));
});

test("reconcileJerseyHolders: ambiguous rider -> blocker and status 'ambiguous'", () => {
  const parsed = [
    jerseyEntry("yellow", { parsedRiderName: "DUP RIDER", bibNumber: 99 }),
    jerseyEntry("green"),
    jerseyEntry("kom"),
    jerseyEntry("white")
  ];

  const { jerseyHolders, blockers } = reconcileJerseyHolders(parsed, {
    existingRiders: JERSEY_RIDERS,
    existingTeams: JERSEY_TEAMS,
    existingStartlist: JERSEY_STARTLIST
  });

  const yellow = jerseyHolders.find((holder) => holder.jerseyType === "yellow");
  assert.equal(yellow.status, "ambiguous");
  assert.equal(yellow.matchedRiderId, null);
  assert.ok(blockers.includes("Ambiguous yellow jersey holder."));
});

test("reconcileJerseyHolders: matched rider not on the stage startlist -> blocker and status 'not_on_startlist'", () => {
  // rider-white is matched cleanly by bib but JERSEY_STARTLIST has no row for it.
  const parsed = [jerseyEntry("yellow"), jerseyEntry("green"), jerseyEntry("kom"), jerseyEntry("white")];

  const { jerseyHolders, blockers } = reconcileJerseyHolders(parsed, {
    existingRiders: JERSEY_RIDERS,
    existingTeams: JERSEY_TEAMS,
    existingStartlist: JERSEY_STARTLIST
  });

  const white = jerseyHolders.find((holder) => holder.jerseyType === "white");
  assert.equal(white.status, "not_on_startlist");
  assert.equal(white.matchedRiderId, "rider-white");
  assert.ok(blockers.includes("White jersey holder is not on the stage startlist."));
});

test("reconcileJerseyHolders: matched by bib with an abbreviated official name is allowed — nameMismatch true, but not a blocker", () => {
  const parsed = [
    // Official-letour style abbreviated name ("Y. LEADER") instead of the
    // canonical "Yellow Leader" — bib number still resolves it uniquely.
    jerseyEntry("yellow", { parsedRiderName: "Y. LEADER" }),
    jerseyEntry("green"),
    jerseyEntry("kom"),
    jerseyEntry("white")
  ];
  const startlistWithWhite = [...JERSEY_STARTLIST, { riderId: "rider-white", status: "confirmed" }];

  const { jerseyHolders, blockers } = reconcileJerseyHolders(parsed, {
    existingRiders: JERSEY_RIDERS,
    existingTeams: JERSEY_TEAMS,
    existingStartlist: startlistWithWhite
  });

  const yellow = jerseyHolders.find((holder) => holder.jerseyType === "yellow");
  assert.equal(yellow.status, "matched");
  assert.equal(yellow.matchedRiderId, "rider-yellow");
  assert.equal(yellow.matchedBy, "bib_number");
  assert.equal(yellow.nameMismatch, true);
  assert.deepEqual(blockers, []);
});

test("reconcileStageResult folds jersey-holder blockers into the stage's overall safeToApply", async () => {
  const { existingRiders, existingTeams, existingStages } = await loadContext();
  const baseFixture = await readJsonFixture("parsed-stage-perfect-match.json");
  const parsedStageResult = {
    ...baseFixture,
    // Drop the "white" entry from the fixture's own (otherwise fully
    // matched) jersey_holders, so this test isolates the effect of a
    // missing jersey holder without introducing unrelated rider data.
    jersey_holders: baseFixture.jersey_holders.filter((holder) => holder.jerseyType !== "white")
  };
  const existingStartlist = await readJsonFixture("existing-startlist-stage-2-complete.json");

  const result = reconcileStageResult({
    stageNumber: 2,
    stageType: "road",
    parsedStageResult,
    existingStage: stageRecordFor(existingStages, 2),
    existingRiders,
    existingTeams,
    existingStartlist
  });

  // The result-line riders/teams all still match cleanly...
  assert.deepEqual(result.unmatchedRiders, []);
  assert.equal(result.startlistValidationPassed, true);
  // ...but the missing white jersey holder still blocks the whole stage.
  assert.equal(result.safeToApply, false);
  assert.ok(result.blockers.includes("Missing white jersey holder."));
  assert.equal(result.jerseyHolders.find((holder) => holder.jerseyType === "white").status, "missing");
});

test("checkStartlistMembership splits matched riders into on/missing sets and ignores a null riderId", () => {
  const matchedRiders = [
    { riderName: "A", riderId: "rider-a" },
    { riderName: "B", riderId: "rider-b" },
    { riderName: "C", riderId: null }
  ];
  const existingStartlist = [{ riderId: "rider-a", status: "confirmed" }];

  const { onStartlist, missingFromStartlist } = checkStartlistMembership(matchedRiders, existingStartlist);

  assert.deepEqual(onStartlist.map((rider) => rider.riderId), ["rider-a"]);
  assert.deepEqual(missingFromStartlist.map((rider) => rider.riderName).sort(), ["B", "C"]);
});

test("classifyRiderMatch prefers bib number over name and flags a name mismatch without blocking the match", () => {
  const existingRiders = [{ id: "rider-1", teamId: "team-1", displayName: "Test Rider", normalizedName: "different name", bibNumber: 7 }];
  const match = classifyRiderMatch({ rider_name: "T. RIDER", bib_number: 7 }, existingRiders);

  assert.equal(match.status, "matched");
  assert.equal(match.matchedBy, "bib_number");
  assert.equal(match.riderId, "rider-1");
  assert.equal(match.nameMismatch, true);
});

test("classifyTeamMatch matches by code or name and reports ambiguous on multiple candidates", () => {
  const existingTeams = [
    { id: "team-1", name: "Team One", shortName: "T1", code: "T1" },
    { id: "team-2", name: "Team One Duplicate", shortName: null, code: null }
  ];

  assert.equal(classifyTeamMatch("T1", existingTeams).status, "matched");
  assert.equal(classifyTeamMatch("Nonexistent Team", existingTeams).status, "unmatched");

  const ambiguous = classifyTeamMatch("team one", [
    { id: "a", name: "Team One", shortName: null, code: null },
    { id: "b", name: "team one", shortName: null, code: null }
  ]);
  assert.equal(ambiguous.status, "ambiguous");
  assert.equal(ambiguous.candidateIds.length, 2);
});

test("classifyTeamMatch matches official-letour's compact uppercase team names against canonical hyphen-spaced names", () => {
  const existingTeams = [
    { id: "lidl-trek", name: "Lidl - Trek", shortName: null, code: null },
    { id: "groupama", name: "Groupama - FDJ United", shortName: null, code: null },
    { id: "bahrain", name: "Bahrain - Victorious", shortName: null, code: null },
    { id: "alpecin", name: "Alpecin - Premier Tech", shortName: null, code: null },
    { id: "caja-rural", name: "Caja Rural - Seguros RGA", shortName: null, code: null }
  ];

  const cases = [
    ["LIDL-TREK", "lidl-trek"],
    ["GROUPAMA-FDJ UNITED", "groupama"],
    ["BAHRAIN VICTORIOUS", "bahrain"],
    ["ALPECIN-PREMIER TECH", "alpecin"],
    ["CAJA RURAL-SEGUROS RGA", "caja-rural"]
  ];

  for (const [officialLetourName, expectedTeamId] of cases) {
    const match = classifyTeamMatch(officialLetourName, existingTeams);
    assert.equal(match.status, "matched", `expected "${officialLetourName}" to match, got ${match.status}: ${match.reason}`);
    assert.equal(match.teamId, expectedTeamId);
  }
});

test("detectDuplicateBibConflicts ignores riders without a bib number", () => {
  const conflicts = detectDuplicateBibConflicts([
    { rider_name: "A", bib_number: 1 },
    { rider_name: "B", bib_number: null },
    { rider_name: "C", bib_number: null }
  ]);

  assert.deepEqual(conflicts, []);
});

test("buildReconciliationReport sets dryRun/applyEnabled/reconciliationOnly metadata and overallSafeToApply", async () => {
  const { existingRiders, existingTeams, existingStages } = await loadContext();
  const parsedStageResult = await readJsonFixture("parsed-stage-perfect-match.json");
  const existingStartlist = await readJsonFixture("existing-startlist-stage-2-complete.json");
  const stageResult = reconcileStageResult({
    stageNumber: 2,
    stageType: "road",
    parsedStageResult,
    existingStage: stageRecordFor(existingStages, 2),
    existingRiders,
    existingTeams,
    existingStartlist
  });

  const report = buildReconciliationReport({
    provider: "official-letour",
    stageDate: "2026-07-05",
    stageRangeRequested: { fromStage: 2, toStage: 2 },
    stageReconciliations: [stageResult]
  });

  assert.equal(report.provider, "official-letour");
  assert.equal(report.dryRun, true);
  assert.equal(report.applyEnabled, false);
  assert.equal(report.reconciliationOnly, true);
  assert.equal(report.stageDate, "2026-07-05");
  assert.deepEqual(report.stageRangeRequested, { fromStage: 2, toStage: 2 });
  assert.equal(report.overallSafeToApply, true);
  assert.equal(report.stages.length, 1);
});

test("buildReconciliationReport overallSafeToApply is false when any stage is unsafe, and false for an empty stage list", () => {
  const safeStage = { stageNumber: 2, safeToApply: true };
  const unsafeStage = { stageNumber: 1, safeToApply: false };

  assert.equal(buildReconciliationReport({ stageReconciliations: [safeStage, unsafeStage] }).overallSafeToApply, false);
  assert.equal(buildReconciliationReport({ stageReconciliations: [] }).overallSafeToApply, false);
});

// Real subset of parsed rider rows from a live fetch of TDF 2026 Stage 1
// (2026-07-14) — confirms the UCI "N=1" TTT rule (team time = time of the
// team's first rider across the line; every other rider individually
// timed), which is the whole basis for deriving a team result from this
// same rider-ranking data without a separate letour.fr team table.
const STAGE_1_RIDER_ROWS = [
  { position: 1, rider_name: "J. VINGEGAARD", bib_number: 11, team_name: "TEAM VISMA | LEASE A BIKE", time: "00h 21' 47''" },
  { position: 2, rider_name: "F. GANNA", bib_number: 84, team_name: "NETCOMPANY INEOS CYCLING TEAM", time: "00h 21' 55''" },
  { position: 3, rider_name: "T. POGACAR", bib_number: 1, team_name: "UAE TEAM EMIRATES XRG", time: "00h 21' 59''" },
  { position: 6, rider_name: "I. DEL TORO", bib_number: 2, team_name: "UAE TEAM EMIRATES XRG", time: "00h 22' 13''" },
  { position: 7, rider_name: "D. PIGANZOLI", bib_number: 18, team_name: "TEAM VISMA | LEASE A BIKE", time: "00h 22' 15''" },
  { position: 9, rider_name: "T. FOSS", bib_number: 83, team_name: "NETCOMPANY INEOS CYCLING TEAM", time: "00h 22' 25''" },
  { position: 43, rider_name: "S. KUSS", bib_number: 15, team_name: "TEAM VISMA | LEASE A BIKE", time: "00h 23' 45''" }
];

test("deriveTeamResultFromRiderRows ranks teams by their fastest rider's time (UCI N=1 TTT rule)", () => {
  const { teams, unparsedTeamNames } = deriveTeamResultFromRiderRows(STAGE_1_RIDER_ROWS);

  assert.deepEqual(unparsedTeamNames, []);
  assert.equal(teams.length, 3);

  assert.deepEqual(teams[0], {
    position: 1,
    teamName: "TEAM VISMA | LEASE A BIKE",
    teamTimeSeconds: 21 * 60 + 47,
    firstRiderName: "J. VINGEGAARD",
    firstRiderBibNumber: 11,
    riderCount: 3,
    ridersWithTimeCount: 3
  });
  assert.deepEqual(teams[1], {
    position: 2,
    teamName: "NETCOMPANY INEOS CYCLING TEAM",
    teamTimeSeconds: 21 * 60 + 55,
    firstRiderName: "F. GANNA",
    firstRiderBibNumber: 84,
    riderCount: 2,
    ridersWithTimeCount: 2
  });
  assert.deepEqual(teams[2], {
    position: 3,
    teamName: "UAE TEAM EMIRATES XRG",
    teamTimeSeconds: 21 * 60 + 59,
    firstRiderName: "T. POGACAR",
    firstRiderBibNumber: 1,
    riderCount: 2,
    ridersWithTimeCount: 2
  });

  // A teammate finishing well behind the team's first rider (Piganzoli, 28s
  // behind Vingegaard) must never make Visma's derived team time slower -
  // the minimum, not an average, is the whole point of the N=1 rule.
  assert.equal(teams[0].teamTimeSeconds < teams[1].teamTimeSeconds, true);
});

test("deriveTeamResultFromRiderRows excludes riders with no team_name and reports teams with zero parseable times separately", () => {
  const rows = [
    { rider_name: "No Team Rider", bib_number: 200, team_name: null, time: "00h 20' 00''" },
    { rider_name: "DNF Rider", bib_number: 201, team_name: "ALL DNF TEAM", time: "-" },
    { rider_name: "Real Rider", bib_number: 202, team_name: "REAL TEAM", time: "00h 25' 00''" }
  ];

  const { teams, unparsedTeamNames } = deriveTeamResultFromRiderRows(rows);

  assert.equal(teams.length, 1);
  assert.equal(teams[0].teamName, "REAL TEAM");
  assert.deepEqual(unparsedTeamNames, ["ALL DNF TEAM"]);
});

test("deriveTeamResultFromRiderRows treats a rider missing a real time as a non-fastest teammate, not a team-blocking failure", () => {
  const rows = [
    { rider_name: "Fast Rider", bib_number: 300, team_name: "MIXED TEAM", time: "00h 20' 00''" },
    { rider_name: "Dropped Rider", bib_number: 301, team_name: "MIXED TEAM", time: "-" }
  ];

  const { teams, unparsedTeamNames } = deriveTeamResultFromRiderRows(rows);

  assert.deepEqual(unparsedTeamNames, []);
  assert.equal(teams.length, 1);
  assert.equal(teams[0].firstRiderName, "Fast Rider");
  assert.equal(teams[0].riderCount, 2);
  assert.equal(teams[0].ridersWithTimeCount, 1);
});

test("deriveTeamResultFromRiderRows returns empty teams for no input", () => {
  assert.deepEqual(deriveTeamResultFromRiderRows([]), { teams: [], unparsedTeamNames: [] });
  assert.deepEqual(deriveTeamResultFromRiderRows(undefined), { teams: [], unparsedTeamNames: [] });
});

const STAGE_1_EXISTING_TEAMS = [
  { id: "team-visma", code: null, name: "Team Visma | Lease a Bike", shortName: null },
  { id: "team-ineos", code: null, name: "Netcompany Ineos Cycling Team", shortName: null },
  { id: "team-uae", code: null, name: "UAE Team Emirates XRG", shortName: null }
];

test("reconcileTeamTimeTrialResult matches every derived team against existing teams and reports no blockers when they all resolve", () => {
  const { teams, blockers } = reconcileTeamTimeTrialResult(STAGE_1_RIDER_ROWS, { existingTeams: STAGE_1_EXISTING_TEAMS });

  assert.deepEqual(blockers, []);
  assert.equal(teams.length, 3);
  assert.deepEqual(
    teams.map((team) => ({ position: team.position, teamName: team.teamName, teamId: team.teamId, matchedBy: team.matchedBy })),
    [
      { position: 1, teamName: "TEAM VISMA | LEASE A BIKE", teamId: "team-visma", matchedBy: "name" },
      { position: 2, teamName: "NETCOMPANY INEOS CYCLING TEAM", teamId: "team-ineos", matchedBy: "name" },
      { position: 3, teamName: "UAE TEAM EMIRATES XRG", teamId: "team-uae", matchedBy: "name" }
    ]
  );
});

test("reconcileTeamTimeTrialResult blocks on a derived team with no matching existing team", () => {
  const { teams, blockers } = reconcileTeamTimeTrialResult(STAGE_1_RIDER_ROWS, { existingTeams: STAGE_1_EXISTING_TEAMS.slice(0, 2) });

  assert.equal(teams.length, 3);
  assert.equal(teams[2].teamId, null);
  assert.ok(blockers.some((blocker) => blocker.includes("UAE TEAM EMIRATES XRG") && blocker.includes("no matching existing team")));
});

test("reconcileTeamTimeTrialResult surfaces a team with no parseable rider time as a blocker", () => {
  const rows = [...STAGE_1_RIDER_ROWS, { rider_name: "X", bib_number: 999, team_name: "GHOST TEAM", time: "-" }];
  const { blockers } = reconcileTeamTimeTrialResult(rows, { existingTeams: STAGE_1_EXISTING_TEAMS });

  assert.ok(blockers.some((blocker) => blocker.includes("GHOST TEAM") && blocker.includes("could not be derived")));
});

test("reconcileStageResult populates tttTeamResult (with its blockers folded in) for a TTT stage, and leaves it empty for a non-TTT stage", async () => {
  const { existingRiders, existingTeams: fixtureExistingTeams } = await loadContext();

  const tttResult = reconcileStageResult({
    stageNumber: 1,
    stageType: "ttt",
    parsedStageResult: { stage_number: 1, riders: STAGE_1_RIDER_ROWS },
    existingStage: { id: "stage-record-1", stageNumber: 1, stageType: "team_time_trial", stageDate: "2026-07-04" },
    existingRiders,
    existingTeams: STAGE_1_EXISTING_TEAMS
  });

  assert.equal(tttResult.isTtt, true);
  assert.equal(tttResult.tttTeamResult.teams.length, 3);
  assert.equal(tttResult.tttTeamResult.blockers.length, 0);
  // This stage's existingStage carries no ttt_timing_rule (unset), so it's
  // still unconditionally unsafe — only ttt_timing_rule='individual_time'
  // is supported (see the next test below for that case).
  assert.equal(tttResult.tttTimingRule, null);
  assert.equal(tttResult.isSupportedTtt, false);
  assert.equal(tttResult.safeToApply, false);
  assert.ok(tttResult.blockers.some((blocker) => blocker.includes("TTT")));

  const roadResult = reconcileStageResult({
    stageNumber: 2,
    stageType: "road",
    parsedStageResult: { stage_number: 2, riders: [] },
    existingStage: { id: "stage-record-2", stageNumber: 2, stageType: "hilly", stageDate: "2026-07-05" },
    existingRiders,
    existingTeams: fixtureExistingTeams
  });

  assert.equal(roadResult.isTtt, false);
  assert.deepEqual(roadResult.tttTeamResult, { teams: [], blockers: [] });
});

// Self-contained rider/startlist/jersey-holder fixtures matching
// STAGE_1_RIDER_ROWS (unlike loadContext()'s fixture riders, which are
// unrelated fictional data) - needed because a genuinely clean
// safeToApply=true result requires every parsed rider matched and on the
// startlist, plus all four jersey holders, not just clean team matching.
const STAGE_1_EXISTING_RIDERS = STAGE_1_RIDER_ROWS.map((row, index) => ({
  id: `rider-${index + 1}`,
  bibNumber: row.bib_number,
  normalizedName: row.rider_name.toLowerCase(),
  teamId: STAGE_1_EXISTING_TEAMS.find((team) => team.name.toUpperCase() === row.team_name)?.id ?? null
}));
const STAGE_1_EXISTING_STARTLIST = STAGE_1_EXISTING_RIDERS.map((rider) => ({ riderId: rider.id, status: "confirmed" }));
const STAGE_1_JERSEY_HOLDERS = [
  { jerseyType: "yellow", parsedRiderName: "J. VINGEGAARD", bibNumber: 11 },
  { jerseyType: "green", parsedRiderName: "F. GANNA", bibNumber: 84 },
  { jerseyType: "kom", parsedRiderName: "T. POGACAR", bibNumber: 1 },
  { jerseyType: "white", parsedRiderName: "I. DEL TORO", bibNumber: 2 }
];

test("reconcileStageResult is safe to apply for a TTT stage whose ttt_timing_rule is individual_time, once the derived team result reconciles cleanly", async () => {
  const result = reconcileStageResult({
    stageNumber: 1,
    stageType: "ttt",
    parsedStageResult: { stage_number: 1, riders: STAGE_1_RIDER_ROWS, jersey_holders: STAGE_1_JERSEY_HOLDERS },
    existingStage: { id: "stage-record-1", stageNumber: 1, stageType: "team_time_trial", tttTimingRule: "individual_time", stageDate: "2026-07-04" },
    existingRiders: STAGE_1_EXISTING_RIDERS,
    existingTeams: STAGE_1_EXISTING_TEAMS,
    existingStartlist: STAGE_1_EXISTING_STARTLIST
  });

  assert.equal(result.isTtt, true);
  assert.equal(result.tttTimingRule, "individual_time");
  assert.equal(result.isSupportedTtt, true);
  assert.equal(result.tttTeamResult.teams.length, 3);
  assert.deepEqual(result.tttTeamResult.blockers, []);
  assert.deepEqual(result.blockers, []);
  assert.equal(result.safeToApply, true);
});

test("reconcileStageResult stays unsafe for a TTT stage whose ttt_timing_rule is 'team_time' (older shared-block-time rule, not derivable yet), even with otherwise-clean rider/team/jersey matches", async () => {
  const result = reconcileStageResult({
    stageNumber: 1,
    stageType: "ttt",
    parsedStageResult: { stage_number: 1, riders: STAGE_1_RIDER_ROWS, jersey_holders: STAGE_1_JERSEY_HOLDERS },
    existingStage: { id: "stage-record-1", stageNumber: 1, stageType: "team_time_trial", tttTimingRule: "team_time", stageDate: "2026-07-04" },
    existingRiders: STAGE_1_EXISTING_RIDERS,
    existingTeams: STAGE_1_EXISTING_TEAMS,
    existingStartlist: STAGE_1_EXISTING_STARTLIST
  });

  assert.equal(result.isSupportedTtt, false);
  assert.equal(result.safeToApply, false);
  assert.deepEqual(result.blockers, [
    "Stage is a TTT with ttt_timing_rule=team_time; only individual_time TTT stages are supported for apply, so it remains warning-only and is never safe to apply."
  ]);
});
