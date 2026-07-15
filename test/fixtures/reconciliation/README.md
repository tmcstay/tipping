# Reconciliation fixtures

Fixtures used by `scripts/grandtour-reconciliation.test.mjs` to exercise
`scripts/grandtour-reconciliation.mjs`'s pure matching logic without a live
Supabase connection.

## Shared "existing DB" fixtures

- `existing-riders.json` — a small set of `grandtour_riders` rows shaped as
  the reconciliation layer expects them (`id`, `teamId`, `displayName`,
  `normalizedName`, `bibNumber`). Includes two riders (`rider-martin-a`,
  `rider-martin-b`) that deliberately share a `normalizedName` to drive the
  ambiguous-match scenario.
- `existing-teams.json` — a small set of `grandtour_teams` rows (`id`,
  `name`, `shortName`, `code`).
- `existing-stages.json` — `grandtour_stages` rows (`id`, `stageNumber`).
  Stage `99` is intentionally absent to drive the missing-stage scenario.

## Parsed official-letour stage result fixtures

Each file is shaped like the `stageResult` object
`parseLetourRankingStageRows` returns (`stage_number`, `type`, `riders[]`),
one per reconciliation scenario:

- `parsed-stage-perfect-match.json` — stage 2; every rider's bib number and
  team name matches an existing record exactly.
- `parsed-stage-unmatched-rider.json` — stage 4; one rider's bib and name
  match nothing in `existing-riders.json`.
- `parsed-stage-ambiguous-rider.json` — stage 5; a rider named "G. MARTIN"
  with a bib number that matches nobody, whose name matches both
  `rider-martin-a` and `rider-martin-b`.
- `parsed-stage-duplicate-bib.json` — stage 6; two different riders in the
  same parsed stage share bib number `1` (a source data-quality issue, not a
  matching issue).
- `parsed-stage-unmatched-team.json` — stage 7; the rider matches by bib, but
  the team name doesn't match any `existing-teams.json` entry.

There is no dedicated "missing stage" fixture — that scenario reuses
`parsed-stage-perfect-match.json` against stage number `99`, which is absent
from `existing-stages.json`.

## Required Supabase read queries (documented, not fixture-backed)

`scripts/grandtour-reconciliation-supabase.mjs` is the only place that talks
to Supabase for reconciliation, and it only ever issues `select` calls:

```
select id from grand_tours where name = :name and year = :year limit 1;

select id, stage_number from grandtour_stages
where grand_tour_id = :grandTourId and stage_number = :stageNumber limit 1;

select id, team_id, display_name, normalized_name, bib_number from grandtour_riders
where grand_tour_id = :grandTourId;

select id, name, short_name, code from grandtour_teams
where grand_tour_id = :grandTourId;
```

These reads are safe with the public anon key: `grandtour_riders`,
`grandtour_teams`, and `grandtour_stages` are fully public-readable per
`supabase/migrations/20260629080958_grandtour_mvp.sql`; no service-role key
is needed or accepted for reconciliation (see
`scripts/grandtour-reconciliation-supabase.test.mjs` for a mocked-client test
that only exercises `select`/`eq`/`limit`/`maybeSingle`).
