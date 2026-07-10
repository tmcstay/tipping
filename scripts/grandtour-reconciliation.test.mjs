import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  buildReconciliationReport,
  checkStartlistMembership,
  classifyRiderMatch,
  classifyTeamMatch,
  detectDuplicateBibConflicts,
  reconcileJerseyHolders,
  reconcileStageResult
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
