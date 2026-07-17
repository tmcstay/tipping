/**
 * Pure functions implementing the absence/inactivity policy for
 * `public.uci_riders`. No I/O -- the sync CLI (scripts/uci-rider-sync.mjs)
 * calls these once per rider per run and applies the results.
 *
 * Policy:
 *   - `last_seen_at` is updated (to "now") whenever a sync's UCI listing
 *     genuinely returns the rider.
 *   - `consecutive_absences` increments only on a COMPLETED sync run
 *     where the rider was expected (i.e. this run covers the rider's
 *     discipline/season and the listing was fully paginated) but absent
 *     from the results.
 *   - `is_active` flips to false only once `consecutive_absences` reaches
 *     INACTIVITY_THRESHOLD_CONSECUTIVE_SYNCS.
 *   - A `partial`/`failed` sync run is NEVER evidence of absence -- a
 *     network hiccup or an early circuit-breaker trip must never look
 *     like "the rider stopped racing." `consecutive_absences` is left
 *     completely untouched for a rider not confidently accounted for in
 *     a partial/failed run.
 *   - Never a hard delete -- `is_active = false` is the only state change,
 *     always reversible by the rider reappearing in a later completed
 *     sync (see `recordRiderSeen`).
 */

// ~1 month of weekly syncs. A constant, not derived from any date math --
// this is a count of consecutive completed runs, not a calendar duration,
// since sync cadence itself may vary (a missed scheduled run is not the
// same thing as the rider being absent).
export const INACTIVITY_THRESHOLD_CONSECUTIVE_SYNCS = 4;

/**
 * A completed sync run that genuinely found the rider. Resets the
 * absence counter and refreshes last_seen_at -- reactivates a
 * previously-inactive rider automatically (no manual "un-delete" step is
 * ever needed).
 */
export function recordRiderSeen({ now = new Date() } = {}) {
  return {
    last_seen_at: now.toISOString(),
    consecutive_absences: 0,
    is_active: true,
  };
}

/**
 * A completed sync run that covered this rider's discipline/season but
 * did not find them. Only a genuinely `completed` run counts as evidence
 * -- `partial`/`failed` never increment the counter (see the module doc
 * comment). `currentConsecutiveAbsences` is the rider's existing value
 * before this run.
 */
export function recordRiderAbsent({ currentConsecutiveAbsences = 0, syncRunStatus }) {
  if (syncRunStatus !== "completed") {
    return { changed: false, consecutive_absences: currentConsecutiveAbsences, is_active: undefined };
  }
  const nextCount = currentConsecutiveAbsences + 1;
  const shouldDeactivate = nextCount >= INACTIVITY_THRESHOLD_CONSECUTIVE_SYNCS;
  return {
    changed: true,
    consecutive_absences: nextCount,
    is_active: shouldDeactivate ? false : undefined,
  };
}

/**
 * Convenience wrapper deciding which of the two functions above applies,
 * from the rider's already-known previous state and whether this run's
 * listing included them. Returns a plain partial-row patch ready to merge
 * into a planned update -- never mutates its inputs.
 */
export function applyInactivityPolicy({ wasSeenThisRun, currentConsecutiveAbsences = 0, syncRunStatus, now = new Date() }) {
  if (wasSeenThisRun) {
    return recordRiderSeen({ now });
  }
  const outcome = recordRiderAbsent({ currentConsecutiveAbsences, syncRunStatus });
  if (!outcome.changed) {
    return { last_seen_at: undefined, consecutive_absences: currentConsecutiveAbsences, is_active: undefined };
  }
  const patch = { last_seen_at: undefined, consecutive_absences: outcome.consecutive_absences };
  if (outcome.is_active !== undefined) patch.is_active = outcome.is_active;
  return patch;
}
