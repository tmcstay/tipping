import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_STAGE_CALENDAR_PATH,
  loadStageCalendar,
  lookupStageDate,
  parisDateISO,
  parseStageCalendarCsv,
  resolveScheduledStage,
  resolveStageFromGrandTourStages
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

test("resolveStageFromGrandTourStages matches a grandtour_stages row by its Paris calendar date", () => {
  const rows = [
    { stageNumber: 5, startsAt: "2026-07-08T10:00:00+00:00" },
    { stageNumber: 6, startsAt: "2026-07-09T10:00:00+00:00" }
  ];
  const resolved = resolveStageFromGrandTourStages(rows, "2026-07-09");

  assert.equal(resolved.stageNumber, 6);
  assert.equal(resolved.stageDate, "2026-07-09");
  assert.equal(resolved.reason, null);
});

test("resolveStageFromGrandTourStages returns no stage when nothing starts on that date", () => {
  const rows = [{ stageNumber: 5, startsAt: "2026-07-08T10:00:00+00:00" }];
  const resolved = resolveStageFromGrandTourStages(rows, "2026-07-13");

  assert.equal(resolved.stageNumber, null);
  assert.equal(resolved.stageDate, null);
  assert.match(resolved.reason, /No grandtour_stages row starts on 2026-07-13/);
});

test("resolveStageFromGrandTourStages ignores rows with a missing starts_at and returns no stage for an empty list", () => {
  const rows = [{ stageNumber: 7, startsAt: null }];
  const resolved = resolveStageFromGrandTourStages(rows, "2026-07-10");
  assert.equal(resolved.stageNumber, null);

  const empty = resolveStageFromGrandTourStages([], "2026-07-10");
  assert.equal(empty.stageNumber, null);
  assert.match(empty.reason, /No grandtour_stages row starts on 2026-07-10/);
});

test("loadStageCalendar reads the real TDF 2026 stage calendar and resolves stage 6 for 2026-07-09", async () => {
  const rows = await loadStageCalendar(DEFAULT_STAGE_CALENDAR_PATH);
  const resolved = resolveScheduledStage(rows, "2026-07-09");

  assert.equal(resolved.stageNumber, 6);
  assert.equal(resolved.stageType, "mountain");
});
