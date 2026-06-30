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
  startTime?: Date | string | null;
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
  startTime
}: CyclingStageLockInput): Date | null {
  if (startTime) {
    const resolved = startTime instanceof Date ? startTime : new Date(startTime);
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
  if (resultPosition === 2) return 6;
  if (resultPosition === 3) return 4;
  if (
    typeof resultPosition === "number" &&
    resultPosition >= 4 &&
    resultPosition <= 10
  ) return 1;
  return 0;
}
