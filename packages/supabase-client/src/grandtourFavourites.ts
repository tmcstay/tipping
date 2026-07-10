import { getCurrentUser } from "./auth";
import { getSupabaseClient } from "./client";

/**
 * Per-user favourite riders (Part D). Plain table access under RLS, not
 * RPCs - grandtour_favourite_riders' RLS ("user_id = auth.uid()" for all
 * operations, plus an admin read-all policy) already fully enforces
 * "users can read/write only their own favourites; admins may read all",
 * so a favourite add/remove is exactly as safe as a direct insert/delete
 * here as it would be behind an RPC, without the extra indirection -
 * matches this session's established preference (Parts A-C) for plain
 * queries over new RPCs whenever RLS alone is sufficient.
 */

export async function listFavouriteRiderIds(grandTourId: string): Promise<string[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  const { data, error } = await getSupabaseClient()
    .from("grandtour_favourite_riders")
    .select("rider_id")
    .eq("user_id", user.id)
    .eq("grand_tour_id", grandTourId);
  if (error) throw error;
  return (data ?? []).map((row) => row.rider_id);
}

export async function addFavouriteRider(grandTourId: string, riderId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("You must be signed in to favourite a rider.");
  const { error } = await getSupabaseClient()
    .from("grandtour_favourite_riders")
    .upsert(
      { user_id: user.id, grand_tour_id: grandTourId, rider_id: riderId },
      { onConflict: "user_id,grand_tour_id,rider_id", ignoreDuplicates: true }
    );
  if (error) throw error;
}

export async function removeFavouriteRider(grandTourId: string, riderId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("You must be signed in to remove a favourite.");
  const { error } = await getSupabaseClient()
    .from("grandtour_favourite_riders")
    .delete()
    .eq("user_id", user.id)
    .eq("grand_tour_id", grandTourId)
    .eq("rider_id", riderId);
  if (error) throw error;
}

/**
 * Adds or removes a favourite based on its current state, returning the
 * new state. The caller (already holding the current favourite set in UI
 * state) tells us which direction to go, rather than this function
 * re-querying first - one round trip either way.
 */
export async function toggleFavouriteRider(
  grandTourId: string,
  riderId: string,
  currentlyFavourite: boolean
): Promise<boolean> {
  if (currentlyFavourite) {
    await removeFavouriteRider(grandTourId, riderId);
    return false;
  }
  await addFavouriteRider(grandTourId, riderId);
  return true;
}
