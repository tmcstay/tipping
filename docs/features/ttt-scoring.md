# Team Time Trial (TTT) Scoring

## Purpose
Score a user's predicted top-five teams for a Team Time Trial stage, where
teams rather than individual riders are timed.

## Confirmed rules
- **Only `grandtour_stages.ttt_timing_rule = 'individual_time'` is
  supported.** This is the "first rider across the line sets the team's
  official time" rule (in effect since the 2023 Paris–Nice). Any other/null
  `ttt_timing_rule` is refused at every write step (apply, admin-check,
  finalise) — not silently degraded.
- Team scoring is a **flatter** scale than the rider path, deliberately, not
  a bug: exact team position = 6 points, right team wrong position (within
  official top five) = 3 points, outside top five = 0. Plus a separate,
  independent **4-point winning-team bonus** when `predicted_position=1`
  correctly names the actual position-1 team.
- TTT jersey selections remain **individual riders**, using the official
  post-stage classification holders — never inferred from the winning team.
- Maximum for a perfect TTT stage: 30 (team positions) + 4 (bonus) + 20
  (jerseys) = 54.
- letour.fr publishes no separate team-classification page — the team result
  is **derived** from the same per-rider ranking table already parsed for
  every stage (`deriveTeamResultFromRiderRows`: group by team, take each
  team's minimum elapsed time, rank ascending).

## User experience
Same stage tip-entry form as the rider path, but the top-five picker offers
teams instead of riders when the stage is a supported TTT.

## Data model
`grandtour_stage_team_result_lines` (the TTT counterpart to
`grandtour_stage_result_lines`) — existed unused in the schema for a while
before the apply RPC was extended to write it.

## Relevant source files
- `scripts/grandtour-reconciliation.mjs` — `deriveTeamResultFromRiderRows`,
  `reconcileTeamTimeTrialResult`.
- `scripts/grandtour-feed-provider.mjs` — `parseLetourElapsedTime`.
- `scripts/grandtour-apply.mjs` — `selectTopNTeamResultLines`.

## Relevant migrations
- `20260703025324_add_grandtour_ttt_schema_support.sql` — original schema
  (`ttt_timing_rule`, `grandtour_stage_team_result_lines`), unused until this
  feature was built.
- `20260703041335_implement_grandtour_ttt_scoring.sql` — the actual scoring
  branch in `recalculate_grandtour_stage_scores` (supersedes an earlier draft
  in the migration above — always check for the latest migration redefining
  a function).
- `20260714020000_grandtour_apply_ttt_individual_time_result.sql` — extends
  `apply_grandtour_official_stage_result` with `p_team_result_lines`.
- `20260714030000_grandtour_ttt_individual_time_admin_review_workflow.sql` —
  extends admin-check/finalise to accept a supported TTT stage (both had
  their own separate, unconditional TTT refusals before this).

## Current implementation
Full chain (apply → admin-check → finalise → score) works for
`individual_time` TTT stages, verified end-to-end with a real local
rehearsal and hand-computed expected points
(`supabase/tests/grandtour_finalize_stage_result.sql`, scenarios 20–24).

## Outstanding work
- **The CLI (`scripts/grandtour-admin-stage.mjs`) and the correction RPC
  (`correct_grandtour_stage_result_from_reviewed_report`, the "Update
  Results" admin panel) are still rider-only-assumed** — check both for the
  TTT gap before using them on a real TTT stage.
- No non-`individual_time` TTT rule is supported; a stage tagged with any
  other rule (or none) is unconditionally refused everywhere.

## Edge cases
- A `team_result_available` flag must be true (top-five team-result lines
  exist) for the winning-team bonus to be evaluated at all — otherwise every
  team pick scores 0/`pending`, distinct from "not applied yet".

## Acceptance criteria
- TTT exact team positions award 6 points each.
- TTT wrong-position teams (still in official top five) award 3 points each.
- A correct TTT winning team awards a 4-point bonus, independent of position
  scoring.
- TTT jerseys use only official individual rider holders.

## Tests
`supabase/tests/grandtour_apply_official_stage_result.sql` (17 scenarios),
`supabase/tests/grandtour_finalize_stage_result.sql` (24 scenarios, including
the full rehearsal), `scripts/grandtour-feed-provider.test.mjs`,
`scripts/grandtour-reconciliation.test.mjs`, `scripts/grandtour-apply.test.mjs`.
