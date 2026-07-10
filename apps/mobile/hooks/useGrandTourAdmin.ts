import { useCallback } from "react";
import {
  isGrandTourAdmin,
  listGrandTourStageAdminSummaries
} from "@tipping-suite/supabase-client";

import { useAuth } from "../auth/useAuth";
import { useAsyncData } from "./useAsyncData";

/**
 * Confirms the current user is a GrandTour cycling admin before any admin
 * controls are shown - the UI-side half of requirement #9. The real
 * security boundary remains RLS + the workflow RPCs' own service_role/
 * auth.uid() checks (unchanged by this hook); this only decides whether
 * the panel renders at all.
 */
export function useGrandTourAdminAccess() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const loadIsAdmin = useCallback(() => isGrandTourAdmin(userId), [userId]);
  return useAsyncData(loadIsAdmin, [userId]);
}

export function useGrandTourStageAdminSummaries(raceId: string | null | undefined) {
  const loadSummaries = useCallback(
    () => (raceId ? listGrandTourStageAdminSummaries(raceId) : Promise.resolve([])),
    [raceId]
  );
  return useAsyncData(loadSummaries, [raceId]);
}
