import fs from "node:fs/promises";
import path from "node:path";

import { parseOfficialTourRidersHtml } from "./letour-official-riders.mjs";
import {
  normalizeRiderName,
  parseCsv,
  stableUuid,
} from "./tdf-data-utils.mjs";

const DEFAULT_DATA_DIR = path.resolve("data/cycling/tdf/2026");
const DEFAULT_HTML = path.resolve("dist/official-source/letour-riders.html");
const OFFICIAL_LIST_URL = "https://www.letour.fr/en/riders";

function repairMojibake(value) {
  if (!/[ÃÄÅâ]/.test(value)) return value;
  const repaired = Buffer.from(value, "latin1").toString("utf8");
  const score = (text) => (text.match(/[ÃÄÅâ�]/g) ?? []).length;
  return score(repaired) < score(value) ? repaired : value;
}

function titleCaseName(value) {
  return value.toLocaleLowerCase("en").replace(
    /(^|[\s\-'’])([\p{L}])/gu,
    (_, prefix, letter) => `${prefix}${letter.toLocaleUpperCase("en")}`,
  );
}

function csvValue(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(rows, columns) {
  return `${columns.join(",")}\n${rows.map((row) => columns.map((column) => csvValue(row[column])).join(",")).join("\n")}\n`;
}

async function readCsv(dataDir, filename) {
  return parseCsv(await fs.readFile(path.join(dataDir, filename), "utf8"));
}

function parseArgs(argv) {
  const options = { apply: false, dataDir: DEFAULT_DATA_DIR, html: DEFAULT_HTML };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") options.apply = true;
    else if (argument === "--data-dir") options.dataDir = path.resolve(argv[++index]);
    else if (argument === "--html") options.html = path.resolve(argv[++index]);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const [html, aliasText, existingRiders, existingStartlist, existingTeams, auditRows] = await Promise.all([
    fs.readFile(options.html, "utf8"),
    fs.readFile(path.join(options.dataDir, "official_startlist_aliases_2026.json"), "utf8"),
    readCsv(options.dataDir, "riders_2026_tdf.csv"),
    readCsv(options.dataDir, "startlist_2026_tdf.csv"),
    readCsv(options.dataDir, "teams_2026_tdf.csv"),
    readCsv(options.dataDir, "data_audit_2026_tdf.csv"),
  ]);
  const aliases = JSON.parse(aliasText);
  const officialTeams = parseOfficialTourRidersHtml(html);
  const raceId = existingStartlist[0]?.race_id;
  if (!raceId) throw new Error("Existing startlist does not contain a race ID");

  const existingByNormalizedName = new Map();
  for (const rider of existingRiders) {
    const repairedName = repairMojibake(rider.full_name);
    const normalized = normalizeRiderName(repairedName);
    existingByNormalizedName.set(normalized, [...(existingByNormalizedName.get(normalized) ?? []), { ...rider, repairedName }]);
  }
  const existingById = new Map(existingRiders.map((rider) => [rider.id, rider]));
  const existingStartlistByRider = new Map(existingStartlist.map((entry) => [entry.rider_id, entry]));
  const teamRowsById = new Map(existingTeams.map((team) => [team.id, team]));
  const matchedExistingIds = new Set();
  const exactMatches = [];
  const aliasMatches = [];
  const inserted = [];
  const conflicts = [];
  const riders = [];
  const startlist = [];

  const teams = officialTeams.map((officialTeam) => {
    const alias = aliases.teams[officialTeam.code];
    if (!alias || !teamRowsById.has(alias.id)) throw new Error(`Missing reviewed team alias for ${officialTeam.code}`);
    const existing = teamRowsById.get(alias.id);
    if (existing.name !== alias.name) conflicts.push({ type: "team_name", id: alias.id, existing: existing.name, incoming: alias.name });
    return {
      ...existing,
      name: alias.name,
      code: officialTeam.code,
      source_url: officialTeam.source_url,
      data_confidence: "high",
      updated_at: `${aliases.accessed_at}T00:00:00Z`,
    };
  });

  for (const officialTeam of officialTeams) {
    const teamAlias = aliases.teams[officialTeam.code];
    for (const officialRider of officialTeam.riders) {
      const normalizedOfficial = normalizeRiderName(officialRider.official_name);
      const candidates = existingByNormalizedName.get(normalizedOfficial) ?? [];
      const reviewedAlias = aliases.rider_ids_by_bib[String(officialRider.bib_number)];
      let existing = null;
      let matchMethod = null;
      if (candidates.length === 1) {
        existing = candidates[0];
        matchMethod = "exact_normalized_name_and_tour";
        exactMatches.push({ bib_number: officialRider.bib_number, id: existing.id, name: existing.repairedName });
      } else if (candidates.length > 1) {
        const sameTeam = candidates.filter((candidate) => existingStartlistByRider.get(candidate.id)?.team_id === teamAlias.id);
        if (sameTeam.length === 1) {
          existing = sameTeam[0];
          matchMethod = "team_and_normalized_name";
          exactMatches.push({ bib_number: officialRider.bib_number, id: existing.id, name: existing.repairedName });
        }
      }
      if (!existing && reviewedAlias) {
        existing = existingById.get(reviewedAlias.id);
        if (!existing) throw new Error(`Reviewed rider alias ${reviewedAlias.id} does not exist`);
        matchMethod = "reviewed_alias";
        aliasMatches.push({
          bib_number: officialRider.bib_number,
          id: existing.id,
          existing_name: repairMojibake(existing.full_name),
          official_name: officialRider.official_name,
        });
      }
      if (!existing && candidates.length > 0) {
        throw new Error(`Ambiguous official rider ${officialRider.official_name}; add a reviewed alias`);
      }

      const id = existing?.id ?? stableUuid(`official-tdf-2026-rider:${officialRider.profile_url}`);
      const displayName = reviewedAlias?.display_name
        ?? existing?.repairedName
        ?? titleCaseName(officialRider.official_name);
      if (existing) matchedExistingIds.add(existing.id);
      else inserted.push({ bib_number: officialRider.bib_number, id, name: displayName, team_code: officialTeam.code });
      const previousStartlist = existing ? existingStartlistByRider.get(existing.id) : null;
      riders.push({
        id,
        full_name: displayName,
        nationality: officialRider.nationality,
        date_of_birth: existing?.date_of_birth ?? "",
        rider_role: existing?.rider_role || "unknown",
        source_url: officialRider.profile_url,
        data_confidence: "high",
        created_at: existing?.created_at ?? `${aliases.accessed_at}T00:00:00Z`,
        updated_at: `${aliases.accessed_at}T00:00:00Z`,
      });
      startlist.push({
        id: previousStartlist?.id ?? stableUuid(`official-tdf-2026-startlist:${raceId}:${id}`),
        race_id: raceId,
        rider_id: id,
        team_id: teamAlias.id,
        status: "confirmed",
        bib_number: officialRider.bib_number,
        source_url: OFFICIAL_LIST_URL,
        data_confidence: "high",
        created_at: previousStartlist?.created_at ?? `${aliases.accessed_at}T00:00:00Z`,
        updated_at: `${aliases.accessed_at}T00:00:00Z`,
      });
      if (existing && existingStartlistByRider.get(existing.id)?.team_id !== teamAlias.id) {
        conflicts.push({
          type: "rider_team",
          id,
          name: displayName,
          existing: existingStartlistByRider.get(existing.id)?.team_id ?? null,
          incoming: teamAlias.id,
          matchMethod,
        });
      }
    }
  }

  const removedProvisionalRiders = existingRiders
    .filter((rider) => !matchedExistingIds.has(rider.id))
    .map((rider) => ({ id: rider.id, name: repairMojibake(rider.full_name), team_id: existingStartlistByRider.get(rider.id)?.team_id ?? null }));
  const duplicateBibNumbersPerTeam = [...new Map(startlist.map((entry) => [`${entry.team_id}|${entry.bib_number}`, []])).keys()]
    .filter((groupKey) => startlist.filter((entry) => `${entry.team_id}|${entry.bib_number}` === groupKey).length > 1);
  const report = {
    source: OFFICIAL_LIST_URL,
    accessed_at: aliases.accessed_at,
    officialTeams: officialTeams.length,
    officialRiders: riders.length,
    exactMatches: exactMatches.length,
    reviewedAliasMatches: aliasMatches.length,
    ridersInserted: inserted.length,
    ridersRemovedFromProvisionalSnapshot: removedProvisionalRiders.length,
    missingBibNumbers: startlist.filter((entry) => !entry.bib_number).length,
    duplicateBibNumbersPerTourTeam: duplicateBibNumbersPerTeam,
    conflicts,
    aliasMatches,
    inserted,
    removedProvisionalRiders,
  };
  const reportPath = path.join(options.dataDir, "official_startlist_refresh_report.json");
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (options.apply) {
    const officialSourceRow = {
      source_name: "Official Tour de France 2026 start list",
      source_url: OFFICIAL_LIST_URL,
      date_accessed: aliases.accessed_at,
      fields_found: "184 official starters, bib numbers, team assignments, nationality codes",
      missing_fields: "Bulk dates of birth and rider roles",
      confidence_notes: "Primary official race-organiser start list captured after the race began.",
      data_confidence: "high",
      reuse_risk: "medium",
      comments: "One public start-list page was captured; no rider-profile crawl was required.",
    };
    const nextAudit = [...auditRows.filter((row) => row.source_url !== OFFICIAL_LIST_URL), officialSourceRow];
    await Promise.all([
      fs.writeFile(path.join(options.dataDir, "teams_2026_tdf.csv"), toCsv(teams, Object.keys(existingTeams[0])), "utf8"),
      fs.writeFile(path.join(options.dataDir, "riders_2026_tdf.csv"), toCsv(riders, Object.keys(existingRiders[0])), "utf8"),
      fs.writeFile(path.join(options.dataDir, "startlist_2026_tdf.csv"), toCsv(startlist, Object.keys(existingStartlist[0])), "utf8"),
      fs.writeFile(path.join(options.dataDir, "official_riders_2026_tdf.csv"), toCsv(
        officialTeams.flatMap((team) => team.riders.map((rider) => ({ team_code: team.code, team_name: team.name, ...rider }))),
        ["team_code", "team_name", "bib_number", "official_name", "nationality", "profile_url"],
      ), "utf8"),
      fs.writeFile(path.join(options.dataDir, "data_audit_2026_tdf.csv"), toCsv(nextAudit, Object.keys(auditRows[0])), "utf8"),
    ]);
  }
  console.log(JSON.stringify({ mode: options.apply ? "apply" : "review", reportPath, ...report }, null, 2));
}

await main();
