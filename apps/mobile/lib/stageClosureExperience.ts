/**
 * Pure display/view-model logic for the dashboard's stage cards: turns an
 * already-resolved closure state (from
 * @tipping-suite/tipping-core's resolveCyclingStageClosureState - the real
 * date-math lives there, this file only formats it) plus a caller-supplied
 * pre-formatted lock date/time string into exactly what a card needs to
 * render: badge label, primary line, emphasis, whether editing is allowed,
 * and the CTA label. Also builds the small (href, accessibilityLabel,
 * accessibilityHint) tuples every clickable dashboard card needs, and the
 * "N of 5 selections completed" progress label.
 *
 * Deliberately takes the resolved state as a plain string union (not an
 * import of CyclingStageClosureState from @tipping-suite/tipping-core) and
 * a caller-supplied formatted date/time string (not a Date +
 * Intl.DateTimeFormat call here) - this file is compiled standalone by
 * apps/mobile's test:ui tsc invocation (see package.json), which does not
 * resolve cross-package runtime imports, and locale-aware date formatting
 * belongs in lib/formatters.ts, not duplicated here.
 */

export type CyclingStageClosureStateLike =
  | "open"
  | "closing_soon"
  | "closed"
  | "live"
  | "completed";

export type ClosureBadgeLabel = "Open" | "Closing soon" | "Closed" | "Live" | "Completed";

export type ClosureDisplay = {
  state: CyclingStageClosureStateLike;
  badgeLabel: ClosureBadgeLabel;
  /** The single line of text a card should show for this state - never a stale/expired timestamp, never a negative countdown. */
  primaryLabel: string;
  /** True for the high-emphasis <60m-remaining tier, and for "live" - callers should render these with stronger visual weight. */
  emphasis: boolean;
  /** Whether tip-entry/edit controls should be shown at all. */
  editable: boolean;
  ctaLabel: string;
  showLockIcon: boolean;
};

export type ClosureDisplayInput = {
  state: CyclingStageClosureStateLike;
  locksAt: string | null;
  now: Date;
  /** A locale-formatted date/time string for `locksAt` (e.g. from lib/formatters.ts's formatDateTime), used only in the "open" state. */
  formattedLockDateTime: string;
  hasDraftInProgress?: boolean;
  hasSubmittedTip?: boolean;
};

const CLOSING_SOON_HIGH_EMPHASIS_MINUTES = 60;

function resolveCtaLabel(input: ClosureDisplayInput): string {
  if (input.hasSubmittedTip) return "Edit tips";
  if (input.hasDraftInProgress) return "Continue draft";
  return "Enter tips";
}

