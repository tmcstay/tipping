import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_TDF_DATA_DIR = path.join(
  ROOT_DIR,
  "data",
  "cycling",
  "tdf",
  "2026",
);

const UUID_NAMESPACE = "fd9ee73c-0c8f-4c80-a4d4-aacaaee0f3dd";

function uuidToBytes(uuid) {
  return Buffer.from(uuid.replaceAll("-", ""), "hex");
}

export function stableUuid(value, namespace = UUID_NAMESPACE) {
  const hash = crypto
    .createHash("sha1")
    .update(Buffer.concat([uuidToBytes(namespace), Buffer.from(value, "utf8")]))
    .digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function normalizeRiderName(name) {
  return name
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en");
}

// Team names vary far more in punctuation/hyphenation across sources than
// rider names do (e.g. official-letour's compact "LIDL-TREK" vs our
// canonical "Lidl - Trek"), so team-name comparison additionally folds
// every run of punctuation (hyphens, pipes, periods, ampersands, etc.) down
// to a single space before comparing tokens. This intentionally does not
// share normalizeRiderName's exact behavior — collapsing punctuation to
// whitespace is correct for sponsor-string team names but would be wrong
// for rider names (e.g. a hyphenated surname).
export function normalizeTeamName(name) {
  return name
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en");
}

export function parseOptionalBibNumber(value) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const bibNumber = Number(value);
  if (!Number.isInteger(bibNumber) || bibNumber <= 0) {
    throw new Error(`Bib number must be a positive integer: ${value}`);
  }
  return bibNumber;
}

function duplicateValues(rows, valueForRow) {
  const seen = new Map();
  for (const row of rows) {
    const value = valueForRow(row);
    const matches = seen.get(value) ?? [];
    matches.push(row.id);
    seen.set(value, matches);
  }
  return [...seen.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([value, ids]) => ({ ids, value }));
}

function missingRequiredFields(entity, rows, fields) {
  return rows.flatMap((row, index) => fields
    .filter((field) => row[field] === undefined || row[field] === null || row[field] === "")
    .map((field) => `${entity}[${row.id ?? index}].${field}`));
}

export function analyzeTdfDataset(dataset) {
  const missingRequired = [
    ...missingRequiredFields("race", [dataset.race], [
      "id", "name", "year", "start_date", "end_date", "category", "source_url", "data_confidence",
    ]),
    ...missingRequiredFields("stages", dataset.stages, [
      "id", "race_id", "stage_number", "stage_date", "start_location", "finish_location",
      "distance_km", "stage_type", "is_rest_day", "source_url", "data_confidence",
    ]),
    ...missingRequiredFields("teams", dataset.teams, [
      "id", "name", "team_type", "source_url", "data_confidence",
    ]),
    ...missingRequiredFields("riders", dataset.riders, [
      "id", "full_name", "source_url", "data_confidence",
    ]),
    ...missingRequiredFields("startlist", dataset.startlist, [
      "id", "race_id", "rider_id", "team_id", "status", "source_url", "data_confidence",
    ]),
    ...missingRequiredFields("audit", dataset.audit, [
      "source_name", "source_url", "date_accessed", "fields_found", "missing_fields",
      "confidence_notes", "data_confidence", "reuse_risk", "comments",
    ]),
  ];

  return {
    missingRequiredFields: missingRequired,
    duplicateRiderNames: duplicateValues(
      dataset.riders,
      (rider) => normalizeRiderName(rider.full_name),
    ),
    duplicateTeamNames: duplicateValues(
      dataset.teams,
      (team) => normalizeTeamName(team.name),
    ),
    knownOptionalGaps: {
      teamsWithoutCode: dataset.teams.filter((team) => !team.code).length,
      teamsWithoutCountry: dataset.teams.filter((team) => !team.country).length,
      ridersWithoutNationality: dataset.riders.filter((rider) => !rider.nationality).length,
      ridersWithoutDateOfBirth: dataset.riders.filter((rider) => !rider.date_of_birth).length,
      ridersWithUnknownRole: dataset.riders.filter((rider) => !rider.rider_role || rider.rider_role === "unknown").length,
      startlistRowsWithoutBibNumber: dataset.startlist.filter((entry) => !entry.bib_number).length,
    },
  };
}

