# Stage Results (user-facing)

## Purpose
Show a user their own tip history against official results — per-stage
comparisons, badges, and cumulative totals — without exposing anything the
RLS tip-privacy rule wouldn't allow.

## Confirmed rules
- Only eligible stages (`isStageEligibleForResults` — the stage has started
  **and** has a final or reviewable result) can ever appear as a "result" —
  a stage row existing, or even a draft result existing, is never treated as
  a real result on its own. Enforced at three layers: the query layer, the
  shared selector, and a final defensive filter in the screen.
- Badges are green (exact), blue (partial/right-entity-wrong-position), grey
  (miss/not picked/pending) — never red; red is reserved for genuine errors.
  This is a single shared table (`ScoreOutcomeBadge`) used everywhere,
  fixing three previously-inconsistent per-screen copies.
- Points shown always come from the tip's already-persisted
  `score_details`, never recomputed client-side.

## User experience
`/my-tips` — cumulative totals above a sortable list of one collapsible
accordion per stage, **every stage defaults closed** (plain per-item
`useState`, not lifted/shared state — React's key-based reconciliation
preserves open/closed state across refetches as long as `key={stage.id}` is
kept). Expanded: `GrandTourTopFiveComparison`, `GrandTourJerseyComparison`, a
bonus line, and two nested collapsibles (`GrandTourOfficialTopTen`,
`GrandTourScoreExplanation`) that also default closed.

`/results` — `StageResultCard` per stage with per-row score badges
(`buildResultRowScoreBadges`), keyed by `entryId` (fixed from an earlier
`position`-only key that misattributed ties — see below).

## Data model
Reads `grandtour_stage_results`/`grandtour_stage_result_lines`/
`grandtour_stage_jersey_holders` plus the user's own
`grandtour_tips`/`grandtour_stage_scores`. RLS-scoped throughout — no new
RPC was needed for this feature.

## Relevant source files
- `packages/tipping-core/src/stage-eligibility.ts` —
  `isStageEligibleForResults`, `selectLatestEligibleStage`.
- `packages/supabase-client/src/cycling.ts` — `listCyclingStageResults`,
  `getCyclingStageResult` (both take an optional `now` param for the
  eligibility filter).
- `apps/mobile/lib/grandtourStageResultsExperience.ts` —
  `buildTopFiveRowDetails`, `buildJerseyRowDetails`, `buildOfficialTopTenRows`,
  `sortStageRows`, `buildScoreExplanationLines`, `buildResultRowScoreBadges`,
  `extractScoreTopFive`.
- `apps/mobile/lib/grandtourHistoryExperience.ts` — `computeCumulativeHistory`,
  `computeHistorySummary`.
- `apps/mobile/components/ScoreOutcomeBadge.tsx` — the shared badge table.

## Relevant migrations
None new — reuses existing RLS on `grandtour_tips`/`grandtour_stage_scores`.

## Current implementation
Fully built, including the dashboard's own compact "latest performance" line
(badge list, not just an aggregate total).

## Outstanding work
None currently open beyond the general RLS-visibility test gap (see
[official-data-import.md](official-data-import.md)).

## Edge cases
- **Genuine finish-position ties** (two riders/teams sharing
  `actual_position`) must be matched by `entryId`, not `position` alone — a
  real bug (silent misattribution + a duplicate React key) was found via code
  review and fixed in both `StageResultCard.tsx` and `app/index.tsx`.
- The "none"/no-pick badge background must differ from the row background it
  sits on (`ui.colors.border`, not `surfaceMuted`) or it becomes invisible —
  also a real, found-and-fixed bug.
- "Latest completed stage" must always be computed via
  `selectLatestEligibleStage` (sorted by actual `starts_at` descending, stage
  number as tie-breaker) — never an unordered `.find`/client re-sort, which
  had no time-based guard at all in the pre-fix code.

## Acceptance criteria
- A future stage never appears as a result, at any of the three enforcement
  layers.
- A pending (not-yet-scored) tip never shows a fabricated `0`.

## Tests
`packages/tipping-core` (`stage-eligibility`), `apps/mobile` `test:ui`
(`grandtourStageResultsExperience`, `grandtourHistoryExperience`).
