const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildJerseyRowDetails,
  buildOfficialTopTenRows,
  buildResultRowScoreBadges,
  buildScoreExplanationLines,
  buildStageResultBadgesForTip,
  buildTopFiveRowDetails,
  extractScoreTopFive,
  jerseyMatchTypeToBadgeTone,
  sortStageRows,
  STAGE_SORT_OPTIONS,
  sumJerseyPoints,
  sumTopFivePoints,
  topFiveMatchTypeToBadgeTone
} = require("../../../dist/mobile-tests/grandtourStageResultsExperience.js");

function officialResultFixture() {
  return {
    riderResults: [
      { actual_position: 1, rider: { id: "r1", display_name: "Tadej Pogačar", bib_number: 1, team: { name: "UAE Team Emirates" } } },
      { actual_position: 2, rider: { id: "r2", display_name: "Richard Carapaz", bib_number: 21, team: { name: "EF Education" } } },
      { actual_position: 3, rider: { id: "r3", display_name: "Primoz Roglic", bib_number: 11, team: { name: "Red Bull" } } },
      { actual_position: 4, rider: { id: "r4", display_name: "Jonas Vingegaard", bib_number: 2, team: { name: "Visma" } } },
      { actual_position: 6, rider: { id: "r6", display_name: "Someone Else", bib_number: 33, team: { name: "Team X" } } }
    ]
  };
}

function riderLookupFixture(id) {
  const table = {
    r1: { name: "Tadej Pogačar", bibNumber: 1, teamName: "UAE Team Emirates" },
    r4: { name: "Jonas Vingegaard", bibNumber: 2, teamName: "Visma" },
    r5: { name: "Remco Evenepoel", bibNumber: 3, teamName: "Soudal" },
    r6: { name: "Someone Else", bibNumber: 33, teamName: "Team X" },
    r9: { name: "Never Finished", bibNumber: 99, teamName: "Team Y" }
  };
  return table[id] ?? null;
}

test("buildOfficialTopTenRows sorts by position and flattens rider/team/bib", () => {
  const rows = buildOfficialTopTenRows(officialResultFixture());
  assert.deepEqual(rows.map((r) => r.position), [1, 2, 3, 4, 6]);
  assert.equal(rows[0].riderName, "Tadej Pogačar");
  assert.equal(rows[0].bibNumber, 1);
  assert.equal(rows[0].teamName, "UAE Team Emirates");
});

test("buildOfficialTopTenRows returns an empty array when there is no official result", () => {
  assert.deepEqual(buildOfficialTopTenRows(null), []);
});

test("buildTopFiveRowDetails always returns exactly 5 rows, positions 1-5, regardless of input size", () => {
  const rows = buildTopFiveRowDetails({
    predictedSelections: [{ position: 1, riderId: "r1" }],
    officialRows: buildOfficialTopTenRows(officialResultFixture()),
    scoreTopFive: null,
    riderLookup: riderLookupFixture
  });
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.map((r) => r.predictedPosition), [1, 2, 3, 4, 5]);
});

test("buildTopFiveRowDetails: exact position match (using score_details) has matchType exact and correct points", () => {
  const rows = buildTopFiveRowDetails({
    predictedSelections: [{ position: 1, riderId: "r1" }],
    officialRows: buildOfficialTopTenRows(officialResultFixture()),
    scoreTopFive: [{ predicted_position: 1, rider_id: "r1", actual_position: 1, points: 10 }],
    riderLookup: riderLookupFixture
  });
  const row = rows.find((r) => r.predictedPosition === 1);
  assert.equal(row.matchType, "exact");
  assert.equal(row.points, 10);
  assert.equal(row.actualPosition, 1);
  assert.equal(row.predictedRiderName, "Tadej Pogačar");
  assert.equal(row.predictedBibNumber, 1);
  assert.equal(row.officialRiderId, "r1");
});

test("buildTopFiveRowDetails: top-5-wrong-position match scores 1 point (via score_details)", () => {
  const rows = buildTopFiveRowDetails({
    predictedSelections: [{ position: 2, riderId: "r4" }],
    officialRows: buildOfficialTopTenRows(officialResultFixture()),
    scoreTopFive: [{ predicted_position: 2, rider_id: "r4", actual_position: 4, points: 1 }],
    riderLookup: riderLookupFixture
  });
  const row = rows.find((r) => r.predictedPosition === 2);
  assert.equal(row.matchType, "top5-wrong-position");
  assert.equal(row.points, 1);
  assert.equal(row.actualPosition, 4);
  assert.equal(row.officialRiderName, "Richard Carapaz", "position 2 was officially filled by Carapaz, a distinct concept from actualPosition");
});

