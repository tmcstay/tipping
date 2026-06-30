import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

import { readTdfDataset, stableUuid } from "./tdf-data-utils.mjs";

function parseOptions(argv) {
  const options = { dryRun: false, users: 5, stages: 3, seed: 2026 };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--dry-run") {
      options.dryRun = true;
    } else if (["--users", "--stages", "--seed"].includes(argument)) {
      const value = Number(argv[index + 1]);
      if (!Number.isInteger(value) || value < 1) throw new Error(`${argument} requires a positive integer`);
      options[argument.slice(2)] = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4_294_967_296;
  };
}

const ROLE_WEIGHTS = {
  flat: { sprinter: 6, puncheur: 2, domestique: 1, gc: 1, climber: 0.5, time_trial: 1 },
  hilly: { puncheur: 5, gc: 3, climber: 3, sprinter: 1.5, domestique: 1, time_trial: 1 },
  mountain: { climber: 6, gc: 5, puncheur: 2, domestique: 1, sprinter: 0.25, time_trial: 1 },
  individual_time_trial: { time_trial: 6, gc: 4, puncheur: 1, climber: 1, sprinter: 1, domestique: 1 },
  team_time_trial: { time_trial: 5, gc: 3, domestique: 2, puncheur: 1, climber: 1, sprinter: 1 },
};

function weightedPick(candidates, stageType, random, excluded = new Set()) {
  const available = candidates.filter((candidate) => !excluded.has(candidate.rider_id));
  if (available.length === 0) throw new Error("No selectable riders remain");
  const weights = ROLE_WEIGHTS[stageType] ?? {};
  const weighted = available.map((candidate) => ({
    candidate,
    weight: weights[candidate.rider_role] ?? 1,
  }));
  const total = weighted.reduce((sum, item) => sum + item.weight, 0);
  let cursor = random() * total;
  for (const item of weighted) {
    cursor -= item.weight;
    if (cursor <= 0) return item.candidate;
  }
  return weighted.at(-1).candidate;
}

function chooseSelections(roster, stageType, random) {
  const excluded = new Set();
  const topFive = [];
  for (let position = 1; position <= 5; position += 1) {
    const rider = weightedPick(roster, stageType, random, excluded);
    excluded.add(rider.rider_id);
    topFive.push({ riderId: rider.rider_id, position });
  }

  const byPreferredRole = (roles) => {
    const candidates = roster.filter((entry) => roles.includes(entry.rider_role));
    return weightedPick(candidates.length > 0 ? candidates : roster, stageType, random).rider_id;
  };
  return {
    topFive,
    jerseys: {
      yellow_holder: byPreferredRole(["gc", "climber"]),
      green_holder: byPreferredRole(["sprinter", "puncheur"]),
      kom_holder: byPreferredRole(["climber", "gc"]),
      white_holder: byPreferredRole(["gc", "climber", "puncheur"]),
    },
  };
}

async function ensureDummyUsers(client, count) {
  const { data: userPage, error: listError } = await client.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listError) throw listError;
  const byEmail = new Map(userPage.users.map((user) => [user.email, user]));
  const users = [];

  for (let index = 1; index <= count; index += 1) {
    const email = `dummy.tdf2026.${String(index).padStart(3, "0")}@example.invalid`;
    let user = byEmail.get(email);
    if (!user) {
      const { data, error } = await client.auth.admin.createUser({
        email,
        email_confirm: true,
        password: `Dummy-${crypto.randomUUID()}-Aa1!`,
      });
      if (error) throw error;
      user = data.user;
    }
    users.push(user);
  }

  const { error: profileError } = await client.from("profiles").upsert(
    users.map((user, index) => ({
      id: user.id,
      display_name: `Demo Rider ${String(index + 1).padStart(2, "0")}`,
      is_dummy: true,
      updated_at: new Date().toISOString(),
    })),
    { onConflict: "id" },
  );
  if (profileError) throw profileError;
  return users;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const dataset = await readTdfDataset();
  if (options.dryRun) {
    console.log(JSON.stringify({
      mode: "dry-run",
      users: options.users,
      stagesPerUser: Math.min(options.stages, dataset.stages.length),
      plannedTips: options.users * Math.min(options.stages, dataset.stages.length),
      seed: options.seed,
      note: "No users, tips or results were created.",
    }, null, 2));
    return;
  }

  const url = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Never expose the service-role key to Expo.");
  }
  const client = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const random = createRandom(options.seed);
  const raceId = dataset.race.id;
  const { data: competition, error: competitionError } = await client
    .from("grandtour_competitions")
    .select("id")
    .eq("grand_tour_id", raceId)
    .eq("is_public", true)
    .limit(1)
    .single();
  if (competitionError) throw competitionError;

  const { data: stageRows, error: stageError } = await client
    .from("grandtour_stages")
    .select("id,stage_number,stage_type,locks_at")
    .eq("grand_tour_id", raceId)
    .gt("locks_at", new Date().toISOString())
    .order("stage_number")
    .limit(options.stages);
  if (stageError) throw stageError;
  if (!stageRows?.length) throw new Error("No unlocked TDF stages are available for dummy tips");

  const users = await ensureDummyUsers(client, options.users);
  let tipsCreated = 0;
  for (const user of users) {
    for (const stage of stageRows) {
      const { data: roster, error: rosterError } = await client
        .from("grandtour_stage_startlists")
        .select("rider_id,rider_role,status")
        .eq("stage_id", stage.id)
        .in("status", ["provisional", "confirmed"]);
      if (rosterError) throw rosterError;
      if (!roster?.length) throw new Error(`No selectable roster for stage ${stage.stage_number}`);

      const tipId = stableUuid(`dummy-tip:${user.id}:${competition.id}:${stage.id}:daily`);
      const selections = chooseSelections(roster, stage.stage_type, random);
      const { error: tipError } = await client.from("grandtour_tips").upsert({
        id: tipId,
        user_id: user.id,
        competition_id: competition.id,
        stage_id: stage.id,
        tip_mode: "daily",
        status: "draft",
        is_dummy: true,
      }, { onConflict: "user_id,competition_id,stage_id,tip_mode" });
      if (tipError) throw tipError;

      const { error: deleteError } = await client
        .from("grandtour_tip_selections")
        .delete()
        .eq("tip_id", tipId);
      if (deleteError) throw deleteError;

      const selectionRows = [
        ...selections.topFive.map((selection) => ({
          tip_id: tipId,
          selection_type: "stage_top_5",
          rider_id: selection.riderId,
          predicted_position: selection.position,
        })),
        ...Object.entries(selections.jerseys).map(([selectionType, riderId]) => ({
          tip_id: tipId,
          selection_type: selectionType,
          rider_id: riderId,
          predicted_position: null,
        })),
      ];
      const { error: selectionError } = await client.from("grandtour_tip_selections").insert(selectionRows);
      if (selectionError) throw selectionError;
      const { error: submitError } = await client
        .from("grandtour_tips")
        .update({ status: "submitted" })
        .eq("id", tipId);
      if (submitError) throw submitError;
      tipsCreated += 1;
    }
  }

  console.log(JSON.stringify({
    mode: "generated",
    dummyUsers: users.length,
    dummyTips: tipsCreated,
    seed: options.seed,
    officialResultsCreated: 0,
  }, null, 2));
}

await main();
