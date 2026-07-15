import assert from "node:assert/strict";
import test from "node:test";

import { buildSubject, renderStageResultsEmail, type StageResultsEmailData } from "./render-stage-results.ts";

function baseData(overrides: Partial<StageResultsEmailData> = {}): StageResultsEmailData {
  return {
    eventName: "GrandTour Tips",
    stageNumber: 11,
    stageName: "Toulouse - Bagnères-de-Bigorre",
    stageDateLabel: "Wed 15 Jul",
    displayName: "Jordan",
    stageScore: 18,
    totalScore: 142,
    currentRank: 3,
    previousRank: 10,
    participantCount: 48,
    topFive: [
      { predictedPosition: 1, riderName: "Rider A", actualPositionLabel: "1st", points: 10, badge: "exact" },
      { predictedPosition: 2, riderName: "Rider B", actualPositionLabel: "4th", points: 2, badge: "partial" },
      { predictedPosition: 3, riderName: "Rider C", actualPositionLabel: "Outside top 5", points: 0, badge: "miss" },
      { predictedPosition: 4, riderName: null, actualPositionLabel: "—", points: null, badge: "not-picked" },
      { predictedPosition: 5, riderName: "Rider E", actualPositionLabel: "5th", points: 10, badge: "exact" },
    ],
    actualTopFive: [
      { position: 1, riderName: "Rider A" },
      { position: 2, riderName: "Rider X" },
    ],
    leaderboard: [
      { rank: 1, displayName: "Alex", totalScore: 200, isCurrentUser: false },
      { rank: 3, displayName: "Jordan", totalScore: 142, isCurrentUser: true },
      { rank: 4, displayName: "Sam", totalScore: 130, isCurrentUser: false },
    ],
    scoreGapToNext: 12,
    nextStage: { isOpen: true, stageId: "stage-12-uuid", stageNumber: 12 },
    appPublicUrl: "https://grandtour-three.vercel.app",
    supportEmail: "support@example.com",
    ...overrides,
  };
}

test("buildSubject includes movement clause when rank improved", () => {
  const subject = buildSubject({ stageNumber: 11, stageScore: 18, currentRank: 3, previousRank: 10 });
  assert.equal(subject, "Stage 11 results: You scored 18 points and moved up 7 places");
});

test("buildSubject omits movement clause when rank is unchanged", () => {
  const subject = buildSubject({ stageNumber: 11, stageScore: 18, currentRank: 3, previousRank: 3 });
  assert.equal(subject, "Stage 11 results: You scored 18 points");
});

test("buildSubject omits movement clause when previous rank is unknown (never fabricates zero movement)", () => {
  const subject = buildSubject({ stageNumber: 11, stageScore: 18, currentRank: 3, previousRank: null });
  assert.equal(subject, "Stage 11 results: You scored 18 points");
});

test("buildSubject singular point wording", () => {
  const subject = buildSubject({ stageNumber: 11, stageScore: 1, currentRank: 3, previousRank: 3 });
  assert.equal(subject, "Stage 11 results: You scored 1 point");
});

test("renderStageResultsEmail escapes HTML characters in display names and rider names", () => {
  const data = baseData({
    displayName: `<b>Jordan</b>`,
    topFive: [
      { predictedPosition: 1, riderName: `Rider "<script>"`, actualPositionLabel: "1st", points: 10, badge: "exact" },
    ] as StageResultsEmailData["topFive"],
  });
  const rendered = renderStageResultsEmail(data);
  assert.ok(!rendered.html.includes("<b>Jordan</b>"));
  assert.ok(rendered.html.includes("&lt;b&gt;Jordan&lt;/b&gt;"));
  assert.ok(!rendered.html.includes(`<script>`));
  assert.ok(rendered.html.includes("&lt;script&gt;"));
});

test("renderStageResultsEmail: correct-position badge renders 'exact' tone/label", () => {
  const rendered = renderStageResultsEmail(baseData());
  assert.ok(rendered.html.includes("Exact"));
});

test("renderStageResultsEmail: top-five-wrong-position badge renders 'partial'/'Top 5' label", () => {
  const rendered = renderStageResultsEmail(baseData());
  assert.ok(rendered.html.includes("Top 5"));
});

test("renderStageResultsEmail: missed tip renders 'Miss' label", () => {
  const rendered = renderStageResultsEmail(baseData());
  assert.ok(rendered.html.includes("Miss"));
});

test("renderStageResultsEmail: not-picked slot shows 'Not picked' and a neutral badge", () => {
  const rendered = renderStageResultsEmail(baseData());
  assert.ok(rendered.text.includes("Not picked"));
});

test("renderStageResultsEmail: unknown previous rank shows NEW, not a fabricated number", () => {
  const rendered = renderStageResultsEmail(baseData({ previousRank: null }));
  assert.ok(rendered.html.includes(">NEW<") || rendered.text.includes("Movement: NEW"));
});

test("renderStageResultsEmail: missing leaderboard data is omitted, not rendered as empty/broken", () => {
  const rendered = renderStageResultsEmail(baseData({ leaderboard: null }));
  assert.ok(!rendered.html.includes("<h2 class=\"email-ink\" style=\"font-size:15px;color:#1a1a1a;margin:0 0 8px 0;\">Leaderboard</h2>"));
});

test("renderStageResultsEmail: open next stage renders a 'Tip Stage N' CTA deep link", () => {
  const rendered = renderStageResultsEmail(baseData({ nextStage: { isOpen: true, stageId: "abc-123", stageNumber: 12 } }));
  assert.ok(rendered.html.includes("Tip Stage 12"));
  assert.ok(rendered.html.includes("https://grandtour-three.vercel.app/stages/abc-123"));
});

test("renderStageResultsEmail: missing/closed next stage falls back to 'View Full Results'", () => {
  const rendered = renderStageResultsEmail(baseData({ nextStage: null }));
  assert.ok(rendered.html.includes("View Full Results"));
  assert.ok(rendered.html.includes("https://grandtour-three.vercel.app/results"));
});

test("renderStageResultsEmail: not-yet-open next stage also falls back to 'View Full Results'", () => {
  const rendered = renderStageResultsEmail(baseData({ nextStage: { isOpen: false, stageId: "abc-123", stageNumber: 12 } }));
  assert.ok(rendered.html.includes("View Full Results"));
});

test("renderStageResultsEmail: footer includes preferences link and no promotional copy", () => {
  const rendered = renderStageResultsEmail(baseData());
  assert.ok(rendered.html.includes("/profile"));
  assert.ok(rendered.html.includes("Manage notification preferences"));
  assert.ok(!/unsubscribe from all|special offer|% off|promo/i.test(rendered.html));
});

test("renderStageResultsEmail: preheader matches the standard copy", () => {
  const rendered = renderStageResultsEmail(baseData());
  assert.equal(rendered.preheader, "See your tips, points, overall position and the next stage.");
});

test("renderStageResultsEmail: text alternative is non-empty and includes the subject-relevant score", () => {
  const rendered = renderStageResultsEmail(baseData());
  assert.ok(rendered.text.includes("Stage score: 18"));
  assert.ok(rendered.text.includes("Total score: 142"));
  assert.ok(rendered.text.length > 0);
});
