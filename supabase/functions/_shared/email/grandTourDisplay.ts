/**
 * Reimplementation of apps/mobile/lib/grandTourDisplay.ts's
 * formatGrandTourName for this Edge Function's own Deno/node runtime -
 * following the same "reimplement per runtime, don't cross-import" pattern
 * already used for the score-badge logic in this directory (see
 * CLAUDE.md's Resend email section). Keep both copies in sync by hand if
 * the naming convention ever changes; there is no cross-package import
 * path between apps/mobile and supabase/functions.
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

export function formatGrandTourName(source: GrandTourNameSource | null | undefined): string {
  const officialName = resolveOfficialName(source?.name);
  const yearSuffix = formatAbbreviatedYear(source?.year);
  return yearSuffix ? `${officialName} ${yearSuffix}` : officialName;
}
