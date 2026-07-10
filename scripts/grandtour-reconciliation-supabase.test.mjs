import assert from "node:assert/strict";
import test from "node:test";

import { fetchReconciliationContext, resolveGrandTourId } from "./grandtour-reconciliation-supabase.mjs";
import { reconcileStageResult } from "./grandtour-reconciliation.mjs";

// A minimal fake Supabase query builder that only implements the read
// methods this module is allowed to call (select/eq/limit/maybeSingle). If
// grandtour-reconciliation-supabase.mjs ever called .insert/.upsert/.update/
// .delete, this fake would throw "not a function" and fail the test.
function fakeSupabaseClient(tableData) {
  return {
    from(table) {
      const rows = tableData[table] ?? [];
      const filters = [];
      const builder = {
        select() {
          return builder;
        },
        eq(column, value) {
          filters.push((row) => row[column] === value);
          return builder;
        },
        limit() {
          return builder;
        },
        async maybeSingle() {
          const match = rows.filter((row) => filters.every((predicate) => predicate(row)))[0] ?? null;
          return { data: match, error: null };
        },
        then(resolve) {
          const matches = rows.filter((row) => filters.every((predicate) => predicate(row)));
          return resolve({ data: matches, error: null });
        }
      };
      return builder;
    }
  };
}

test("resolveGrandTourId reads grand_tours by name and year only", async () => {
  const client = fakeSupabaseClient({
    grand_tours: [{ id: "tour-1", name: "Tour de France", year: 2026 }]
  });

  const grandTourId = await resolveGrandTourId(client, { name: "Tour de France", year: 2026 });
  assert.equal(grandTourId, "tour-1");
});

test("resolveGrandTourId returns null when no matching grand tour exists", async () => {
  const client = fakeSupabaseClient({ grand_tours: [] });
  const grandTourId = await resolveGrandTourId(client, { name: "Giro d'Italia", year: 2026 });
  assert.equal(grandTourId, null);
});

test("fetchReconciliationContext reads stage/riders/teams/startlist scoped to the grand tour and maps snake_case to camelCase", async () => {
  const client = fakeSupabaseClient({
    grandtour_stages: [{ id: "stage-2", grand_tour_id: "tour-1", stage_number: 2, stage_type: "hilly", starts_at: "2026-07-05T10:00:00+00:00" }],
    grandtour_riders: [
      { id: "rider-1", grand_tour_id: "tour-1", team_id: "team-1", display_name: "Test Rider", normalized_name: "test rider", bib_number: 1 }
    ],
    grandtour_teams: [
      { id: "team-1", grand_tour_id: "tour-1", name: "Test Team", short_name: "TT", code: "TT" }
    ],
    grandtour_stage_startlists: [
      { stage_id: "stage-2", rider_id: "rider-1", status: "confirmed" },
      { stage_id: "stage-99-different-stage", rider_id: "rider-2", status: "confirmed" }
    ]
  });

  const context = await fetchReconciliationContext(client, { grandTourId: "tour-1", stageNumber: 2 });

  assert.deepEqual(context.existingStage, { id: "stage-2", stageNumber: 2, stageType: "hilly", stageDate: "2026-07-05" });
  assert.deepEqual(context.existingRiders, [
    { id: "rider-1", teamId: "team-1", displayName: "Test Rider", normalizedName: "test rider", bibNumber: 1 }
  ]);
  assert.deepEqual(context.existingTeams, [
    { id: "team-1", name: "Test Team", shortName: "TT", code: "TT" }
  ]);
  assert.deepEqual(context.existingStartlist, [{ riderId: "rider-1", status: "confirmed" }]);
});

test("fetchReconciliationContext returns null stageType/stageDate when starts_at or stage_type is absent", async () => {
  const client = fakeSupabaseClient({
    grandtour_stages: [{ id: "stage-3", grand_tour_id: "tour-1", stage_number: 3 }],
    grandtour_riders: [],
    grandtour_teams: [],
    grandtour_stage_startlists: []
  });

  const context = await fetchReconciliationContext(client, { grandTourId: "tour-1", stageNumber: 3 });

  assert.deepEqual(context.existingStage, { id: "stage-3", stageNumber: 3, stageType: undefined, stageDate: null });
});

test("the real grandtour_stages.id read by fetchReconciliationContext flows unchanged into reconcileStageResult()'s stageId, with no second lookup", async () => {
  const client = fakeSupabaseClient({
    grandtour_stages: [{ id: "stage-uuid-abc-123", grand_tour_id: "tour-1", stage_number: 2, stage_type: "hilly", starts_at: "2026-07-05T10:00:00+00:00" }],
    grandtour_riders: [
      { id: "rider-1", grand_tour_id: "tour-1", team_id: "team-1", display_name: "Test Rider", normalized_name: "test rider", bib_number: 1 }
    ],
    grandtour_teams: [
      { id: "team-1", grand_tour_id: "tour-1", name: "Test Team", short_name: "TT", code: "TT" }
    ],
    grandtour_stage_startlists: [
      { stage_id: "stage-uuid-abc-123", rider_id: "rider-1", status: "confirmed" }
    ]
  });

  const context = await fetchReconciliationContext(client, { grandTourId: "tour-1", stageNumber: 2 });
  const result = reconcileStageResult({
    stageNumber: 2,
    stageType: "road",
    parsedStageResult: { stage_number: 2, type: "road", riders: [{ position: 1, rider_name: "TEST RIDER", bib_number: 1, team_name: "Test Team" }] },
    ...context
  });

  assert.equal(result.stageId, "stage-uuid-abc-123");
  assert.equal(result.stageId, context.existingStage.id);
  assert.equal(result.stageDate, "2026-07-05");
  assert.equal(result.stageType, "hilly");
});

test("fetchReconciliationContext returns null existingStage and empty existingStartlist when no stage record matches", async () => {
  const client = fakeSupabaseClient({
    grandtour_stages: [],
    grandtour_riders: [],
    grandtour_teams: [],
    grandtour_stage_startlists: [{ stage_id: "some-other-stage", rider_id: "rider-1", status: "confirmed" }]
  });
  const context = await fetchReconciliationContext(client, { grandTourId: "tour-1", stageNumber: 99 });
  assert.equal(context.existingStage, null);
  assert.deepEqual(context.existingStartlist, []);
});
