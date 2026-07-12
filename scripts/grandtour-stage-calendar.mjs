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

export const DEFAULT_STAGE_AVAILABILITY_GRACE_HOURS = 12;

/**
 * Resolves the stage the automatic dry-run should check, sourced from live
 * grandtour_stages rows (id/stage_number/starts_at/isFinal, read via
 * fetchAllGrandTourStages) instead of the static stage-calendar CSV or an
 * exact calendar-date match. Used by scripts/grandtour-auto-dry-run.mjs.
 *
 * Replaces an earlier exact-Paris-date-match design
 * (resolveStageFromGrandTourStages, now removed) that had a real bug: if a
 * stage's results weren't ready in time for the day it raced, the next
 * day's exact-date match would move straight past it and it would NEVER
 * be automatically re-attempted - `stage.starts_at` would simply no
 * longer equal "today". This version instead:
 *
 *   1. Compares `now` and `starts_at` as real instants (UTC), never as a
 *      timezone-dependent calendar-date string - the runner's local date
 *      (or any particular timezone) never enters the comparison.
 *   2. Considers a stage "eligible" once at least `graceHours` have passed
 *      since it started (`starts_at <= now - graceHours`) - giving the
 *      race, official results, and letour.fr's own publishing pipeline
 *      time to actually finish, rather than checking (and likely finding
 *      "not published yet") the instant a stage starts.
 *   3. Skips any stage already finalised (`isFinal: true`) unless
 *      `allowRerunCompleted` is explicitly set - once a stage is done,
 *      stop re-checking it automatically every day.
 *   4. Among everything still eligible, always picks the EARLIEST one
 *      (lowest starts_at, tie-broken by stage number) - never "the most
 *      recent prior stage" - so a stalled/unprocessed earlier stage is
 *      what gets picked up next, not silently skipped in favour of a
 *      later one.
 *
 * `stageRows` entries are `{ stageNumber, startsAt, isFinal }`.
 */
export function resolveAutomaticStage(stageRows, {
  now = new Date(),
  graceHours = DEFAULT_STAGE_AVAILABILITY_GRACE_HOURS,
  allowRerunCompleted = false
} = {}) {
  const cutoffMs = now.getTime() - graceHours * 60 * 60 * 1000;

  const eligible = (stageRows ?? [])
    .filter((row) => row.startsAt)
    .map((row) => ({ ...row, startsAtMs: new Date(row.startsAt).getTime() }))
    .filter((row) => !Number.isNaN(row.startsAtMs))
    .filter((row) => row.startsAtMs <= cutoffMs)
    .filter((row) => allowRerunCompleted || !row.isFinal)
    .sort((a, b) => a.startsAtMs - b.startsAtMs || a.stageNumber - b.stageNumber);

  if (eligible.length === 0) {
    return {
      stageNumber: null,
      reason: "No eligible stage for automatic dry-run."
    };
  }

  const selected = eligible[0];
  return {
    stageNumber: selected.stageNumber,
    reason: `Stage ${selected.stageNumber} started at ${selected.startsAt} (>= ${graceHours}h before ${now.toISOString()}) and is not yet finalised${allowRerunCompleted ? " (allow-rerun-completed is set, so finalised stages were also eligible)" : ""}.`
  };
}
