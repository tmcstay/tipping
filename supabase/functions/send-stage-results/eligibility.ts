/**
 * Pure eligibility rules for stage-result notification jobs. No Deno/network
 * APIs - the Edge Function's index.ts loads data and calls these.
 */

/**
 * The single reliable "stage result is final AND scoring is complete"
 * condition (see CLAUDE.md's "Resend transactional email" section /
 * Phase 1 discovery): `grandtour_stage_results.is_final` is kept in
 * lockstep with `review_status = 'finalised'` by a DB CHECK constraint, but
 * a final result alone does NOT mean scoring has run - scoring is a
 * separate step (`recalculate_grandtour_stage_scores`) that only ever runs
 * after finalisation and is only inferable from `grandtour_stage_scores`
 * row existence (no boolean "scoring complete" column exists anywhere).
 * There is no explicit "cancelled" stage-result state in this schema
 * (`review_status`'s 6 values have no such value) - a cancelled/abandoned
 * stage simply never reaches `is_final = true`, so it's already excluded
 * here without a special case.
 */
export function isStageReadyForNotifications(input: {
  isFinal: boolean;
  reviewStatus: string | null;
  scoreCount: number;
}): boolean {
  return input.isFinal === true && input.reviewStatus === "finalised" && input.scoreCount > 0;
}

export type ParticipantSkipReason = "notifications_disabled" | "no_email";

export type ParticipantJobPlan =
  | { status: "pending" }
  | { status: "skipped"; reason: ParticipantSkipReason };

/**
 * Called only for users who already have a scored/corrected tip on a
 * ready stage (the "did not participate" exclusion happens one layer up,
 * by only ever iterating grandtour_stage_scores rows in the first place -
 * a non-participant never reaches this function at all). Every other
 * exclusion in the task brief not handled here (provisional results,
 * review-required, incomplete scoring, cancelled stage, already-sent job)
 * is handled by isStageReadyForNotifications and the caller's own
 * idempotent-upsert-then-claim-only-pending/failed-ready query - not by
 * this per-user classifier.
 */
export function classifyParticipant(input: {
  resultsEmailEnabled: boolean;
  email: string | null;
}): ParticipantJobPlan {
  const trimmedEmail = input.email?.trim() ?? "";
  if (!trimmedEmail) return { status: "skipped", reason: "no_email" };
  if (!input.resultsEmailEnabled) return { status: "skipped", reason: "notifications_disabled" };
  return { status: "pending" };
}

/**
 * `generation` starts at 1 for a job's original send and is bumped by
 * `grandtour_private.dispatch_stage_score_notifications` (see
 * 20260716010000_grandtour_stage_score_notification_dispatch.sql) whenever a
 * stage is rescored/corrected after already notifying - folding it into the
 * key ensures Resend's own Idempotency-Key cache never dedupes a corrected
 * email against the original send. Generation 1 omits the suffix so the
 * original key format (and the DB-side default of `notification_generation
 * = 1`) stay unchanged.
 */
export function buildStageResultIdempotencyKey(stageId: string, userId: string, generation = 1): string {
  const base = `stage-result:${stageId}:${userId}`;
  return generation <= 1 ? base : `${base}:g${generation}`;
}
