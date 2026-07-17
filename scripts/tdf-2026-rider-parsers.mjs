// Re-export the existing, already-verified official-letour start-list
// parser (source #1) rather than duplicating it — it already covers
// exactly what this importer needs from that page (bib number, rider
// name, team, nationality). See scripts/letour-official-riders.mjs.
//
// procyclingstats.com (this file's earlier "source #2" parsers) has been
// retired from this importer's source hierarchy entirely — it returned
// HTTP 403 to every fetch attempt, and UCI's public rider-details/search
// data surface (scripts/uci-parsers.mjs,
// scripts/uci-client.mjs) replaced it as the primary enrichment
// source. See CLAUDE.md's rider-importer section for the full history.
export { parseOfficialTourRidersHtml } from "./letour-official-riders.mjs";

import { fetchTextCached } from "./source-fetch-utils.mjs";
import { parseOfficialTourRidersHtml } from "./letour-official-riders.mjs";

const LETOUR_RIDERS_URL = "https://www.letour.fr/en/riders";

/**
 * Fetches and parses the live official Tour de France riders page.
 * Extracted here so `tdf-2026-rider-importer.mjs`,
 * `tdf-2026-registry-match-report.mjs`, and `uci-rider-sync.mjs`'s
 * roster-seed mode share one implementation instead of three identical
 * private copies.
 */
export async function fetchOfficialTourRoster({ cache, rateLimiter, fetchImpl } = {}) {
  const { body } = await fetchTextCached(LETOUR_RIDERS_URL, { cache, rateLimiter, fetchImpl });
  return parseOfficialTourRidersHtml(body);
}
