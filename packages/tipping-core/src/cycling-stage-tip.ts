export type CyclingRiderStatus =
  | "provisional"
  | "confirmed"
  | "withdrawn"
  | "reserve"
  | "dns"
  | "dnf"
  | "unknown"
  | string;

export type CyclingStageLockInput = {
  /** Legacy: a precise lock instant, when the caller already resolved one. Lowest-priority explicit source (kept for back-compat with existing callers). */
  startTime?: Date | string | null;
  /** grandtour_stages.locks_at - the real stored per-stage lock timestamp. */
  locksAt?: Date | string | null;
  /** grandtour_stages.manual_locked_at - an admin override that always takes priority over any other lock time (AGENTS.md: "Manual lock status overrides timestamps"). */
  manualLockedAt?: Date | string | null;
  stageDate?: string | null;
  defaultLockTimeUtc?: string;
  now?: Date | string;
};

export type CyclingTipValidationInput = CyclingStageLockInput & {
  riderStatus: CyclingRiderStatus;
  hasExistingTip?: boolean;
};

export type CyclingTipValidationResult =
  | { valid: true; reason: null }
  | {
      valid: false;
      reason: "duplicate_tip" | "rider_not_selectable" | "stage_locked";
    };

const SELECTABLE_RIDER_STATUSES = new Set<CyclingRiderStatus>([
  "provisional",
  "confirmed"
]);

export function isCyclingRiderSelectable(status: CyclingRiderStatus): boolean {
  return SELECTABLE_RIDER_STATUSES.has(status);
}

export function resolveCyclingStageLockAt({
  defaultLockTimeUtc = "12:00:00Z",
  stageDate,
  startTime,
  locksAt,
  manualLockedAt
}: CyclingStageLockInput): Date | null {
  // Priority: an explicit admin manual-lock override always wins, then the
  // real stored locks_at column, then the legacy startTime field (kept for
  // callers that only ever had a single precise instant), then a
  // stageDate + defaultLockTimeUtc-derived fallback.
  const explicit = manualLockedAt ?? locksAt ?? startTime;
  if (explicit) {
    const resolved = explicit instanceof Date ? explicit : new Date(explicit);
    return Number.isNaN(resolved.getTime()) ? null : resolved;
  }

  if (!stageDate || !/^\d{4}-\d{2}-\d{2}$/.test(stageDate)) {
    return null;
  }

  if (!/^\d{2}:\d{2}:\d{2}Z$/.test(defaultLockTimeUtc)) {
    return null;
  }

  const fallback = new Date(`${stageDate}T${defaultLockTimeUtc}`);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

export function isCyclingStageTipLocked(input: CyclingStageLockInput): boolean {
  const lockAt = resolveCyclingStageLockAt(input);
  if (!lockAt) {
    return true;
  }

  const now = input.now instanceof Date ? input.now : new Date(input.now ?? Date.now());
  return Number.isNaN(now.getTime()) || now >= lockAt;
}

export function validateCyclingStageWinnerTip(
  input: CyclingTipValidationInput
): CyclingTipValidationResult {
  if (!isCyclingRiderSelectable(input.riderStatus)) {
    return { valid: false, reason: "rider_not_selectable" };
  }

  if (input.hasExistingTip) {
    return { valid: false, reason: "duplicate_tip" };
  }

  if (isCyclingStageTipLocked(input)) {
    return { valid: false, reason: "stage_locked" };
  }

  return { valid: true, reason: null };
}

export function scoreCyclingStageWinnerTip(
  resultPosition: number | null | undefined
): number {
  if (resultPosition === 1) return 10;
  if (
    typeof resultPosition === "number" &&
    resultPosition >= 2 &&
    resultPosition <= 5
  ) return 1;
  return 0;
}

/**
 * Semantic tip-entry/display state for a stage, centralising what was
 * previously three separate hand-rolled `now >= locks_at` comparisons
 * across the mobile app (dashboard, LockCountdownCard, stages list), each
 * with slightly different null-handling. This is the single source of
 * truth every screen should call instead of comparing dates itself.
 */
export type CyclingStageClosureState =
  | "open"
  | "closing_soon"
  | "closed"
  | "live"
  | "completed";

export type CyclingStageClosureInput = CyclingStageLockInput & {
  /** grandtour_stages.starts_at - the stage's real scheduled/actual start instant. Deliberately separate from the lock-related fields above (lock and start are different columns/instants in the real schema). */
  startsAt?: Date | string | null;
  /** Whether an official result already exists for this stage (grandtour_stage_results.is_final). */
  isFinal?: boolean | null;
};

const CYCLING_STAGE_CLOSING_SOON_THRESHOLD_MS = 24 * 60 * 60 * 1000;

function resolveInstant(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const resolved = value instanceof Date ? value : new Date(value);
  return Number.isNaN(resolved.getTime()) ? null : resolved;
}

/**
 * Resolves a stage's closure state, using a single `now` for every
 * comparison within the call (never re-reads the clock partway through).
 * Priority: `completed` (a real result exists) > `live` (the stage has
 * actually started) > the tip-locking state (`closed`/`closing_soon`/`open`,
 * via `isCyclingStageTipLocked`/`resolveCyclingStageLockAt` - the existing
 * lock logic remains the sole source of truth for whether tipping is
 * locked; this function only adds the start/completion states around it).
 * Missing/invalid lock data fails closed, per the existing lock helpers.
 */
export function resolveCyclingStageClosureState(
  input: CyclingStageClosureInput
): CyclingStageClosureState {
  const now = resolveInstant(input.now) ?? new Date();

  if (input.isFinal === true) return "completed";

  const startsAt = resolveInstant(input.startsAt);
  if (startsAt && now.getTime() >= startsAt.getTime()) return "live";

  if (isCyclingStageTipLocked({ ...input, now })) return "closed";

  const lockAt = resolveCyclingStageLockAt({ ...input, now });
  if (!lockAt) return "closed"; // defensive - isCyclingStageTipLocked already fails closed here too
  const msRemaining = lockAt.getTime() - now.getTime();
  return msRemaining <= CYCLING_STAGE_CLOSING_SOON_THRESHOLD_MS ? "closing_soon" : "open";
}
