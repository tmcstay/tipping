/**
 * The single shared formatter for a grand tour's user-facing display name -
 * e.g. "Tour de France ’26". No screen should read `grand_tours.name`/`year`
 * directly and format it independently; every consumer calls
 * `formatGrandTourName` instead, so the convention only has to be correct
 * in one place.
 *
 * `grand_tours.name` is free text and is NOT reliable to display verbatim -
 * it varies by environment (local seed data uses "GrandTour France 2026",
 * not "Tour de France 2026") and has no structured field (no race-type
 * enum, no reliable `category`/`countries` values) that identifies which
 * real-world race it is. This resolves the *official* event name via a
 * defensive keyword match against the raw name (same approach already used
 * by lib/raceAccent.ts for heading colour), and always takes the year from
 * the authoritative `year` integer column - never parsed out of the name
 * string, which would silently break if a name ever omits it.
 */

export type GrandTourNameSource = {
  name?: string | null;
  year?: number | null;
};

const KNOWN_GRAND_TOURS: { pattern: RegExp; officialName: string }[] = [
  { pattern: /tour\s*de\s*france|\bfrance\b/i, officialName: "Tour de France" },
  { pattern: /\bgiro\b|\bitalia\b/i, officialName: "Giro d’Italia" },
  { pattern: /\bvuelta\b|espa[nñ]a/i, officialName: "Vuelta a España" }
];

// Strips a trailing four-digit year (optionally parenthesised) from an
// unrecognised race name, so an unknown race never ends up with a doubled
// year suffix (e.g. "Some Race 2026 ’26").
const TRAILING_YEAR_PATTERN = /\s*\(?\b(?:19|20)\d{2}\)?\s*$/;

function resolveOfficialName(rawName: string | null | undefined): string {
  const source = (rawName ?? "").trim();
  const known = KNOWN_GRAND_TOURS.find((entry) => entry.pattern.test(source));
  if (known) return known.officialName;
  const withoutYear = source.replace(TRAILING_YEAR_PATTERN, "").trim();
  return withoutYear || "Grand Tour";
}

function formatAbbreviatedYear(year: number | null | undefined): string | null {
  if (year === null || year === undefined || !Number.isFinite(year)) return null;
  const twoDigit = String(Math.trunc(year)).slice(-2).padStart(2, "0");
  return `’${twoDigit}`;
}

/** e.g. formatGrandTourName({ name: "GrandTour France 2026", year: 2026 }) -> "Tour de France ’26" */
export function formatGrandTourName(source: GrandTourNameSource | null | undefined): string {
  const officialName = resolveOfficialName(source?.name);
  const yearSuffix = formatAbbreviatedYear(source?.year);
  return yearSuffix ? `${officialName} ${yearSuffix}` : officialName;
}
