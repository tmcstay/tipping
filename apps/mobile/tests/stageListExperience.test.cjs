const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildFutureStagesToggleLabel,
  buildStageListSections,
  selectStartedStagesDescending
} = require("../../../dist/mobile-tests/stageListExperience.js");

const now = new Date("2026-07-10T12:00:00Z");

function stage(stageNumber, startsAt) {
  return { stageNumber, startsAt };
}

test("started stages are shown latest-first with the next upcoming stage on top", () => {
  const sections = buildStageListSections(
    [
      stage(1, "2026-07-04T10:00:00Z"),
      stage(2, "2026-07-05T10:00:00Z"),
      stage(3, "2026-07-06T10:00:00Z"),
      stage(4, "2026-07-11T10:00:00Z"),
      stage(5, "2026-07-12T10:00:00Z"),
      stage(6, "2026-07-13T10:00:00Z")
    ],
    now
  );
  assert.deepEqual(
    sections.current.map((entry) => entry.stageNumber),
    [4, 3, 2, 1]
  );
  assert.deepEqual(
    sections.future.map((entry) => entry.stageNumber),
    [5, 6]
  );
});

test("a stage starting exactly now counts as started, not future", () => {
  const sections = buildStageListSections(
    [stage(1, "2026-07-10T12:00:00Z"), stage(2, "2026-07-11T10:00:00Z")],
    now
  );
  assert.deepEqual(
    sections.current.map((entry) => entry.stageNumber),
    [2, 1]
  );
  assert.deepEqual(sections.future, []);
});

test("all-future race shows only the next stage by default", () => {
  const sections = buildStageListSections(
    [
      stage(3, "2026-08-03T10:00:00Z"),
      stage(1, "2026-08-01T10:00:00Z"),
      stage(2, "2026-08-02T10:00:00Z")
    ],
    now
  );
  assert.deepEqual(
    sections.current.map((entry) => entry.stageNumber),
    [1]
  );
  assert.deepEqual(
    sections.future.map((entry) => entry.stageNumber),
    [2, 3]
  );
});

test("all-past race has an empty future section", () => {
  const sections = buildStageListSections(
    [stage(1, "2026-07-04T10:00:00Z"), stage(2, "2026-07-05T10:00:00Z")],
    now
  );
  assert.deepEqual(
    sections.current.map((entry) => entry.stageNumber),
    [2, 1]
  );
  assert.deepEqual(sections.future, []);
});

test("empty input produces two empty sections", () => {
  const sections = buildStageListSections([], now);
  assert.deepEqual(sections.current, []);
  assert.deepEqual(sections.future, []);
});

test("a null/invalid start date is treated as future and sorts after dated future stages", () => {
  const sections = buildStageListSections(
    [
      stage(1, "2026-07-04T10:00:00Z"),
      stage(2, null),
      stage(3, "not a date"),
      stage(4, "2026-07-11T10:00:00Z"),
      stage(5, "2026-07-12T10:00:00Z")
    ],
    now
  );
  // Stage 4 is the next dated upcoming stage; undated stages never win the
  // "next stage" slot ahead of a genuinely dated one.
  assert.deepEqual(
    sections.current.map((entry) => entry.stageNumber),
    [4, 1]
  );
  assert.deepEqual(
    sections.future.map((entry) => entry.stageNumber),
    [5, 2, 3]
  );
});

test("identical start times fall back to stage number deterministically", () => {
  const sections = buildStageListSections(
    [
      stage(2, "2026-07-05T10:00:00Z"),
      stage(1, "2026-07-05T10:00:00Z"),
      stage(4, "2026-08-01T10:00:00Z"),
      stage(3, "2026-08-01T10:00:00Z")
    ],
    now
  );
  // Started ties: latest-first list falls back to higher stage number first.
  assert.deepEqual(
    sections.current.map((entry) => entry.stageNumber),
    [3, 2, 1]
  );
  assert.deepEqual(
    sections.future.map((entry) => entry.stageNumber),
    [4]
  );
});

test("toggle label states", () => {
  assert.equal(buildFutureStagesToggleLabel(false, 7), "Show future stages (7)");
  assert.equal(buildFutureStagesToggleLabel(true, 7), "Hide future stages");
});

test("selectStartedStagesDescending: excludes every not-yet-started stage outright - no 'next upcoming' exception, unlike buildStageListSections", () => {
  const rows = selectStartedStagesDescending(
    [
      stage(1, "2026-07-04T10:00:00Z"),
      stage(2, "2026-07-05T10:00:00Z"),
      stage(3, "2026-07-11T10:00:00Z"), // future - after `now`
      stage(4, "2026-07-20T10:00:00Z") // further future
    ],
    now
  );
  assert.deepEqual(rows.map((row) => row.stageNumber), [2, 1]);
});

test("selectStartedStagesDescending: orders newest (most recently started) first", () => {
  const rows = selectStartedStagesDescending(
    [stage(1, "2026-07-01T10:00:00Z"), stage(2, "2026-07-08T10:00:00Z"), stage(3, "2026-07-03T10:00:00Z")],
    now
  );
  assert.deepEqual(rows.map((row) => row.stageNumber), [2, 3, 1]);
});

test("selectStartedStagesDescending: a stage starting exactly now counts as started", () => {
  const rows = selectStartedStagesDescending([stage(1, now.toISOString())], now);
  assert.deepEqual(rows.map((row) => row.stageNumber), [1]);
});

test("selectStartedStagesDescending: an undated stage is excluded (fails closed), never assumed started", () => {
  const rows = selectStartedStagesDescending(
    [stage(1, "2026-07-01T10:00:00Z"), stage(2, null)],
    now
  );
  assert.deepEqual(rows.map((row) => row.stageNumber), [1]);
});

test("selectStartedStagesDescending: an empty list produces an empty result", () => {
  assert.deepEqual(selectStartedStagesDescending([], now), []);
});
