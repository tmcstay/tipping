import { getSupabaseClient } from "./client";
import { getCurrentUser } from "./auth";
import type { Json } from "@tipping-suite/shared-types";

export type EventSummary = {
  id: string;
  event_key: string;
  name: string;
  venue: string | null;
  country: string | null;
  starts_at: string | null;
  lock_at: string | null;
  status: string;
};

export type RaceMarket = {
  id: string;
  market_key: string;
  market_type: string;
  name: string;
  lock_at: string | null;
  status: string;
  points_rule: Json;
};

export type RaceCompetitor = {
  id: string;
  competitor_key: string;
  name: string;
  competitor_type: string;
  team_name: string | null;
  active: boolean;
};

export type UserTip = {
  id: string;
  user_id: string;
  market_id: string;
  competitor_id: string;
  submitted_at: string;
  is_dummy: boolean;
};

export type LeaderboardRow = {
  id: string;
  total_points: number;
  rank: number | null;
  tips_count: number;
  profiles: {
    display_name: string | null;
  } | null;
};

export async function listEventsForApp(appKey: string): Promise<EventSummary[]> {
  const { data, error } = await getSupabaseClient()
    .from("events")
    .select(
      "id,event_key,name,venue,country,starts_at,lock_at,status,seasons!inner(competitions!inner(apps!inner(code)))"
    )
    .eq("seasons.competitions.apps.code", appKey)
    .order("starts_at", { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []).map(({ seasons: _seasons, ...event }) => event);
}

export async function getEventById(eventId: string): Promise<EventSummary | null> {
  const { data, error } = await getSupabaseClient()
    .from("events")
    .select("id,event_key,name,venue,country,starts_at,lock_at,status")
    .eq("id", eventId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

export async function listMarketsForEvent(eventId: string): Promise<RaceMarket[]> {
  const { data, error } = await getSupabaseClient()
    .from("markets")
    .select("id,market_key,market_type,name,lock_at,status,points_rule")
    .eq("event_id", eventId)
    .order("market_key", { ascending: true });

  if (error) {
    throw error;
  }

  return data ?? [];
}

export async function listCompetitorsForEvent(
  eventId: string
): Promise<RaceCompetitor[]> {
  const { data: event, error: eventError } = await getSupabaseClient()
    .from("events")
    .select("seasons!inner(competition_id)")
    .eq("id", eventId)
    .maybeSingle();

  if (eventError) {
    throw eventError;
  }

  const season = Array.isArray(event?.seasons)
    ? event?.seasons[0]
    : event?.seasons;
  const competitionId = season?.competition_id;

  if (!competitionId) {
    return [];
  }

  const { data, error } = await getSupabaseClient()
    .from("competitors")
    .select("id,competitor_key,name,competitor_type,team_name,active")
    .eq("competition_id", competitionId)
    .eq("active", true)
    .order("team_name", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    throw error;
  }

  return data ?? [];
}

export async function listCurrentUserTipsForMarkets(
  marketIds: string[]
): Promise<UserTip[]> {
  if (marketIds.length === 0) {
    return [];
  }

  const user = await getCurrentUser();

  if (!user) {
    return [];
  }

  const { data, error } = await getSupabaseClient()
    .from("tips")
    .select("id,user_id,market_id,competitor_id,submitted_at,is_dummy")
    .eq("user_id", user.id)
    .in("market_id", marketIds);

  if (error) {
    throw error;
  }

  return data ?? [];
}

export async function listLeaderboardForApp(
  appKey: string
): Promise<LeaderboardRow[]> {
  const { data, error } = await getSupabaseClient()
    .from("leaderboards")
    .select(
      "id,total_points,rank,tips_count,profiles(display_name),apps!inner(code)"
    )
    .eq("apps.code", appKey)
    .order("rank", { ascending: true, nullsFirst: false })
    .order("total_points", { ascending: false });

  if (error) {
    throw error;
  }

  return (data ?? []).map(({ apps: _apps, profiles, ...row }) => ({
    ...row,
    profiles: Array.isArray(profiles) ? profiles[0] ?? null : profiles
  }));
}