test("buildTopFiveRowDetails: a rider outside the actual top 5 (but in the stored top 10) is a miss worth 0", () => {
  const rows = buildTopFiveRowDetails({
    predictedSelections: [{ position: 3, riderId: "r6" }],
    officialRows: buildOfficialTopTenRows(officialResultFixture()),
    scoreTopFive: [{ predicted_position: 3, rider_id: "r6", actual_position: 6, points: 0 }],
    riderLookup: riderLookupFixture
  });
  const row = rows.find((r) => r.predictedPosition === 3);
  assert.equal(row.matchType, "miss");
  assert.equal(row.points, 0);
  assert.equal(row.actualPosition, 6);
});

test("buildTopFiveRowDetails: a rider absent from the result entirely is a miss with a null actual position", () => {
  const rows = buildTopFiveRowDetails({
    predictedSelections: [{ position: 5, riderId: "r9" }],
    officialRows: buildOfficialTopTenRows(officialResultFixture()),
    scoreTopFive: [{ predicted_position: 5, rider_id: "r9", actual_position: null, points: 0 }],
    riderLookup: riderLookupFixture
  });
  const row = rows.find((r) => r.predictedPosition === 5);
  assert.equal(row.matchType, "miss");
  assert.equal(row.points, 0);
  assert.equal(row.actualPosition, null);
});

test("buildTopFiveRowDetails: an unpicked position is not-picked with null points", () => {
  const rows = buildTopFiveRowDetails({
    predictedSelections: [],
    officialRows: buildOfficialTopTenRows(officialResultFixture()),
    scoreTopFive: null,
    riderLookup: riderLookupFixture
  });
  for (const row of rows) {
    assert.equal(row.matchType, "not-picked");
    assert.equal(row.points, null);
    assert.equal(row.predictedRiderId, null);
  }
});

test("buildTopFiveRowDetails: without score_details (not yet scored), points stay null/pending even for a positionally-exact-looking pick", () => {
  const rows = buildTopFiveRowDetails({
    predictedSelections: [{ position: 1, riderId: "r1" }],
    officialRows: buildOfficialTopTenRows(officialResultFixture()),
    scoreTopFive: null,
    riderLookup: riderLookupFixture
  });
  const row = rows.find((r) => r.predictedPosition === 1);
  assert.equal(row.points, null, "must never show a misleading points value before the stage is actually scored");
  assert.equal(row.matchType, "exact", "the finish itself is still known/derivable from the official result even though it hasn't been scored yet");
});

test("sumTopFivePoints sums only rows with known points, and returns null when any picked row is still pending", () => {
  const scoredRows = buildTopFiveRowDetails({
    predictedSelections: [
      { position: 1, riderId: "r1" }, { position: 2, riderId: "r4" }, { position: 3, riderId: "r6" },
      { position: 4, riderId: "r9" }, { position: 5, riderId: null }
    ],
    officialRows: buildOfficialTopTenRows(officialResultFixture()),
    scoreTopFive: [
      { predicted_position: 1, rider_id: "r1", actual_position: 1, points: 10 },
      { predicted_position: 2, rider_id: "r4", actual_position: 4, points: 1 },
      { predicted_position: 3, rider_id: "r6", actual_position: 6, points: 0 },
      { predicted_position: 4, rider_id: "r9", actual_position: null, points: 0 }
    ],
    riderLookup: riderLookupFixture
  });
  assert.equal(sumTopFivePoints(scoredRows), 11);

  const pendingRows = buildTopFiveRowDetails({
    predictedSelections: [{ position: 1, riderId: "r1" }],
    officialRows: [],
    scoreTopFive: null,
    riderLookup: riderLookupFixture
  });
  assert.equal(sumTopFivePoints(pendingRows), null, "must not report a false total while a picked position is still unscored");
});

test("buildJerseyRowDetails always returns the 4 jerseys in yellow/green/kom/white order", () => {
  const rows = buildJerseyRowDetails({
    predictedJerseys: [{ jerseyType: "white", riderId: "r1" }],
    officialJerseys: [],
    scoreJerseys: null,
    riderLookup: riderLookupFixture
  });
  assert.deepEqual(rows.map((r) => r.jerseyType), ["yellow", "green", "kom", "white"]);
});

