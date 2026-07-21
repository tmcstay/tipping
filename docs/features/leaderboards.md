# Leaderboards

## Purpose
Rank users within a competition by daily, preselection, and overall (derived)
score, with rank-movement context.

## Confirmed rules
- Three leaderboard types exist at the schema level (`leaderboard_type`):
  daily, preselection, overall. Overall is derived (daily + preselection),
  never a tip-entry mode.
- `get_grandtour_leaderboard_with_movement(p_competition_id, p_leaderboard_type)`
  computes rank live and stateless every call (no rank-history/snapshot
  table). "Previous" standing is derived on demand: identifies the single
  most-recently-scored stage across the whole leaderboard and reduces each
  user's total by exactly that one stage's contribution.
- A user with no scored stage before that one gets `previous_rank: null`,
  rendered as `"New"` — never a fabricated number.
- Movement badge: `▲ N` (up, colored `positiveStrong`), `▼ N` (down, colored
  `danger` red — an explicit exception to this app's usual "red reserved for
  errors" rule), `—` (steady), `NEW`.

## User experience
`apps/mobile/app/leaderboard.tsx` — compact table (no per-row card chrome),
current-user summary card, search-by-display-name filter, rank/points/move
columns (Move renders at every width as of the latest pass — the earlier
768px-breakpoint responsive split was removed). Tapping a row navigates to
`/participant/[userId]` via `Pressable` + `router.push()` (not
`<Link asChild>` — see [TROUBLESHOOTING.md](../development/TROUBLESHOOTING.md)
for why).

## Data model
`get_grandtour_leaderboard` (original) and
`get_grandtour_leaderboard_with_movement` (extends it with `previous_rank`).
Both `security invoker`, both join `profiles` for `display_name` — both were
silently broken for a period by a missing `profiles` SELECT grant (see
[DATABASE.md](../development/DATABASE.md)).

## Relevant source files
- `apps/mobile/lib/leaderboardExperience.ts` — `buildLeaderboardDisplayItems`,
  `formatRankMovement`, `getRankMovementTone`,
  `buildParticipantDetailLink`.
- `packages/supabase-client/src/cycling.ts` — `listCyclingLeaderboard`.

## Relevant migrations
- `20260702055447_live_grandtour_leaderboards.sql` — original leaderboard RPC.
- `20260714050000_grandtour_leaderboard_movement.sql` — movement extension.
- `20260715080000_grandtour_leaderboard_movement_service_role_access.sql`,
  `20260715090000_grandtour_leaderboard_movement_short_circuit_fix.sql` —
  two real bugs fixed post-launch (missing service-role grant; a
  short-circuit-evaluation assumption that doesn't hold in Postgres — see
  [DATABASE.md](../development/DATABASE.md) gotcha #5).

## Current implementation
Fully built: compact table, movement, search, current-user summary card,
per-row navigation to participant detail. Column alignment was fixed twice
(centred Points/Move, then a chevron-spacer regression fix).

## Outstanding work
None known beyond the shared "only Tour de France is a real race" constraint
and the general RLS-visibility test gap noted in
[official-data-import.md](official-data-import.md).

## Edge cases
- A user outside the visible top block sees the top N rows, a `⋯` divider,
  then a small window centred on themselves — never forced to scroll through
  the whole field. Falls back to a flat list (no divider) when the list is
  short or the user is already near the top.
- No fabricated movement number is ever shown for a user with no prior scored
  stage — always `"New"`.

## Acceptance criteria
- Daily, preselection, and overall standings are each independently correct.
- Overall equals daily plus preselection.
- A tie or edge-of-window user always sees their own row.

## Tests
`apps/mobile` `test:ui` (`leaderboardExperience`), SQL tests for the movement
RPC (`supabase/tests/grandtour_leaderboard_movement.sql`).
