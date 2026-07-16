const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildLeaderboardDisplayItems,
  buildParticipantDetailLink,
  formatRankMovement,
  getRankMovementTone
} = require("../../../dist/mobile-tests/leaderboardExperience.js");

function rows(count) {
  return Array.from({ length: count }, (_, index) => ({ id: `row-${index + 1}`, user_id: `user-${index + 1}`, rank: index + 1 }));
}

test("returns every row flat, no divider, when the whole list fits within topCount", () => {
  const items = buildLeaderboardDisplayItems(rows(5), "user-3", 15, 1);
  assert.equal(items.length, 5);
  assert.ok(items.every((item) => item.type === "row"));
  assert.equal(items.find((item) => item.row.user_id === "user-3").isCurrentUser, true);
});

test("returns every row flat when the current user is already within the top block", () => {
  const items = buildLeaderboardDisplayItems(rows(30), "user-10", 15, 1);
  assert.equal(items.length, 30);
  assert.ok(items.every((item) => item.type === "row"));
});

test("returns every row flat when there is no signed-in user match", () => {
  const items = buildLeaderboardDisplayItems(rows(30), "someone-not-in-the-list", 15, 1);
  assert.equal(items.length, 30);
});

test("shows top block + divider + a small window around the user when they're far down the list", () => {
  const items = buildLeaderboardDisplayItems(rows(30), "user-25", 15, 1);

  const topRows = items.slice(0, 15);
  assert.ok(topRows.every((item) => item.type === "row"));
  assert.deepEqual(topRows.map((item) => item.row.rank), Array.from({ length: 15 }, (_, i) => i + 1));

  assert.equal(items[15].type, "divider");

  const windowRows = items.slice(16);
  assert.deepEqual(windowRows.map((item) => item.row.rank), [24, 25, 26]);
  assert.equal(windowRows.find((item) => item.row.rank === 25).isCurrentUser, true);
  assert.equal(windowRows.some((item) => item.isCurrentUser && item.row.rank !== 25), false);
});

test("the user window never duplicates rows already shown in the top block", () => {
  // User at rank 16 (just past the top-15 cutoff): window radius 1 would
  // naively include rank 15, which is already in the top block.
  const items = buildLeaderboardDisplayItems(rows(30), "user-16", 15, 1);
  const windowRows = items.slice(16).filter((item) => item.type === "row");
  assert.deepEqual(windowRows.map((item) => item.row.rank), [16, 17]);
});

test("the window never runs past the end of the list", () => {
  const items = buildLeaderboardDisplayItems(rows(20), "user-20", 15, 2);
  const windowRows = items.slice(16).filter((item) => item.type === "row");
  assert.deepEqual(windowRows.map((item) => item.row.rank), [18, 19, 20]);
});

test("formatRankMovement: improvement shows an up arrow with the delta", () => {
  assert.equal(formatRankMovement(3, 6), "↑ 3");
});

test("formatRankMovement: decline shows a down arrow with the delta", () => {
  assert.equal(formatRankMovement(8, 5), "↓ 3");
});

test("formatRankMovement: no change shows an em dash", () => {
  assert.equal(formatRankMovement(4, 4), "—");
});

test("formatRankMovement: null previous rank shows 'New', never a fabricated number", () => {
  assert.equal(formatRankMovement(10, null), "New");
});

test("getRankMovementTone: improvement is 'up'", () => {
  assert.equal(getRankMovementTone(3, 6), "up");
});

test("getRankMovementTone: decline is 'down'", () => {
  assert.equal(getRankMovementTone(8, 5), "down");
});

test("getRankMovementTone: unchanged rank is 'steady'", () => {
  assert.equal(getRankMovementTone(4, 4), "steady");
});

test("getRankMovementTone: a new entrant is 'steady', never the negative colour", () => {
  assert.equal(getRankMovementTone(10, null), "steady");
});

test("buildParticipantDetailLink routes to /participant/<userId> with a descriptive accessible name", () => {
  const link = buildParticipantDetailLink("user-42", "Jordan Smith");
  assert.equal(link.href, "/participant/user-42");
  assert.match(link.accessibilityLabel, /Jordan Smith/);
  assert.match(link.accessibilityHint, /tip history/i);
});

test("buildParticipantDetailLink is stable/deterministic for the same inputs - the leaderboard row and any other entry point build the identical link", () => {
  const first = buildParticipantDetailLink("user-7", "Alex Rider");
  const second = buildParticipantDetailLink("user-7", "Alex Rider");
  assert.deepEqual(first, second);
});