test("buildJerseyRowDetails: a correct pick is match with the shared jersey points constant", () => {
  const rows = buildJerseyRowDetails({
    predictedJerseys: [{ jerseyType: "yellow", riderId: "r1" }],
    officialJerseys: [{ jerseyType: "yellow", riderId: "r1" }],
    scoreJerseys: [{ selection_type: "yellow_holder", predicted_rider_id: "r1", actual_rider_id: "r1", pending: false, points: 5 }],
    riderLookup: riderLookupFixture
  });
  const row = rows.find((r) => r.jerseyType === "yellow");
  assert.equal(row.matchType, "match");
  assert.equal(row.points, 5);
  assert.equal(row.actualRiderName, "Tadej Pogačar");
});

test("buildJerseyRowDetails: a wrong pick is miss with 0 points", () => {
  const rows = buildJerseyRowDetails({
    predictedJerseys: [{ jerseyType: "green", riderId: "r4" }],
    officialJerseys: [{ jerseyType: "green", riderId: "r6" }],
    scoreJerseys: [{ selection_type: "green_holder", predicted_rider_id: "r4", actual_rider_id: "r6", pending: false, points: 0 }],
    riderLookup: riderLookupFixture
  });
  const row = rows.find((r) => r.jerseyType === "green");
  assert.equal(row.matchType, "miss");
  assert.equal(row.points, 0);
  assert.equal(row.actualRiderName, "Someone Else");
});

test("buildJerseyRowDetails: no pick is not-picked; an unresolved official holder (pre-scoring) is pending, not a false miss", () => {
  const notPicked = buildJerseyRowDetails({
    predictedJerseys: [],
    officialJerseys: [{ jerseyType: "kom", riderId: "r1" }],
    scoreJerseys: null,
    riderLookup: riderLookupFixture
  });
  assert.equal(notPicked.find((r) => r.jerseyType === "kom").matchType, "not-picked");

  const pending = buildJerseyRowDetails({
    predictedJerseys: [{ jerseyType: "white", riderId: "r1" }],
    officialJerseys: [],
    scoreJerseys: null,
    riderLookup: riderLookupFixture
  });
  const row = pending.find((r) => r.jerseyType === "white");
  assert.equal(row.matchType, "pending");
  assert.equal(row.points, null);
});

test("sumJerseyPoints sums known points and is null while any jersey is still pending", () => {
  const rows = buildJerseyRowDetails({
    predictedJerseys: [{ jerseyType: "yellow", riderId: "r1" }, { jerseyType: "green", riderId: "r4" }],
    officialJerseys: [{ jerseyType: "yellow", riderId: "r1" }, { jerseyType: "green", riderId: "r6" }],
    scoreJerseys: [
      { selection_type: "yellow_holder", predicted_rider_id: "r1", actual_rider_id: "r1", pending: false, points: 5 },
      { selection_type: "green_holder", predicted_rider_id: "r4", actual_rider_id: "r6", pending: false, points: 0 }
    ],
    riderLookup: riderLookupFixture
  });
  assert.equal(sumJerseyPoints(rows), 5);

  const pendingRows = buildJerseyRowDetails({
    predictedJerseys: [{ jerseyType: "kom", riderId: "r1" }],
    officialJerseys: [],
    scoreJerseys: null,
    riderLookup: riderLookupFixture
  });
  assert.equal(sumJerseyPoints(pendingRows), null);
});

test("sortStageRows: newest (default) sorts by stage number descending", () => {
  const rows = [{ stageNumber: 2, totalScore: 5 }, { stageNumber: 5, totalScore: 3 }, { stageNumber: 3, totalScore: 21 }];
  const sorted = sortStageRows(rows, "newest");
  assert.deepEqual(sorted.map((r) => r.stageNumber), [5, 3, 2]);
});

test("sortStageRows: oldest sorts by stage number ascending", () => {
  const rows = [{ stageNumber: 5, totalScore: 3 }, { stageNumber: 2, totalScore: 5 }];
  const sorted = sortStageRows(rows, "oldest");
  assert.deepEqual(sorted.map((r) => r.stageNumber), [2, 5]);
});

test("sortStageRows: highest-score sorts by score descending, treating unscored stages as lowest, tie-broken by stage number", () => {
  const rows = [
    { stageNumber: 2, totalScore: 5 },
    { stageNumber: 5, totalScore: null },
    { stageNumber: 3, totalScore: 21 },
    { stageNumber: 4, totalScore: 21 }
  ];
  const sorted = sortStageRows(rows, "highest-score");
  assert.deepEqual(sorted.map((r) => r.stageNumber), [4, 3, 2, 5]);
});

