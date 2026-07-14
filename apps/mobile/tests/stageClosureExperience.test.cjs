const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildClosureDisplay,
  buildCompoundStatusLine,
  buildHistoryStatCardLink,
  buildJerseyDashboardCardLink,
  buildLeaderboardDashboardCardLink,
  buildRankStatCardLink,
  buildSelectionProgressLabel,
  buildStageDashboardCardLink
} = require("../../../dist/mobile-tests/stageClosureExperience.js");

const NOW = new Date("2026-07-13T12:00:00.000Z");

test("open state (far from lock) shows the formatted closing date/time as the primary label, no emphasis, editable", () => {
  const display = buildClosureDisplay({
    state: "open",
    locksAt: "2026-07-16T10:00:00Z",
    now: NOW,
    formattedLockDateTime: "Thu 16 Jul, 10:00 am"
  });
  assert.equal(display.badgeLabel, "Open");
  assert.equal(display.primaryLabel, "Closes Thu 16 Jul, 10:00 am");
  assert.equal(display.emphasis, false);
  assert.equal(display.editable, true);
  assert.equal(display.showLockIcon, false);
});

test("closing_soon (>60m remaining) shows a duration, not a raw timestamp, no high emphasis", () => {
  const display = buildClosureDisplay({
    state: "closing_soon",
    locksAt: "2026-07-13T17:30:00Z", // 5.5h after NOW
    now: NOW,
    formattedLockDateTime: "irrelevant"
  });
  assert.equal(display.badgeLabel, "Closing soon");
  assert.equal(display.primaryLabel, "Closes in 5h 30m");
  assert.equal(display.emphasis, false);
  assert.equal(display.editable, true);
});

test("closing_soon under 60m is high-emphasis and shows minutes only", () => {
  const display = buildClosureDisplay({
    state: "closing_soon",
    locksAt: "2026-07-13T12:45:00Z", // 45m after NOW
    now: NOW,
    formattedLockDateTime: "irrelevant"
  });
  assert.equal(display.primaryLabel, "Closes in 45m");
  assert.equal(display.emphasis, true);
});

test("closing_soon never shows a negative countdown even with a slightly-past locksAt (defensive clamp)", () => {
  const display = buildClosureDisplay({
    state: "closing_soon",
    locksAt: "2026-07-13T11:59:59.000Z", // 1s before NOW - state is still passed in as closing_soon defensively
    now: NOW,
    formattedLockDateTime: "irrelevant"
  });
  assert.equal(display.primaryLabel, "Closes in 0m");
  assert.ok(!/-/.test(display.primaryLabel), "must never render a negative duration");
});

test("closed state shows exactly 'Closed', never a stale timestamp, disables editing, shows the lock icon", () => {
  const display = buildClosureDisplay({
    state: "closed",
    locksAt: "2026-07-13T09:00:00Z",
    now: NOW,
    formattedLockDateTime: "Mon 13 Jul, 9:00 am"
  });
  assert.equal(display.primaryLabel, "Closed");
  assert.ok(!display.primaryLabel.includes("Closes"), "must never show 'Closes <expired time>' once locked");
  assert.equal(display.editable, false);
  assert.equal(display.ctaLabel, "View tips");
  assert.equal(display.showLockIcon, true);
});

test("live state shows 'Live', not a stale closure time, and disables editing", () => {
  const display = buildClosureDisplay({
    state: "live",
    locksAt: "2026-07-13T09:00:00Z",
    now: NOW,
    formattedLockDateTime: "Mon 13 Jul, 9:00 am"
  });
  assert.equal(display.primaryLabel, "Live");
  assert.equal(display.emphasis, true);
  assert.equal(display.editable, false);
  assert.equal(display.ctaLabel, "View stage");
});

test("completed state shows 'Completed' and disables editing", () => {
  const display = buildClosureDisplay({
    state: "completed",
    locksAt: "2026-07-10T09:00:00Z",
    now: NOW,
    formattedLockDateTime: "irrelevant"
  });
  assert.equal(display.primaryLabel, "Completed");
  assert.equal(display.editable, false);
  assert.equal(display.ctaLabel, "View result");
});

test("locked cards never expose an edit-tip CTA: closed/live/completed all have editable=false, only open/closing_soon are editable", () => {
  for (const state of ["closed", "live", "completed"]) {
    const display = buildClosureDisplay({ state, locksAt: null, now: NOW, formattedLockDateTime: "x" });
    assert.equal(display.editable, false, `${state} must not be editable`);
  }
  for (const state of ["open", "closing_soon"]) {
    const display = buildClosureDisplay({ state, locksAt: "2026-08-01T00:00:00Z", now: NOW, formattedLockDateTime: "x" });
    assert.equal(display.editable, true, `${state} must be editable`);
  }
});

