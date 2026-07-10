import { useCallback, useEffect, useState } from "react";
import { listFavouriteRiderIds, toggleFavouriteRider } from "@tipping-suite/supabase-client";

import { useAsyncData } from "./useAsyncData";

/**
 * Favourites are kept as a client-side Set for O(1) lookups while
 * rendering rider lists, and updated optimistically on toggle (RLS is the
 * real safety boundary - a failed write reverts the optimistic change and
 * surfaces an error rather than silently drifting from the server).
 */
export function useFavouriteRiderIds(grandTourId: string | null | undefined) {
  const loadIds = useCallback(
    () => (grandTourId ? listFavouriteRiderIds(grandTourId) : Promise.resolve([])),
    [grandTourId]
  );
  const result = useAsyncData(loadIds, [grandTourId]);
  const [favourites, setFavourites] = useState<Set<string>>(new Set());
  const [toggleError, setToggleError] = useState<string | null>(null);

  useEffect(() => {
    setFavourites(new Set(result.data ?? []));
  }, [result.data]);

  const toggle = useCallback(async (riderId: string) => {
    if (!grandTourId) return;
    setToggleError(null);
    const wasFavourite = favourites.has(riderId);
    setFavourites((current) => {
      const next = new Set(current);
      if (wasFavourite) next.delete(riderId); else next.add(riderId);
      return next;
    });
    try {
      await toggleFavouriteRider(grandTourId, riderId, wasFavourite);
    } catch (cause) {
      setFavourites((current) => {
        const next = new Set(current);
        if (wasFavourite) next.add(riderId); else next.delete(riderId);
        return next;
      });
      const message = cause instanceof Error ? cause.message : "Could not update your favourite riders.";
      setToggleError(message);
    }
  }, [favourites, grandTourId]);

  return {
    error: result.error ?? toggleError,
    favouriteRiderIds: favourites,
    loading: result.loading,
    reload: result.reload,
    toggle
  };
}
