const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildRiderDirectory,
  computeTeamOrderBib,
  filterRiderDirectory
} = require("../../../dist/mobile-tests/riderDirectoryExperience.js");

function rider(id, teamId, bib, name, isActive = true, status = "active") {
  return { id, teamId, bibNumber: bib, displayName: name, isActive, status };
}

const TEAMS = [
  { id: "team-a", name: "Team Alpha" },
  { id: "team-b", name: "Team Beta" },
  { id: "team-c", name: "Team Gamma" }
];

test("computeTeamOrderBib is the minimum bib among active riders per team", () => {
  const riders = [
    rider("r1", "team-a", 3, "A1"),
    rider("r2", "team-a", 1, "A2"),
    rider("r3", "team-a", 2, "A3"),
    rider("r4", "team-b", 11, "B1")
  ];
  const map = computeTeamOrderBib(riders);
  assert.equal(map.get("team-a"), 1);
  assert.equal(map.get("team-b"), 11);
});

test("computeTeamOrderBib ignores inactive riders and riders with no bib", () => {
  const riders = [
    rider("r1", "team-a", 1, "Inactive", false),
    rider("r2", "team-a", 5, "Active"),
    rider("r3", "team-a", null, "No bib")
  ];
  const map = computeTeamOrderBib(riders);
  assert.equal(map.get("team-a"), 5, "the inactive rider's lower bib must not count");
});

test("teams sort by team_order_bib ascending - matches the task's worked example (1-8, 11-18, 21-28)", () => {
  const riders = [
    ...[1, 2, 3, 4, 5, 6, 7, 8].map((bib, i) => rider(`c-${bib}`, "team-c", bib, `C${i}`)),
    ...[11, 12, 13, 14, 15, 16, 17, 18].map((bib, i) => rider(`a-${bib}`, "team-a", bib, `A${i}`)),
    ...[21, 22, 23, 24, 25, 26, 27, 28].map((bib, i) => rider(`b-${bib}`, "team-b", bib, `B${i}`))
  ];
  const groups = buildRiderDirectory(riders, TEAMS, new Set());
  assert.deepEqual(groups.map((g) => g.teamId), ["team-c", "team-a", "team-b"]);
  assert.deepEqual(groups.map((g) => g.teamOrderBib), [1, 11, 21]);
});

test("does not sort teams alphabetically when bib data is available (Team Gamma has the lowest bibs)", () => {
  const riders = [
    rider("g1", "team-c", 1, "Gamma Rider"),
    rider("a1", "team-a", 50, "Alpha Rider"),
    rider("b1", "team-b", 25, "Beta Rider")
  ];
  const groups = buildRiderDirectory(riders, TEAMS, new Set());
  // Alphabetically this would be Alpha, Beta, Gamma - bib order must win.
  assert.deepEqual(groups.map((g) => g.teamName), ["Team Gamma", "Team Beta", "Team Alpha"]);
});

test("riders within a team sort by bib_number ascending", () => {
  const riders = [
    rider("r1", "team-a", 8, "Eighth"),
    rider("r2", "team-a", 1, "First"),
    rider("r3", "team-a", 4, "Fourth")
  ];
  const groups = buildRiderDirectory(riders, TEAMS, new Set());
  assert.deepEqual(groups[0].riders.map((r) => r.bibNumber), [1, 4, 8]);
});

test("a team with no active/bibbed riders sorts last, by team name", () => {
  const riders = [
    rider("r1", "team-b", 5, "Has bib"),
    rider("r2", "team-c", null, "No bib rider"),
    rider("r3", "team-a", null, "Also no bib", false)
  ];
  const groups = buildRiderDirectory(riders, TEAMS, new Set());
  assert.equal(groups[0].teamId, "team-b", "the only team with a real bib must come first");
  // team-a and team-c both have null team_order_bib - fall back to team name.
  assert.deepEqual(groups.slice(1).map((g) => g.teamName), ["Team Alpha", "Team Gamma"]);
});

test("riders with no bib sort last within their team, by name", () => {
  const riders = [
    rider("r1", "team-a", 5, "Bibbed"),
    rider("r2", "team-a", null, "Zed no-bib"),
    rider("r3", "team-a", null, "Anna no-bib")
  ];
  const groups = buildRiderDirectory(riders, TEAMS, new Set());
  assert.deepEqual(groups[0].riders.map((r) => r.displayName), ["Bibbed", "Anna no-bib", "Zed no-bib"]);
});

test("buildRiderDirectory marks favourites correctly", () => {
  const riders = [rider("r1", "team-a", 1, "Fav"), rider("r2", "team-a", 2, "Not fav")];
  const groups = buildRiderDirectory(riders, TEAMS, new Set(["r1"]));
  const byId = new Map(groups[0].riders.map((r) => [r.riderId, r]));
  assert.equal(byId.get("r1").isFavourite, true);
  assert.equal(byId.get("r2").isFavourite, false);
});

test("filterRiderDirectory: favourites filter keeps only favourite riders and drops empty team groups", () => {
  const riders = [
    rider("r1", "team-a", 1, "Fav One"),
    rider("r2", "team-a", 2, "Not Fav"),
    rider("r3", "team-b", 11, "Not Fav Either")
  ];
  const groups = buildRiderDirectory(riders, TEAMS, new Set(["r1"]));
  const filtered = filterRiderDirectory(groups, "", "favourites");
  assert.equal(filtered.length, 1, "team-b has no favourites and must be dropped entirely");
  assert.deepEqual(filtered[0].riders.map((r) => r.riderId), ["r1"]);
});

test("filterRiderDirectory: search matches name, team, or bib", () => {
  const riders = [rider("r1", "team-a", 7, "Searchable Rider"), rider("r2", "team-a", 9, "Other")];
  const groups = buildRiderDirectory(riders, TEAMS, new Set());
  assert.deepEqual(filterRiderDirectory(groups, "searchable", "all")[0].riders.map((r) => r.riderId), ["r1"]);
  assert.deepEqual(filterRiderDirectory(groups, "alpha", "all")[0].riders.map((r) => r.riderId), ["r1", "r2"]);
  assert.deepEqual(filterRiderDirectory(groups, "7", "all")[0].riders.map((r) => r.riderId), ["r1"]);
});

test("filterRiderDirectory returns an empty array when favourites filter matches nothing", () => {
  const riders = [rider("r1", "team-a", 1, "Nobody's favourite")];
  const groups = buildRiderDirectory(riders, TEAMS, new Set());
  assert.deepEqual(filterRiderDirectory(groups, "", "favourites"), []);
});