test("sortStageRows never mutates the input array", () => {
  const rows = [{ stageNumber: 1, totalScore: 1 }, { stageNumber: 2, totalScore: 2 }];
  const originalOrder = rows.map((r) => r.stageNumber);
  sortStageRows(rows, "oldest");
  assert.deepEqual(rows.map((r) => r.stageNumber), originalOrder);
});

test("STAGE_SORT_OPTIONS exposes exactly the three required modes", () => {
  assert.deepEqual(STAGE_SORT_OPTIONS.map((o) => o.key), ["newest", "oldest", "highest-score"]);
});

test("buildScoreExplanationLines reflects the real exported scoring constants, not separately hard-coded numbers", () => {
  // These are @tipping-suite/tipping-core's real EXACT_POSITION_POINTS/
  // TOP_FIVE_WRONG_POSITION_POINTS/STAGE_JERSEY_POINTS values, passed in
  // exactly as the real GrandTourScoreExplanation component does - see
  // packages/tipping-core/src/grandtour-scoring.ts (also covered by
  // packages/tipping-core's own test suite, npm --workspace packages/tipping-core test).
  const lines = buildScoreExplanationLines({
    exactPositionPoints: { 1: 10, 2: 8, 3: 6, 4: 4, 5: 2 },
    topFiveWrongPositionPoints: 1,
    stageJerseyPoints: 5
  });
  assert.ok(lines.some((line) => line.includes("1st = 10 pts")));
  assert.ok(lines.some((line) => line.includes("2nd = 8 pts")));
  assert.ok(lines.some((line) => line.includes("3rd = 6 pts")));
  assert.ok(lines.some((line) => line.includes("4th = 4 pts")));
  assert.ok(lines.some((line) => line.includes("5th = 2 pts")));
  assert.ok(lines.some((line) => line.includes("different position: 1 pt")));
  assert.ok(lines.some((line) => line.includes("5 pts per jersey")));
});

const badgeOfficialRows = [
  { position: 1, entryId: "rider-a" },
  { position: 2, entryId: "rider-b" },
  { position: 3, entryId: "rider-c" },
  { position: 4, entryId: "rider-d" },
  { position: 5, entryId: "rider-e" }
];

test("buildResultRowScoreBadges: exact pick is green with server points when scored", () => {
  const badges = buildResultRowScoreBadges({
    officialRows: badgeOfficialRows,
    predictedSelections: [{ predictedPosition: 1, entryId: "rider-a" }],
    scoreTopFive: [{ predicted_position: 1, points: 10 }]
  });
  assert.deepEqual(badges[0], { position: 1, entryId: "rider-a", tone: "exact", label: "+10" });
});

test("buildResultRowScoreBadges: right entrant wrong position is a blue partial badge", () => {
  const badges = buildResultRowScoreBadges({
    officialRows: badgeOfficialRows,
    predictedSelections: [{ predictedPosition: 4, entryId: "rider-b" }],
    scoreTopFive: [{ predicted_position: 4, points: 1 }]
  });
  assert.deepEqual(badges[1], { position: 2, entryId: "rider-b", tone: "partial", label: "+1" });
});

test("buildResultRowScoreBadges: unpicked rows are neutral with an en dash", () => {
  const badges = buildResultRowScoreBadges({
    officialRows: badgeOfficialRows,
    predictedSelections: [{ predictedPosition: 1, entryId: "rider-a" }],
    scoreTopFive: null
  });
  assert.deepEqual(badges[4], { position: 5, entryId: "rider-e", tone: "none", label: "–" });
});

test("buildResultRowScoreBadges: matched rows before scoring show a tick, never a fabricated number", () => {
  const badges = buildResultRowScoreBadges({
    officialRows: badgeOfficialRows,
    predictedSelections: [
      { predictedPosition: 1, entryId: "rider-a" },
      { predictedPosition: 2, entryId: "rider-e" }
    ],
    scoreTopFive: null
  });
  assert.deepEqual(badges[0], { position: 1, entryId: "rider-a", tone: "exact", label: "✓" });
  assert.deepEqual(badges[4], { position: 5, entryId: "rider-e", tone: "partial", label: "✓" });
});

