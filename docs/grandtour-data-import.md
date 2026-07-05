# GrandTour 2026 data import

The provisional Tour de France 2026 snapshot lives in
`data/cycling/tdf/2026/`. It contains the race, 21 stages, 23 teams, the
official 184-rider start list with bibs and nationality codes, and eight
source-audit records. It does not contain official stage results.

## Supabase mapping

The importer reuses the additive GrandTour schema:

| Data | Table |
| --- | --- |
| Race | `grand_tours` |
| Public competition | `grandtour_competitions` |
| Stages | `grandtour_stages` |
| Teams | `grandtour_teams` |
| Riders | `grandtour_riders` |
| Stage rosters | `grandtour_stage_startlists` |
| Source audit | `data_audit` |

The schema is created by the existing GrandTour migrations. Its public tables
have RLS and explicit Data API grants for read-only mobile access. Imports use a
server-side service role and never expose that credential to Expo.

## Commands

Apply migrations, review the dry run, then import:

```bash
npm run import:tdf:2026 -- --dry-run
npm run import:tdf:2026
```

The real import requires:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

Do not put the service-role key in an `EXPO_PUBLIC_*` variable. The mobile app
uses `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` only.

## Refresh and confidence rules

The import is deterministic and idempotent. It uses upserts, never deletes
riders, and preserves existing rider IDs. Rider reconciliation first matches an
exact normalized name within the same tour. Team plus normalized name is used
only to disambiguate multiple exact-name candidates. It never uses loose or
partial-name matching. Name normalization lowercases, trims, removes
diacritics, and collapses whitespace.

Run a database-aware review before applying changes:

```bash
npm run import:tdf:2026 -- --review
```

The review writes `rider_import_review.json` beside the source snapshot and
reports inserts, updates, skips, ambiguous matches, conflicts, missing bibs,
and duplicate bibs per tour/team. An actual import fails closed when conflicts
or ambiguous matches exist. After manually approving every reported conflict,
rerun with `--approve-rider-conflicts`.

Race-level startlist bibs populate the canonical rider bib. They do not
overwrite `grandtour_stage_startlists.bib_number`; only a source row carrying an
explicit matching `stage_id` may update that stage-specific value.

Every row must preserve `source_url` and `data_confidence`. Startlist status is
preserved and defaults to `provisional`; only an audited source should promote
it to `confirmed`. Use `withdrawn`, `dns`, `dnf`, `reserve`, or `unknown` when a
refresh changes availability. Never manufacture results.

Exact start times are currently estimated. Before production, set an audited
time or override `TDF_DEFAULT_STAGE_START_TIME_UTC` and
`TDF_LOCK_LEAD_MINUTES`.

Stage imports also populate `ttt_timing_rule` for Team Time Trials. TTT stage
placings belong in `grandtour_stage_team_result_lines`; post-stage jersey
holders always remain individual riders in `grandtour_stage_jersey_holders`.
The 2026 opening TTT uses `individual_time` for its individual classification
timing rule.

## Verification checklist

- One cycling race named Tour de France for 2026.
- Exactly 21 unique stage numbers; no rest-day rows unless intentionally added.
- 23 unique normalized team names and 184 unique normalized rider names.
- 3,864 stage-startlist rows, with valid race/team/rider relationships.
- Official startlist statuses are confirmed.
- Source URLs, confidence fields, and seven audit records are populated.
- Mobile reads work through `useTdf2026Race`, `useTdf2026Stages`,
  `useStageStartlist`, `useTdfTeams`, and `useTdfRiders`.

For a local verification, start Docker Desktop, run `npx supabase db reset`,
obtain the local URL/service-role key from `npx supabase status`, and run the
import command with those server-side variables set for that shell only.