export function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export function parseArgs(argv) {
  const options = {
    approveRiderConflicts: false,
    dryRun: false,
    reviewOnly: false,
    dataDir: DEFAULT_TDF_DATA_DIR,
    reviewReport: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--dry-run") {
      options.dryRun = true;
    } else if (argument === "--review") {
      options.reviewOnly = true;
    } else if (argument === "--approve-rider-conflicts") {
      options.approveRiderConflicts = true;
    } else if (argument === "--review-report") {
      const value = argv[index + 1];
      if (!value) throw new Error("--review-report requires a path");
      options.reviewReport = path.resolve(value);
      index += 1;
    } else if (argument === "--data-dir") {
      const value = argv[index + 1];
      if (!value) throw new Error("--data-dir requires a path");
      options.dataDir = path.resolve(value);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (quoted) throw new Error("CSV ended inside a quoted field");
  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  if (rows.length === 0) return [];

  const headers = rows[0];
  return rows.slice(1).filter((values) => values.some(Boolean)).map((values, rowIndex) => {
    if (values.length !== headers.length) {
      throw new Error(`CSV row ${rowIndex + 2} has ${values.length} fields; expected ${headers.length}`);
    }
    return Object.fromEntries(headers.map((header, columnIndex) => [header, values[columnIndex]]));
  });
}

async function readCsv(dataDir, filename) {
  return parseCsv(await fs.readFile(path.join(dataDir, filename), "utf8"));
}

export async function readTdfDataset(dataDir = DEFAULT_TDF_DATA_DIR) {
  const [raceText, stages, teams, riders, startlist, audit] = await Promise.all([
    fs.readFile(path.join(dataDir, "race_2026_tdf.json"), "utf8"),
    readCsv(dataDir, "stages_2026_tdf.csv"),
    readCsv(dataDir, "teams_2026_tdf.csv"),
    readCsv(dataDir, "riders_2026_tdf.csv"),
    readCsv(dataDir, "startlist_2026_tdf.csv"),
    readCsv(dataDir, "data_audit_2026_tdf.csv"),
  ]);
  const race = JSON.parse(raceText);

  if (stages.length !== 21) throw new Error(`Expected 21 stages, found ${stages.length}`);
  if (teams.length !== 23) throw new Error(`Expected 23 teams, found ${teams.length}`);
  if (riders.length !== 184) throw new Error(`Expected 184 riders, found ${riders.length}`);
  if (startlist.length !== riders.length) {
    throw new Error(`Expected one race startlist row per rider, found ${startlist.length}`);
  }

  const stageNumbers = new Set(stages.map((stage) => stage.stage_number));
  const teamIds = new Set(teams.map((team) => team.id));
  const riderIds = new Set(riders.map((rider) => rider.id));
  if (stageNumbers.size !== stages.length) throw new Error("Duplicate stage numbers detected");
  if (teamIds.size !== teams.length) throw new Error("Duplicate team IDs detected");
  if (riderIds.size !== riders.length) throw new Error("Duplicate rider IDs detected");

  for (const row of [...stages, ...teams, ...riders, ...startlist, ...audit]) {
    if (!row.source_url || !row.data_confidence) {
      throw new Error("Every dataset row must include source_url and data_confidence");
    }
  }
  for (const row of startlist) {
    if (!teamIds.has(row.team_id) || !riderIds.has(row.rider_id)) {
      throw new Error(`Invalid race startlist foreign key: ${row.id}`);
    }
  }

  const dataset = { audit, race, riders, stages, startlist, teams };
  const analysis = analyzeTdfDataset(dataset);
  if (analysis.missingRequiredFields.length > 0) {
    throw new Error(`Missing required dataset fields:\n${analysis.missingRequiredFields.join("\n")}`);
  }
  if (analysis.duplicateRiderNames.length > 0) {
    throw new Error(`Duplicate normalized rider names: ${JSON.stringify(analysis.duplicateRiderNames)}`);
  }
  if (analysis.duplicateTeamNames.length > 0) {
    throw new Error(`Duplicate normalized team names: ${JSON.stringify(analysis.duplicateTeamNames)}`);
  }

  return dataset;
}