test("CTA label reflects draft/submitted state only while editable", () => {
  const fresh = buildClosureDisplay({ state: "open", locksAt: "2026-08-01T00:00:00Z", now: NOW, formattedLockDateTime: "x" });
  assert.equal(fresh.ctaLabel, "Enter tips");

  const draft = buildClosureDisplay({ state: "open", locksAt: "2026-08-01T00:00:00Z", now: NOW, formattedLockDateTime: "x", hasDraftInProgress: true });
  assert.equal(draft.ctaLabel, "Continue draft");

  const submitted = buildClosureDisplay({ state: "open", locksAt: "2026-08-01T00:00:00Z", now: NOW, formattedLockDateTime: "x", hasSubmittedTip: true });
  assert.equal(submitted.ctaLabel, "Edit tips");
});

test("buildSelectionProgressLabel formats and clamps to the total", () => {
  assert.equal(buildSelectionProgressLabel(5), "5 of 5 selections completed");
  assert.equal(buildSelectionProgressLabel(2), "2 of 5 selections completed");
  assert.equal(buildSelectionProgressLabel(0), "0 of 5 selections completed");
  assert.equal(buildSelectionProgressLabel(-1), "0 of 5 selections completed");
  assert.equal(buildSelectionProgressLabel(9), "5 of 5 selections completed");
});

test("buildStageDashboardCardLink builds the stage detail route and a descriptive accessibility label/hint", () => {
  const link = buildStageDashboardCardLink({
    stageId: "stage-5",
    stageNumber: 5,
    startLocation: "Pau",
    finishLocation: "Gavarnie",
    statusLabel: "Open",
    ctaLabel: "Enter tips"
  });
  assert.equal(link.href, "/stages/stage-5");
  assert.equal(link.accessibilityLabel, "Stage 5, Pau to Gavarnie, Open");
  assert.equal(link.accessibilityHint, "Double tap to enter tips");
});

test("buildStageDashboardCardLink falls back to TBC for missing locations", () => {
  const link = buildStageDashboardCardLink({
    stageId: "stage-9",
    stageNumber: 9,
    startLocation: null,
    finishLocation: null,
    statusLabel: "Closed",
    ctaLabel: "View tips"
  });
  assert.match(link.accessibilityLabel, /TBC to TBC/);
});

test("buildLeaderboardDashboardCardLink routes to /leaderboard", () => {
  assert.equal(buildLeaderboardDashboardCardLink("GrandTour Overall").href, "/leaderboard");
  assert.equal(buildLeaderboardDashboardCardLink(null).accessibilityLabel, "Leaderboard");
});

test("buildRankStatCardLink and buildHistoryStatCardLink route correctly", () => {
  assert.equal(buildRankStatCardLink().href, "/leaderboard");
  assert.equal(buildHistoryStatCardLink().href, "/my-tips");
});

test("buildJerseyDashboardCardLink routes to /overall-jerseys", () => {
  const link = buildJerseyDashboardCardLink("Yellow");
  assert.equal(link.href, "/overall-jerseys");
  assert.equal(link.accessibilityLabel, "Yellow jersey standings");
});

test("buildCompoundStatusLine: open with selections shows 'N of 5 complete'", () => {
  assert.equal(
    buildCompoundStatusLine({ badgeLabel: "Open", state: "open", selectedCount: 3 }),
    "Open · 3 of 5 complete"
  );
});

test("buildCompoundStatusLine: open with zero selections shows 'Action required'", () => {
  assert.equal(
    buildCompoundStatusLine({ badgeLabel: "Open", state: "open", selectedCount: 0 }),
    "Open · Action required"
  );
});

test("buildCompoundStatusLine: open/closing_soon with a submitted tip shows 'Tips submitted' regardless of count", () => {
  assert.equal(
    buildCompoundStatusLine({ badgeLabel: "Closing soon", state: "closing_soon", selectedCount: 5, hasSubmittedTip: true }),
    "Closing soon · Tips submitted"
  );
});

test("buildCompoundStatusLine: closed shows submitted or no-tip", () => {
  assert.equal(
    buildCompoundStatusLine({ badgeLabel: "Closed", state: "closed", hasSubmittedTip: true }),
    "Closed · Tips submitted"
  );
  assert.equal(
    buildCompoundStatusLine({ badgeLabel: "Closed", state: "closed", hasSubmittedTip: false }),
    "Closed · No tip"
  );
});

test("buildCompoundStatusLine: live shows locked-tip state", () => {
  assert.equal(
    buildCompoundStatusLine({ badgeLabel: "Live", state: "live", hasAnyTip: true }),
    "Live · Tips locked"
  );
  assert.equal(
    buildCompoundStatusLine({ badgeLabel: "Live", state: "live", hasAnyTip: false }),
    "Live · No tip"
  );
});

test("buildCompoundStatusLine: completed shows points when known, otherwise just the badge", () => {
  assert.equal(
    buildCompoundStatusLine({ badgeLabel: "Completed", state: "completed", points: 18 }),
    "Completed · 18 points"
  );
  assert.equal(
    buildCompoundStatusLine({ badgeLabel: "Completed", state: "completed", points: null }),
    "Completed"
  );
});
