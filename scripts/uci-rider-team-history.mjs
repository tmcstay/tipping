import { normalizeTeamName } from "./tdf-data-utils.mjs";

/**
 * Turns UCI's already-parsed `teamHistoryRaw` (scripts/uci-parsers.mjs's
 * parseUciRiderDetailsHtml output -- one row per year, `{year, teamName,
 * teamCode, countryCode}`) into planned `uci_rider_team_history` upserts.
 * Pure, no I/O.
 *
 * Reuses `normalizeTeamName` (tdf-data-utils.mjs) for variation-tolerant
 * comparison, but NEVER auto-merges two distinct internal
 * (grandtour_teams) teams on name similarity alone -- team_id is only
 * ever resolved on an exact normalized name/code equality; anything else
 * is left null, to be resolved later, contextually, by a human or a
 * later race-entry matching pass.
 */

function resolveTeamId({ sourceTeamName, sourceTeamCode }, teamsIndex) {
  if (!teamsIndex) return null;
  if (sourceTeamCode) {
    const byCode = teamsIndex.byCode?.get(normalizeTeamName(sourceTeamCode));
    if (byCode) return byCode;
  }
  if (sourceTeamName) {
    const byName = teamsIndex.byName?.get(normalizeTeamName(sourceTeamName));
    if (byName) return byName;
  }
  return null;
}

/**
 * Builds a lookup index ({byCode, byName}, both Maps of normalized key ->
 * team id) from a flat list of `{id, name, code}` grandtour_teams rows --
 * the shape callers already have from a read like
 * scripts/grandtour-reconciliation-supabase.mjs's team queries.
 */
export function buildTeamLookupIndex(teams = []) {
  const byCode = new Map();
  const byName = new Map();
  for (const team of teams) {
    if (team.code) byCode.set(normalizeTeamName(team.code), team.id);
    if (team.name) byName.set(normalizeTeamName(team.name), team.id);
  }
  return { byCode, byName };
}

/**
 * Plans the team-history upserts for one rider's already-fetched
 * `teamHistoryRaw` array against its already-existing
 * `uci_rider_team_history` rows (read for that `rider_id`). Every planned
 * row's key -- `(rider_id, season_year, source_team_code ?? '', source)`
 * -- matches the DB's own unique index exactly, so an unchanged season is
 * skipped (never re-inserted), and a genuinely changed one (rare -- a
 * team-history row is normally append-only across weekly syncs) is
 * queued as an update against its existing row id.
 */
export function planRiderTeamHistorySync({ riderId, teamHistoryRaw = [], teamsIndex = null, source = "uci" }, existingHistory = []) {
  const existingByKey = new Map(
    existingHistory.map((row) => [`${row.season_year}|${row.source_team_code ?? ""}|${row.source}`, row]),
  );

  const inserts = [];
  const updates = [];
  const unchanged = [];
  // Guards against two raw team-history entries (within this single
  // rider's own teamHistoryRaw) landing on the identical persistence key
  // (season_year + team_code + source) -- e.g. UCI recording two stints
  // in the same season, one or both missing a team code. The DB's own
  // unique index only has room for one row per key; two inserts sharing a
  // key crash the batch outright rather than degrading gracefully. The
  // first entry for a given key wins; later duplicates are dropped, not
  // guessed at or silently double-applied.
  const seenKeysThisRun = new Set();

  for (const entry of teamHistoryRaw) {
    const seasonYear = Number.isInteger(entry.year) ? entry.year : (Number.isInteger(Number(entry.year)) ? Number(entry.year) : null);
    const key = `${seasonYear}|${entry.teamCode ?? ""}|${source}`;
    if (seenKeysThisRun.has(key)) continue;
    seenKeysThisRun.add(key);
    const teamId = resolveTeamId({ sourceTeamName: entry.teamName, sourceTeamCode: entry.teamCode }, teamsIndex);

    const row = {
      rider_id: riderId,
      team_id: teamId,
      source_team_name: entry.teamName ?? null,
      source_team_code: entry.teamCode ?? null,
      season_year: seasonYear,
      discipline: "road",
      source,
    };

    const existing = existingByKey.get(key);
    if (!existing) {
      inserts.push(row);
      continue;
    }
    // Only genuinely different content (team name/code, or a
    // newly-resolvable team_id) triggers an update -- a season already
    // recorded identically is left untouched.
    const changed = existing.source_team_name !== row.source_team_name
      || existing.team_id !== row.team_id;
    if (changed) {
      updates.push({ id: existing.id, ...row });
    } else {
      unchanged.push({ id: existing.id, ...row });
    }
  }

  return {
    inserts,
    updates,
    unchanged,
    summary: { inserted: inserts.length, updated: updates.length, unchanged: unchanged.length, teamIdResolvedCount: [...inserts, ...updates].filter((row) => row.team_id).length },
  };
}
