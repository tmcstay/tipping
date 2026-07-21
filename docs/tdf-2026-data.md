# 2026 Cycling Dataset Integration

> **Deprecated / historical.** Superseded by
> [docs/features/official-data-import.md](features/official-data-import.md)
> and [docs/development/DATA_IMPORTS.md](development/DATA_IMPORTS.md), which
> describe the current (UCI-sourced) importer. This file documents an earlier
> stage of that pipeline. Kept for historical context only.

GrandTour is a cycling tipping app for grand tour stage racing fans. The factual
2026 race dataset is retained for data provenance; the app must not imply that
GrandTour is official, endorsed, or affiliated with the race organiser.

## Dataset location

The source snapshot lives in:

```text
data/cycling/tdf/2026/
  race_2026_tdf.json
  stages_2026_tdf.csv
  teams_2026_tdf.csv
  riders_2026_tdf.csv
  startlist_2026_tdf.csv
  data_audit_2026_tdf.csv
```

Every source row carries a `source_url` and `data_confidence`. The audit file
records source limitations and reuse risk. Do not remove these fields during a
refresh.

## Schema mapping

The repository already had a cycling-specific GrandTour schema, so the import
extends that model rather than creating a second set of `races`, `stages`,
`tips`, and `leaderboards` tables that would conflict with generic/F1-era
tables.

| Dataset concept | Supabase table |
| --- | --- |
| Race | `grand_tours` |
| Competition | `grandtour_competitions` |
| Stages | `grandtour_stages` |
| Teams | `grandtour_teams` |
| Riders | `grandtour_riders` |
| Race startlist | expanded into `grandtour_stage_startlists` |
| Tips | `grandtour_tips` and `grandtour_tip_selections` |
| Rider stage results | `grandtour_stage_results` and `grandtour_stage_result_lines` |
| TTT team stage results | `grandtour_stage_team_result_lines` |
| Jersey holders | `grandtour_stage_jersey_holders` (individual riders only) |
| Leaderboards | `grandtour_leaderboard_snapshots` |
| Source audit | `data_audit` |

The migration is
`supabase/migrations/20260630011922_integrate_tdf_2026_data.sql`.

## Import

Apply migrations first, then run:

```bash
npm run import:tdf:2026:dry-run
npm run import:tdf:2026
```

A real import requires server-side environment variables:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

Never place the service-role key in Expo, Vercel public variables, or any
`EXPO_PUBLIC_*` variable.

The import uses deterministic IDs and atomic upserts, so it is safe to rerun.
It logs created, updated, and skipped counts. It imports 21 stages, 23 teams,
184 riders, eight audit records, and expands the race roster to 3,864
stage-roster records.

Exact stage start times were not present in the source snapshot. The importer
therefore marks them as estimated and defaults to 12:00:00 UTC with a ten-minute
lock lead. Override these before a production import when authoritative times
are available:

```text
TDF_DEFAULT_STAGE_START_TIME_UTC=12:00:00Z
TDF_LOCK_LEAD_MINUTES=10
```

TTT imports set `ttt_timing_rule`. For the 2026 opening TTT, the individual
classification timing rule is `individual_time`: the official stage result is
the team ranking, while yellow, green, KOM, and white are taken only from the
official post-stage individual holders. Never infer yellow from the winning
team.

## Provisional startlist refresh

All imported startlist rows remain `provisional`. Do not mark them `confirmed`
until an official final startlist is available.

To refresh:

1. Replace the six files in `data/cycling/tdf/2026/` with a newly audited
   snapshot.
2. Preserve stable source IDs where the entity is unchanged.
3. Record every source and access date in `data_audit_2026_tdf.csv`.
4. Run the dry-run import.
5. Review rider/team changes and source confidence.
6. Run the real import with server-side credentials.
7. Mark future stage-roster rows `withdrawn`, `dns`, or `dnf` as appropriate.

Only `provisional` and `confirmed` roster entries are selectable for a new tip.
Changing a rider's later status does not delete an existing tip.

## Cycling rules and tests

The compatibility stage-winner helper in
`packages/tipping-core/src/cycling-stage-tip.ts` now follows the first slot of
the canonical ordered-top-five rules:

- Winner: 10 points
- Elsewhere in the actual top five: 1 point
- Outside the actual top five: 0 points

The complete canonical scoring implementation lives in
`packages/tipping-core/src/grandtour-scoring.ts`. Stage result imports may still
retain positions six through ten as useful race data, but those positions do
not score in the canonical game.
Run all current shared tests with:

```bash
npm test
```

## Mobile data access

Cycling queries are exported from `@tipping-suite/supabase-client`. Mobile hook
foundations are in `apps/mobile/hooks/useCyclingData.ts`:

- `useCyclingRace`
- `useTdf2026Stages`
- `useStageStartlist`
- `useStageResult`
- `useStageTipDraft`
- `useSaveTipDraft`
- `useSubmitTip`
- `useClearTip`
- `useCyclingLeaderboard`

GrandTour is now the active mobile configuration and uses the `/stages` route
tree. The canonical stage form supports ordered rider Top 5 selections for
normal stages and ordered team Top 5 selections for TTT stages. Save Draft and
Submit Tips are separate atomic RPC operations. The previous F1 query and route
code remains available but is no longer linked from primary navigation.

## Dummy data

Dummy activity remains disabled in the GrandTour app configuration and is not
shown in the MVP UI. For controlled development environments only:

```bash
npm run seed:tdf:dummy:dry-run -- --users 5 --stages 3 --seed 2026
npm run seed:tdf:dummy -- --users 5 --stages 3 --seed 2026
```

The real command requires the same server-side Supabase credentials as the
import. It creates clearly marked dummy profiles and tips, applies stage-type
role weighting when roles are known, and never creates official results.

## Known limitations

- The official 184-rider start list, bibs, team assignments, and nationality
  codes were captured from the race organiser on 2026-07-05.
- Dates of birth are absent and rider roles are `unknown`.
- Exact stage start times remain provisional.
- One source disagreement about the Uno-X selection is recorded in the audit.
- A local database reset requires Docker Desktop; it cannot run while the
  Docker engine is stopped.
