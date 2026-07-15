import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_STAGE_AVAILABILITY_GRACE_HOURS,
  DEFAULT_STAGE_CALENDAR_PATH,
  loadStageCalendar,
  lookupStageDate,
  parisDateISO,
  parseStageCalendarCsv,
  resolveAutomaticStage,
  resolveScheduledStage
} from "./grandtour-stage-calendar.mjs";

const SAMPLE_CSV = [
  "id,race_id,stage_number,stage_date,start_location,finish_location,distance_km,stage_type,is_rest_day,notes,source_url,data_confidence,created_at,updated_at",
  "id-1,race-1,1,2026-07-04,Barcelone,Barcelone,19.6,TTT,false,,https://www.letour.fr/en/overall-route,high,2026-06-30T00:00:00Z,2026-06-30T00:00:00Z",
  "id-2,race-1,2,2026-07-05,Tarragone,Barcelone,168.5,hilly,false,,https://www.letour.fr/en/overall-route,high,2026-06-30T00:00:00Z,2026-06-30T00:00:00Z",
  "id-3,race-1,6,2026-07-09,Pau,Gavarnie-Gèdre,186.2,mountain,false,,https://www.letour.fr/en/overall-route,high,2026-06-30T00:00:00Z,2026-06-30T00:00:00Z"
].join("\n");

test("parseStageCalendarCsv reads stage number, date, type and rest-day flag", () => {
  const rows = parseStageCalendarCsv(SAMPLE_CSV);

  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], { stageNumber: 1, stageDate: "2026-07-04", stageType: "TTT", isRestDay: false });
  assert.deepEqual(rows[2], { stageNumber: 6, stageDate: "2026-07-09", stageType: "mountain", isRestDay: false });
});

test("resolveScheduledStage returns the stage scheduled for the given date", () => {
  const rows = parseStageCalendarCsv(SAMPLE_CSV);
  const resolved = resolveScheduledStage(rows, "2026-07-09");

  assert.equal(resolved.stageNumber, 6);
  assert.equal(resolved.stageDate, "2026-07-09");
  assert.equal(resolved.stageType, "mountain");
  assert.equal(resolved.reason, null);
});

test("resolveScheduledStage returns no stage for a rest day gap in the calendar", () => {
  const rows = parseStageCalendarCsv(SAMPLE_CSV);
  const resolved = resolveScheduledStage(rows, "2026-07-13");

  assert.equal(resolved.stageNumber, null);
  assert.equal(resolved.stageDate, null);
  assert.match(resolved.reason, /No completed stage found for 2026-07-13/);
});

test("resolveScheduledStage returns no stage outside the race window", () => {
  const rows = parseStageCalendarCsv(SAMPLE_CSV);
  const resolved = resolveScheduledStage(rows, "2026-08-01");

  assert.equal(resolved.stageNumber, null);
  assert.match(resolved.reason, /No completed stage found for 2026-08-01/);
});

test("lookupStageDate finds the date for a known stage and null for unknown", () => {
  const rows = parseStageCalendarCsv(SAMPLE_CSV);

  assert.equal(lookupStageDate(rows, 6), "2026-07-09");
  assert.equal(lookupStageDate(rows, 99), null);
});

