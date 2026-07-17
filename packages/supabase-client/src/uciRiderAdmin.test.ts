import assert from "node:assert/strict";
import test from "node:test";

// dedupeIds is tested against its own zero-local-import module
// (uciRiderIdUtils.ts) rather than importing it via uciRiderAdmin.ts. Every
// other production file in this package (client.ts, auth.ts,
// grandtourAdmin.ts, and now uciRiderAdmin.ts, which imports client.ts)
// deliberately omits the .ts extension on relative imports for
// tsc/bundler compatibility with the apps that consume
// "@tipping-suite/supabase-client" - but Node's ESM resolver requires an
// explicit extension for a file loaded directly by `node --test`, so a
// production file with a bare local import can't be loaded this way at all
// (confirmed: importing uciRiderAdmin.ts directly here throws
// ERR_MODULE_NOT_FOUND for its own bare `from "./client"`). This is a real,
// pre-existing structural limit of this package's test convention, not
// something introduced or worked around unsafely here - getUciRidersByIds/
// getGrandTourRidersByIds' async Supabase-calling bodies are therefore not
// directly unit-tested (same as every other Supabase-calling function in
// grandtourAdmin.ts, none of which have unit tests either); this file
// covers the one piece of new pure logic that could be split out cleanly.
import { dedupeIds } from "./uciRiderIdUtils.ts";

test("dedupeIds: removes duplicates, preserves first-seen order, drops null/undefined/empty entries", () => {
  assert.deepEqual(dedupeIds(["a", "b", "a", null, undefined, "c", "b"]), ["a", "b", "c"]);
  assert.deepEqual(dedupeIds([]), []);
  assert.deepEqual(dedupeIds([null, undefined]), []);
});
