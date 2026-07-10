/**
 * Read-only Supabase access for GrandTour reconciliation. Every function here
 * issues `.select(...)` calls only — no `.insert`, `.upsert`, `.update`, or
 * `.delete` appears anywhere in this file. Reconciliation deliberately reads
 * with the public anon key (see scripts/grandtour-feed-reconcile.mjs), which
 * is sufficient because grandtour_riders/grandtour_teams/grandtour_stages/
 * grandtour_stage_startlists are fully public-readable and
 * grandtour_stage_results/*_lines are public-readable once `is_final = true`
 * (see supabase/migrations/20260629080958_grandtour_mvp.sql). No
 * service-role key is required or accepted by this module.
 */

export async function resolveGrandTourId(client, { name, year }) {
  const { data, error } = await client
    .from("grand_tours")
    .select("id")
    .eq("name", name)
    .eq("year", year)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

export async function fetchReconciliationContext(client, { grandTourId, stageNumber }) {
  const [
    { data: stage, error: stageError },
    { data: riders, error: ridersError },
    { data: teams, error: teamsError }
  ] = await Promise.all([
    client
      .from("grandtour_stages")
      .select("id, stage_number, stage_type, starts_at")
      .eq("grand_tour_id", grandTourId)
      .eq("stage_number", stageNumber)
      .maybeSingle(),
    client
      .from("grandtour_riders")
      .select("id, team_id, display_name, normalized_name, bib_number")
      .eq("grand_tour_id", grandTourId),
    client
      .from("grandtour_teams")
      .select("id, name, short_name, code")
      .eq("grand_tour_id", grandTourId)
  ]);
  if (stageError) throw stageError;
  if (ridersError) throw ridersError;
  if (teamsError) throw teamsError;

  // The startlist is scoped to a specific stage_id, which is only known
  // after the stage lookup above resolves, so this read cannot join the
  // Promise.all above and is a second, sequential round trip.
  let existingStartlist = [];
  if (stage) {
    const { data: startlistRows, error: startlistError } = await client
      .from("grandtour_stage_startlists")
      .select("rider_id, status")
      .eq("stage_id", stage.id);
    if (startlistError) throw startlistError;
    existingStartlist = (startlistRows ?? []).map((row) => ({ riderId: row.rider_id, status: row.status }));
  }

  return {
    existingStage: stage
      ? {
          id: stage.id,
          stageNumber: stage.stage_number,
          stageType: stage.stage_type,
          // Date portion of starts_at (UTC), e.g. "2026-07-05" from
          // "2026-07-05T10:00:00+00:00" — a plain calendar-date field
          // doesn't exist on grandtour_stages, so this is the closest
          // authoritative source scoped to the same read.
          stageDate: typeof stage.starts_at === "string" ? stage.starts_at.slice(0, 10) : null
        }
      : null,
    existingRiders: (riders ?? []).map((rider) => ({
      id: rider.id,
      teamId: rider.team_id,
      displayName: rider.display_name,
      normalizedName: rider.normalized_name,
      bibNumber: rider.bib_number
    })),
    existingTeams: (teams ?? []).map((team) => ({
      id: team.id,
      name: team.name,
      shortName: team.short_name,
      code: team.code
    })),
    existingStartlist
  };
}
