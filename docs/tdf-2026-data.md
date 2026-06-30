# 2026 Cycling Dataset Integration

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
| Results | `grandtour_stage_results` and result-line/jersey tables |
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
173 riders, seven audit records, and expands the race roster to 3,633
stage-roster records.

Exact stage start times were not present in the source snapshot. The importer
therefore marks them as estimated and defaults to 12:00:00 UTC with a ten-minute
lock lead. Override these before a production import when authoritative times
are available:

```text
TDF_DEFAULT_STAGE_START_TIME_UTC=12:00:00Z
TDF_LOCK_LEAD_MINUTES=10
```

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

The additional stage-winner v1 rules live in
`packages/tipping-core/src/cycling-stage-tip.ts`:

- Winner: 10 points
- Second: 6 points
- Third: 4 points
- Fourth through tenth: 1 point
- Otherwise: 0 points

The canonical GrandTour ordered-top-five and jersey game remains unchanged.
Stage result lines may contain either five rows for the canonical game or ten
rows when the stage-winner v1 top-ten award is required.
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
- `useSubmitCyclingTip`
- `useCyclingLeaderboard`

GrandTour is now the active mobile configuration and uses the `/stages` route
tree. The previous F1 query and route code remains available but is no longer
linked from primary navigation. The initial submit hook saves the stage-winner
selection as position 1 of a draft GrandTour entry; a completed submission flow
remains a follow-up.

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

- The snapshot contains 173 provisional riders rather than a final 184-rider
  startlist.
- Three team rosters remain incomplete in the source snapshot.
- Twenty-two rider nationalities are missing.
- Dates of birth are absent and rider roles are `unknown`.
- Exact start times and bib numbers are absent.
- One source disagreement about the Uno-X selection is recorded in the audit.
- A local database reset requires Docker Desktop; it cannot run while the
  Docker engine is stopped.
