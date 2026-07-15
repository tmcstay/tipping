import assert from "node:assert/strict";
import test from "node:test";

import { computeRankMovement, formatMovementBadge, formatSubjectMovementClause } from "./movement.ts";

test("computeRankMovement: improved rank is 'up'", () => {
  const movement = computeRankMovement(3, 10);
  assert.deepEqual(movement, { kind: "up", places: 7 });
});

test("computeRankMovement: worse rank is 'down'", () => {
  const movement = computeRankMovement(10, 7);
  assert.deepEqual(movement, { kind: "down", places: 3 });
});

test("computeRankMovement: unchanged rank is 'same'", () => {
  const movement = computeRankMovement(5, 5);
  assert.deepEqual(movement, { kind: "same" });
});

test("computeRankMovement: null previous rank is 'new', never zero movement", () => {
  const movement = computeRankMovement(5, null);
  assert.deepEqual(movement, { kind: "new" });
});

test("formatMovementBadge renders each kind per spec", () => {
  assert.equal(formatMovementBadge({ kind: "up", places: 7 }), "▲ 7");
  assert.equal(formatMovementBadge({ kind: "down", places: 3 }), "▼ 3");
  assert.equal(formatMovementBadge({ kind: "same" }), "—");
  assert.equal(formatMovementBadge({ kind: "new" }), "NEW");
});

test("formatSubjectMovementClause: up/down produce a clause", () => {
  assert.equal(formatSubjectMovementClause({ kind: "up", places: 7 }), "and moved up 7 places");
  assert.equal(formatSubjectMovementClause({ kind: "up", places: 1 }), "and moved up 1 place");
  assert.equal(formatSubjectMovementClause({ kind: "down", places: 3 }), "and moved down 3 places");
});

test("formatSubjectMovementClause: same/new produce no clause (never fabricated zero movement)", () => {
  assert.equal(formatSubjectMovementClause({ kind: "same" }), null);
  assert.equal(formatSubjectMovementClause({ kind: "new" }), null);
});
