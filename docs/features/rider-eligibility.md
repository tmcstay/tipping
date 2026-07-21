# Rider Eligibility

## Purpose
Determine which riders a user may validly select, and which classification
rules (e.g. young-rider/white-jersey eligibility) apply to a given rider.

## Confirmed rules
- Selected riders must belong to the relevant tour's roster
  (`grandtour_stage_startlists`).
- Young-rider (white jersey) eligibility:
  `youngRiderEligibilityCutoffDate(raceYear) = (raceYear - 25)-01-01` —
  riders aged 25 or younger during the calendar year of the race, boundary
  inclusive. Sourced to the UCI/ASO young-rider classification rule.

## User experience
Not currently enforced as a UI validation rule during tip entry — see
Outstanding work.

## Data model
`grandtour_riders.date_of_birth` (increasingly UCI-sourced, see
[official-data-import.md](official-data-import.md)), used by
`tdf-2026-rider-specialty.mjs`'s eligibility calculation.

## Relevant source files
- `scripts/tdf-2026-rider-specialty.mjs` — the eligibility cutoff function
  and its tests (built and re-verified across two importer sessions).

## Relevant migrations
None specific — relies on `grandtour_riders.date_of_birth`, populated by the
TDF 2026 importer and, increasingly, the UCI registry sync.

## Current implementation
The eligibility calculation itself is implemented, tested, and re-verified —
but it currently only feeds the TDF 2026 rider importer's output CSV/JSON
(`young_rider_eligible`, `eligibility_cutoff_date` columns), not any live
tip-entry validation path.

## Outstanding work
- **Not wired into stage tip-entry validation.** A user can currently pick
  any rider for the white jersey regardless of age. This is the single
  clearest, most concrete gap in this feature area — see
  [ROADMAP.md](../project/ROADMAP.md).
- DNS/DNF exclusion is a related but distinct concern — see
  [rider-status.md](rider-status.md).

## Edge cases
- Eligibility is derived only from the fixed race year, never "today"'s
  date — a rider doesn't age out of eligibility mid-tour.
- DOB is required to evaluate eligibility; a rider with no known DOB has an
  unknown (not false) eligibility status.

## Acceptance criteria (for the currently-implemented calculation only)
- Boundary-inclusive: a rider turning 26 on Jan 1 of the race year is exactly
  at the cutoff, not excluded.

## Tests
`scripts/tdf-2026-rider-specialty.test.mjs`.
