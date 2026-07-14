import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  buildFeedReview,
  buildSkippedStageReport,
  parseFeedArgs,
  validateFeedPayload,
  LETOUR_FETCH_USER_AGENT,
  LETOUR_CLASSIFICATION_JERSEY_MAP,
  ManualJsonGrandTourFeedProvider,
  OfficialLetourGrandTourFeedProvider,
  extractGeneralClassificationAjaxUrls,
  fetchLetourJerseyHolders,
  parseLetourClassificationLeader,
  parseLetourElapsedTime,
  parseLetourRankingStageRows
} from "./grandtour-feed-provider.mjs";

const FIXTURES_DIR = path.resolve("test", "fixtures", "letour");

async function readFixture(name) {
  return fs.readFile(path.join(FIXTURES_DIR, name), "utf8");
}

test("dry-run feed import reports unmatched riders without mutating tables", () => {
  const review = buildFeedReview({
    mode: "dry-run",
    payload: {
      source_name: "manual-test",
      rider_statuses: [{ rider_name: "Unknown Rider", status: "withdrawn" }]
    }
  });

  assert.equal(review.summary.unmatchedRiders, 1);
  assert.equal(review.note.includes("does not mutate"), true);
});

test("rider status feed reports changed active/withdrawn states", () => {
  const review = buildFeedReview({
    mode: "dry-run",
    payload: {
      rider_statuses: [
        { rider_id: "r1", status: "active" },
        { rider_id: "r2", status: "withdrawn" }
      ]
    }
  });

  assert.equal(review.summary.changedRiderStatuses, 1);
});

test("stage result feed separates normal rider results from TTT team results", () => {
  const review = buildFeedReview({
    mode: "dry-run",
    payload: {
      stage_results: [{ stage_number: 2, type: "road", riders: [{ rider_id: "r1", position: 1 }] }],
      ttt_results: [{ stage_number: 1, type: "ttt", teams: [{ team_id: "t1", position: 1 }] }]
    }
  });

  assert.equal(review.summary.stageResultCandidates, 1);
  assert.equal(review.summary.tttResultCandidates, 1);
  assert.deepEqual(review.validationErrors, []);
});

test("feed validation rejects TTT rider placings", () => {
  assert.deepEqual(
    validateFeedPayload({ ttt_results: [{ stage_number: 1, type: "ttt", riders: [{ rider_id: "r1" }] }] }),
    ["TTT stage result must use teams, not rider placings."]
  );
});

test("import review includes source, fetched_at and validation outcome", () => {
  const review = buildFeedReview({
    mode: "dry-run",
    payload: {
      source_name: "manual-test",
      source_url: "https://example.test/feed.json",
      fetched_at: "2026-07-07T00:00:00.000Z"
    }
  });

  assert.equal(review.provider, "manual-test");
  assert.equal(review.sourceUrl, "https://example.test/feed.json");
  assert.equal(review.fetchedAt, "2026-07-07T00:00:00.000Z");
  assert.equal(review.importStatus, "validated");
});

test("dry-run with sample source file produces non-zero candidates", async () => {
  const samplePath = path.resolve("data", "feeds", "tdf-2026", "sample-stage-result.json");
  const provider = new ManualJsonGrandTourFeedProvider({ sourceFile: samplePath });
  const payload = await provider.readPayload();
  const review = buildFeedReview({ mode: "dry-run", payload });

  assert.equal(review.summary.stageResultCandidates, 1);
  assert.equal(review.summary.tttResultCandidates, 1);
  assert.equal(review.summary.changedRiderStatuses, 1);
  assert.deepEqual(review.validationErrors, []);
});

test("backfill source file parses multiple stages and reports range metadata", async () => {
  const samplePath = path.resolve("data", "feeds", "tdf-2026", "sample-backfill-stages-1-3.json");
  const provider = new ManualJsonGrandTourFeedProvider({ sourceFile: samplePath });
  const payload = await provider.readPayload();
  const review = buildFeedReview({
    mode: "dry-run",
    payload,
    options: { backfill: true, fromStage: 1, toStage: 3 }
  });

  assert.equal(review.importType, "backfill");
  assert.equal(review.fromStage, 1);
  assert.equal(review.toStage, 3);
  assert.deepEqual(review.summary.stagesConsidered, [1, 2, 3]);
  assert.deepEqual(review.summary.stagesWithResults.sort(), [1, 2, 3]);
  assert.equal(review.summary.stageResultCandidates, 2);
  assert.equal(review.summary.tttResultCandidates, 1);
  assert.equal(review.summary.changedRiderStatuses, 1);
  assert.equal(review.summary.candidateJerseyHolderRows, 3);
  assert.equal(review.summary.candidateRiderStatusChanges, 1);
  assert.deepEqual(review.validationErrors, []);
});

