export type GrandTourStageAdminSummaryLike = {
  isFinal: boolean;
  reviewStatus: string | null;
  resultLineCount: number;
  jerseyHolderCount: number;
  scoreCount: number;
};

export type GrandTourAdminAction = "mark-checked" | "finalise" | "score";

/**
 * Whether a grandtour_stages.stage_type value is a TTT - the same set the
 * RPC layer checks (apply_grandtour_official_stage_result,
 * mark_grandtour_stage_result_checked, finalize_grandtour_stage_result).
 * Used by the admin card to decide whether "Review Results"/"Latest
 * official check" should render team result lines
 * (grandtour_stage_team_result_lines) instead of rider result lines - it
 * does NOT decide whether that TTT stage is actually apply-eligible
 * (ttt_timing_rule='individual_time' is a separate, RPC-enforced concern,
 * not a UI display concern).
 */
export function isTttStageType(stageType: string | null | undefined): boolean {
  return stageType === "ttt" || stageType === "team_time_trial";
}

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

/**
 * Whether the loaded result-line/jersey-holder detail is complete (10
 * lines, 4 jersey holders) - the same shape check canMarkChecked applies,
 * factored out so the review-detail warning banner and the button gate can
 * both use it without duplicating the "10"/"4" literals.
 */
export function isStageDataComplete(summary: GrandTourStageAdminSummaryLike): boolean {
  return summary.resultLineCount === 10 && summary.jerseyHolderCount === 4;
}

/**
 * Warning strings for the review-detail section, e.g. "Only 7 of 10 result
 * lines loaded." Empty array means nothing to warn about (not necessarily
 * "ready" - a complete-but-already-scored stage has no warnings either).
 */
export function getStageReviewWarnings(summary: GrandTourStageAdminSummaryLike): string[] {
  const warnings: string[] = [];
  if (summary.resultLineCount !== 10) {
    warnings.push(`Only ${summary.resultLineCount} of 10 result lines loaded.`);
  }
  if (summary.jerseyHolderCount !== 4) {
    warnings.push(`Only ${summary.jerseyHolderCount} of 4 jersey holders loaded.`);
  }
  return warnings;
}

/**
 * The exact confirmation-modal copy shown before Mark Checked, including
 * the stage number and an ISO timestamp the admin is implicitly attesting
 * to at the moment of confirming.
 */
export function buildMarkCheckedConfirmationMessage(stageNumber: number, now: Date = new Date()): string {
  return `I have reviewed the top 10 result lines and four jersey holders for Stage ${stageNumber}, at ${now.toISOString()}.`;
}

/**
 * Human label for grandtour_stage_results.review_status, for the admin
 * stage card's collapsed header - an admin needs to identify a stage's
 * import/reconciliation progress without expanding it. `null` means no
 * result row exists at all yet (nothing has ever been applied).
 */
export function formatReviewStatusLabel(reviewStatus: string | null): string {
  switch (reviewStatus) {
    case "draft":
      return "Draft";
    case "imported":
      return "Imported";
    case "review_required":
      return "Review required";
    case "admin_checked":
      return "Admin checked";
    case "finalised":
      return "Finalised";
    case "correction_required":
      return "Correction required";
    default:
      return "Not imported";
  }
}

/** Whether a stage's own scheduled date is still ahead of `now` - a simple "has this stage actually happened yet" signal, distinct from review_status (which tracks the *result's* progress, not the stage's own calendar position). */
export function resolveAdminStageDateStatus(stageDate: string | null, now: Date): "Upcoming" | "Past" | "Date TBC" {
  if (!stageDate) return "Date TBC";
  const ms = new Date(stageDate).getTime();
  if (Number.isNaN(ms)) return "Date TBC";
  return ms > now.getTime() ? "Upcoming" : "Past";
}

/** "7/10 lines · 3/4 jerseys · 0 scored" - the collapsed header's at-a-glance count of reviewed/unresolved items, so an admin can spot an incomplete import without expanding the card. */
export function buildAdminStageReviewCountsLabel(summary: GrandTourStageAdminSummaryLike): string {
  return `${summary.resultLineCount}/10 lines · ${summary.jerseyHolderCount}/4 jerseys · ${summary.scoreCount} scored`;
}
