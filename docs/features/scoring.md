# Scoring (rider top five)

## Purpose
Deterministically score a user's predicted top five against the official
stage result.

## Confirmed rules
- Exact position: 10 / 8 / 6 / 4 / 2 points (positions 1–5).
- Actual top five, wrong position: 1 point.
- Outside actual top five: 0 points.
- Exact-position and wrong-position awards are mutually exclusive per rider.
- No additional stage bonuses for the rider path.
- Maximum top-five score per stage: 30.
- Jerseys (shared with [jersey-competition.md](jersey-competition.md)): 5
  points per correct daily holder, 25 per correct final winner. Stage maximum
  including jerseys: 50. Overall jersey maximum: 100.
- Daily and preselection modes call the exact same scoring function — see
  [DECISIONS.md](../project/DECISIONS.md) #1.

## User experience
`GrandTourTopFiveComparison` (My Tips) shows predicted vs. actual rider per
position with Exact/Top 5/Miss labels and per-position points, using the
shared `ScoreOutcomeBadge` color table (green=exact, blue=partial,
grey=none/pending — never red; red is reserved for genuine errors).

## Data model
`grandtour_stage_scores.score_details.top_five` (and `.jerseys`) — the
persisted, already-computed breakdown a tip's status moves to `scored`
against. Never recomputed client-side; a pending tip shows "Awaiting official
scoring" instead of a misleading `0`.

## Relevant source files
- `packages/tipping-core` — the scoring function and its point-constant
  exports (`EXACT_POSITION_POINTS`, `TOP_FIVE_WRONG_POSITION_POINTS`,
  `STAGE_JERSEY_POINTS`).
- `apps/mobile/components/ScoreOutcomeBadge.tsx` — shared badge colors.
- `apps/mobile/lib/grandtourStageResultsExperience.ts` —
  `buildTopFiveRowDetails`, `topFiveMatchTypeToBadgeTone`,
  `buildResultRowScoreBadges`, `buildScoreExplanationLines`.

## Relevant migrations
`recalculate_grandtour_stage_scores` RPC (pre-existing, `security invoker`,
requires a real authenticated cycling-admin session — the service-role key
alone cannot call it). Requires `is_final = true` first.

## Current implementation
Fully built and used across My Tips, Results, and the dashboard's "latest
performance" line. A real tied-position badge misattribution bug (matching by
`position` alone instead of `entryId`) was found and fixed via code review —
see [DECISIONS.md](../project/DECISIONS.md) and CLAUDE.md history for detail
if a similar de-duplication bug needs to be diagnosed again.

## Outstanding work
None known specific to rider scoring; see
[stage-results.md](stage-results.md) for the badge-consolidation history.

## Edge cases
- A genuine finish-position tie (two riders sharing `actual_position`) must
  be matched by `entryId`, never by `position` alone — a real bug was found
  and fixed here.
- Missing an official component (e.g. a jersey holder not yet recorded)
  leaves that component pending, recalculated idempotently once available.

## Acceptance criteria
- Perfect top five totals 30 points.
- Daily and preselection return identical scores for identical picks/results.
- Corrected results recalculate without duplicate/double-counted points.

## Tests
`packages/tipping-core` scoring tests; `supabase/tests/grandtour_finalize_stage_result.sql`
(hand-checked point totals through a full apply→check→finalise→score
rehearsal).