test("parseFeedArgs supports --import-type backfill with stage range", () => {
  const options = parseFeedArgs(["--import-type", "backfill", "--from-stage", "1", "--to-stage", "3"]);

  assert.equal(options.importType, "backfill");
  assert.equal(options.backfill, true);
  assert.equal(options.fromStage, 1);
  assert.equal(options.toStage, 3);
});

test("parseFeedArgs: --apply without --from-report is rejected", () => {
  assert.throws(
    () => parseFeedArgs(["--apply", "--provider", "official-letour", "--confirm-provider", "official-letour", "--confirm-stage", "2"]),
    /--from-report/
  );
});

test("parseFeedArgs: --apply without --confirm-provider is rejected", () => {
  assert.throws(
    () => parseFeedArgs(["--apply", "--provider", "official-letour", "--from-report", "report.json", "--confirm-stage", "2"]),
    /--confirm-provider/
  );
});

test("parseFeedArgs: --apply with a --confirm-provider that isn't official-letour is rejected", () => {
  assert.throws(
    () => parseFeedArgs(["--apply", "--provider", "official-letour", "--from-report", "report.json", "--confirm-provider", "manual-json", "--confirm-stage", "2"]),
    /"official-letour"/
  );
});

test("parseFeedArgs: --apply without --confirm-stage is rejected", () => {
  assert.throws(
    () => parseFeedArgs(["--apply", "--provider", "official-letour", "--from-report", "report.json", "--confirm-provider", "official-letour"]),
    /--confirm-stage/
  );
});

test("parseFeedArgs: --apply with --provider other than official-letour is rejected", () => {
  assert.throws(
    () => parseFeedArgs(["--apply", "--provider", "manual-json", "--from-report", "report.json", "--confirm-provider", "official-letour", "--confirm-stage", "2"]),
    /--provider official-letour/
  );
});

test("parseFeedArgs: --apply combined with --reconcile is rejected", () => {
  assert.throws(
    () => parseFeedArgs(["--apply", "--reconcile", "--provider", "official-letour", "--from-report", "report.json", "--confirm-provider", "official-letour", "--confirm-stage", "2"]),
    /cannot be combined with --reconcile/
  );
});

test("parseFeedArgs: --apply with a mismatched --from-stage/--to-stage is rejected", () => {
  assert.throws(
    () => parseFeedArgs(["--apply", "--provider", "official-letour", "--from-report", "report.json", "--confirm-provider", "official-letour", "--confirm-stage", "2", "--from-stage", "3", "--to-stage", "3"]),
    /must equal --confirm-stage/
  );
});

test("parseFeedArgs: a fully valid --apply invocation parses cleanly", () => {
  const options = parseFeedArgs([
    "--apply", "--provider", "official-letour", "--from-report", "report.json",
    "--confirm-provider", "official-letour", "--confirm-stage", "2",
    "--reason", "manual correction", "--request-id", "req-123"
  ]);
  assert.equal(options.apply, true);
  assert.match(options.fromReportPath, /report\.json$/);
  assert.equal(options.confirmProvider, "official-letour");
  assert.equal(options.confirmStage, 2);
  assert.equal(options.reason, "manual correction");
  assert.equal(options.requestId, "req-123");
});

test("official letour provider rejects stage range requirement", async () => {
  let thrown = null;
  try {
    const provider = new OfficialLetourGrandTourFeedProvider({ fromStage: null, toStage: null, allCompleted: false });
    await provider.readPayload();
  } catch (error) {
    thrown = error;
  }

  assert.equal(thrown?.message, "official-letour provider requires --from-stage and --to-stage.");
});

