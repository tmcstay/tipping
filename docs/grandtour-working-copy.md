# GrandTour Active Working Copy

GrandTour Tips is the active mobile app experience. It is a cycling tipping app
for grand tour stage-racing fans and does not claim official affiliation with a
race organiser.

## Current event and data status

The working copy focuses on the Tour de France 2026 dataset:

- 21 stages, ordered by stage number and date
- 23 teams
- 173 riders in the current source snapshot
- 3,633 generated stage-startlist records
- stage routes and distances sourced from the official race route
- rider and startlist records treated as provisional until a final official
  startlist is available

Exact stage start times and bib numbers are not present in the current dataset.
Imported stage times are therefore marked provisional.

## Active mobile flow

Primary navigation now provides:

- Home: event summary and canonical scoring rules
- Stages: ordered Tour de France 2026 stage list
- Stage detail: Daily/Preselection mode, ordered Top 5, four jersey picks,
  explicit draft saving, submission, clearing, status, results, and scoring
- TTT stage detail: ordered team Top 5 with rider-only jersey picks
- Post-lock comparison: submitted league tips only; drafts remain private
- Jerseys: overall jersey-winner preselection
- Leaderboard: Daily, Preselection, and Overall score tabs
- Profile: current Supabase user state

The F1 configuration and generic race-market screens remain in the repository
for reuse, but GrandTour is the default configuration and the F1 route tree is
not linked from primary navigation.

Authentication and the canonical atomic RPC workflow are implemented. Normal
stages use rider Top 5 selections. Team Time Trial stages use team Top 5
selections while yellow, green, KOM, and white remain official individual rider
holders. Drafts do not auto-submit.

The current app also includes private-league live leaderboards, dummy/prize
labels, score breakdowns, and a remote GrandTour tipping kill switch. A
protected admin/result-entry UI is not yet present; result administration is
currently database/import driven.

## Run locally

Create `apps/mobile/.env.local` with public client credentials only:

```text
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-publishable-or-anon-key
```

Then run:

```bash
npm ci
npm --workspace apps/mobile start
```

Never expose `SUPABASE_SERVICE_ROLE_KEY` through Expo or an
`EXPO_PUBLIC_*` variable.

## Apply and import the 2026 data

Apply the committed Supabase migrations, then validate and run the import from
a trusted server or local shell:

```bash
npm run import:tdf:2026:dry-run
npm run import:tdf:2026
```

The real import requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in that
trusted shell. Refresh details and confidence rules are documented in
[`tdf-2026-data.md`](./tdf-2026-data.md).

## Verification

```bash
npm run test --workspace packages/tipping-core
npm run typecheck
npm run import:tdf:2026:dry-run
npm run seed:tdf:dummy:dry-run
npm --workspace apps/mobile run web:build
```

Database verification also uses the transactional SQL suites in
`supabase/tests/canonical_grandtour_tipping.sql` and
`supabase/tests/grandtour_ttt.sql` against local Supabase only.

## Deployment compatibility

The native Xcode workspace and scheme remain `F1Tips`, and the bundle ID remains
`app.tipping`, so the proven Codemagic signing and TestFlight workflow is not
renamed. The iOS display name is overridden to `GrandTour Tips` without
changing native project identifiers.

## Remaining TODOs

- Replace estimated stage start/lock times with authoritative times.
- Add a protected admin/result-entry UI for rider and TTT team results.
- Add a mobile component-test harness if component-level automation is wanted.
- Import audited official 2026 teams, riders, startlists, stage types, and TTT
  timing rules after the schema is deployed.
- Merge the reviewed production-prep branch, complete the fresh backup and
  dry-run approval gates, then deploy the four pending TTT/bib migrations
  before the dependent frontend and data import. Production does not yet
  contain these changes.

## Session history

### 05 July 2026 — UI/TTT production preparation

- Removed temporary design archives and generated workstation-specific review
  reports from the production change set.
- Confirmed the ignored E2E credential fixture is not referenced by committed
  Supabase configuration.
- Verified the four additive migrations are pending remotely and apply cleanly
  in order during a fresh local reset.
- Passed canonical, TTT, and bib SQL/RLS suites; 40 core tests; 10 data/import
  tests; 10 mobile UI tests; both typechecks; and the Expo web export.
- Regenerated Supabase types and added the current `graphql_public` schema
  metadata emitted by the CLI.
- Confirmed authenticated dashboard, Tips, and Results empty states against a
  clean local database without loading the E2E fixture.
- No production write, deployment, merge, or app-store submission was run.

### 03 July 2026 — canonical workflow production release

- Applied and verified the six canonical GrandTour production migrations.
- Confirmed live private-league leaderboards and the remote tipping kill switch.
- Recorded backups, restore-risk acceptance, migration evidence, and
  post-migration verification in
  `docs/GRANDTOUR_PRODUCTION_DEPLOYMENT_CHECKLIST.md`.

### 03 July 2026 — Team Time Trial local implementation

- Added stage-type aliases and nullable `ttt_timing_rule` support.
- Added `grandtour_stage_team_result_lines` with RLS, grants, validation, and
  audit handling while preserving rider result tables.
- Added team targets for TTT Top 5 selections; jerseys remain rider-only.
- Updated atomic draft/submission validation and authoritative recalculation.
- Implemented TTT scoring: 6 exact, 3 wrong-position Top 5, and a 4-point
  winning-team bonus. Missing official result components remain pending.
- Added team pickers, rider jersey pickers, official TTT/jersey result sections,
  comparison rendering, and TTT score breakdowns in Expo.
- Updated local seed startlists to retain rider-to-team links.
- Verified locally: TypeScript passed, 36 core tests passed, Expo web export
  passed, canonical SQL tests passed, TTT SQL/RLS tests passed, schema lint
  passed, and no new GrandTour security-advisor findings were introduced.
- Browser smoke testing confirmed TTT team selection, rider-only jerseys,
  unchanged road-stage picks, result separation, winner bonus display, and
  pending jersey messaging. Temporary test data was removed with a local reset.
- No TTT production migrations or deployment commands were run.
