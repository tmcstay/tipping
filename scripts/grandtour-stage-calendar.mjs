import fs from "node:fs/promises";
import path from "node:path";

import { DEFAULT_TDF_DATA_DIR, parseCsv } from "./tdf-data-utils.mjs";

export const DEFAULT_STAGE_CALENDAR_PATH = path.join(DEFAULT_TDF_DATA_DIR, "stages_2026_tdf.csv");

export function parseStageCalendarCsv(csvText) {
  return parseCsv(csvText).map((row) => ({
    stageNumber: Number(row.stage_number),
    stageDate: row.stage_date,
    stageType: row.stage_type,
    isRestDay: row.is_rest_day === "true"
  }));
}

export async function loadStageCalendar(calendarPath = DEFAULT_STAGE_CALENDAR_PATH) {
  return parseStageCalendarCsv(await fs.readFile(calendarPath, "utf8"));
}

export function parisDateISO(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

export function lookupStageDate(calendarRows, stageNumber) {
  return calendarRows.find((row) => row.stageNumber === stageNumber)?.stageDate ?? null;
}

export function resolveScheduledStage(calendarRows, asOfDateISO) {
  const stage = calendarRows.find((row) => row.stageDate === asOfDateISO && !row.isRestDay);
  if (!stage) {
    return {
      stageNumber: null,
      stageDate: null,
      stageType: null,
      reason: `No completed stage found for ${asOfDateISO} (rest day or outside the race window).`
    };
  }
  return {
    stageNumber: stage.stageNumber,
    stageDate: stage.stageDate,
    stageType: stage.stageType,
    reason: null
  };
}