test("parse letour ranking page rows for road stage results", () => {
  const sampleHtml = `
    <table class="rankingTable rankingTables--with-pict rtable js-extend-target">
      <tbody>
        <tr class="rankingTables__row rankingTables__row--emphase has-shadowsep">
          <td class="rankingTables__row__position is-alignCenter"><span>1</span></td>
          <td class="rankingTables__row__profile runner">
            <span class="rankingTables__row__profile--wrapper">
              <a class="rankingTables__row__profile--name">T. POGACAR</a>
            </span>
          </td>
          <td class="is-alignCenter hidden">1</td>
          <td class="break-line team">
            <a>UAE TEAM EMIRATES XRG</a>
          </td>
          <td class="is-alignCenter time">03h 40' 01"</td>
          <td class="is-alignCenter time">-</td>
        </tr>
      </tbody>
    </table>
  `;

  const parsed = parseLetourRankingStageRows(sampleHtml, 2, "road");
  assert.equal(parsed.stageResult.stage_number, 2);
  assert.equal(parsed.stageResult.riders.length, 1);
  assert.equal(parsed.stageResult.riders[0].position, 1);
  assert.equal(parsed.stageResult.riders[0].rider_name, "T. POGACAR");
  assert.equal(parsed.stageResult.riders[0].bib_number, 1);
  assert.equal(parsed.stageResult.riders[0].team_name, "UAE TEAM EMIRATES XRG");
  assert.equal(parsed.individualTimingRows.length, 0);
  assert.deepEqual(parsed.warnings, []);
});

test("parse letour ranking page rows for TTT stage emits individual timing warning", () => {
  const sampleHtml = `
    <table class="rankingTable rankingTables--with-pict rtable js-extend-target">
      <tbody>
        <tr class="rankingTables__row rankingTables__row--emphase has-shadowsep">
          <td class="rankingTables__row__position is-alignCenter"><span>1</span></td>
          <td class="rankingTables__row__profile runner">
            <span class="rankingTables__row__profile--wrapper">
              <a class="rankingTables__row__profile--name">J. VINGEGAARD</a>
            </span>
          </td>
          <td class="is-alignCenter hidden">11</td>
          <td class="break-line team">
            <a>TEAM VISMA | LEASE A BIKE</a>
          </td>
          <td class="is-alignCenter time">45' 34"</td>
          <td class="is-alignCenter time">-</td>
        </tr>
      </tbody>
    </table>
  `;

  const parsed = parseLetourRankingStageRows(sampleHtml, 1, "ttt");
  assert.equal(parsed.stageResult.stage_number, 1);
  assert.equal(parsed.stageResult.riders.length, 1);
  assert.equal(parsed.individualTimingRows.length, 1);
  assert.equal(parsed.warnings[0], "TTT individual timing rows found, but official team result source was not found.");
});

test("parseLetourElapsedTime parses real hh'mm''ss'' markup into whole seconds", () => {
  // Exact strings confirmed by fetching a live TDF 2026 Stage 1 rankings
  // page on 2026-07-14: Vingegaard (fastest) and his own Visma teammate
  // Piganzoli, whose real crossing time is 28s slower - direct evidence
  // riders are individually timed, not sharing one team block time.
  assert.equal(parseLetourElapsedTime("00h 21' 47''"), 21 * 60 + 47);
  assert.equal(parseLetourElapsedTime("00h 22' 15''"), 22 * 60 + 15);
  assert.equal(parseLetourElapsedTime("01h 02' 03''"), 3600 + 2 * 60 + 3);
});

test("parseLetourElapsedTime accepts the alternate mm'ss\" seconds marker", () => {
  assert.equal(parseLetourElapsedTime("00h 45' 34\""), 45 * 60 + 34);
});

test("parseLetourElapsedTime returns null for placeholders, gaps, and malformed input", () => {
  assert.equal(parseLetourElapsedTime("-"), null);
  assert.equal(parseLetourElapsedTime("+ 00h 00' 08''"), null);
  assert.equal(parseLetourElapsedTime(""), null);
  assert.equal(parseLetourElapsedTime(null), null);
  assert.equal(parseLetourElapsedTime(undefined), null);
  assert.equal(parseLetourElapsedTime("21' 47''"), null);
});

