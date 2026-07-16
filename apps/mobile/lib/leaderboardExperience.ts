/**
 * Pure view-model logic for the compact, standings-oriented leaderboard:
 * decides which rows to actually render so a long leaderboard stays easy
 * to scan (top block, then a divider, then a small window centred on the
 * signed-in user) rather than forcing everyone to scroll through the
 * entire field to find themselves. Takes plain row-like objects (id +
 * user_id + rank), not the full CyclingLeaderboardRow type, so this file
 * can be compiled standalone by apps/mobile's test:ui script (see
 * package.json) without resolving cross-package imports.
 */

export type LeaderboardRowLike = {
  id: string;
  user_id: string;
  rank: number;
};

export type LeaderboardDisplayItem<T extends LeaderboardRowLike> =
  | { type: "row"; row: T; isCurrentUser: boolean }
  | { type: "divider" };

/**
 * Rows are assumed already sorted by rank ascending (as the leaderboard
 * RPC returns them). When the current user is already visible within the
 * top `topCount` rows (or isn't in the list at all, or the whole list fits
 * within `topCount`), every row is shown as-is - no divider. Otherwise,
 * shows the top `topCount` rows, a single divider, then a small window of
 * `windowRadius` rows on each side of the current user (never duplicating
 * a row that's already in the top block).
 */
export function buildLeaderboardDisplayItems<T extends LeaderboardRowLike>(
  rows: T[],
  currentUserId: string | null | undefined,
  topCount = 15,
  windowRadius = 1
): LeaderboardDisplayItem<T>[] {
  const userIndex = currentUserId ? rows.findIndex((row) => row.user_id === currentUserId) : -1;

  if (rows.length <= topCount || userIndex === -1 || userIndex < topCount) {
    return rows.map((row) => ({ type: "row", row, isCurrentUser: row.user_id === currentUserId }));
  }

  const topRows = rows.slice(0, topCount);
  const windowStart = Math.max(topCount, userIndex - windowRadius);
  const windowEnd = Math.min(rows.length, userIndex + windowRadius + 1);
  const windowRows = rows.slice(windowStart, windowEnd);

  return [
    ...topRows.map((row) => ({ type: "row" as const, row, isCurrentUser: false })),
    { type: "divider" as const },
    ...windowRows.map((row) => ({ type: "row" as const, row, isCurrentUser: row.user_id === currentUserId }))
  ];
}

/**
 * Formats rank movement since the previous completed stage. `previousRank`
 * is null when the user had no scored stage before the most recent one
 * (a brand-new entrant relative to that stage) - shown as "New", never a
 * fabricated number. Lower rank numbers are better, so a decrease is an
 * improvement (up arrow).
 */
export function formatRankMovement(rank: number, previousRank: number | null): string {
  if (previousRank === null) return "New";
  const delta = previousRank - rank;
  if (delta === 0) return "—";
  return delta > 0 ? `↑ ${delta}` : `↓ ${Math.abs(delta)}`;
}

export type RankMovementTone = "up" | "down" | "steady";

/**
 * Colour semantics for a movement value: an improvement is "up" (green),
 * a drop is "down" (red), and both an unchanged rank and a "New" entrant
 * are "steady" (blue) - a new entrant hasn't lost ground to anyone, so it
 * never renders in the negative colour.
 */
export function getRankMovementTone(rank: number, previousRank: number | null): RankMovementTone {
  if (previousRank === null) return "steady";
  if (previousRank > rank) return "up";
  if (previousRank < rank) return "down";
  return "steady";
}

export type ParticipantDetailLink = {
  href: string;
  accessibilityLabel: string;
  accessibilityHint: string;
};

/** Link/accessibility tuple for a leaderboard row that navigates to that participant's tip history/scoring detail page - the single source of both the route and its accessible name, so the leaderboard screen and any future entry point (e.g. a future dashboard mini-leaderboard) build this identically. */
export function buildParticipantDetailLink(userId: string, displayName: string): ParticipantDetailLink {
  return {
    href: `/participant/${userId}`,
    accessibilityLabel: `View ${displayName}'s tips and scores`,
    accessibilityHint: "Double tap to view this participant's tip history and scoring"
  };
}