test("parisDateISO formats a fixed instant as a YYYY-MM-DD calendar date", () => {
  const result = parisDateISO(new Date("2026-07-09T19:30:00Z"));

  assert.match(result, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(result, "2026-07-09");
});

test("resolveAutomaticStage: DEFAULT_STAGE_AVAILABILITY_GRACE_HOURS is 8", () => {
  assert.equal(DEFAULT_STAGE_AVAILABILITY_GRACE_HOURS, 8);
});

test("resolveAutomaticStage picks a stage only once graceHours have elapsed since starts_at (UTC instant, not calendar date)", () => {
  const rows = [{ stageNumber: 6, startsAt: "2026-07-09T10:00:00Z", isFinal: false }];

  // Exactly at the cutoff instant (starts_at + 12h) - eligible.
  const atCutoff = resolveAutomaticStage(rows, { now: new Date("2026-07-09T22:00:00Z"), graceHours: 12 });
  assert.equal(atCutoff.stageNumber, 6);
  assert.equal(atCutoff.resolutionSource, "database_schedule");

  // One millisecond before the cutoff - not yet eligible.
  const beforeCutoff = resolveAutomaticStage(rows, { now: new Date("2026-07-09T21:59:59.999Z"), graceHours: 12 });
  assert.equal(beforeCutoff.stageNumber, null);
  assert.equal(beforeCutoff.resolutionSource, "none");
});

test("resolveAutomaticStage skips a finalised stage unless allowRerunCompleted is set", () => {
  const rows = [{ stageNumber: 6, startsAt: "2026-07-09T10:00:00Z", isFinal: true }];
  const now = new Date("2026-07-10T10:00:00Z");

  const skipped = resolveAutomaticStage(rows, { now });
  assert.equal(skipped.stageNumber, null);
  assert.equal(skipped.resolutionSource, "none");

  const rerun = resolveAutomaticStage(rows, { now, allowRerunCompleted: true });
  assert.equal(rerun.stageNumber, 6);
  assert.equal(rerun.resolutionSource, "database_schedule");
});

test("resolveAutomaticStage selects the LATEST eligible unresolved stage, never the earliest, so a permanently-unresolvable early stage (e.g. an unconfirmed TTT) cannot starve out later stages forever", () => {
  const rows = [
    { stageNumber: 5, startsAt: "2026-07-08T10:00:00Z", isFinal: false },
    { stageNumber: 6, startsAt: "2026-07-09T10:00:00Z", isFinal: false },
    { stageNumber: 7, startsAt: "2026-07-10T10:00:00Z", isFinal: false }
  ];
  const now = new Date("2026-07-11T00:00:00Z");

  const resolved = resolveAutomaticStage(rows, { now, graceHours: 12 });
  assert.equal(resolved.stageNumber, 7);
  assert.equal(resolved.resolutionSource, "database_schedule");
});

test("resolveAutomaticStage falls back to the latest unresolved straggler when the very latest eligible stage is already finalised and reruns are disabled", () => {
  const rows = [
    { stageNumber: 1, startsAt: "2026-07-04T10:00:00Z", isFinal: false }, // e.g. a TTT that can never be finalised through this pipeline
    { stageNumber: 4, startsAt: "2026-07-07T10:00:00Z", isFinal: true },
    { stageNumber: 5, startsAt: "2026-07-08T10:00:00Z", isFinal: false }, // applied draft, not yet finalised
    { stageNumber: 6, startsAt: "2026-07-09T10:00:00Z", isFinal: true }
  ];
  const now = new Date("2026-07-11T00:00:00Z");

  const resolved = resolveAutomaticStage(rows, { now, graceHours: 12 });
  assert.equal(resolved.stageNumber, 5, "the latest eligible stage (6) is already final, so the algorithm steps back to the most recent unresolved one (5), never all the way back to stage 1");
  assert.equal(resolved.resolutionSource, "unresolved_stage");
});

test("resolveAutomaticStage only re-selects a stuck-forever stage (e.g. an unconfirmed TTT) once it is genuinely the sole unresolved eligible stage left", () => {
  const rows = [
    { stageNumber: 1, startsAt: "2026-07-04T10:00:00Z", isFinal: false },
    { stageNumber: 2, startsAt: "2026-07-05T10:00:00Z", isFinal: true }
  ];
  const now = new Date("2026-07-11T00:00:00Z");

  const resolved = resolveAutomaticStage(rows, { now, graceHours: 12 });
  assert.equal(resolved.stageNumber, 1);
  assert.equal(resolved.resolutionSource, "unresolved_stage");
});

test("resolveAutomaticStage returns none when every eligible stage is already finalised", () => {
  const rows = [
    { stageNumber: 1, startsAt: "2026-07-04T10:00:00Z", isFinal: true },
    { stageNumber: 2, startsAt: "2026-07-05T10:00:00Z", isFinal: true }
  ];
  const now = new Date("2026-07-11T00:00:00Z");

  const resolved = resolveAutomaticStage(rows, { now, graceHours: 12 });
  assert.equal(resolved.stageNumber, null);
  assert.equal(resolved.resolutionSource, "none");
});

test("resolveAutomaticStage returns the exact no-eligible-stage resolutionSource for an empty list, and never a hardcoded stage", () => {
  const resolved = resolveAutomaticStage([], { now: new Date("2026-07-10T10:00:00Z") });
  assert.equal(resolved.stageNumber, null);
  assert.equal(resolved.resolutionSource, "none");
});

test("resolveAutomaticStage ignores rows with a missing or unparsable starts_at", () => {
  const rows = [
    { stageNumber: 6, startsAt: null, isFinal: false },
    { stageNumber: 7, startsAt: "not-a-date", isFinal: false }
  ];
  const resolved = resolveAutomaticStage(rows, { now: new Date("2026-07-10T10:00:00Z") });
  assert.equal(resolved.stageNumber, null);
});

test("loadStageCalendar reads the real TDF 2026 stage calendar and resolves stage 6 for 2026-07-09", async () => {
  const rows = await loadStageCalendar(DEFAULT_STAGE_CALENDAR_PATH);
  const resolved = resolveScheduledStage(rows, "2026-07-09");

  assert.equal(resolved.stageNumber, 6);
  assert.equal(resolved.stageType, "mountain");
});
