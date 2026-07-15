/**
 * Rank-movement wording shared by the stage-results email subject and the
 * personal-summary card. `previousRank: null` always means "unknown", never
 * "no change" - a genuinely unknown previous rank must never be rendered
 * as zero movement (matches the leaderboard's own existing "New" handling
 * in apps/mobile/lib/leaderboardExperience.ts, reimplemented here rather
 * than imported since this module runs in the Edge Function/Deno runtime,
 * a different deploy target to the mobile app's tsc-compiled lib/ files).
 */
export type RankMovement =
  | { kind: "up"; places: number }
  | { kind: "down"; places: number }
  | { kind: "same" }
  | { kind: "new" };

export function computeRankMovement(currentRank: number, previousRank: number | null): RankMovement {
  if (previousRank === null) return { kind: "new" };
  const delta = previousRank - currentRank;
  if (delta > 0) return { kind: "up", places: delta };
  if (delta < 0) return { kind: "down", places: -delta };
  return { kind: "same" };
}

/** Up: ▲ 7 / Same: — / Down: ▼ 3 / New: NEW */
export function formatMovementBadge(movement: RankMovement): string {
  switch (movement.kind) {
    case "up":
      return `▲ ${movement.places}`;
    case "down":
      return `▼ ${movement.places}`;
    case "new":
      return "NEW";
    case "same":
    default:
      return "—";
  }
}

/**
 * The subject-line movement clause, e.g. "and moved up 7 places" / "and
 * moved down 3 places" - or null when there's nothing directional to say
 * (unchanged rank, or an unknown previous rank). Never fabricates "moved 0
 * places" for a new or steady entrant.
 */
export function formatSubjectMovementClause(movement: RankMovement): string | null {
  if (movement.kind === "up") return `and moved up ${movement.places} place${movement.places === 1 ? "" : "s"}`;
  if (movement.kind === "down") return `and moved down ${movement.places} place${movement.places === 1 ? "" : "s"}`;
  return null;
}
