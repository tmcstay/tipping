/**
 * Whether a stage's result is eligible to appear in any result-facing feed
 * (dashboard "latest result", recent-results lists, result selectors, rider
 * result histories, result carousels, stage-scoped leaderboard filters,
 * "latest completed stage" calculations). A stage row existing is never
 * sufficient on its own - the schema has no `stage.status`/
 * `result.result_status` columns matching the generic "in_progress /
 * completed / provisional / official" vocabulary directly, so this adapts
 * that conceptual rule to the real fields: `grandtour_stages.starts_at`
 * plus `grandtour_stage_results.is_final` / `review_status`.
 *
 * Note: the public app reads `grandtour_stage_results` via RLS that only
 * exposes rows where `is_final = true` (see
 * packages/supabase-client/src/cycling.ts and CLAUDE.md's GrandTour
 * pipeline notes) - `reviewStatus` support here exists so this predicate is
 * correct and reusable for any future/admin-authenticated caller that can
 * see non-final rows too, even though the public dashboard today will only
 * ever pass `isFinal`.
 */

export type StageEligibilityInput = {
  startsAt: Date | string | null | undefined;
  /** grandtour_stage_results.is_final for this stage's result, if any. */
  isFinal?: boolean | null;
  /** grandtour_stage_results.review_status for this stage's result, if any. */
  reviewStatus?: string | null;
};

const PROVISIONAL_REVIEW_STATUSES = new Set([
  "imported",
  "review_required",
  "admin_checked",
  "correction_required"
]);

function resolveInstant(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const resolved = value instanceof Date ? value : new Date(value);
  return Number.isNaN(resolved.getTime()) ? null : resolved;
}

/**
 * A stage is eligible for result-facing feeds only when its scheduled
 * start has actually passed AND it has a result beyond a bare/absent one:
 * either a finalised ("official") result, or a result row already in a
 * provisional review state. A stage row existing with no result at all
 * (or a `draft` result, which is not yet even a completed import) is never
 * treated as a result merely because the stage row exists.
 */
export function isStageEligibleForResults(
  stage: StageEligibilityInput,
  now: Date = new Date()
): boolean {
  const startsAt = resolveInstant(stage.startsAt);
  if (!startsAt || startsAt.getTime() > now.getTime()) return false;

  if (stage.isFinal === true) return true;
  if (stage.reviewStatus && PROVISIONAL_REVIEW_STATUSES.has(stage.reviewStatus)) return true;
  return false;
}

export type EligibleStageCandidate = StageEligibilityInput & { stageNumber: number };

/**
 * Deterministically selects the "latest" result-eligible stage from a set
 * of candidates: sorted by actual start time descending, tie-broken by
 * stage number descending (never insertion order, never an unordered
 * client-side find). Returns null when nothing is eligible - never falls
 * back to an arbitrary/ineligible stage. This replaces the two
 * near-duplicate ad hoc "sort by stage_number, take [0]" selections that
 * previously lived independently in the dashboard and results screens.
 */
export function selectLatestEligibleStage<T extends EligibleStageCandidate>(
  candidates: readonly T[],
  now: Date = new Date()
): T | null {
  const eligible = candidates.filter((candidate) => isStageEligibleForResults(candidate, now));
  if (eligible.length === 0) return null;

  const sorted = [...eligible].sort((a, b) => {
    const aTime = resolveInstant(a.startsAt)?.getTime() ?? 0;
    const bTime = resolveInstant(b.startsAt)?.getTime() ?? 0;
    if (bTime !== aTime) return bTime - aTime;
    return b.stageNumber - a.stageNumber;
  });

  return sorted[0];
}
