# Jersey Competition

## Purpose
Separately tip and score the four grand-tour classification leaders: yellow
(general classification), green (points), KOM/polka-dot (climber), white
(young rider).

## Confirmed rules
- Four jersey picks are part of every stage entry (both daily and
  preselection), alongside the top-five pick — not a separate entry.
- A rider may be picked for a jersey and also be in the predicted top five
  simultaneously.
- Daily scoring: 5 points per correct post-stage holder (per jersey).
- Overall scoring: 25 points per correct **final** (tour-level) winner —
  tour-level, uses the preselection lock, not the per-stage lock.
- Jersey holders are fetched from letour.fr's "General ranking" tab (four
  sub-tab URLs embedded as a `data-ajax-stack` JSON attribute, re-scraped
  fresh per stage — the URLs are per-page-load tokens, never hardcoded).
- Young-rider (white jersey) eligibility cutoff:
  `youngRiderEligibilityCutoffDate(raceYear) = (raceYear - 25)-01-01`, a
  fixed calendar cutoff from the race year alone, boundary inclusive.
  Sourced to UCI/ASO's own white-jersey classification rule.

## User experience
`GrandTourJerseyComparison` (My Tips) — predicted vs. actual holder per
jersey, using the shared `ScoreOutcomeBadge` colors (fixed from an earlier
red-for-miss inconsistency that violated this app's own "red reserved for
errors" convention).

## Data model
`grandtour_stage_jersey_holders` (`stage_id`, `jersey_type` enum, `rider_id`,
unique per `(stage_id, jersey_type)`). Triggers: `validate_jersey_holder()`
(rider must be on the stage startlist; result must exist and not be final)
and `prevent_final_jersey_holder_delete()`.

## Relevant source files
- `scripts/grandtour-feed-provider.mjs` — `extractGeneralClassificationAjaxUrls`,
  `fetchLetourJerseyHolders`, `parseLetourClassificationLeader`.
- `apps/mobile/components/ScoreOutcomeBadge.tsx`,
  `apps/mobile/lib/grandtourStageResultsExperience.ts`'s
  `jerseyMatchTypeToBadgeTone`.
- `scripts/tdf-2026-rider-specialty.mjs` — young-rider eligibility rule
  (currently only reachable through the TDF importer, not tip-entry
  validation — see Outstanding work).

## Relevant migrations
`grandtour_stage_jersey_holders` schema (part of the original
`20260629080958_grandtour_mvp.sql` migration).

## Current implementation
Fully built for tipping, storage, and scoring across daily and final
(overall) jersey classifications. Badge display was consolidated onto one
shared color table this pass, fixing two real found bugs (amber used for a
wrong-position match in one screen, red used for a miss in another — see
[stage-results.md](stage-results.md)).

## Outstanding work
- Young-rider eligibility is not enforced in the tip-entry UI — nothing stops
  a user picking an over-25 rider for the white jersey. See
  [ROADMAP.md](../project/ROADMAP.md).
- Three-period jersey competition and rest-day jersey deadlines (variant
  rules raised in a later product brief) are not implemented and have no
  defined design yet — see [ROADMAP.md](../project/ROADMAP.md).

## Edge cases
- A jersey holder must be on the stage startlist and the stage result must
  exist and not be final at the time it's recorded (trigger-enforced).
- A final jersey holder can never be deleted (trigger-enforced).

## Acceptance criteria
- Each correct daily jersey awards 5 points; perfect daily jerseys total 20.
- Each correct overall jersey winner awards 25 points; perfect overall
  jerseys total 100.
- A rider may hold multiple jersey selections simultaneously.

## Tests
`packages/tipping-core` jersey scoring tests; `supabase/tests/` jersey-holder
trigger coverage.
