/**
 * Ordering/partition rule for the stage tips list: latest relevant stages
 * first, future stages hidden by default behind a "Show future stages"
 * toggle.
 *
 * "Relevant" means: every stage that has already started (live, closed, or
 * completed) PLUS the single next upcoming stage - that's the one the user
 * needs to tip next, so hiding it would defeat the screen's purpose. The
 * visible list is sorted descending by start time, which naturally reads
 * as: next stage to tip, then anything live, then completed stages
 * most-recent-first.
 *
 * Everything else (stages further in the future) goes to the `future`
 * section, sorted ascending (soonest first - the natural reading order for
 * a forward-looking schedule). Stages with no usable start date can't be
 * reasoned about in time, so they sort to the end of the future section.
 * Stage number is the deterministic tie-breaker throughout, matching the
 * convention of tipping-core's eligibility selectors.
 *
 * Pure and framework-free so it can be unit-tested via test:ui (compiled
 * standalone - no cross-package or React imports here).
 */

export type StageListCandidate = {
  startsAt: string | null;
  stageNumber: number;
};

export type StageListSections<T extends StageListCandidate> = {
  /** Shown by default: started stages plus the next upcoming stage, latest first. */
  current: T[];
  /** Hidden by default behind the toggle: remaining future stages, soonest first. */
  future: T[];
};

function toStartMs(candidate: StageListCandidate): number | null {
  if (!candidate.startsAt) return null;
  const ms = new Date(candidate.startsAt).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function compareAscending(a: StageListCandidate, b: StageListCandidate): number {
  const aMs = toStartMs(a);
  const bMs = toStartMs(b);
  // Unknown start dates sort last in a soonest-first list.
  const aKey = aMs ?? Number.POSITIVE_INFINITY;
  const bKey = bMs ?? Number.POSITIVE_INFINITY;
  if (aKey !== bKey) return aKey - bKey;
  return a.stageNumber - b.stageNumber;
}

function compareDescending(a: StageListCandidate, b: StageListCandidate): number {
  const aMs = toStartMs(a);
  const bMs = toStartMs(b);
  // Unknown start dates sort last in a latest-first list too.
  const aKey = aMs ?? Number.NEGATIVE_INFINITY;
  const bKey = bMs ?? Number.NEGATIVE_INFINITY;
  if (aKey !== bKey) return bKey - aKey;
  return b.stageNumber - a.stageNumber;
}

export function buildStageListSections<T extends StageListCandidate>(
  candidates: readonly T[],
  now: Date
): StageListSections<T> {
  const nowMs = now.getTime();
  const started: T[] = [];
  const upcoming: T[] = [];

  for (const candidate of candidates) {
    const startMs = toStartMs(candidate);
    if (startMs !== null && startMs <= nowMs) {
      started.push(candidate);
    } else {
      upcoming.push(candidate);
    }
  }

  started.sort(compareDescending);
  upcoming.sort(compareAscending);

  // The next upcoming stage is always relevant - it's the one to tip next.
  const next = upcoming.shift();
  const current = next ? [next, ...started] : started;
  return { current, future: upcoming };
}

export function buildFutureStagesToggleLabel(showFuture: boolean, futureCount: number): string {
  if (showFuture) return "Hide future stages";
  return `Show future stages (${futureCount})`;
}