function formatOpenClosingSoonLabel(msRemaining: number): { label: string; highEmphasis: boolean } {
  const totalMinutes = Math.max(0, Math.ceil(msRemaining / 60000));
  if (totalMinutes <= CLOSING_SOON_HIGH_EMPHASIS_MINUTES) {
    return { label: `Closes in ${totalMinutes}m`, highEmphasis: true };
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return { label: `Closes in ${hours}h ${minutes}m`, highEmphasis: false };
}

/**
 * Builds everything a stage card needs to display for its closure state.
 * Never shows a closure timestamp once it has passed, never a negative
 * countdown, and never a tip-entry CTA once `editable` is false.
 */
export function buildClosureDisplay(input: ClosureDisplayInput): ClosureDisplay {
  switch (input.state) {
    case "completed":
      return {
        state: "completed",
        badgeLabel: "Completed",
        primaryLabel: "Completed",
        emphasis: false,
        editable: false,
        ctaLabel: "View result",
        showLockIcon: false
      };
    case "live":
      return {
        state: "live",
        badgeLabel: "Live",
        primaryLabel: "Live",
        emphasis: true,
        editable: false,
        ctaLabel: "View stage",
        showLockIcon: false
      };
    case "closed":
      return {
        state: "closed",
        badgeLabel: "Closed",
        primaryLabel: "Closed",
        emphasis: false,
        editable: false,
        ctaLabel: "View tips",
        showLockIcon: true
      };
    case "closing_soon": {
      const lockAtMs = input.locksAt ? new Date(input.locksAt).getTime() : NaN;
      const msRemaining = Number.isNaN(lockAtMs) ? 0 : Math.max(0, lockAtMs - input.now.getTime());
      const { label, highEmphasis } = formatOpenClosingSoonLabel(msRemaining);
      return {
        state: "closing_soon",
        badgeLabel: "Closing soon",
        primaryLabel: label,
        emphasis: highEmphasis,
        editable: true,
        ctaLabel: resolveCtaLabel(input),
        showLockIcon: false
      };
    }
    case "open":
    default:
      return {
        state: "open",
        badgeLabel: "Open",
        primaryLabel: `Closes ${input.formattedLockDateTime}`,
        emphasis: false,
        editable: true,
        ctaLabel: resolveCtaLabel(input),
        showLockIcon: false
      };
  }
}

/**
 * "Closes in Xd Yh" / "Xh Ym" / "Xm" / "Xm Ys" / "Xs" / "Closed" - the one
 * shared duration formatter for every live stage-lock countdown in the app
 * (components/StageLockCountdown.tsx), replacing what used to be two
 * separate, differently-worded one-shot implementations (this file's old
 * closing_soon-only minute formatter, and lib/formatters.ts's
 * formatDurationUntil, used only by the tip-entry screen). Granularity
 * narrows as the deadline approaches so the display stays meaningful right
 * up to the close: whole days+hours while there's more than a day left,
 * hours+minutes under a day, whole minutes while there's 5+ minutes left,
 * and minutes+seconds (or bare seconds under a minute) once it's close
 * enough that a viewer might actually be watching the clock. Never returns
 * a negative duration - clamps to "Closed" instead.
 */
export function formatLockCountdown(msRemaining: number): string {
  if (msRemaining <= 0) return "Closed";
  const totalSeconds = Math.floor(msRemaining / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return `Closes in ${days}d ${hours}h`;
  if (hours > 0) return `Closes in ${hours}h ${minutes}m`;
  if (minutes >= 5) return `Closes in ${minutes}m`;
  if (minutes > 0) return `Closes in ${minutes}m ${seconds}s`;
  return `Closes in ${seconds}s`;
}

const COUNTDOWN_TICK_UNDER_ONE_MINUTE_MS = 1000;
const COUNTDOWN_TICK_UNDER_ONE_HOUR_MS = 30_000;
const COUNTDOWN_TICK_DEFAULT_MS = 60_000;

/**
 * How often a live countdown should re-render, given how much time is
 * actually left - second-level precision only once it matters (under a
 * minute), never a wasted per-second re-render for a stage that's days
 * away. Pure so it's unit-tested the same as the formatter above; the
 * ticking itself (setTimeout/setInterval) lives in the React component.
 */
export function resolveCountdownTickIntervalMs(msRemaining: number): number {
  if (msRemaining <= 60_000) return COUNTDOWN_TICK_UNDER_ONE_MINUTE_MS;
  if (msRemaining <= 3_600_000) return COUNTDOWN_TICK_UNDER_ONE_HOUR_MS;
  return COUNTDOWN_TICK_DEFAULT_MS;
}

/** "N of 5 selections completed" - clamped so a data glitch can never show a negative or over-100% count. */
export function buildSelectionProgressLabel(selectedCount: number, totalSlots: number = 5): string {
  const clamped = Math.max(0, Math.min(selectedCount, totalSlots));
  return `${clamped} of ${totalSlots} selections completed`;
}

export type CompoundStatusLineInput = {
  badgeLabel: ClosureBadgeLabel;
  state: CyclingStageClosureStateLike;
  /** Only meaningful for open/closing_soon. */
  selectedCount?: number;
  totalSlots?: number;
  hasSubmittedTip?: boolean;
  hasAnyTip?: boolean;
  /** Only meaningful for completed. Null/undefined -> no points shown yet. */
  points?: number | null;
};

/**
 * One compact "status · tip state" line - e.g. "Open · 3 of 5 complete",
 * "Closed · Tips submitted", "Live · Tips locked", "Completed · 18 points".
 * Stage status and tip state are deliberately kept as two clauses of one
 * line rather than merged into a single ambiguous word.
 */
export function buildCompoundStatusLine(input: CompoundStatusLineInput): string {
  const totalSlots = input.totalSlots ?? 5;
  switch (input.state) {
    case "completed":
      return input.points != null ? `${input.badgeLabel} · ${input.points} points` : input.badgeLabel;
    case "live":
      return `${input.badgeLabel} · ${input.hasAnyTip ? "Tips locked" : "No tip"}`;
    case "closed":
      return `${input.badgeLabel} · ${input.hasSubmittedTip ? "Tips submitted" : "No tip"}`;
    case "open":
    case "closing_soon":
    default: {
      if (input.hasSubmittedTip) return `${input.badgeLabel} · Tips submitted`;
      const selected = Math.max(0, Math.min(input.selectedCount ?? 0, totalSlots));
      if (selected === 0) return `${input.badgeLabel} · Action required`;
      return `${input.badgeLabel} · ${selected} of ${totalSlots} complete`;
    }
  }
}

export type DashboardCardLink = {
  href: string;
  accessibilityLabel: string;
  accessibilityHint: string;
};

/** Link/accessibility tuple for a stage card (next-stage hero, latest result, upcoming-stage row). */
export function buildStageDashboardCardLink(input: {
  stageId: string;
  stageNumber: number;
  startLocation: string | null;
  finishLocation: string | null;
  statusLabel: string;
  ctaLabel: string;
}): DashboardCardLink {
  const place = `${input.startLocation ?? "TBC"} to ${input.finishLocation ?? "TBC"}`;
  return {
    href: `/stages/${input.stageId}`,
    accessibilityLabel: `Stage ${input.stageNumber}, ${place}, ${input.statusLabel}`,
    accessibilityHint: `Double tap to ${input.ctaLabel.toLowerCase()}`
  };
}

export function buildLeaderboardDashboardCardLink(competitionName: string | null): DashboardCardLink {
  return {
    href: "/leaderboard",
    accessibilityLabel: competitionName ? `${competitionName} leaderboard` : "Leaderboard",
    accessibilityHint: "Double tap to view the full leaderboard"
  };
}

export function buildRankStatCardLink(): DashboardCardLink {
  return {
    href: "/leaderboard",
    accessibilityLabel: "Your overall rank",
    accessibilityHint: "Double tap to view the full leaderboard"
  };
}

export function buildHistoryStatCardLink(): DashboardCardLink {
  return {
    href: "/my-tips",
    accessibilityLabel: "Your tipping history",
    accessibilityHint: "Double tap to view your tips and score history"
  };
}

export function buildJerseyDashboardCardLink(jerseyLabel: string): DashboardCardLink {
  return {
    href: "/overall-jerseys",
    accessibilityLabel: `${jerseyLabel} jersey standings`,
    accessibilityHint: "Double tap to view jersey standings"
  };
}