// Row markup confirmed against a real letour.fr stage-rankings page and its
// general-classification AJAX fragments (see docs/grandtour-results-feed.md's
// jersey-holder section): identical rankingTable/rankingTables__row shape is
// reused by the stage-result table and every classification fragment.
function classificationRow({ position, name, bib, team, time = "12h 00' 00\"", gap = "-" }) {
  return `
    <tr class="rankingTables__row rankingTables__row--emphase has-shadowsep">
      <td class="rankingTables__row__position is-alignCenter"><span>${position}</span></td>
      <td class="rankingTables__row__profile runner">
        <span class="rankingTables__row__profile--wrapper">
          <a class="rankingTables__row__profile--name">${name}</a>
        </span>
      </td>
      <td class="is-alignCenter hidden">${bib}</td>
      <td class="break-line team">
        <a>${team}</a>
      </td>
      <td class="is-alignCenter time">${time}</td>
      <td class="is-alignCenter time">${gap}</td>
    </tr>
  `;
}

// A general-classification AJAX fragment: a bare rankingTable, no wrapping
// page chrome, exactly like the real /en/ajax/ranking/<stage>/<type>/<hash>/none
// responses.
function classificationFragment(rows) {
  return `
    <table class="rankingTable rankingTables--with-pict rtable js-extend-target">
      <tbody>
        ${rows.join("\n")}
      </tbody>
    </table>
  `;
}

