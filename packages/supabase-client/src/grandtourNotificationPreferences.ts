import { getCurrentUser } from "./auth";
import { getSupabaseClient } from "./client";

/**
 * Per-user GrandTour stage-result email preference. Plain table access
 * under RLS ("users can read/write only their own row"), matching the same
 * established preference in grandtourFavourites.ts for plain queries over
 * new RPCs whenever RLS alone is sufficient. A row always exists for every
 * signed-up user (provisioned by the signup trigger - see
 * 20260715030000_grandtour_notification_preferences.sql), so this never
 * needs to fabricate a client-side default for a missing row.
 */

export type GrandTourNotificationPreference = {
  resultsEmailEnabled: boolean;
  timezone: string;
};

export async function getNotificationPreference(): Promise<GrandTourNotificationPreference | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const { data, error } = await getSupabaseClient()
    .from("grandtour_notification_preferences")
    .select("results_email_enabled, timezone")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    resultsEmailEnabled: data.results_email_enabled,
    timezone: data.timezone,
  };
}

export async function setResultsEmailEnabled(enabled: boolean): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("You must be signed in to update notification preferences.");
  const { error } = await getSupabaseClient()
    .from("grandtour_notification_preferences")
    .upsert(
      { user_id: user.id, results_email_enabled: enabled },
      { onConflict: "user_id" }
    );
  if (error) throw error;
}