test("buildResultRowScoreBadges: a tied official position (two entrants sharing actual_position) still badges each entrant independently by entryId, never sharing one badge", () => {
  const tiedOfficialRows = [
    { position: 1, entryId: "rider-a" },
    { position: 1, entryId: "rider-b" },
    { position: 3, entryId: "rider-c" }
  ];
  const badges = buildResultRowScoreBadges({
    officialRows: tiedOfficialRows,
    predictedSelections: [{ predictedPosition: 1, entryId: "rider-b" }],
    scoreTopFive: [{ predicted_position: 1, points: 10 }]
  });
  const riderABadge = badges.find((badge) => badge.entryId === "rider-a");
  const riderBBadge = badges.find((badge) => badge.entryId === "rider-b");
  assert.equal(riderABadge.tone, "none");
  assert.equal(riderABadge.label, "–");
  assert.equal(riderBBadge.tone, "exact");
  assert.equal(riderBBadge.label, "+10");
});

test("buildResultRowScoreBadges: no tip at all yields all-neutral badges", () => {
  const badges = buildResultRowScoreBadges({
    officialRows: badgeOfficialRows,
    predictedSelections: [],
    scoreTopFive: null
  });
  assert.equal(badges.length, 5);
  assert.ok(badges.every((badge) => badge.tone === "none" && badge.label === "–"));
});

test("extractScoreTopFive returns null for an unscored or non-existent tip, never a fabricated array", () => {
  assert.equal(extractScoreTopFive(null), null);
  assert.equal(extractScoreTopFive({ status: "submitted", score: null, selections: [] }), null);
  assert.equal(extractScoreTopFive({ status: "scored", score: null, selections: [] }), null);
});

test("extractScoreTopFive reads the server-computed top_five off a scored tip's score_details", () => {
  const rows = extractScoreTopFive({
    status: "scored",
    score: { score_details: { top_five: [{ predicted_position: 1, points: 10 }] } },
    selections: []
  });
  assert.deepEqual(rows, [{ predicted_position: 1, points: 10 }]);
});

test("buildStageResultBadgesForTip returns null when the tip never counted (draft/missing)", () => {
  assert.equal(buildStageResultBadgesForTip({ result: officialResultFixture(), isTtt: false, tip: null }), null);
  assert.equal(
    buildStageResultBadgesForTip({
      result: officialResultFixture(),
      isTtt: false,
      tip: { status: "draft", score: null, selections: [] }
    }),
    null
  );
});

test("buildStageResultBadgesForTip badges a submitted (not yet scored) tip's exact pick with a checkmark, not a fabricated number", () => {
  const badges = buildStageResultBadgesForTip({
    result: officialResultFixture(),
    isTtt: false,
    tip: {
      status: "submitted",
      score: null,
      selections: [{ selection_type: "stage_top_5", rider_id: "r1", team_id: null, predicted_position: 1 }]
    }
  });
  const exactRow = badges.find((badge) => badge.position === 1);
  assert.equal(exactRow.tone, "exact");
  assert.equal(exactRow.label, "✓");
});

test("buildStageResultBadgesForTip reads real points off a scored tip, never recomputing them", () => {
  const badges = buildStageResultBadgesForTip({
    result: officialResultFixture(),
    isTtt: false,
    tip: {
      status: "scored",
      score: { score_details: { top_five: [{ predicted_position: 1, points: 10 }] } },
      selections: [{ selection_type: "stage_top_5", rider_id: "r1", team_id: null, predicted_position: 1 }]
    }
  });
  const exactRow = badges.find((badge) => badge.position === 1);
  assert.equal(exactRow.tone, "exact");
  assert.equal(exactRow.label, "+10");
});

test("topFiveMatchTypeToBadgeTone maps onto the shared 3-tone system - blue for wrong position, never amber", () => {
  assert.equal(topFiveMatchTypeToBadgeTone("exact"), "exact");
  assert.equal(topFiveMatchTypeToBadgeTone("top5-wrong-position"), "partial");
  assert.equal(topFiveMatchTypeToBadgeTone("miss"), "none");
  assert.equal(topFiveMatchTypeToBadgeTone("not-picked"), "none");
});

test("jerseyMatchTypeToBadgeTone maps onto the shared tone system - neutral for a miss, never red", () => {
  assert.equal(jerseyMatchTypeToBadgeTone("match"), "exact");
  assert.equal(jerseyMatchTypeToBadgeTone("miss"), "none");
  assert.equal(jerseyMatchTypeToBadgeTone("not-picked"), "none");
  assert.equal(jerseyMatchTypeToBadgeTone("pending"), "pending");
});
