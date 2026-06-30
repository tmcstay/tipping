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
  return name.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
}

export function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export function parseArgs(argv) {
  const options = { dryRun: false, dataDir: DEFAULT_TDF_DATA_DIR };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--dry-run") {
      options.dryRun = true;
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
  if (riders.length !== 173) throw new Error(`Expected 173 riders, found ${riders.length}`);
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

  return { audit, race, riders, stages, startlist, teams };
}