// A stage main-page fixture carrying the real "General ranking" tab's
// data-ajax-stack JSON (itg/ipg/img/ijg -> per-classification AJAX URLs),
// HTML-entity-escaped and backslash-escaped exactly like the real page.
function stageMainPageWithAjaxStack(stageNumber, { includeGeneralTab = true } = {}) {
  const stack = {
    itg: `/en/ajax/ranking/${stageNumber}/itg/testhash-itg/none`,
    ipg: `/en/ajax/ranking/${stageNumber}/ipg/testhash-ipg/none`,
    img: `/en/ajax/ranking/${stageNumber}/img/testhash-img/none`,
    ijg: `/en/ajax/ranking/${stageNumber}/ijg/testhash-ijg/none`,
    etg: `/en/ajax/ranking/${stageNumber}/etg/testhash-etg/none`,
    icg: `/en/ajax/ranking/${stageNumber}/icg/testhash-icg/none`
  };
  const escapedStack = JSON.stringify(stack)
    .replace(/"/g, "&quot;")
    .replace(/\//g, "\\/");

  const generalTab = includeGeneralTab
    ? `<span class="js-tabs-ranking" data-tabs-target="it"
         data-ajax-stack = ${escapedStack}
         data-type="g" data-xtclick="ranking::tab::overall">General ranking</span>`
    : "";

  return `
    <div class="js-tabs-wrapper js-tabs-bigwrapper" data-current-type="e" data-current-tab="it">
      <ul class="tabs js-tabs-nav ranking__header__typeSelect" role="tablist">
        <li class="tabs__item js-tabs-parent">
          ${generalTab}
        </li>
        <li class="tabs__item js-tabs-parent is-active">
          <span class="js-tabs-ranking" data-tabs-target="it" data-type="e" data-xtclick="ranking::tab::stage">Stage ranking</span>
        </li>
      </ul>
      <div data-id="it" class="rankingTabs__content__item js-tabs-content">
        ${classificationFragment([classificationRow({ position: 1, name: `S${stageNumber} STAGE WINNER`, bib: 200, team: "STAGE TEAM" })])}
      </div>
    </div>
  `;
}

function mockFetchByUrl(responses) {
  return async (url) => {
    const key = Object.keys(responses).find((candidate) => url.includes(candidate));
    if (!key) return new Response(null, { status: 404 });
    const entry = responses[key];
    if (entry instanceof Error) throw entry;
    if (typeof entry === "number") return new Response(null, { status: entry });
    return new Response(entry, { status: 200 });
  };
}

test("extractGeneralClassificationAjaxUrls finds the 4 classification URLs from the real 'General ranking' data-ajax-stack markup", () => {
  const html = stageMainPageWithAjaxStack(2);
  const urls = extractGeneralClassificationAjaxUrls(html);

  assert.equal(urls.individual, "https://www.letour.fr/en/ajax/ranking/2/itg/testhash-itg/none");
  assert.equal(urls.points, "https://www.letour.fr/en/ajax/ranking/2/ipg/testhash-ipg/none");
  assert.equal(urls.climber, "https://www.letour.fr/en/ajax/ranking/2/img/testhash-img/none");
  assert.equal(urls.youth, "https://www.letour.fr/en/ajax/ranking/2/ijg/testhash-ijg/none");
});

test("extractGeneralClassificationAjaxUrls returns null when the 'General ranking' tab markup is absent (page structure changed)", () => {
  const html = stageMainPageWithAjaxStack(2, { includeGeneralTab: false });
  assert.equal(extractGeneralClassificationAjaxUrls(html), null);
});

test("parseLetourClassificationLeader takes position 1, not the first row in markup order", () => {
  const fragment = classificationFragment([
    classificationRow({ position: 2, name: "SECOND ROW", bib: 5, team: "TEAM B" }),
    classificationRow({ position: 1, name: "ACTUAL LEADER", bib: 9, team: "TEAM A" })
  ]);

  const { leader, diagnostics } = parseLetourClassificationLeader(fragment, "points", 6, "https://www.letour.fr/en/ajax/ranking/6/ipg/x/none");
  assert.equal(diagnostics.status, "found");
  assert.equal(leader.parsedRiderName, "ACTUAL LEADER");
  assert.equal(leader.jerseyType, "green");
});

test("parseLetourClassificationLeader reports table_not_found when the fragment has no rankingTable", () => {
  const { leader, diagnostics } = parseLetourClassificationLeader("<div>no table here</div>", "climber", 8, "https://example.com/x");
  assert.equal(leader, null);
  assert.equal(diagnostics.status, "table_not_found");
});

test("parseLetourClassificationLeader reports empty_table when the fragment's table has no rows", () => {
  const fragment = classificationFragment([]);
  const { leader, diagnostics } = parseLetourClassificationLeader(fragment, "climber", 8, "https://example.com/x");
  assert.equal(leader, null);
  assert.equal(diagnostics.status, "empty_table");
});

test("parseLetourClassificationLeader reports unsupported_markup when fragmentHtml is null (URL never discovered)", () => {
  const { leader, diagnostics } = parseLetourClassificationLeader(null, "youth", 8);
  assert.equal(leader, null);
  assert.equal(diagnostics.status, "unsupported_markup");
});

for (const stageNumber of [2, 3, 4, 5]) {
  test(`fetchLetourJerseyHolders finds all 4 real classification leaders for stage ${stageNumber}`, async () => {
    const html = stageMainPageWithAjaxStack(stageNumber);
    const fetchImpl = mockFetchByUrl({
      "/itg/": classificationFragment([classificationRow({ position: 1, name: `S${stageNumber} YELLOW LEADER`, bib: 1, team: "UAE TEAM EMIRATES XRG" })]),
      "/ipg/": classificationFragment([classificationRow({ position: 1, name: `S${stageNumber} GREEN LEADER`, bib: 105, team: "ALPECIN - PREMIER TECH" })]),
      "/img/": classificationFragment([classificationRow({ position: 1, name: `S${stageNumber} KOM LEADER`, bib: 71, team: "BAHRAIN - VICTORIOUS" })]),
      "/ijg/": classificationFragment([classificationRow({ position: 1, name: `S${stageNumber} WHITE LEADER`, bib: 2, team: "UAE TEAM EMIRATES XRG" })])
    });

    const { jerseyHolders, diagnostics, warnings } = await fetchLetourJerseyHolders(html, stageNumber, { fetchImpl });

    assert.equal(jerseyHolders.length, 4);
    assert.deepEqual(warnings, []);
    assert.deepEqual(diagnostics.map((entry) => entry.status), ["found", "found", "found", "found"]);

    const byType = Object.fromEntries(jerseyHolders.map((holder) => [holder.jerseyType, holder]));

    assert.equal(byType.yellow.parsedRiderName, `S${stageNumber} YELLOW LEADER`);
    assert.equal(byType.yellow.sourceClassification, "individual");
    assert.equal(byType.yellow.bibNumber, 1);
    assert.equal(byType.yellow.parsedTeamName, "UAE TEAM EMIRATES XRG");

    assert.equal(byType.green.parsedRiderName, `S${stageNumber} GREEN LEADER`);
    assert.equal(byType.green.sourceClassification, "points");
    assert.equal(byType.green.bibNumber, 105);

    assert.equal(byType.kom.parsedRiderName, `S${stageNumber} KOM LEADER`);
    assert.equal(byType.kom.sourceClassification, "climber");
    assert.equal(byType.kom.bibNumber, 71);

    assert.equal(byType.white.parsedRiderName, `S${stageNumber} WHITE LEADER`);
    assert.equal(byType.white.sourceClassification, "youth");
    assert.equal(byType.white.bibNumber, 2);
  });
}

test("fetchLetourJerseyHolders: one classification's AJAX fetch failing (404) only blocks that jersey, others still found", async () => {
  const html = stageMainPageWithAjaxStack(2);
  const fetchImpl = mockFetchByUrl({
    "/itg/": classificationFragment([classificationRow({ position: 1, name: "YELLOW LEADER", bib: 1, team: "TEAM A" })]),
    "/ipg/": 404,
    "/img/": classificationFragment([classificationRow({ position: 1, name: "KOM LEADER", bib: 3, team: "TEAM A" })]),
    "/ijg/": classificationFragment([classificationRow({ position: 1, name: "WHITE LEADER", bib: 4, team: "TEAM A" })])
  });

  const { jerseyHolders, diagnostics, warnings } = await fetchLetourJerseyHolders(html, 2, { fetchImpl });

  assert.equal(jerseyHolders.length, 3);
  assert.ok(!jerseyHolders.some((holder) => holder.jerseyType === "green"));
  assert.equal(diagnostics.find((entry) => entry.classification === "points").status, "fetch_error");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /points classification AJAX fetch failed/);
});

test("fetchLetourJerseyHolders: a network exception fetching one classification is caught and reported as fetch_error, not thrown", async () => {
  const html = stageMainPageWithAjaxStack(2);
  const fetchImpl = mockFetchByUrl({
    "/itg/": classificationFragment([classificationRow({ position: 1, name: "YELLOW LEADER", bib: 1, team: "TEAM A" })]),
    "/ipg/": classificationFragment([classificationRow({ position: 1, name: "GREEN LEADER", bib: 2, team: "TEAM A" })]),
    "/img/": new Error("network unreachable"),
    "/ijg/": classificationFragment([classificationRow({ position: 1, name: "WHITE LEADER", bib: 4, team: "TEAM A" })])
  });

  const { jerseyHolders, diagnostics } = await fetchLetourJerseyHolders(html, 2, { fetchImpl });
  assert.equal(jerseyHolders.length, 3);
  assert.equal(diagnostics.find((entry) => entry.classification === "climber").status, "fetch_error");
});

test("fetchLetourJerseyHolders: when the 'General ranking' tab itself can't be found, all 4 classifications fail closed with unsupported_markup", async () => {
  const html = stageMainPageWithAjaxStack(2, { includeGeneralTab: false });
  const fetchImpl = mockFetchByUrl({});

  const { jerseyHolders, diagnostics, warnings } = await fetchLetourJerseyHolders(html, 2, { fetchImpl });

  assert.equal(jerseyHolders.length, 0);
  assert.deepEqual(diagnostics.map((entry) => entry.status), ["unsupported_markup", "unsupported_markup", "unsupported_markup", "unsupported_markup"]);
  assert.equal(warnings.length, 4);
});

test("LETOUR_CLASSIFICATION_JERSEY_MAP maps each classification to its jersey exactly once", () => {
  assert.deepEqual(LETOUR_CLASSIFICATION_JERSEY_MAP, {
    individual: "yellow",
    points: "green",
    climber: "kom",
    youth: "white"
  });
});

test("dry-run review reports provider, stage range, stage date, and dry-run/apply flags", () => {
  const review = buildFeedReview({
    mode: "dry-run",
    payload: {
      source_name: "official-letour",
      source_url: "https://www.letour.fr/en/rankings/stage-6",
      stage_results: [{ stage_number: 6, type: "road", riders: [{ rider_id: "r1", position: 1 }] }]
    },
    options: { fromStage: 6, toStage: 6, stageDate: "2026-07-09" }
  });

  assert.equal(review.provider, "official-letour");
  assert.deepEqual(review.stageRangeRequested, { fromStage: 6, toStage: 6 });
  assert.equal(review.stageDate, "2026-07-09");
  assert.equal(review.dryRun, true);
  assert.equal(review.applyEnabled, false);
  assert.deepEqual(review.warnings, []);
});

test("apply-mode review still reports applyEnabled=false", () => {
  const review = buildFeedReview({
    mode: "apply",
    payload: { source_name: "manual-test" }
  });

  assert.equal(review.dryRun, false);
  assert.equal(review.applyEnabled, false);
});

test("buildSkippedStageReport marks the run skipped without a stage range or fetch", () => {
  const review = buildSkippedStageReport({
    provider: "official-letour",
    asOfDate: "2026-07-13",
    reason: "No completed stage found for 2026-07-13 (rest day or outside the race window)."
  });

  assert.equal(review.mode, "dry-run");
  assert.equal(review.dryRun, true);
  assert.equal(review.applyEnabled, false);
  assert.equal(review.importStatus, "skipped");
  assert.equal(review.fromStage, null);
  assert.equal(review.toStage, null);
  assert.deepEqual(review.warnings, ["No completed stage found for 2026-07-13 (rest day or outside the race window)."]);
});

test("successful fixture parse extracts all riders with ok diagnostics", async () => {
  const html = await readFixture("stage-successful.html");
  const parsed = parseLetourRankingStageRows(html, 2, "road");

  assert.equal(parsed.stageResult.riders.length, 3);
  assert.deepEqual(parsed.stageResult.riders.map((rider) => rider.rider_name), ["T. POGACAR", "J. VINGEGAARD", "R. EVENEPOEL"]);
  assert.deepEqual(parsed.warnings, []);
  assert.deepEqual(parsed.diagnostics, {
    stageNumber: 2,
    url: "https://www.letour.fr/en/rankings/stage-2",
    status: "ok",
    rowsMatched: 3,
    ridersParsed: 3
  });
});

test("changed markup with no ranking table is reported as table_not_found drift", async () => {
  const html = await readFixture("stage-changed-markup.html");
  const parsed = parseLetourRankingStageRows(html, 4, "road");

  assert.equal(parsed.stageResult, null);
  assert.equal(parsed.diagnostics.status, "table_not_found");
  assert.equal(parsed.diagnostics.rowsMatched, 0);
  assert.match(parsed.warnings[0], /markup may have changed/i);
});

test("empty ranking table is reported as empty_table, not a successful zero-result stage", async () => {
  const html = await readFixture("stage-empty-table.html");
  const parsed = parseLetourRankingStageRows(html, 5, "road");

  assert.equal(parsed.stageResult, null);
  assert.equal(parsed.diagnostics.status, "empty_table");
  assert.equal(parsed.diagnostics.rowsMatched, 0);
  assert.match(parsed.warnings[0], /no data rows yet/i);
});

test("row-level drift with matched rows but no extractable fields is reported as parse_empty", async () => {
  const html = await readFixture("stage-row-drift.html");
  const parsed = parseLetourRankingStageRows(html, 6, "road");

  assert.equal(parsed.stageResult, null);
  assert.equal(parsed.diagnostics.status, "parse_empty");
  assert.equal(parsed.diagnostics.rowsMatched, 1);
  assert.equal(parsed.diagnostics.ridersParsed, 0);
  assert.match(parsed.warnings[0], /row markup may have changed/i);
});

test("pending-results placeholder is distinguished from markup drift", async () => {
  const html = await readFixture("stage-pending-placeholder.html");
  const parsed = parseLetourRankingStageRows(html, 21, "road");

  assert.equal(parsed.stageResult, null);
  assert.equal(parsed.diagnostics.status, "pending");
  assert.match(parsed.warnings[0], /not published yet/i);
});

test("buildFeedReview marks importStatus failed and sets parserDriftDetected when drift is present", () => {
  const review = buildFeedReview({
    mode: "dry-run",
    payload: {
      source_name: "official-letour",
      stage_fetch_metadata: [
        { stageNumber: 6, url: "https://www.letour.fr/en/rankings/stage-6", httpStatus: 200, status: "table_not_found", rowsMatched: 0, ridersParsed: 0, warningCount: 1 }
      ]
    },
    options: { fromStage: 6, toStage: 6 }
  });

  assert.equal(review.parserDriftDetected, true);
  assert.equal(review.importStatus, "failed");
  assert.match(review.note, /Parser drift was detected/);
});

test("buildFeedReview does not flag drift for a benign pending/not_found stage", () => {
  const review = buildFeedReview({
    mode: "dry-run",
    payload: {
      source_name: "official-letour",
      stage_fetch_metadata: [
        { stageNumber: 21, url: "https://www.letour.fr/en/rankings/stage-21", httpStatus: 404, status: "not_found", rowsMatched: 0, ridersParsed: 0, warningCount: 1 }
      ]
    },
    options: { fromStage: 21, toStage: 21 }
  });

  assert.equal(review.parserDriftDetected, false);
});

test("official-letour provider reports a 404 stage page as not_found without throwing", async (t) => {
  const originalFetch = globalThis.fetch;
  let capturedHeaders = null;
  globalThis.fetch = async (url, init) => {
    capturedHeaders = init?.headers ?? null;
    return new Response(null, { status: 404, statusText: "Not Found" });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const provider = new OfficialLetourGrandTourFeedProvider({ fromStage: 21, toStage: 21, allCompleted: false });
  const payload = await provider.readPayload();

  assert.equal(payload.stage_fetch_metadata.length, 1);
  assert.equal(payload.stage_fetch_metadata[0].status, "not_found");
  assert.equal(payload.stage_fetch_metadata[0].httpStatus, 404);
  assert.equal(payload.stage_results.length, 0);
  assert.match(payload.warnings[0], /404/);
  assert.equal(capturedHeaders["User-Agent"], LETOUR_FETCH_USER_AGENT);
});

test("official-letour provider reports a non-200 response as fetch_error without throwing", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("Service Unavailable", { status: 503, statusText: "Service Unavailable" });
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const provider = new OfficialLetourGrandTourFeedProvider({ fromStage: 6, toStage: 6, allCompleted: false });
  const payload = await provider.readPayload();

  assert.equal(payload.stage_fetch_metadata[0].status, "fetch_error");
  assert.equal(payload.stage_fetch_metadata[0].httpStatus, 503);
  assert.match(payload.warnings[0], /503/);
});

test("official-letour provider reports a network exception as fetch_error without throwing", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("network unreachable");
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const provider = new OfficialLetourGrandTourFeedProvider({ fromStage: 6, toStage: 6, allCompleted: false });
  const payload = await provider.readPayload();

  assert.equal(payload.stage_fetch_metadata[0].status, "fetch_error");
  assert.equal(payload.stage_fetch_metadata[0].httpStatus, null);
  assert.match(payload.warnings[0], /network unreachable/);
});

