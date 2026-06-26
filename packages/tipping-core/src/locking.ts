export type LockableEvent = {
  lockAt?: Date | string | null;
};

export type LockableMarket = {
  lockAt?: Date | string | null;
  status?: string | null;
};

export type TipPermissionInput = {
  event?: LockableEvent | null;
  market: LockableMarket;
  now?: Date | string;
};

export function resolveMarketLockAt(
  market: LockableMarket,
  event?: LockableEvent | null
): Date | null {
  const lockAt = market.lockAt ?? event?.lockAt ?? null;

  if (!lockAt) {
    return null;
  }

  return lockAt instanceof Date ? lockAt : new Date(lockAt);
}

export function isMarketLocked({
  event,
  market,
  now = new Date()
}: TipPermissionInput): boolean {
  if (market.status && market.status !== "open") {
    return true;
  }

  const lockAt = resolveMarketLockAt(market, event);

  if (!lockAt || Number.isNaN(lockAt.getTime())) {
    return true;
  }

  const currentTime = now instanceof Date ? now : new Date(now);

  return currentTime >= lockAt;
}

export function canSubmitTip(input: TipPermissionInput): boolean {
  return !isMarketLocked(input);
}
