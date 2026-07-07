const assert = require("node:assert/strict");
const test = require("node:test");

const {
  groupSelectableRiders,
  isSelectableRiderStatus
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
