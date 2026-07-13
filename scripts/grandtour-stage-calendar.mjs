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
 * longer equal "today".
 *
 * **Second bug, fixed here:** the version of this function that replaced
 * the one above always picked the EARLIEST eligible non-final stage. That
 * self-heals a stalled stage in the common case, but has its own failure
 * mode: a stage that can structurally never become `isFinal` through this
 * pipeline - a TTT, whose official team-result source is never
 * auto-confirmed (see the TTT safety rule in
 * scripts/grandtour-reconciliation.mjs) - stays "eligible and not final"
 * forever, and "earliest eligible" means it gets re-selected on every
 * single scheduled run, permanently starving every later stage of
 * automatic attention even after the TTT has already been correctly,
 * repeatedly flagged for manual review. This is exactly what produced a
 * real run whose report showed `stageNumber: 1,
 * finalStatus: "unsafe_review_required"` day after day - indistinguishable
 * from a genuine "silently defaults to stage 1" bug even though the
 * selection logic itself never hardcoded `1` anywhere.
 *
 * The fixed algorithm:
 *
 *   1. Compares `now` and `starts_at` as real instants (UTC), never as a
 *      timezone-dependent calendar-date string - the runner's local date
 *      (or any particular timezone) never enters the comparison.
 *   2. Considers a stage "eligible" once at least `graceHours` have passed
 *      since it started (`starts_at <= now - graceHours`) - giving the
 *      race, official results, and letour.fr's own publishing pipeline
 *      time to actually finish, rather than checking (and likely finding
 *      "not published yet") the instant a stage starts.
 *   3. Among everything eligible, prefers the MOST RECENTLY STARTED stage
 *      - what today's run actually needs to look at - as long as it isn't
 *      already finalised (or `allowRerunCompleted` is set). This is
 *      `resolutionSource: "database_schedule"`.
 *   4. If that latest eligible stage IS already finalised and reruns are
 *      disabled, falls back to the most recent eligible stage (older than
 *      that one) that is NOT finalised - `resolutionSource:
 *      "unresolved_stage"` - so a genuine straggler (a stage still
 *      awaiting review while a later one has already been completed) is
 *      never permanently skipped just because something newer finished
 *      first. This still never regresses all the way back to an early,
 *      structurally-unresolvable stage (like a TTT) once there is any
 *      other unresolved stage newer than it.
 *   5. If every eligible stage is already finalised (or none are eligible
 *      at all), returns `stageNumber: null` / `resolutionSource: "none"` -
 *      never a hardcoded fallback stage.
 *
 * `stageRows` entries are `{ stageNumber, startsAt, isFinal }`.
 * `resolveStageRange` in scripts/grandtour-auto-dry-run.mjs adds a fourth
 * resolutionSource value, `"manual_input"`, for the case this function is
 * never even called (an explicit stage was supplied).
 */
export function resolveAutomaticStage(stageRows, {
  now = new Date(),
  graceHours = DEFAULT_STAGE_AVAILABILITY_GRACE_HOURS,
  allowRerunCompleted = false
} = {}) {
  const cutoffMs = now.getTime() - graceHours * 60 * 60 * 1000;

  // Descending: most recently started first, so "the latest eligible
  // stage" is always eligible[0].
  const eligible = (stageRows ?? [])
    .filter((row) => row.startsAt)
    .map((row) => ({ ...row, startsAtMs: new Date(row.startsAt).getTime() }))
    .filter((row) => !Number.isNaN(row.startsAtMs))
    .filter((row) => row.startsAtMs <= cutoffMs)
    .sort((a, b) => b.startsAtMs - a.startsAtMs || b.stageNumber - a.stageNumber);

  if (eligible.length === 0) {
    return {
      stageNumber: null,
      startsAt: null,
      resolutionSource: "none",
      reason: `No stage has started at least ${graceHours}h before ${now.toISOString()} yet - nothing is eligible for automatic dry-run.`
    };
  }

  const latest = eligible[0];
  if (allowRerunCompleted || !latest.isFinal) {
    return {
      stageNumber: latest.stageNumber,
      startsAt: latest.startsAt,
      resolutionSource: "database_schedule",
      reason: `Stage ${latest.stageNumber} is the most recently started eligible stage (started ${latest.startsAt}, >= ${graceHours}h before ${now.toISOString()})${latest.isFinal ? ", already finalised, but allow-rerun-completed is set" : " and is not yet finalised"}.`
    };
  }

  // The latest eligible stage is already finalised and reruns are
  // disabled - look further back for the most recent eligible stage that
  // is still unresolved, rather than giving up or reusing the finalised
  // one. This is what stops a permanently-unresolvable earlier stage
  // (e.g. a TTT) from starving out later stages: as soon as ANY later
  // stage exists and is unresolved, it wins; an early stage like that is
  // only ever picked again once it is genuinely the sole unresolved
  // eligible stage left.
  const straggler = eligible.slice(1).find((row) => !row.isFinal);
  if (straggler) {
    return {
      stageNumber: straggler.stageNumber,
      startsAt: straggler.startsAt,
      resolutionSource: "unresolved_stage",
      reason: `Stage ${latest.stageNumber} (the most recently started eligible stage) is already finalised and allow-rerun-completed is not set, so Stage ${straggler.stageNumber} (started ${straggler.startsAt}) was selected instead - it is eligible but still has no finalised result.`
    };
  }

  return {
    stageNumber: null,
    startsAt: null,
    resolutionSource: "none",
    reason: `Every eligible stage (started at least ${graceHours}h before ${now.toISOString()}) is already finalised and allow-rerun-completed is not set - nothing left to automatically dry-run.`
  };
}
