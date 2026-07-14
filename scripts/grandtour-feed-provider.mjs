import fs from "node:fs/promises";
import path from "node:path";

import { parseArgs as parseBaseArgs } from "./tdf-data-utils.mjs";
import { DEFAULT_STAGE_CALENDAR_PATH } from "./grandtour-stage-calendar.mjs";

export const FEED_SEGMENTS = [
  "stage_metadata",
  "stage_result",
  "ttt_result",
  "jersey_holders",
  "rider_status",
  "startlist",
  "team_data"
];

export function stageNumberFromResult(result) {
  const value = result?.stage_number;
  if (value === undefined || value === null) return null;
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

export function buildStageRange(fromStage, toStage) {
  if (fromStage === null || toStage === null) return [];
  if (fromStage > toStage) return [];
  const range = [];
  for (let stage = fromStage; stage <= toStage; stage += 1) {
    range.push(stage);
  }
  return range;
}

export function uniqueSortedStageNumbers(stageResults, tttResults) {
  const seen = new Set();
  for (const result of [...(stageResults ?? []), ...(tttResults ?? [])]) {
    const stageNumber = stageNumberFromResult(result);
    if (stageNumber !== null) seen.add(stageNumber);
  }
  return [...seen].sort((a, b) => a - b);
}

export function decodeHtmlEntities(value) {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

export function stripHtml(value) {
  return decodeHtmlEntities(String(value).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim());
}

// Parses an official-letour absolute elapsed-time string (the ranking
// table's "Times" column, e.g. "00h 21' 47''", confirmed by fetching a live
// stage-rankings page on 2026-07-14 and inspecting the raw decoded markup)
// into whole seconds. Returns null for anything that isn't a genuine
// elapsed time - a "-" placeholder, a "+"-prefixed gap string, or
// missing/malformed markup - never coerces those to 0, which would make a
// placeholder or DNF row silently look like the fastest time to any caller
// comparing times (e.g. deriveTeamResultFromRiderRows in
// grandtour-reconciliation.mjs). The seconds marker accepts either two
// straight single quotes (what live markup decodes to: "&#039;&#039;") or
// one straight double quote, since a hand-written fixture elsewhere in this
// codebase uses the latter for a shorter mm'ss" shape - both are accepted
// here as long as the hours segment is present, matching only the format
// actually confirmed live.
export function parseLetourElapsedTime(timeString) {
  if (typeof timeString !== "string") return null;
  const match = timeString.trim().match(/^(\d+)h\s*(\d+)'\s*(\d+)(?:''|")$/);
  if (!match) return null;
  const [, hours, minutes, seconds] = match;
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
}

export function letourRankingPageUrl(stageNumber) {
  return `https://www.letour.fr/en/rankings/stage-${stageNumber}`;
}

export const LETOUR_FETCH_USER_AGENT =
  "GrandTourTippingBot/1.0 (+https://github.com/tmcstay/tipping; dry-run only; contact: tmcstay@gmail.com)";

export function findLetourRankingTable(html) {
  const match = html.match(/<table[^>]*class="[^"]*rankingTable[^"]*"[^>]*>[\s\S]*?<\/table>/i);
  return match?.[0] ?? null;
}

// Maps each official-letour classification tab to the jersey it determines.
// Individual/General Classification carries the yellow (overall) jersey;
// Points -> green; Climber/Mountains -> kom; Youth -> white.
export const LETOUR_CLASSIFICATION_JERSEY_MAP = {
  individual: "yellow",
  points: "green",
  climber: "kom",
  youth: "white"
};

export const REQUIRED_JERSEY_TYPES = Object.values(LETOUR_CLASSIFICATION_JERSEY_MAP);

// Extracts rider rows from an already-isolated ranking/classification
// <table>...</table> fragment. Shared by parseLetourRankingStageRows (stage
// result table) and parseLetourClassificationLeader (per-classification
// tables) so both use identical row markup assumptions.
function extractRankingRowsFromTableHtml(tableHtml) {
  const rowRegex = /<tr[^>]*class="[^"]*rankingTables__row[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi;
  const rows = [];
  let rowsMatched = 0;
  let rowMatch;

  while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
    rowsMatched += 1;
    const rowHtml = rowMatch[1];
    const positionMatch = rowHtml.match(/<td[^>]*class="[^"]*rankingTables__row__position[^"]*"[^>]*>[\s\S]*?<span>([\s\S]*?)<\/span>/i);
    const nameMatch = rowHtml.match(/<a[^>]*class="[^"]*rankingTables__row__profile--name[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
    const bibMatch = rowHtml.match(/<td[^>]*class="[^"]*is-alignCenter[^"]*hidden[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
    const teamMatch = rowHtml.match(/<td[^>]*class="[^"]*team[^"]*"[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i);
    const timeMatches = [...rowHtml.matchAll(/<td[^>]*class="[^"]*is-alignCenter[^"]*time[^"]*"[^>]*>([\s\S]*?)<\/td>/gi)];

    const position = positionMatch ? Number(stripHtml(positionMatch[1])) : null;
    if (!Number.isInteger(position)) continue;

    const riderName = nameMatch ? stripHtml(nameMatch[1]) : null;
    const bibNumber = bibMatch ? Number(stripHtml(bibMatch[1]).replace(/[^0-9]/g, "")) : null;
    const teamName = teamMatch ? stripHtml(teamMatch[1]) : null;
    const time = timeMatches[0] ? stripHtml(timeMatches[0][1]) : null;
    const gap = timeMatches[1] ? stripHtml(timeMatches[1][1]) : null;

    if (!riderName) continue;

    rows.push({
      position,
      rider_name: riderName,
      bib_number: Number.isInteger(bibNumber) ? bibNumber : null,
      team_name: teamName,
      time,
      gap
    });
  }

  return { rows, rowsMatched };
}

// Real official-letour markup (confirmed against a live stage page — see
// docs/grandtour-results-feed.md's jersey-holder section for the
// investigation record): the four cumulative ("general") classifications
// that determine jersey holders are NOT present in a stage rankings page's
// initial HTML at all — only the "Stage ranking" -> "Individual" stage
// result table is (parseLetourRankingStageRows above). The page instead
// exposes a "General ranking" tab (`data-type="g"`) carrying a
// `data-ajax-stack` JSON attribute mapping short type codes to per-stage
// AJAX fragment URLs:
//   itg = individual general (-> yellow), ipg = points general (-> green),
//   img = mountain/climber general (-> kom), ijg = youth general (-> white)
// (etg/icg = team/combative, not used here). Each URL's trailing path
// segment is a token generated per page load, so it must always be scraped
// fresh from the just-fetched main page — never hardcoded or cached across
// stages/requests.
const CLASSIFICATION_TYPE_CODES = {
  individual: "itg",
  points: "ipg",
  climber: "img",
  youth: "ijg"
};

const LETOUR_ORIGIN = "https://www.letour.fr";

// Extracts the four general-classification AJAX URLs from a stage's main
// rankings page HTML, or null if the "General ranking" tab's
// data-ajax-stack block itself can't be located/parsed (a page-level markup
// change) — in which case every classification fails closed with
// "unsupported_markup" rather than guessing a URL shape.
export function extractGeneralClassificationAjaxUrls(html) {
  const match = html.match(/<span[^>]*data-ajax-stack\s*=\s*(\{[^}]*\})[^>]*data-type="g"[^>]*>/i);
  if (!match) return null;

  let parsedStack;
  try {
    const decoded = decodeHtmlEntities(match[1]).replace(/\\\//g, "/");
    parsedStack = JSON.parse(decoded);
  } catch {
    return null;
  }

  const urls = {};
  for (const [classification, typeCode] of Object.entries(CLASSIFICATION_TYPE_CODES)) {
    const relativePath = parsedStack[typeCode];
    urls[classification] = typeof relativePath === "string"
      ? new URL(relativePath, LETOUR_ORIGIN).toString()
      : null;
  }
  return urls;
}

/**
 * Parses the leader (position 1) out of one already-fetched general-
 * classification AJAX fragment (the HTML response body from a URL returned
 * by extractGeneralClassificationAjaxUrls). The fragment reuses the exact
 * same rankingTable/rankingTables__row markup as the main stage-result
 * table (confirmed against real fragment responses), so this reuses
 * findLetourRankingTable/extractRankingRowsFromTableHtml rather than a
 * separate selector.
 *
 * Diagnostics statuses: "found" | "table_not_found" | "empty_table" |
 * "unsupported_markup" (fragmentHtml itself was null, e.g. its URL could
 * never be discovered).
 */
export function parseLetourClassificationLeader(fragmentHtml, classification, stageNumber, url = null) {
  const jerseyType = LETOUR_CLASSIFICATION_JERSEY_MAP[classification];
  const selector = "table.rankingTable > tbody > tr.rankingTables__row (row 1)";

  if (fragmentHtml === null) {
    return {
      leader: null,
      diagnostics: { stageNumber, classification, jerseyType, status: "unsupported_markup", selector: null, url, rowsMatched: 0 }
    };
  }

  const tableHtml = findLetourRankingTable(fragmentHtml);
  if (!tableHtml) {
    return {
      leader: null,
      diagnostics: { stageNumber, classification, jerseyType, status: "table_not_found", selector, url, rowsMatched: 0 }
    };
  }

  const { rows, rowsMatched } = extractRankingRowsFromTableHtml(tableHtml);
  if (rows.length === 0) {
    return {
      leader: null,
      diagnostics: { stageNumber, classification, jerseyType, status: "empty_table", selector, url, rowsMatched }
    };
  }

  const leaderRow = rows.find((row) => row.position === 1) ?? rows[0];

  return {
    leader: {
      jerseyType,
      sourceClassification: classification,
      parsedRiderName: leaderRow.rider_name,
      parsedTeamName: leaderRow.team_name ?? null,
      bibNumber: leaderRow.bib_number ?? null
    },
    diagnostics: { stageNumber, classification, jerseyType, status: "found", selector, url, rowsMatched: rows.length }
  };
}

/**
 * Fetches and parses all four end-of-stage classification leaders
 * (yellow/green/kom/white) for one stage, given that stage's already-
 * fetched main rankings page HTML. Performs up to 4 additional network
 * fetches (one per classification's AJAX fragment — see
 * extractGeneralClassificationAjaxUrls above); each is independently
 * fault-tolerant, matching the fault-tolerance of the main stage-result
 * fetch in OfficialLetourGrandTourFeedProvider.readPayload(). Never throws
 * on a missing/malformed classification — a missing leader is reported via
 * `warnings` and `diagnostics`, and simply absent from the returned
 * `jerseyHolders` array; reconciliation (reconcileJerseyHolders in
 * scripts/grandtour-reconciliation.mjs) is what turns a missing entry into
 * a "Missing <type> jersey holder." blocker, so safeToApply still fails
 * closed exactly as before.
 */
export async function fetchLetourJerseyHolders(stageMainPageHtml, stageNumber, { headers = { "User-Agent": LETOUR_FETCH_USER_AGENT, Accept: "text/html" }, fetchImpl = fetch } = {}) {
  const ajaxUrls = extractGeneralClassificationAjaxUrls(stageMainPageHtml);
  const jerseyHolders = [];
  const diagnostics = [];
  const warnings = [];

  for (const classification of Object.keys(LETOUR_CLASSIFICATION_JERSEY_MAP)) {
    const jerseyType = LETOUR_CLASSIFICATION_JERSEY_MAP[classification];
    const url = ajaxUrls?.[classification] ?? null;

    if (!url) {
      diagnostics.push({
        stageNumber,
        classification,
        jerseyType,
        status: "unsupported_markup",
        selector: 'data-ajax-stack JSON on the "General ranking" tab (data-type="g")',
        url: null,
        rowsMatched: 0
      });
      warnings.push(`Stage ${stageNumber}: could not discover the ${classification} general-classification AJAX URL; the page's tab markup may have changed. Jersey holder cannot be determined.`);
      continue;
    }

    let fragmentHtml = null;
    let fetchFailure = null;
    try {
      const response = await fetchImpl(url, { headers });
      if (response.ok) {
        fragmentHtml = await response.text();
      } else {
        fetchFailure = `HTTP ${response.status}`;
      }
    } catch (error) {
      fetchFailure = error.message;
    }

    if (fetchFailure) {
      diagnostics.push({ stageNumber, classification, jerseyType, status: "fetch_error", selector: url, url, rowsMatched: 0 });
      warnings.push(`Stage ${stageNumber}: ${classification} classification AJAX fetch failed (${fetchFailure}) at ${url}. Jersey holder cannot be determined.`);
      continue;
    }

    const { leader, diagnostics: entryDiagnostics } = parseLetourClassificationLeader(fragmentHtml, classification, stageNumber, url);
    diagnostics.push(entryDiagnostics);
    if (leader) {
      jerseyHolders.push(leader);
    } else {
      warnings.push(`Stage ${stageNumber}: ${classification} classification leader not found (status=${entryDiagnostics.status}) at ${url}. Jersey holder cannot be determined.`);
    }
  }

  return { jerseyHolders, diagnostics, warnings };
}

// Text letour.fr (or a similarly-shaped future host) is likely to render on a
// stage page before results are published, as opposed to a genuinely changed
// table markup. Used to tell "no results yet" apart from real parser drift.
const PENDING_RESULT_PATTERNS = [
  /result(s)?\s+(will\s+be\s+)?available/i,
  /ranking(s)?\s+(will\s+be\s+)?available/i,
  /no\s+ranking(s)?\s+available/i,
  /stage\s+(is\s+)?in\s+progress/i,
  /stage\s+not\s+(yet\s+)?finished/i
];

export function detectPendingResultsPlaceholder(html) {
  return PENDING_RESULT_PATTERNS.some((pattern) => pattern.test(html));
}

/**
 * Parser statuses, from most to least confident:
 * - "ok": table found, rows found, fields extracted.
 * - "pending": no table, but page text suggests results aren't published yet (expected/benign).
 * - "empty_table": table found with the expected classes but zero row elements (possible drift, low severity).
 * - "parse_empty": table and rows found, but no field could be extracted from any row (likely row-level drift).
 * - "table_not_found": no ranking table found and no pending-results text either (likely page-level drift).
 */
export function parseLetourRankingStageRows(html, stageNumber, stageType = "road") {
  const url = letourRankingPageUrl(stageNumber);
  const tableHtml = findLetourRankingTable(html);

  if (!tableHtml) {
    const pending = detectPendingResultsPlaceholder(html);
    const status = pending ? "pending" : "table_not_found";
    const message = pending
      ? `Stage ${stageNumber} results are not published yet at ${url}.`
      : `Official ranking table not found for stage ${stageNumber} at ${url}. The page markup may have changed.`;
    return {
      stageResult: null,
      individualTimingRows: [],
      warnings: [message],
      diagnostics: { stageNumber, url, status, rowsMatched: 0, ridersParsed: 0 }
    };
  }

  const { rows: riders, rowsMatched } = extractRankingRowsFromTableHtml(tableHtml);

  if (rowsMatched === 0) {
    return {
      stageResult: null,
      individualTimingRows: [],
      warnings: [`Stage ${stageNumber} ranking table at ${url} has no data rows yet.`],
      diagnostics: { stageNumber, url, status: "empty_table", rowsMatched: 0, ridersParsed: 0 }
    };
  }

  if (riders.length === 0) {
    return {
      stageResult: null,
      individualTimingRows: [],
      warnings: [`Unable to parse any rider ranking row for stage ${stageNumber} at ${url}; row markup may have changed.`],
      diagnostics: { stageNumber, url, status: "parse_empty", rowsMatched, ridersParsed: 0 }
    };
  }

  const stageResult = {
    stage_number: stageNumber,
    type: "road",
    riders
  };

  const individualTimingRows = stageType === "ttt" ? riders : [];
  const warnings = [];
  if (stageType === "ttt" && individualTimingRows.length > 0) {
    warnings.push("TTT individual timing rows found, but official team result source was not found.");
  }

  return {
    stageResult,
    individualTimingRows,
    warnings,
    diagnostics: { stageNumber, url, status: "ok", rowsMatched, ridersParsed: riders.length }
  };
}

export class ManualJsonGrandTourFeedProvider {
  constructor({ sourceFile }) {
    this.sourceFile = sourceFile;
    this.name = "manual-json";
  }

  async readPayload() {
    if (!this.sourceFile) {
      return {
        source_name: this.name,
        source_url: null,
        fetched_at: new Date().toISOString(),
        confidence: "manual",
        stage_results: [],
        ttt_results: [],
        jersey_holders: [],
        rider_statuses: [],
        startlist: [],
        teams: [],
        stage_metadata: []
      };
    }
    return JSON.parse(await fs.readFile(this.sourceFile, "utf8"));
  }

  async fetchStageResults() {
    const payload = await this.readPayload();
    return [...(payload.stage_results ?? []), ...(payload.ttt_results ?? [])];
  }

  async fetchJerseyHolders() {
    return (await this.readPayload()).jersey_holders ?? [];
  }

  async fetchRiderStatuses() {
    return (await this.readPayload()).rider_statuses ?? [];
  }

  async fetchStartlist() {
    return (await this.readPayload()).startlist ?? [];
  }
}

export class OfficialLetourGrandTourFeedProvider {
  constructor({ fromStage, toStage, allCompleted }) {
    this.fromStage = fromStage;
    this.toStage = toStage;
    this.allCompleted = allCompleted;
    this.name = "official-letour";
  }

  async readPayload() {
    if (this.fromStage === null || this.toStage === null) {
      throw new Error("official-letour provider requires --from-stage and --to-stage.");
    }
    const stageRange = buildStageRange(this.fromStage, this.toStage);
    const stageResults = [];
    const individualTimingRows = [];
    const warnings = [];
    const stageFetchMetadata = [];
    const jerseyFetchMetadata = [];
    let firstUrl = null;

    for (const stageNumber of stageRange) {
      const url = letourRankingPageUrl(stageNumber);
      firstUrl = firstUrl ?? url;

      let html = null;
      let httpStatus = null;
      try {
        const response = await fetch(url, {
          headers: { "User-Agent": LETOUR_FETCH_USER_AGENT, Accept: "text/html" }
        });
        httpStatus = response.status;

        if (response.status === 404) {
          const message = `Stage ${stageNumber} rankings page not found at ${url} (404); results may not be published yet.`;
          warnings.push(message);
          stageFetchMetadata.push({ stageNumber, url, httpStatus, status: "not_found", rowsMatched: 0, ridersParsed: 0, warningCount: 1 });
          continue;
        }
        if (!response.ok) {
          const message = `Unexpected response fetching stage ${stageNumber} rankings at ${url}: ${response.status} ${response.statusText}.`;
          warnings.push(message);
          stageFetchMetadata.push({ stageNumber, url, httpStatus, status: "fetch_error", rowsMatched: 0, ridersParsed: 0, warningCount: 1 });
          continue;
        }
        html = await response.text();
      } catch (error) {
        const message = `Unable to fetch stage ${stageNumber} rankings at ${url}: ${error.message}`;
        warnings.push(message);
        stageFetchMetadata.push({ stageNumber, url, httpStatus, status: "fetch_error", rowsMatched: 0, ridersParsed: 0, warningCount: 1 });
        continue;
      }

      const stageType = stageNumber === 1 ? "ttt" : "road";
      const { stageResult, individualTimingRows: stageIndividualRows, warnings: stageWarnings, diagnostics } =
        parseLetourRankingStageRows(html, stageNumber, stageType);

      // Classification leaders (end-of-stage jersey holders) are parsed for
      // every stage, independent of whether the stage-result table itself
      // parsed cleanly — the two live in different tables on the same page.
      // They're only attached to a stageResult (and so only reach
      // reconciliation) when stageResult exists, matching how stage results
      // already work: a stage with no parsed result table isn't reconciled
      // at all yet.
      const { jerseyHolders, diagnostics: jerseyDiagnostics, warnings: jerseyWarnings } = await fetchLetourJerseyHolders(html, stageNumber);
      if (stageResult) {
        stageResult.jersey_holders = jerseyHolders;
        stageResults.push(stageResult);
      }
      individualTimingRows.push(...stageIndividualRows);
      warnings.push(...stageWarnings.map((message) => `Stage ${stageNumber}: ${message}`));
      warnings.push(...jerseyWarnings);
      jerseyFetchMetadata.push(...jerseyDiagnostics);
      stageFetchMetadata.push({
        stageNumber,
        url,
        httpStatus,
        status: diagnostics.status,
        rowsMatched: diagnostics.rowsMatched,
        ridersParsed: diagnostics.ridersParsed,
        warningCount: stageWarnings.length
      });
    }

    return {
      source_name: this.name,
      source_url: stageRange.length === 1 ? firstUrl : null,
      fetched_at: new Date().toISOString(),
      confidence: "official",
      stage_results: stageResults,
      ttt_results: [],
      jersey_holders: [],
      rider_statuses: [],
      startlist: [],
      teams: [],
      stage_metadata: [],
      individual_timing_rows: individualTimingRows,
      stage_fetch_metadata: stageFetchMetadata,
      jersey_fetch_metadata: jerseyFetchMetadata,
      warnings
    };
  }

  async fetchStageResults() {
    const payload = await this.readPayload();
    return [...(payload.stage_results ?? []), ...(payload.ttt_results ?? [])];
  }

  async fetchJerseyHolders() {
    return (await this.readPayload()).jersey_holders ?? [];
  }

  async fetchRiderStatuses() {
    return (await this.readPayload()).rider_statuses ?? [];
  }

  async fetchStartlist() {
    return (await this.readPayload()).startlist ?? [];
  }
}

export function validateFeedPayload(payload) {
  const validationErrors = [];
  const stageResults = [...(payload.stage_results ?? []), ...(payload.ttt_results ?? [])];
  for (const result of stageResults) {
    if (!result.stage_id && !result.stage_number) {
      validationErrors.push("Stage result is missing stage_id or stage_number.");
    }
    if (result.type === "ttt" && (result.riders?.length ?? 0) > 0) {
      validationErrors.push("TTT stage result must use teams, not rider placings.");
    }
    if (result.type !== "ttt" && (result.teams?.length ?? 0) > 0) {
      validationErrors.push("Non-TTT stage result must use rider placings, not teams.");
    }
  }
  for (const status of payload.rider_statuses ?? []) {
    if (!status.rider_id && !status.rider_name) {
      validationErrors.push("Rider status row is missing rider_id or rider_name.");
    }
    if (!["active", "dns", "dnf", "otl", "withdrawn", "suspended", "excluded", "unknown"].includes(status.status)) {
      validationErrors.push(`Unsupported rider status: ${status.status}`);
    }
  }
  return validationErrors;
}

export function summarizeFeedPayload(payload, options = {}) {
  const riderStatuses = payload.rider_statuses ?? [];
  const changedRiderStatuses = riderStatuses.filter((row) => row.status && row.status !== "active");
  const stageResults = payload.stage_results ?? [];
  const tttResults = payload.ttt_results ?? [];
  const jerseyHolders = payload.jersey_holders ?? [];

  const stageNumbers = uniqueSortedStageNumbers(stageResults, tttResults);
  const fromStage = options.importType === "backfill" ? options.fromStage : null;
  const toStage = options.importType === "backfill" ? options.toStage : null;
  const stagesConsidered = options.importType === "backfill"
    ? buildStageRange(fromStage, toStage)
    : stageNumbers;

  const stagesWithResults = stagesConsidered.filter((stage) => stageNumbers.includes(stage));
  const stagesMissingResults = stagesConsidered.filter((stage) => !stageNumbers.includes(stage));

  const unmatchedRidersInStageResults = stageResults
    .flatMap((result) => result.riders ?? [])
    .filter((row) => !row.rider_id).length;
  const unmatchedTeamsInTTTResults = tttResults
    .flatMap((result) => result.teams ?? [])
    .filter((row) => !row.team_id).length;

  return {
    sourceName: payload.source_name ?? "manual-json",
    sourceUrl: payload.source_url ?? null,
    fetchedAt: payload.fetched_at ?? null,
    matchedRiders: 0,
    unmatchedRiders: riderStatuses.filter((row) => !row.rider_id).length + unmatchedRidersInStageResults,
    unmatchedTeams: unmatchedTeamsInTTTResults,
    changedRiderStatuses: changedRiderStatuses.length,
    stageResultCandidates: stageResults.length,
    tttResultCandidates: tttResults.length,
    candidateJerseyHolderRows: jerseyHolders.length,
    candidateRiderStatusChanges: riderStatuses.length,
    individualTimingCandidates: (payload.individual_timing_rows ?? []).length,
    stagesConsidered,
    stagesWithResults,
    stagesMissingResults,
    scoringStages: stagesWithResults,
    leaderboardRebuildRequired: options.importType === "backfill" || stagesWithResults.length > 1,
    conflicts: [],
    segments: Object.fromEntries(FEED_SEGMENTS.map((segment) => [segment, 0]))
  };
}

export function buildFeedReview({ payload, mode, options = {} }) {
  const hasStageRange = options.fromStage !== null && options.toStage !== null;
  const importType = options.importType === "backfill" || options.backfill || options.allCompleted || hasStageRange
    ? "backfill"
    : "daily";
  const stageNumbers = uniqueSortedStageNumbers(payload.stage_results ?? [], payload.ttt_results ?? []);
  const inferredFromStage = importType === "backfill"
    ? options.fromStage ?? (options.allCompleted && stageNumbers.length ? stageNumbers[0] : null)
    : null;
  const inferredToStage = importType === "backfill"
    ? options.toStage ?? (options.allCompleted && stageNumbers.length ? stageNumbers[stageNumbers.length - 1] : null)
    : null;

  const validationErrors = validateFeedPayload(payload);
  const summary = summarizeFeedPayload(payload, {
    importType,
    fromStage: inferredFromStage,
    toStage: inferredToStage,
    allCompleted: options.allCompleted
  });

  const stageFetchMetadata = payload.stage_fetch_metadata ?? [];
  // Jersey-holder fetch/parse diagnostics (found/table_not_found/empty_table/
  // fetch_error/unsupported_markup per classification, per stage) are
  // surfaced for operator review but deliberately do NOT feed into
  // parserDriftDetected below — that field gates the hard "report.parserDriftDetected
  // must be false" apply refusal (scripts/grandtour-apply.mjs's
  // validateReportForApply) for the *stage-result* table specifically. A
  // missing/unmatched jersey holder already independently forces
  // safeToApply=false via reconcileJerseyHolders's blockers
  // (scripts/grandtour-reconciliation.mjs), which is the mechanism this
  // safety requirement actually relies on.
  const jerseyFetchMetadata = payload.jersey_fetch_metadata ?? [];
  const driftStatuses = new Set(["table_not_found", "parse_empty"]);
  const parserDriftDetected = stageFetchMetadata.some((entry) => driftStatuses.has(entry.status));

  const hasPendingIssues = summary.stagesMissingResults.length > 0 || summary.unmatchedRiders > 0 || summary.unmatchedTeams > 0;
  const importStatus = validationErrors.length || parserDriftDetected
    ? "failed"
    : importType === "backfill" && hasPendingIssues
      ? "review_required"
      : "validated";

  return {
    mode,
    importType,
    fromStage: inferredFromStage,
    toStage: inferredToStage,
    stageRangeRequested: { fromStage: options.fromStage ?? null, toStage: options.toStage ?? null },
    stageDate: options.stageDate ?? null,
    provider: payload.source_name ?? "manual-json",
    sourceUrl: payload.source_url ?? null,
    fetchedAt: payload.fetched_at ?? new Date().toISOString(),
    dryRun: mode !== "apply",
    applyEnabled: false,
    importStatus,
    parserDriftDetected,
    stageFetchMetadata,
    jerseyFetchMetadata,
    validationErrors,
    summary,
    warnings: payload.warnings ?? [],
    note: mode === "apply"
      ? "Apply mode currently validates and writes a review report only; production mutation requires explicit implementation against an approved provider."
      : parserDriftDetected
        ? "Dry run/review mode does not mutate database tables. Parser drift was detected — see stageFetchMetadata/warnings before trusting this report."
        : "Dry run/review mode does not mutate database tables."
  };
}

export function buildSkippedStageReport({ provider, asOfDate, reason }) {
  return {
    mode: "dry-run",
    importType: "daily",
    fromStage: null,
    toStage: null,
    stageRangeRequested: { fromStage: null, toStage: null },
    stageDate: null,
    provider,
    sourceUrl: null,
    fetchedAt: new Date().toISOString(),
    dryRun: true,
    applyEnabled: false,
    importStatus: "skipped",
    validationErrors: [],
    summary: null,
    warnings: [reason],
    note: `No stage was resolved for ${asOfDate}; the run was skipped safely without fetching or mutating anything.`
  };
}

export function parseFeedArgs(argv) {
  const options = {
    ...parseBaseArgs([]),
    apply: false,
    provider: "manual-json",
    sourceFile: null,
    reportPath: path.resolve("data", "cycling", "grandtour_feed_review.json"),
    backfill: false,
    allCompleted: false,
    fromStage: null,
    toStage: null,
    confirmProduction: false,
    force: false,
    asOfDate: null,
    stageCalendarPath: DEFAULT_STAGE_CALENDAR_PATH,
    reconcile: false,
    grandTourId: null,
    grandTourName: "Tour de France",
    grandTourYear: 2026,
    fromReportPath: null,
    confirmProvider: null,
    confirmStage: null,
    reason: null,
    requestId: null
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") {
      options.apply = true;
    } else if (argument === "--provider") {
      options.provider = argv[++index] ?? "";
      if (!options.provider) throw new Error("--provider requires a value");
    } else if (argument === "--source-file") {
      options.sourceFile = path.resolve(argv[++index] ?? "");
      if (!options.sourceFile) throw new Error("--source-file requires a path");
    } else if (argument === "--report") {
      options.reportPath = path.resolve(argv[++index] ?? "");
      if (!options.reportPath) throw new Error("--report requires a path");
    } else if (argument === "--backfill") {
      options.backfill = true;
    } else if (argument === "--import-type") {
      options.importType = argv[++index] ?? "";
      if (!options.importType) throw new Error("--import-type requires a value");
      if (!["daily", "backfill"].includes(options.importType)) {
        throw new Error("--import-type must be either 'daily' or 'backfill'.");
      }
    } else if (argument === "--all-completed") {
      options.allCompleted = true;
    } else if (argument === "--from-stage") {
      options.fromStage = Number(argv[++index] ?? "");
      if (!Number.isInteger(options.fromStage) || options.fromStage <= 0) {
        throw new Error("--from-stage requires a positive integer");
      }
    } else if (argument === "--to-stage") {
      options.toStage = Number(argv[++index] ?? "");
      if (!Number.isInteger(options.toStage) || options.toStage <= 0) {
        throw new Error("--to-stage requires a positive integer");
      }
    } else if (argument === "--confirm-production") {
      options.confirmProduction = true;
    } else if (argument === "--force") {
      options.force = true;
    } else if (argument === "--as-of-date") {
      options.asOfDate = argv[++index] ?? "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(options.asOfDate)) {
        throw new Error("--as-of-date requires a YYYY-MM-DD value");
      }
    } else if (argument === "--stage-calendar") {
      options.stageCalendarPath = path.resolve(argv[++index] ?? "");
      if (!options.stageCalendarPath) throw new Error("--stage-calendar requires a path");
    } else if (argument === "--reconcile") {
      options.reconcile = true;
    } else if (argument === "--grand-tour-id") {
      options.grandTourId = argv[++index] ?? "";
      if (!options.grandTourId) throw new Error("--grand-tour-id requires a value");
    } else if (argument === "--grand-tour-name") {
      options.grandTourName = argv[++index] ?? "";
      if (!options.grandTourName) throw new Error("--grand-tour-name requires a value");
    } else if (argument === "--grand-tour-year") {
      options.grandTourYear = Number(argv[++index] ?? "");
      if (!Number.isInteger(options.grandTourYear)) throw new Error("--grand-tour-year requires an integer");
    } else if (argument === "--from-report") {
      options.fromReportPath = path.resolve(argv[++index] ?? "");
      if (!options.fromReportPath) throw new Error("--from-report requires a path");
    } else if (argument === "--confirm-provider") {
      options.confirmProvider = argv[++index] ?? "";
      if (!options.confirmProvider) throw new Error("--confirm-provider requires a value");
    } else if (argument === "--confirm-stage") {
      options.confirmStage = Number(argv[++index] ?? "");
      if (!Number.isInteger(options.confirmStage) || options.confirmStage <= 0) {
        throw new Error("--confirm-stage requires a positive integer");
      }
    } else if (argument === "--reason") {
      options.reason = argv[++index] ?? "";
      if (!options.reason) throw new Error("--reason requires a value");
    } else if (argument === "--request-id") {
      options.requestId = argv[++index] ?? "";
      if (!options.requestId) throw new Error("--request-id requires a value");
    } else if (argument !== "--dry-run") {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (options.reconcile && options.provider !== "official-letour") {
    throw new Error("--reconcile is only supported with --provider official-letour.");
  }

  if (options.apply) {
    if (options.reconcile) {
      throw new Error("--apply cannot be combined with --reconcile. Apply mode reads an existing reviewed report via --from-report; it never reconciles live.");
    }
    if (options.provider !== "official-letour") {
      throw new Error("--apply requires --provider official-letour.");
    }
    if (!options.fromReportPath) {
      throw new Error("--apply requires --from-report <path>, pointing to a report previously generated with --reconcile.");
    }
    if (!options.confirmProvider) {
      throw new Error("--apply requires --confirm-provider official-letour.");
    }
    if (options.confirmProvider !== "official-letour") {
      throw new Error(`--confirm-provider must be exactly "official-letour" (got "${options.confirmProvider}").`);
    }
    if (options.confirmProvider !== options.provider) {
      throw new Error(`--confirm-provider ("${options.confirmProvider}") must match --provider ("${options.provider}").`);
    }
    if (options.confirmStage === null) {
      throw new Error("--apply requires --confirm-stage <stage_number>.");
    }
    if (options.fromStage !== null && options.fromStage !== options.confirmStage) {
      throw new Error(`--from-stage (${options.fromStage}) must equal --confirm-stage (${options.confirmStage}) when using --apply.`);
    }
    if (options.toStage !== null && options.toStage !== options.confirmStage) {
      throw new Error(`--to-stage (${options.toStage}) must equal --confirm-stage (${options.confirmStage}) when using --apply.`);
    }
  }

  if ((options.fromStage !== null && options.toStage === null) || (options.fromStage === null && options.toStage !== null)) {
    throw new Error("--from-stage and --to-stage must be used together.");
  }

  if ((options.backfill || options.fromStage !== null || options.toStage !== null || options.allCompleted) && !options.allCompleted && (options.fromStage === null || options.toStage === null)) {
    throw new Error("--backfill requires either --from-stage/--to-stage or --all-completed.");
  }

  if (options.fromStage !== null || options.toStage !== null || options.allCompleted) {
    options.backfill = true;
  }

  return options;
}
