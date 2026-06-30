import { createClient } from "@supabase/supabase-js";

import {
  chunk,
  normalizeRiderName,
  parseArgs,
  readTdfDataset,
  stableUuid,
} from "./tdf-data-utils.mjs";

const STAGE_TYPE_MAP = {
  flat: "flat",
  hilly: "hilly",
  mountain: "mountain",
  ITT: "individual_time_trial",
  TTT: "team_time_trial",
};

function stageTiming(stageDate) {
  const defaultTime = process.env.TDF_DEFAULT_STAGE_START_TIME_UTC ?? "12:00:00Z";
  if (!/^\d{2}:\d{2}:\d{2}Z$/.test(defaultTime)) {
    throw new Error("TDF_DEFAULT_STAGE_START_TIME_UTC must use HH:MM:SSZ format");
  }
  const leadMinutes = Number(process.env.TDF_LOCK_LEAD_MINUTES ?? "10");
  if (!Number.isFinite(leadMinutes) || leadMinutes < 0) {
    throw new Error("TDF_LOCK_LEAD_MINUTES must be a non-negative number");
  }
  const startsAt = new Date(`${stageDate}T${defaultTime}`);
  if (Number.isNaN(startsAt.getTime())) throw new Error(`Invalid stage date: ${stageDate}`);
  return {
    startsAt: startsAt.toISOString(),
    locksAt: new Date(startsAt.getTime() - leadMinutes * 60_000).toISOString(),
  };
}

function nonEmptyArray(value) {
  return value?.trim() ? [value.trim()] : [];
}

function buildRows(dataset) {
  const firstStageTiming = stageTiming(dataset.stages[0].stage_date);
  const lastStageTiming = stageTiming(dataset.stages.at(-1).stage_date);
  const raceId = dataset.race.id;
  const competitionId = stableUuid(`grandtour-competition:${raceId}:public`);
  const raceStartlistByRider = new Map(
    dataset.startlist.map((entry) => [entry.rider_id, entry]),
  );

  const race = {
    id: raceId,
    sport: "cycling",
    name: dataset.race.name,
    year: dataset.race.year,
    starts_at: firstStageTiming.startsAt,
    ends_at: lastStageTiming.startsAt,
    preselection_locks_at: firstStageTiming.locksAt,
    category: dataset.race.category,
    countries: dataset.race.countries ?? [],
    source_url: dataset.race.source_url,
    data_confidence: dataset.race.data_confidence,
    created_at: dataset.race.created_at,
    updated_at: dataset.race.updated_at,
  };
  const competition = {
    id: competitionId,
    grand_tour_id: raceId,
    name: "GrandTour France 2026 Public League",
    is_public: true,
    allow_preselection: true,
    allow_daily: true,
  };
  const teams = dataset.teams.map((team) => ({
    id: team.id,
    grand_tour_id: raceId,
    name: team.name,
    short_name: team.code || null,
    code: team.code || null,
    country: team.country || null,
    team_type: team.team_type || null,
    source_url: team.source_url,
    data_confidence: team.data_confidence,
    created_at: team.created_at,
    updated_at: team.updated_at,
  }));
  const riders = dataset.riders.map((rider) => {
    const roster = raceStartlistByRider.get(rider.id);
    if (!roster) throw new Error(`Missing race startlist row for ${rider.full_name}`);
    return {
      id: rider.id,
      grand_tour_id: raceId,
      team_id: roster.team_id,
      display_name: rider.full_name,
      normalized_name: normalizeRiderName(rider.full_name),
      country: rider.nationality || null,
      nationality: rider.nationality || null,
      date_of_birth: rider.date_of_birth || null,
      rider_type: rider.rider_role || "unknown",
      is_active: true,
      source_url: rider.source_url,
      data_confidence: rider.data_confidence,
      created_at: rider.created_at,
      updated_at: rider.updated_at,
    };
  });
  const stages = dataset.stages.map((stage) => {
    const timing = stageTiming(stage.stage_date);
    const stageType = STAGE_TYPE_MAP[stage.stage_type];
    if (!stageType) throw new Error(`Unsupported stage type: ${stage.stage_type}`);
    return {
      id: stage.id,
      grand_tour_id: raceId,
      stage_number: Number(stage.stage_number),
      stage_name: `Stage ${stage.stage_number}: ${stage.start_location} to ${stage.finish_location}`,
      stage_type: stageType,
      starts_at: timing.startsAt,
      locks_at: timing.locksAt,
      start_location: stage.start_location || null,
      finish_location: stage.finish_location || null,
      distance_km: Number(stage.distance_km),
      source_url: stage.source_url,
      data_confidence: stage.data_confidence,
      start_time_is_estimated: true,
      created_at: stage.created_at,
      updated_at: stage.updated_at,
    };
  });
  const startlist = stages.flatMap((stage) =>
    dataset.startlist.map((entry) => {
      const rider = dataset.riders.find((candidate) => candidate.id === entry.rider_id);
      return {
        id: stableUuid(`grandtour-stage-startlist:${stage.id}:${entry.rider_id}`),
        stage_id: stage.id,
        rider_id: entry.rider_id,
        team_id: entry.team_id,
        status: entry.status || "provisional",
        bib_number: entry.bib_number ? Number(entry.bib_number) : null,
        rider_role: rider?.rider_role || "unknown",
        source_url: entry.source_url,
        data_confidence: entry.data_confidence,
        created_at: entry.created_at,
        updated_at: entry.updated_at,
      };
    }),
  );
  const audit = dataset.audit.map((row) => ({
    id: stableUuid(`data-audit:${row.source_url}:${row.date_accessed}`),
    grand_tour_id: raceId,
    source_name: row.source_name,
    source_url: row.source_url,
    date_accessed: row.date_accessed,
    fields_found: nonEmptyArray(row.fields_found),
    missing_fields: nonEmptyArray(row.missing_fields),
    confidence_notes: row.confidence_notes || null,
    data_confidence: row.data_confidence,
    reuse_risk: row.reuse_risk,
    comments: row.comments || null,
  }));

  return { audit, competition: [competition], race: [race], riders, stages, startlist, teams };
}

