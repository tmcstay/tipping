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

- Home: event summary and stage-winner scoring rules
- Stages: ordered Tour de France 2026 stage list
- Stage detail: route, timing, provisional rider search, and stage-winner draft
- Leaderboard: Daily, Preselection, and Overall score tabs
- Profile: current Supabase user state

The F1 configuration and generic race-market screens remain in the repository
for reuse, but GrandTour is the default configuration and the F1 route tree is
not linked from primary navigation.

The MVP stage picker stores one rider as position 1 of a draft GrandTour tip.
Authentication, complete submission state, results entry, and production score
recalculation still need end-to-end UI completion.

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
npm --workspace apps/mobile run typecheck
npm run import:tdf:2026:dry-run
npm run seed:tdf:dummy:dry-run
npm --workspace apps/mobile run web:build
```

## Deployment compatibility

The native Xcode workspace and scheme remain `F1Tips`, and the bundle ID remains
`app.tipping`, so the proven Codemagic signing and TestFlight workflow is not
renamed. The iOS display name is overridden to `GrandTour Tips` without
changing native project identifiers.

## Remaining TODOs

- Replace estimated stage start/lock times with authoritative times.
- Refresh and confirm the final 184-rider startlist and bib numbers.
- Complete authentication and display-name editing screens.
- Promote draft stage-winner picks through an explicit submission flow.
- Add result-entry UI and server-side score/leaderboard recalculation.
- Add persisted selected-rider feedback tests for authenticated users.
