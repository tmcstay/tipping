// Parsers for the UCI public data surface discovered during this
// project's investigation (see scripts/uci-client.mjs's module
// doc comment for how it was found and verified). Both parsers prefer
// structured JSON over rendered-text scraping:
//   - the rider search API (/api/riders/<discipline>/<year>?search=...)
//     returns plain JSON directly — no HTML parsing needed at all.
//   - the rider-details page (/rider-details/<id>) is server-rendered
//     HTML, but embeds a clean JSON payload in a
//     `data-component="RiderDetailsModule" data-props="{...}"` attribute
//     (confirmed against a real fetch of
//     https://www.uci.org/rider-details/149727 this session) — this
//     module extracts and JSON.parses that attribute rather than
//     regex-scraping the rendered label/value text around it, so it
//     can't suffer the "field values bleed into each other" class of bug
//     documented in scripts/tdf-2026-rider-parsers.mjs's history.

function decodeHtmlEntities(value) {
  return String(value)
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)));
}

/** `/rider-details/12345` -> `"12345"`. Returns null for anything else. */
export function uciRiderIdFromUrl(url) {
  const match = String(url ?? "").match(/\/rider-details\/(\d+)/);
  return match ? match[1] : null;
}

export function uciRiderProfileUrl(uciRiderId) {
  return `https://www.uci.org/rider-details/${uciRiderId}`;
}

/**
 * Parses the JSON body of `GET /api/riders/<discipline>/<year>?search=...`
 * (confirmed live: `{"totalItems":1,"page":1,"pageSize":25,"items":[{"givenName":"Tadej","familyName":"POGAČAR","countryCode":"SLO","teamName":"UAE TEAM EMIRATES XRG (UEX)","url":"/rider-details/149727"}]}`).
 * Throws a descriptive error on a genuinely malformed body; a well-formed
 * response with zero hits is not an error (`items: []` is valid).
 */
export function parseUciRiderSearchResponse(jsonText) {
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    throw new Error(`UCI rider search response is not valid JSON: ${error.message}`);
  }
  if (!parsed || !Array.isArray(parsed.items)) {
    throw new Error("UCI rider search response is missing an \"items\" array");
  }
  return {
    totalItems: typeof parsed.totalItems === "number" ? parsed.totalItems : parsed.items.length,
    page: parsed.page ?? 1,
    pageSize: parsed.pageSize ?? parsed.items.length,
    items: parsed.items.map((item) => ({
      givenName: item.givenName ?? null,
      familyName: item.familyName ?? null,
      countryCode: item.countryCode ?? null,
      teamName: item.teamName ?? null,
      url: item.url ?? null,
      uciRiderId: uciRiderIdFromUrl(item.url),
    })),
  };
}

const UCI_DATE_RE = /^(\d{2})\.(\d{2})\.(\d{4})$/;

/** `"21.09.1998"` -> `"1998-09-21"`. Returns null for anything else (never guesses at an ambiguous format). */
export function parseUciDate(rawDate) {
  const match = String(rawDate ?? "").trim().match(UCI_DATE_RE);
  if (!match) return null;
  const [, day, month, year] = match;
  return `${year}-${month}-${day}`;
}

/**
 * Extracts and JSON.parses a `data-component="<componentName>"
 * data-props="{...}"` attribute's value from raw HTML. Bounded to the one
 * matching component's attribute value — never falls back to flattening
 * the whole page to text, so this can't suffer the field-bleed bug the
 * PCS-era parser had (see scripts/tdf-2026-rider-parsers.mjs's history).
 * Returns null if the component isn't present on the page at all (a
 * genuinely different page, not a parse failure); throws if the
 * component is present but its data-props isn't valid JSON (a real
 * markup-format change worth surfacing loudly).
 */
export function extractDataComponentProps(html, componentName) {
  const marker = `data-component="${componentName}" data-props="`;
  const startIndex = html.indexOf(marker);
  if (startIndex === -1) return null;
  const valueStart = startIndex + marker.length;
  const endIndex = html.indexOf('">', valueStart);
  if (endIndex === -1) {
    throw new Error(`Found data-component="${componentName}" but could not find the end of its data-props attribute`);
  }
  const rawValue = decodeHtmlEntities(html.slice(valueStart, endIndex));
  try {
    return JSON.parse(rawValue);
  } catch (error) {
    throw new Error(`data-component="${componentName}"'s data-props is not valid JSON: ${error.message}`);
  }
}

/**
 * Merges consecutive years of the same team/team-code into a single
 * `{ yearRange, teamName, teamCode, countryCode }` entry (e.g. 2019-2023
 * at the same team becomes one row instead of five) — the "year or year
 * range" structuring this task's spec asks for. UCI's own team-history
 * array is one row per year, newest first; this assumes that ordering
 * (each row's `year` one less than the previous row's, for the same
 * team) rather than re-sorting, since re-sorting a raw year string
 * (`"2026"`) is unnecessary when the source already provides them in
 * order and doing so would silently mask a source-order change.
 */
export function compressTeamHistoryToRanges(teams) {
  const ranges = [];
  for (const team of teams ?? []) {
    const year = Number(team.year);
    const previous = ranges.at(-1);
    const sameTeam = previous
      && previous.teamCode === team.teamCode
      && previous.teamName === team.teamName
      && Number.isInteger(year)
      && Number.isInteger(previous._minYear)
      && year === previous._minYear - 1;
    if (sameTeam) {
      previous._minYear = year;
      previous.yearRange = `${year}-${previous._maxYear}`;
    } else {
      ranges.push({
        yearRange: team.year,
        teamName: team.teamName ?? null,
        teamCode: team.teamCode ?? null,
        countryCode: team.countryCode ?? null,
        _minYear: year,
        _maxYear: year,
      });
    }
  }
  return ranges.map(({ _minYear, _maxYear, ...rest }) => rest);
}

/**
 * Parses a UCI rider-details page. `html` is the raw page (not
 * pre-stripped of tags); `uciRiderId` is the id this profile was fetched
 * for (from the request URL, not re-derived from the payload — the
 * payload has no explicit rider-id field of its own). Returns `null`
 * (never throws) when the page genuinely has no `RiderDetailsModule` —
 * e.g. a since-removed/renumbered profile — so the caller can treat that
 * as "no profile", not a parser bug.
 */
export function parseUciRiderDetailsHtml(html, { uciRiderId } = {}) {
  const props = extractDataComponentProps(html, "RiderDetailsModule");
  if (!props) return null;

  const details = props.details ?? {};
  const givenName = details.givenName ?? null;
  const familyName = details.familyName ?? null;
  const canonicalName = [givenName, familyName].filter(Boolean).join(" ").trim() || null;
  const dateOfBirth = parseUciDate(details.dob);
  const rawTeams = props.history?.teams ?? [];

  return {
    uciRiderId: uciRiderId ?? null,
    profileUrl: uciRiderId ? uciRiderProfileUrl(uciRiderId) : null,
    givenName,
    familyName,
    canonicalName,
    dateOfBirthRaw: details.dob ?? null,
    dateOfBirth,
    nationality: details.nationality ?? null,
    currentTeam: details.location ?? null,
    sanctions: details.sanctions ?? null,
    teamHistoryRaw: rawTeams.map((team) => ({
      year: team.year ?? null,
      teamName: team.teamName ?? null,
      teamCode: team.teamCode ?? null,
      countryCode: team.countryCode ?? null,
    })),
    teamHistory: compressTeamHistoryToRanges(rawTeams),
  };
}