async function existingIds(client, table, ids) {
  const existing = new Set();
  for (const idChunk of chunk(ids, 50)) {
    const { data, error } = await client.from(table).select("id").in("id", idChunk);
    if (error) throw error;
    for (const row of data ?? []) existing.add(row.id);
  }
  return existing;
}

async function upsertRows(client, table, rows, batchSize = 500) {
  const existing = await existingIds(client, table, rows.map((row) => row.id));
  for (const rowChunk of chunk(rows, batchSize)) {
    const { error } = await client.from(table).upsert(rowChunk, { onConflict: "id" });
    if (error) throw error;
  }
  return {
    created: rows.filter((row) => !existing.has(row.id)).length,
    updated: rows.filter((row) => existing.has(row.id)).length,
    skipped: 0,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const dataset = await readTdfDataset(options.dataDir);
  const rows = buildRows(dataset);
  const planned = Object.fromEntries(
    Object.entries(rows).map(([name, values]) => [name, values.length]),
  );

  if (options.dryRun) {
    console.log(JSON.stringify({
      mode: "dry-run",
      dataDir: options.dataDir,
      planned,
      assumptions: {
        startTimes: "estimated",
        defaultStageStartTimeUtc: process.env.TDF_DEFAULT_STAGE_START_TIME_UTC ?? "12:00:00Z",
        lockLeadMinutes: Number(process.env.TDF_LOCK_LEAD_MINUTES ?? "10"),
        startlistStatus: "preserved; defaults to provisional",
      },
    }, null, 2));
    return;
  }

  const url = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for a real import. Never expose the service-role key to Expo.");
  }
  const client = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const summary = {};
  summary.race = await upsertRows(client, "grand_tours", rows.race);
  summary.competition = await upsertRows(client, "grandtour_competitions", rows.competition);
  summary.teams = await upsertRows(client, "grandtour_teams", rows.teams);
  summary.riders = await upsertRows(client, "grandtour_riders", rows.riders);
  summary.stages = await upsertRows(client, "grandtour_stages", rows.stages);
  summary.startlist = await upsertRows(client, "grandtour_stage_startlists", rows.startlist);
  summary.audit = await upsertRows(client, "data_audit", rows.audit);
  console.log(JSON.stringify({ mode: "import", dataDir: options.dataDir, summary }, null, 2));
}

await main();
