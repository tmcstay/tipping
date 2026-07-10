const assert = require("node:assert/strict");
const test = require("node:test");

const {
  groupSelectableRiders,
  isSelectableRiderStatus,
  selectRidersForTab
} = require("../../../dist/mobile-tests/riderSelectionExperience.js");

function rider(id, name, teamName, bib, role, status = "confirmed", code = teamName.slice(0, 3).toUpperCase()) {
  return {
    id: `${id}-start`,
    status,
    bib_number: bib,
    rider_role: role,
    status_changed_at: null,
    status_reason: null,
    rider: {
      id,
      bib_number: null,
      display_name: name,
      nationality: null,
      rider_type: role,
      specialities: role ? [role] : null
    },
    team: { id: `${teamName}-id`, name: teamName, code }
  };
}

test("rider modal data groups riders by team and orders by bib", () => {
  const groups = groupSelectableRiders([
    rider("r1", "Second Rider", "Beta", 22, "sprint"),
    rider("r2", "First Rider", "Beta", 21, "gc"),
    rider("r3", "Alpha Rider", "Alpha", 11, "mountain")
  ], "", "all");

  assert.deepEqual(groups.map((group) => group.teamName), ["Alpha", "Beta"]);
  assert.deepEqual(groups[1].entries.map((entry) => entry.rider.display_name), ["First Rider", "Second Rider"]);
});

test("rider modal search works by rider, team, code and bib", () => {
  const riders = [
    rider("r1", "Fast Rider", "Sprint Team", 12, "sprint", "confirmed", "SPR"),
    rider("r2", "Climber", "Mountain Team", 34, "mountain", "confirmed", "MTN")
  ];

  assert.equal(groupSelectableRiders(riders, "fast", "all")[0].entries[0].rider.id, "r1");
  assert.equal(groupSelectableRiders(riders, "mtn", "all")[0].entries[0].rider.id, "r2");
  assert.equal(groupSelectableRiders(riders, "34", "all")[0].entries[0].rider.id, "r2");
});

test("speciality filter shows matching riders", () => {
  const groups = groupSelectableRiders([
    rider("r1", "GC Rider", "A", 1, "gc"),
    rider("r2", "Sprinter", "A", 2, "sprint")
  ], "", "gc");

  assert.deepEqual(groups.flatMap((group) => group.entries.map((entry) => entry.rider.id)), ["r1"]);
});

test("withdrawn and non-starting statuses are not selectable", () => {
  assert.equal(isSelectableRiderStatus("confirmed"), true);
  assert.equal(isSelectableRiderStatus("withdrawn"), false);
  assert.equal(isSelectableRiderStatus("DNS"), false);
  assert.equal(isSelectableRiderStatus("OTL"), false);
});

test("team grouping orders by min bib, not alphabetically, even when alphabetical order disagrees", () => {
  const groups = groupSelectableRiders([
    rider("r1", "Zed Rider", "Zeta", 1, "gc"),
    rider("r2", "Alpha Rider", "Alpha", 50, "sprint")
  ], "", "all");

  // Alphabetically Alpha would come first; bib order (Zeta has bib 1) must win.
  assert.deepEqual(groups.map((group) => group.teamName), ["Zeta", "Alpha"]);
});

test("selectRidersForTab: 'teams' groups by team using min-bib order", () => {
  const riders = [
    rider("r1", "Zed Rider", "Zeta", 1, "gc"),
    rider("r2", "Alpha Rider", "Alpha", 50, "sprint")
  ];
  const result = selectRidersForTab(riders, "teams", "", "all", new Set());
  assert.equal(result.mode, "grouped");
  assert.deepEqual(result.groups.map((group) => group.teamName), ["Zeta", "Alpha"]);
});

test("selectRidersForTab: 'all' is a flat list sorted by bib ascending across teams", () => {
  const riders = [
    rider("r1", "Second", "Beta", 22, "sprint"),
    rider("r2", "First", "Alpha", 3, "gc"),
    rider("r3", "Third", "Alpha", 40, "mountain")
  ];
  const result = selectRidersForTab(riders, "all", "", "all", new Set());
  assert.equal(result.mode, "flat");
  assert.deepEqual(result.riders.map((entry) => entry.rider.id), ["r2", "r1", "r3"]);
});

test("selectRidersForTab: 'favourites' only includes favourited riders, sorted by bib", () => {
  const riders = [
    rider("r1", "Fav High Bib", "Alpha", 40, "gc"),
    rider("r2", "Not Fav", "Alpha", 3, "sprint"),
    rider("r3", "Fav Low Bib", "Beta", 5, "mountain")
  ];
  const result = selectRidersForTab(riders, "favourites", "", "all", new Set(["r1", "r3"]));
  assert.equal(result.mode, "flat");
  assert.deepEqual(result.riders.map((entry) => entry.rider.id), ["r3", "r1"]);
});

test("selectRidersForTab: 'favourites' returns an empty flat list when nothing is favourited", () => {
  const riders = [rider("r1", "Nobody's Fav", "Alpha", 1, "gc")];
  const result = selectRidersForTab(riders, "favourites", "", "all", new Set());
  assert.equal(result.mode, "flat");
  assert.deepEqual(result.riders, []);
});

test("selectRidersForTab: search and speciality filters still apply within a tab", () => {
  const riders = [
    rider("r1", "Fast Climber", "Alpha", 1, "mountain"),
    rider("r2", "Slow Climber", "Alpha", 2, "mountain"),
    rider("r3", "Sprinter", "Alpha", 3, "sprint")
  ];
  const all = selectRidersForTab(riders, "all", "", "mountain", new Set());
  assert.deepEqual(all.riders.map((entry) => entry.rider.id), ["r1", "r2"]);
  const searched = selectRidersForTab(riders, "all", "fast", "all", new Set());
  assert.deepEqual(searched.riders.map((entry) => entry.rider.id), ["r1"]);
});
