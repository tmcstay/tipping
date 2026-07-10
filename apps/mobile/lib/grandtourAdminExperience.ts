export type GrandTourStageAdminSummaryLike = {
  isFinal: boolean;
  reviewStatus: string | null;
  resultLineCount: number;
  jerseyHolderCount: number;
  scoreCount: number;
};

export type GrandTourAdminAction = "mark-checked" | "finalise" | "score";

/**
 * Pure button-gating rules for the GrandTour admin stage panel. Mirrors
 * (but does not replace) the RPCs' own server-side gates in
 * mark_grandtour_stage_result_checked/finalize_grandtour_stage_result/
 * recalculate_grandtour_stage_scores - this only decides whether a button
 * is enabled in the UI, so a stale summary can never let a click bypass a
 * real RPC-side refusal, it only avoids offering an action that's
 * obviously not going to succeed yet.
 */
export function canMarkChecked(summary: GrandTourStageAdminSummaryLike): boolean {
  return (
    summary.isFinal === false &&
    summary.resultLineCount === 10 &&
    summary.jerseyHolderCount === 4 &&
    summary.scoreCount === 0
  );
}

export function canFinalise(summary: GrandTourStageAdminSummaryLike): boolean {
  return (
    summary.reviewStatus === "admin_checked" &&
    summary.isFinal === false &&
    summary.scoreCount === 0
  );
}

export function canScore(summary: GrandTourStageAdminSummaryLike): boolean {
  return summary.reviewStatus === "finalised" && summary.isFinal === true;
}

export function getGrandTourAdminActionAvailability(
  summary: GrandTourStageAdminSummaryLike
): Record<GrandTourAdminAction, boolean> {
  return {
    "mark-checked": canMarkChecked(summary),
    finalise: canFinalise(summary),
    score: canScore(summary)
  };
}

const ACTION_LABELS: Record<GrandTourAdminAction, string> = {
  "mark-checked": "Mark Checked",
  finalise: "Finalise",
  score: "Score"
};

export function getGrandTourAdminActionLabel(action: GrandTourAdminAction): string {
  return ACTION_LABELS[action];
}

/**
 * Formats an RPC action's outcome into the readable success message shown
 * under the acted-on stage, alongside the raw RPC result (rendered
 * separately, unmodified). Never throws - error formatting is handled by
 * the caller from the RPC's own thrown error.
 */
export function formatGrandTourAdminActionMessage(
  action: GrandTourAdminAction,
  stageNumber: number,
  rpcResult: unknown
): string {
  const label = getGrandTourAdminActionLabel(action);
  if (rpcResult && typeof rpcResult === "object" && "status" in rpcResult) {
    const status = (rpcResult as { status?: unknown }).status;
    if (typeof status === "string") {
      return `${label} succeeded for stage ${stageNumber} (status: ${status}).`;
    }
  }
  if (action === "score" && typeof rpcResult === "number") {
    return `${label} succeeded for stage ${stageNumber}: ${rpcResult} tip(s) scored.`;
  }
  return `${label} succeeded for stage ${stageNumber}.`;
}
