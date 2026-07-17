import assert from "node:assert/strict";
import test from "node:test";

import { buildTeamLookupIndex, planRiderTeamHistorySync } from "./uci-rider-team-history.mjs";

function teamHistoryRaw() {
  return [
    { year: 2026, teamName: "UAE Team Emirates XRG", teamCode: "UEX", countryCode: "UAE" },
    { year: 2025, teamName: "UAE Team Emirates", teamCode: "UAD", countryCode: "UAE" },
  ];
}

test("buildTeamLookupIndex: indexes teams by normalized code and name", () => {
  const index = buildTeamLookupIndex([{ id: "t1", name: "UAE Team Emirates XRG", code: "UEX" }]);
  assert.equal(index.byCode.get("uex"), "t1");
  assert.equal(index.byName.get("uae team emirates xrg"), "t1");
});

test("planRiderTeamHistorySync: inserts one row per season for a brand-new rider", () => {
  const plan = planRiderTeamHistorySync({ riderId: "r1", teamHistoryRaw: teamHistoryRaw() }, []);
  assert.equal(plan.inserts.length, 2);
  assert.equal(plan.inserts[0].season_year, 2026);
  assert.equal(plan.inserts[0].team_id, null, "no teamsIndex supplied — team_id must stay null, never guessed");
});

test("planRiderTeamHistorySync: resolves team_id only on an exact normalized name/code match", () => {
  const teamsIndex = buildTeamLookupIndex([{ id: "internal-team-1", name: "UAE Team Emirates XRG", code: "UEX" }]);
  const plan = planRiderTeamHistorySync({ riderId: "r1", teamHistoryRaw: teamHistoryRaw(), teamsIndex }, []);
  const row2026 = plan.inserts.find((row) => row.season_year === 2026);
  const row2025 = plan.inserts.find((row) => row.season_year === 2025);
  assert.equal(row2026.team_id, "internal-team-1");
  assert.equal(row2025.team_id, null, "a different team code/name (naming-convention drift year-to-year) must never be auto-merged on similarity alone");
});

test("planRiderTeamHistorySync: a season already recorded identically is left unchanged, not re-inserted", () => {
  const existing = [{ id: "row-2026", season_year: 2026, source_team_code: "UEX", source: "uci", source_team_name: "UAE Team Emirates XRG", team_id: null }];
  const plan = planRiderTeamHistorySync({ riderId: "r1", teamHistoryRaw: [teamHistoryRaw()[0]] }, existing);
  assert.equal(plan.inserts.length, 0);
  assert.equal(plan.updates.length, 0);
  assert.equal(plan.unchanged.length, 1);
});

test("planRiderTeamHistorySync: a genuinely changed team name for an already-recorded season becomes an update against the existing row id", () => {
  const existing = [{ id: "row-2026", season_year: 2026, source_team_code: "UEX", source: "uci", source_team_name: "Old Name", team_id: null }];
  const plan = planRiderTeamHistorySync({ riderId: "r1", teamHistoryRaw: [teamHistoryRaw()[0]] }, existing);
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0].id, "row-2026");
  assert.equal(plan.updates[0].source_team_name, "UAE Team Emirates XRG");
});

test("planRiderTeamHistorySync: two raw entries for the same rider sharing a season+team-code key are deduped, never planned as two colliding inserts (real bug found live: crashed applyTeamHistoryPlan on uci_rider_team_history's own unique index mid-batch)", () => {
  const plan = planRiderTeamHistorySync(
    {
      riderId: "r1",
      teamHistoryRaw: [
        { year: 2026, teamName: "Team A", teamCode: null, countryCode: "AUS" },
        { year: 2026, teamName: "Team B", teamCode: null, countryCode: "AUS" },
      ],
    },
    [],
  );
  assert.equal(plan.inserts.length, 1, "only the first entry for a colliding key is ever planned");
  assert.equal(plan.inserts[0].source_team_name, "Team A");
});

test("planRiderTeamHistorySync: re-running an identical sync twice is fully idempotent (second run: all unchanged)", () => {
  const teamsIndex = buildTeamLookupIndex([{ id: "internal-team-1", name: "UAE Team Emirates XRG", code: "UEX" }]);
  const first = planRiderTeamHistorySync({ riderId: "r1", teamHistoryRaw: teamHistoryRaw(), teamsIndex }, []);
  const existingAfterApply = first.inserts.map((row, index) => ({ id: `applied-${index}`, ...row }));
  const second = planRiderTeamHistorySync({ riderId: "r1", teamHistoryRaw: teamHistoryRaw(), teamsIndex }, existingAfterApply);
  assert.equal(second.inserts.length, 0);
  assert.equal(second.updates.length, 0);
  assert.equal(second.unchanged.length, 2);
});
