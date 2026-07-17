import assert from "node:assert/strict";
import test from "node:test";

import {
  applyAliasInserts,
  applyRegistryPlan,
  applySpecialtyPlan,
  applyTeamHistoryPlan,
  fetchExistingAliasesForRiders,
  fetchExistingUciRiders,
  fetchGrandTourTeamsIndex,
  fetchPendingReviewItems,
  insertReviewItems,
  insertSyncRun,
  updateSyncRun,
} from "./uci-rider-sync-supabase.mjs";

/**
 * A minimal fake Supabase query builder, following the same convention as
 * scripts/grandtour-reconciliation-supabase.test.mjs's fakeSupabaseClient:
 * only implements what this module is allowed to call. Records every
 * insert/update payload so tests can assert exactly what was written.
 */
function fakeSupabaseClient(tableData = {}) {
  const writes = { insert: [], update: [] };
  return {
    writes,
    from(table) {
      const rows = tableData[table] ?? [];
      const filters = [];
      const builder = {
        select(columns) {
          builder._selectColumns = columns;
          return builder;
        },
        eq(column, value) {
          filters.push((row) => row[column] === value);
          return builder;
        },
        in(column, values) {
          filters.push((row) => values.includes(row[column]));
          return builder;
        },
        order() {
          return builder;
        },
        insert(payload) {
          writes.insert.push({ table, payload });
          const inserted = (Array.isArray(payload) ? payload : [payload]).map((row, index) => ({ id: row.id ?? `generated-${table}-${index}`, ...row }));
          builder._insertedRows = inserted;
          return builder;
        },
        update(payload) {
          writes.update.push({ table, payload });
          return builder;
        },
        async single() {
          return { data: builder._insertedRows?.[0] ?? null, error: null };
        },
        then(resolve) {
          const source = builder._insertedRows ?? rows;
          const matches = source.filter((row) => filters.every((predicate) => predicate(row)));
          return resolve({ data: matches, error: null });
        },
      };
      return builder;
    },
  };
}

test("fetchExistingUciRiders: reads uci_riders, optionally scoped by discipline, never writes", async () => {
  const client = fakeSupabaseClient({ uci_riders: [{ id: "1", discipline: "road" }, { id: "2", discipline: "track" }] });
  const riders = await fetchExistingUciRiders(client, { discipline: "road" });
  assert.equal(riders.length, 1);
  assert.equal(riders[0].id, "1");
  assert.equal(client.writes.insert.length, 0);
  assert.equal(client.writes.update.length, 0);
});

test("fetchExistingAliasesForRiders: returns [] without querying when riderIds is empty", async () => {
  const client = fakeSupabaseClient({ uci_rider_aliases: [{ id: "a", rider_id: "1" }] });
  const aliases = await fetchExistingAliasesForRiders(client, []);
  assert.deepEqual(aliases, []);
});

test("fetchGrandTourTeamsIndex: returns [] without querying when grandTourId is not supplied", async () => {
  const client = fakeSupabaseClient({ grandtour_teams: [{ id: "t1" }] });
  const teams = await fetchGrandTourTeamsIndex(client, {});
  assert.deepEqual(teams, []);
});

test("applyRegistryPlan: inserts new riders first, then updates existing ones, and reports counts", async () => {
  const client = fakeSupabaseClient();
  const plan = {
    inserts: [{ row: { id: null, uci_rider_id: "1", normalized_name: "a" } }],
    updates: [{ row: { id: "existing-1", uci_rider_id: "2", normalized_name: "b" } }],
  };
  const result = await applyRegistryPlan(client, plan);
  assert.equal(result.insertedCount, 1);
  assert.equal(result.updatedCount, 1);
  assert.equal(client.writes.insert.length, 1);
  assert.equal(client.writes.update.length, 1);
  assert.equal(client.writes.insert[0].table, "uci_riders");
  // The insert payload must never include a null placeholder id.
  assert.ok(!("id" in client.writes.insert[0].payload[0]));
});

test("applyRegistryPlan: an empty plan performs zero writes", async () => {
  const client = fakeSupabaseClient();
  const result = await applyRegistryPlan(client, { inserts: [], updates: [] });
  assert.equal(result.insertedCount, 0);
  assert.equal(result.updatedCount, 0);
  assert.equal(client.writes.insert.length, 0);
  assert.equal(client.writes.update.length, 0);
});

test("applyAliasInserts: a no-op for an empty list writes nothing", async () => {
  const client = fakeSupabaseClient();
  const result = await applyAliasInserts(client, []);
  assert.equal(result.insertedCount, 0);
  assert.equal(client.writes.insert.length, 0);
});

test("applyAliasInserts: inserts every planned alias row", async () => {
  const client = fakeSupabaseClient();
  const result = await applyAliasInserts(client, [{ rider_id: "1", normalized_alias: "a" }]);
  assert.equal(result.insertedCount, 1);
  assert.equal(client.writes.insert[0].table, "uci_rider_aliases");
});

test("applyTeamHistoryPlan: inserts and updates go to uci_rider_team_history", async () => {
  const client = fakeSupabaseClient();
  const result = await applyTeamHistoryPlan(client, { inserts: [{ rider_id: "1" }], updates: [{ id: "row-1", rider_id: "1" }] });
  assert.equal(result.insertedCount, 1);
  assert.equal(result.updatedCount, 1);
  assert.ok(client.writes.insert.some((entry) => entry.table === "uci_rider_team_history"));
  assert.ok(client.writes.update.some((entry) => entry.table === "uci_rider_team_history"));
});

test("applySpecialtyPlan: splits planned entries by action (insert vs update)", async () => {
  const client = fakeSupabaseClient();
  const planned = [
    { action: "insert", row: { rider_id: "1", season: 2026 } },
    { action: "update", row: { id: "spec-1", rider_id: "2", season: 2026 } },
    { action: "unchanged", row: { id: "spec-2" } },
  ];
  const result = await applySpecialtyPlan(client, planned);
  assert.equal(result.insertedCount, 1);
  assert.equal(result.updatedCount, 1);
});

test("insertReviewItems: maps queueType/riderId/reason into the DB row shape", async () => {
  const client = fakeSupabaseClient();
  const result = await insertReviewItems(client, [{ queueType: "dob_conflict", riderId: "1", reason: "test" }]);
  assert.equal(result.insertedCount, 1);
  assert.equal(client.writes.insert[0].payload[0].queue_type, "dob_conflict");
});

test("insertSyncRun / updateSyncRun: writes to uci_rider_sync_runs and returns the new row's id", async () => {
  const client = fakeSupabaseClient();
  const id = await insertSyncRun(client, { discipline: "road", season_year: 2026, mode: "dry_run" });
  assert.ok(id);
  await updateSyncRun(client, id, { status: "completed" });
  assert.ok(client.writes.update.some((entry) => entry.table === "uci_rider_sync_runs"));
});

test("fetchPendingReviewItems: reads uci_rider_review_queue filtered by status, defaulting to pending", async () => {
  const client = fakeSupabaseClient({
    uci_rider_review_queue: [
      { id: "1", status: "pending" },
      { id: "2", status: "resolved" },
    ],
  });
  const items = await fetchPendingReviewItems(client);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, "1");
});
