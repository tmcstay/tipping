import { useCallback, useState } from "react";
import type {
  GrandTourTipMode,
  GrandTourTipScope,
  GrandTourTipSelectionInput
} from "@tipping-suite/shared-types";
import {
  clearGrandTourTip,
  getGrandTourTipEntryAvailability,
  getCurrentUserGrandTourTip,
  listLeagueTipsAfterLock,
  saveGrandTourTipDraft,
  submitGrandTourTip
} from "@tipping-suite/supabase-client";

import { useAsyncData } from "./useAsyncData";

export const GRANDTOUR_TIPPING_UNAVAILABLE_MESSAGE =
  "GrandTour tipping is temporarily unavailable while we make updates.";

export function useGrandTourTipEntryAvailability() {
  const loadAvailability = useCallback(() => getGrandTourTipEntryAvailability(), []);
  return useAsyncData(loadAvailability, []);
}

type TipIdentity = {
  competitionId: string | null | undefined;
  stageId: string | null | undefined;
  tipMode: GrandTourTipMode;
  tipScope: GrandTourTipScope;
};

function useTip(identity: TipIdentity) {
  const loadTip = useCallback(
    () => identity.competitionId && identity.stageId !== undefined
      ? getCurrentUserGrandTourTip({
          competitionId: identity.competitionId,
          stageId: identity.stageId,
          tipMode: identity.tipMode,
          tipScope: identity.tipScope
        })
      : Promise.resolve(null),
    [identity.competitionId, identity.stageId, identity.tipMode, identity.tipScope]
  );
  return useAsyncData(loadTip, [
    identity.competitionId,
    identity.stageId,
    identity.tipMode,
    identity.tipScope
  ]);
}

export function useStageTipDraft(input: {
  competitionId: string | null | undefined;
  stageId: string | null | undefined;
  tipMode?: GrandTourTipMode;
}) {
  return useTip({ ...input, tipMode: input.tipMode ?? "daily", tipScope: "stage" });
}

export function useOverallJerseyTip(competitionId: string | null | undefined) {
  return useTip({ competitionId, stageId: null, tipMode: "preselection", tipScope: "overall_jerseys" });
}

function useMutation<TInput, TResult>(
  mutate: (input: TInput) => Promise<TResult>,
  fallbackMessage: string
) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (input: TInput) => {
    setSaving(true);
    setError(null);
    try {
      return await mutate(input);
    } catch (cause) {
      const serverMessage = typeof cause === "object" && cause !== null && "message" in cause
        ? String(cause.message)
        : null;
      setError(serverMessage ?? fallbackMessage);
      throw cause;
    } finally {
      setSaving(false);
    }
  }, [fallbackMessage, mutate]);
  return { error, saving, run, resetError: () => setError(null) };
}

export function useSaveTipDraft() {
  const saveDraft = useCallback((input: {
    competitionId: string;
    stageId: string | null;
    tipMode: GrandTourTipMode;
    tipScope: GrandTourTipScope;
    selections: GrandTourTipSelectionInput[];
  }) => saveGrandTourTipDraft(input), []);
  const mutation = useMutation(saveDraft, "Could not save this draft.");
  return { ...mutation, saveDraft: mutation.run };
}

export function useSubmitTip() {
  const submitTip = useCallback((tipId: string) => submitGrandTourTip(tipId), []);
  const mutation = useMutation(submitTip, "Could not submit these tips.");
  return { ...mutation, submitTip: mutation.run };
}

export function useClearTip() {
  const clearTip = useCallback((tipId: string) => clearGrandTourTip(tipId), []);
  const mutation = useMutation(clearTip, "Could not clear this tip.");
  return { ...mutation, clearTip: mutation.run };
}

export function useLeagueTipsAfterLock(input: TipIdentity) {
  const loadTips = useCallback(
    () => input.competitionId && input.stageId !== undefined
      ? listLeagueTipsAfterLock({
          competitionId: input.competitionId,
          stageId: input.stageId,
          tipMode: input.tipMode,
          tipScope: input.tipScope
        })
      : Promise.resolve([]),
    [input.competitionId, input.stageId, input.tipMode, input.tipScope]
  );
  return useAsyncData(loadTips, [
    input.competitionId,
    input.stageId,
    input.tipMode,
    input.tipScope
  ]);
}