test("official-letour provider records ok fetch metadata for a successful fixture response", async (t) => {
  const html = await readFixture("stage-successful.html");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(html, { status: 200 });
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const provider = new OfficialLetourGrandTourFeedProvider({ fromStage: 2, toStage: 2, allCompleted: false });
  const payload = await provider.readPayload();

  assert.equal(payload.stage_fetch_metadata[0].status, "ok");
  assert.equal(payload.stage_fetch_metadata[0].httpStatus, 200);
  assert.equal(payload.stage_fetch_metadata[0].ridersParsed, 3);
  assert.equal(payload.stage_fetch_metadata[0].warningCount, 0);
  assert.equal(payload.stage_results[0].riders.length, 3);

  const review = buildFeedReview({ payload, mode: "dry-run", options: { fromStage: 2, toStage: 2 } });
  assert.equal(review.parserDriftDetected, false);
  assert.equal(review.stageFetchMetadata[0].url, "https://www.letour.fr/en/rankings/stage-2");
});

test("official-letour provider marks review failed when a stage's markup has drifted", async (t) => {
  const html = await readFixture("stage-changed-markup.html");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(html, { status: 200 });
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const provider = new OfficialLetourGrandTourFeedProvider({ fromStage: 4, toStage: 4, allCompleted: false });
  const payload = await provider.readPayload();
  const review = buildFeedReview({ payload, mode: "dry-run", options: { fromStage: 4, toStage: 4 } });

  assert.equal(review.parserDriftDetected, true);
  assert.equal(review.importStatus, "failed");
});

test("invalid source file reports validation errors", async () => {
  const invalidPayload = {
    source_name: "manual-invalid",
    ttt_results: [{ stage_number: 1, type: "ttt", riders: [{ rider_id: "r1" }] }]
  };
  const tempFile = path.resolve("tmp", "invalid-feed.json");
  await fs.mkdir(path.dirname(tempFile), { recursive: true });
  await fs.writeFile(tempFile, `${JSON.stringify(invalidPayload, null, 2)}\n`, "utf8");

  const provider = new ManualJsonGrandTourFeedProvider({ sourceFile: tempFile });
  const payload = await provider.readPayload();
  const review = buildFeedReview({ mode: "dry-run", payload });

  assert.equal(review.validationErrors.length, 1);
  assert.equal(review.validationErrors[0], "TTT stage result must use teams, not rider placings.");
});
