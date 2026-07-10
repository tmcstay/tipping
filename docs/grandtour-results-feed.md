# GrandTour results and feed operations

> The official Tour de France 2026 startlist (23 teams, 184 riders) has
> been loaded into production Supabase (`nsdpilmmrfobiapbwona`) via
> `scripts/load-tdf-2026-startlist.mjs`. See
> [docs/GRANDTOUR_TDF_2026_STARTLIST_PRODUCTION_LOAD.md](GRANDTOUR_TDF_2026_STARTLIST_PRODUCTION_LOAD.md)
> for the production load record, verification queries, and rollback note.

Jersey competition is parked for user entry for now. Official jersey holders may still be imported, entered, displayed on dashboards/results, and used by historical scoring data, but normal users only tip the stage-result top five.

## Tip entry

- Normal and ITT stages: users pick the top 5 riders for the stage result.
- TTT stages: users pick the top 5 teams for the stage result.
- Jersey pick UI and validation are hidden from normal user tip entry.
- Missing user jersey picks are not backfilled or inferred; they score zero/skipped.

## Rider picker

The rider selector is a fullscreen mobile-first modal. It supports:

- search by rider name, team name/code, or bib number;
- filtering by rider speciality;
- team-grouped display;
- bib-number ordering within each team;
- disabled rows for inactive statuses such as DNS, DNF, OTL, withdrawn, suspended, and excluded.

## Rider withdrawals/status

Supported rider/startlist statuses include active/provisional/confirmed plus DNS, DNF, OTL, withdrawn, suspended, excluded, reserve, and unknown where applicable.

Inactive statuses should disable future-stage selection. Already locked historical tips are not automatically changed; replacement rules require a separate visible product rule.

## Manual feed workflow

No production cron is configured.

Initial commands:

```bash
npm run grandtour:feed:dry-run
npm run grandtour:feed:apply
```

`dry-run` writes a review report and does not mutate database tables.
`npm run grandtour:feed:apply` (`node scripts/grandtour-feed-import.mjs --apply`)
with no other flags still fails immediately — `--apply` now requires
`--from-report`, `--confirm-provider`, and `--confirm-stage` together (see
"Applying an official result" below); it is not usable as a bare npm script.

The full design — target tables, preconditions, transaction/idempotency/
conflict rules, safety gates, and audit fields — is specified in
[docs/grandtour-apply-mode-spec.md](grandtour-apply-mode-spec.md), including
the exact payload contract (§14) and the Phase 3 implementation record
(§15) for what's documented below.

### Applying an official result

`--apply` only ever applies from a previously reviewed report on disk — it
never fetches letour.fr live and never re-runs reconciliation. Generate that
report first with `--reconcile` (see "Reconciliation dry run" above), review
it, then apply it:

```bash
# 1. Generate and review a reconciliation report for one stage.
npm run grandtour:feed:dry-run -- --provider official-letour --from-stage 2 --to-stage 2 \
  --reconcile --report C:\tmp\grandtour-stage-2-review.json

# 2. Inspect C:\tmp\grandtour-stage-2-review.json — confirm
#    reconciliation.stages[0].safeToApply is true and read the blockers if not.

# 3. Apply it, using the service-role key (never the anon key):
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  node scripts/grandtour-feed-import.mjs --apply --provider official-letour \
  --confirm-provider official-letour --confirm-stage 2 \
  --from-report C:\tmp\grandtour-stage-2-review.json \
  --reason "manual apply for stage 2" --report C:\tmp\grandtour-stage-2-apply-outcome.json
```

Required together (`--apply` refuses to start without all of them,
checked before any file is read or any Supabase connection is made):

- `--from-report <path>` — the reviewed report from step 1/2.
- `--confirm-provider official-letour` — must match `--provider official-letour`.
- `--confirm-stage <N>` — must match the report's single stage, and must
  match `--from-stage`/`--to-stage` if those are also passed.
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` env vars — **never** the
  anon key; a key that doesn't decode to the `service_role` JWT claim is
  rejected even if placed in `SUPABASE_SERVICE_ROLE_KEY` by mistake.
- `--confirm-production` — only required if `SUPABASE_URL` resolves to the
  documented production project (`tipping-suite` / `nsdpilmmrfobiapbwona`,
  per `docs/GRANDTOUR_PRODUCTION_DEPLOYMENT_CHECKLIST.md`); not required
  for local/staging URLs.

What gets applied: always exactly the **top 10** result lines, by official
position — never 5, and never any other count (a stage with fewer than 10
official finishers with a valid position, or with duplicate/missing
positions, cannot be applied in v1; see spec §14.1/§16 for the exact rule
and why an earlier "or top-5" fallback was removed). Always writes a
**draft** result (`is_final: false`); apply mode never
finalizes, never writes jersey holders, never writes team result lines
(TTT stages are always rejected), and never scores tips. Re-running the
same apply command with an unchanged report is idempotent (`no_change`,
zero writes); applying over an existing *different* draft result is
refused, not overwritten.

The scheduled GitHub Actions workflow never sets `SUPABASE_SERVICE_ROLE_KEY`
and never passes `--apply`, so it cannot reach this path.

To validate the real apply RPC end-to-end against local Supabase (not
mocked) using 10 real seeded riders — including that a rejected changed
reapply leaves the original result lines untouched — run:

```bash
npm run grandtour:apply:local-smoke
```

It requires `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` for local Supabase,
refuses to run against production with no override, and deletes every row
it creates before exiting (confirmed by an independent read).

> For the first production use of `--apply` (as opposed to this local
> rehearsal), use
> [docs/GRANDTOUR_APPLY_MODE_PRODUCTION_READINESS_CHECKLIST.md](GRANDTOUR_APPLY_MODE_PRODUCTION_READINESS_CHECKLIST.md)
> instead — it covers production-specific gates (backup, migration
> confirmation, service-role key handling, sign-off) this local sequence
> does not.

### Known-safe operator sequence (rehearsed end-to-end)

This is the exact sequence a human operator should follow to apply one
stage, and the checks to run before and after. It was rehearsed in full
against local Supabase only on 2026-07-09 — see the checklist below for
what was verified.

1. **Generate a dry-run + reconciliation report** for the target stage:
   ```bash
   npm run grandtour:feed:dry-run -- --provider official-letour \
     --from-stage <N> --to-stage <N> --reconcile --report C:\tmp\stage-<N>-review.json
   ```
2. **Read the report file yourself** before doing anything else. At minimum, confirm:
   - `provider` is `"official-letour"`
   - `dryRun: true`, `applyEnabled: false`
   - `parserDriftDetected: false`
   - `importStatus` is `"validated"` or `"review_required"` (never `"failed"`/`"skipped"`)
   - `reconciliation.overallSafeToApply: true`
   - `reconciliation.stages[0].safeToApply: true` and `.blockers` is empty
   - `reconciliation.stages[0].startlistValidationPassed: true`
   - `reconciliation.stages[0].isTtt: false` and `.stageType` is not `team_time_trial`/`ttt`
   - `reconciliation.stages[0].stageId` is a real UUID
   - `reconciliation.stages[0].parsedRiders` has true official positions 1–10 present, no duplicates
   - `fetchedAt` is recent (apply refuses anything older than 6 hours)

   If any of these don't hold, **stop** — do not apply. Re-run `--reconcile`
   after the underlying issue is fixed (parser drift, a startlist gap, an
   ambiguous rider match, etc.).
3. **Apply it**, from the *same* report file, using the service-role key:
   ```bash
   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
     node scripts/grandtour-feed-import.mjs --apply --provider official-letour \
     --confirm-provider official-letour --confirm-stage <N> \
     --from-report C:\tmp\stage-<N>-review.json \
     --reason "<who/why>" --request-id "<correlation-id>" \
     --report C:\tmp\stage-<N>-apply-outcome.json
   ```
4. **Read the outcome.** `outcome.status` is `"applied"` (new draft written)
   or `"no_change"` (already applied, nothing written) — both are exit code
   0 and both are success. Any other outcome throws with the RPC's own
   specific error message and exits non-zero; re-running is always safe
   (idempotent), never a partial-state risk.
5. If you ever need to confirm nothing partial happened, or need to
   hand-verify a stage, check directly (read-only, safe with the anon key
   once a result is `is_final`, or the service-role key for a draft):
   `grandtour_stage_results` (exactly one row per stage, `is_final: false`),
   `grandtour_stage_result_lines` (exactly 10, in ascending `actual_position`
   matching the report's rider order), `grandtour_stage_jersey_holders` and
   `grandtour_stage_team_result_lines` (always zero rows for anything apply
   mode wrote), `grandtour_feed_import_runs`/`grandtour_feed_snapshots`
   (one audit row per successful `"applied"` call, none for `"no_change"`).

**Rehearsal checklist (verified 2026-07-09, local Supabase only, migrations
through `20260709020000_grandtour_apply_official_stage_result_rpc.sql`):**

- [x] Generated a dry-run + reconciliation report for stage 2 (a non-TTT
  `hilly` road stage) using the real `buildFeedReview`/`reconcileStageResult`/
  `buildReconciliationReport` functions against real local Supabase data —
  `provider: "official-letour"`, `parserDriftDetected: false`,
  `importStatus: "review_required"` (acceptable), `stageId` a real UUID,
  `safeToApply: true`, `startlistValidationPassed: true`, `isTtt: false`,
  10 `parsedRiders` at true positions 1–10.
- [x] Manually read the report before applying (confirmed the fields above,
  and independently noticed `stageDate` correctly reflected the real
  `grandtour_stages.starts_at` value read from the database, not a guessed
  default — good evidence the "no time-of-check/time-of-use gap" design is
  working as intended).
- [x] Applied via the real CLI: `node scripts/grandtour-feed-import.mjs
  --apply --provider official-letour --from-report <path>
  --confirm-provider official-letour --confirm-stage 2 --reason <text>
  --request-id <id> --report <outcome-path>` with the service-role key.
  Result: `status: "applied"`.
- [x] Confirmed exactly one `grandtour_stage_results` row, `is_final: false`.
- [x] Confirmed exactly 10 `grandtour_stage_result_lines`, in ascending
  `actual_position` order, matching the report's rider order exactly.
- [x] Confirmed zero `grandtour_stage_jersey_holders` rows.
- [x] Confirmed zero `grandtour_stage_team_result_lines` rows.
- [x] Confirmed zero `grandtour_stage_scores` rows (no scoring function was
  called).
- [x] Re-ran the identical apply command: `status: "no_change"`, exit 0, no
  new/duplicate rows (row counts unchanged).
- [x] Modified the reviewed report (swapped positions 1 and 2) and re-ran
  apply: rejected with a non-zero exit and the RPC's
  `"already has a different draft result"` message; independently re-read
  `grandtour_stage_result_lines` afterward and confirmed the original 10
  rows were byte-for-byte unchanged.
- [x] Deleted every row this rehearsal created (`grandtour_stage_results`,
  cascading to its result lines; `grandtour_feed_import_runs`;
  `grandtour_feed_snapshots`) and independently re-queried all six affected
  tables (`grandtour_stage_results`, `grandtour_stage_result_lines`,
  `grandtour_feed_import_runs`, `grandtour_feed_snapshots`,
  `grandtour_stage_jersey_holders`, `grandtour_stage_team_result_lines`,
  `grandtour_stage_scores`) to confirm zero residue.
- [x] `npm run test:data` (134/134), all four `supabase/tests/*.sql` files,
  the reconciliation local smoke test (9/9), and `grandtour:apply:local-smoke`
  (6/6) all passed, before and after this rehearsal.
- [x] Never touched production — `SUPABASE_URL` was `http://127.0.0.1:54321`
  throughout; the scheduled GitHub Actions workflow was not modified and
  has no service-role credential configured, so it still cannot reach
  `--apply`.

### Daily feed automation

A GitHub Actions workflow is configured to run a dry-run every day at 5:00 AM Adelaide time (ACST) using the cron schedule `30 19 * * *` UTC (21:30 CEST, after any stage that day has finished in France).

On the scheduled (cron) trigger, the workflow always uses `provider=official-letour` with no explicit `from_stage`/`to_stage`. The import script auto-resolves the correct stage number from the TDF 2026 stage calendar (`data/cycling/tdf/2026/stages_2026_tdf.csv`) using the current calendar date in `Europe/Paris`. If no stage is scheduled for that date (a rest day, or before/after the race window), the run writes a `skipped` report and exits successfully without fetching anything — it never guesses or fails loudly.

Manual `workflow_dispatch` runs are unaffected and keep explicit control via inputs:

- `provider` (default: `manual-json`)
- `import_type` (default: `daily`)
- `backfill` (legacy compatibility; use `import_type=backfill` when possible)
- `source_file` (optional)
- `report_file` (default: `grandtour-feed-dry-run.json`)
- `from_stage` / `to_stage` (optional; required together for `official-letour` unless `all_completed` is used)

This workflow:

- checks out the repository
- installs dependencies with `npm ci`
- runs the dry-run feed review
- uploads the JSON report artifact

### Stage auto-resolution for scheduled runs

`grandtour-feed-import.mjs` auto-resolves the stage number only when `provider=official-letour` and neither `--from-stage`/`--to-stage` nor `--all-completed` was supplied — i.e. only on the unattended scheduled trigger. The resolution logic (`scripts/grandtour-stage-calendar.mjs`):

- reads `data/cycling/tdf/2026/stages_2026_tdf.csv`,
- computes "today" as a `Europe/Paris` calendar date (overridable with `--as-of-date YYYY-MM-DD` for manual testing),
- finds the stage row whose `stage_date` matches that date,
- returns `stageNumber: null` with a reason if there is no match (rest day or outside the race window).

When no stage resolves, the script writes a report with `importStatus: "skipped"` and a `warnings` entry explaining why, and exits `0` — it does not fetch letour.fr and does not throw. This is the "fail safely" behavior for the scheduled job.

Every report (auto-resolved or explicit) now includes:

- `provider` — the feed provider used
- `stageRangeRequested` — `{ fromStage, toStage }` as requested/resolved
- `stageDate` — the calendar date of the resolved stage, when known
- `dryRun` — `true` unless `--apply` was passed
- `applyEnabled` — always `false`; apply mode is unimplemented regardless of flags
- `warnings` — provider/parse warnings, including the skip reason when applicable

### Manual workflow dispatch (GitHub UI)

To run the workflow manually via the GitHub UI:

1. Go to the GitHub repository.
2. Open the Actions tab.
3. Select `GrandTour Daily Feed Dry Run`.
4. Click `Run workflow`.
5. Choose the branch to run against, typically `main`.
6. Enter values for:
   - `provider`: `manual-json`
   - `source_file`: `data/feeds/tdf-2026/sample-stage-result.json`
   - `report_file`: `grandtour-feed-dry-run.json`
7. Click `Run workflow`.
8. After completion, download the `grandtour-feed-dry-run-report` artifact.

Example manual dispatch inputs:

- `provider: manual-json`
- `source_file: data/feeds/tdf-2026/sample-stage-result.json`
- `report_file: grandtour-feed-dry-run.json`

Example GitHub CLI command:

```bash
gh workflow run "GrandTour Daily Feed Dry Run" --repo tmcstay/tipping --field provider=manual-json --field source_file=data/feeds/tdf-2026/sample-stage-result.json --field report_file=grandtour-feed-dry-run.json
```

### Official letour provider example

For official Tour de France rankings pages:

Example GitHub UI inputs:

- `provider`: `official-letour`
- `report_file`: `grandtour-feed-official-letour.json`
- `from_stage`: `2`
- `to_stage`: `3`

Example local command:

```bash
npm run grandtour:feed:dry-run -- --provider official-letour --from-stage 2 --to-stage 3 --report C:\tmp\grandtour-letour-review.json
```

Example GitHub CLI command:

```bash
gh workflow run "GrandTour Daily Feed Dry Run" --repo tmcstay/tipping --field provider=official-letour --field report_file=grandtour-feed-official-letour.json --field from_stage=2 --field to_stage=3
```

### Official letour provider reliability

Every `official-letour` run parses each stage's rankings page and classifies the
result of that parse. `scripts/grandtour-feed-provider.mjs` distinguishes:

- `ok` — table found, rows found, fields extracted normally.
- `pending` — no ranking table, but the page text suggests the stage just
  hasn't finished yet. Expected/benign, not treated as drift.
- `not_found` — the stage page itself returned 404. Expected/benign for a
  stage that hasn't been run yet, not treated as drift.
- `empty_table` — the expected table markup is present but has zero rows.
  Possible early-drift signal, low severity.
- `parse_empty` — rows are matched but no row's fields could be extracted
  (row-level markup changed). Treated as drift.
- `table_not_found` — no ranking table found and no "pending" placeholder
  text either (page-level markup likely changed). Treated as drift.
- `fetch_error` — a non-404 HTTP error or network failure while fetching.

Each report includes a `stageFetchMetadata` array (one entry per stage
attempted) with `url`, `httpStatus`, `status`, `rowsMatched`, `ridersParsed`,
and `warningCount`. A top-level `parserDriftDetected` boolean is `true` when
any stage classified as `parse_empty` or `table_not_found`. When it is true,
`importStatus` is forced to `failed` and the report `note` calls out the
drift explicitly — a drifted stage is never allowed to look like a
successful zero-result stage.

Fetch requests send a descriptive User-Agent
(`LETOUR_FETCH_USER_AGENT` in `scripts/grandtour-feed-provider.mjs`) so
letour.fr can identify and rate-limit/contact the bot if needed.

Recorded HTML fixtures for these cases live in `test/fixtures/letour/` (see
that directory's `README.md` for what each fixture represents and how to
refresh `stage-successful.html` against the live site).

### Reconciliation dry run (official-letour only)

`--reconcile` compares parsed official-letour rider/team rows for each
requested stage against existing Supabase GrandTour records — it never
writes anything and only ever issues `select` reads. It is opt-in and
completely separate from `--apply`, which remains disabled.

```bash
npm run grandtour:feed:dry-run -- --provider official-letour --from-stage 2 --to-stage 2 --reconcile --report C:\tmp\grandtour-reconcile.json
```

Requirements:

- `SUPABASE_URL` (or `EXPO_PUBLIC_SUPABASE_URL`) and `SUPABASE_ANON_KEY` (or
  `EXPO_PUBLIC_SUPABASE_ANON_KEY`) must be set. Reconciliation only ever uses
  the public anon key — never `SUPABASE_SERVICE_ROLE_KEY` — because
  `grandtour_riders`, `grandtour_teams`, and `grandtour_stages` are fully
  public-readable, and that's all reconciliation needs to read.
- `--reconcile` is rejected for any provider other than `official-letour`.
- The grand tour is resolved by `--grand-tour-name`/`--grand-tour-year`
  (defaults: `Tour de France` / `2026`) unless `--grand-tour-id <uuid>` is
  passed explicitly. If no matching `grand_tours` row is found, the command
  fails with a clear error rather than silently reconciling against nothing.
- If the required env vars are missing, the command fails immediately with a
  clear error before any Supabase call is attempted.

The `official-letour` dry-run report gains a `reconciliation` object:

- `provider`, `dryRun: true`, `applyEnabled: false`, `reconciliationOnly: true`
- `stages[]` — one entry per requested stage number, each with
  `stageNumber`, `stageId`, `stageDate`, `stageType`, `matchedRiders`,
  `unmatchedRiders`, `ambiguousRiders`, `matchedTeams`,
  `unmatchedTeams`, `ambiguousTeams`, `duplicateBibConflicts`,
  `matchedRidersOnStartlist`, `matchedRidersMissingFromStartlist`,
  `startlistValidationPassed`, `noStartlistRowsFound`, `missingStageRecord`,
  `isTtt`, `safeToApply`, and `blockers` (the specific reasons `safeToApply`
  is `false`, when it is). `stageId`/`stageDate`/`stageType` come straight
  from the same `grandtour_stages` row `fetchReconciliationContext` already
  reads for reconciliation — never a second lookup — and are `null` when
  `missingStageRecord` is `true`. `stageId` is the real UUID a future apply
  step needs (`docs/grandtour-apply-mode-spec.md` §14.2/§14.4); `stageType`
  here is the authoritative DB `stage_type` value, distinct from the
  `stageType` argument that only drives the `isTtt` heuristic.
- `overallSafeToApply` — `true` only if every requested stage is individually
  safe to apply

Matching precedence per rider: bib number first (if exactly one existing
rider has that bib), then normalized rider name, matching the same
`normalizeRiderName`/`normalizeTeamName` used by `scripts/import-tdf-2026.mjs`.
Zero candidates is `unmatched`; more than one is `ambiguous`. Team matching
follows the same precedence using team `code` then `name`/`short_name`.

Every **matched** rider is additionally checked against that stage's
`grandtour_stage_startlists` rows (`existingStartlist`, fetched by
`fetchReconciliationContext` and passed to
`reconcileStageResult`/`checkStartlistMembership` in
`scripts/grandtour-reconciliation.mjs`). This mirrors a real DB constraint —
`grandtour_private.validate_result_line()` raises `Result rider must be on
the stage start list.` if a rider without a startlist row for that stage is
ever written to `grandtour_stage_result_lines` — so reconciliation catches
this failure mode before any future apply attempt could reach that trigger.
A matched rider missing from the startlist, or a stage with zero startlist
rows at all (`noStartlistRowsFound: true`, reported distinctly from a
per-rider miss), both set `startlistValidationPassed: false` and block
`safeToApply`.

Stage 1 (or any stage whose `stage_type` is `team_time_trial`) is always
reported with `safeToApply: false` and a blocker explaining that no official
team-result source is confirmed yet, regardless of how clean the rider/team
matches — or the startlist check — are. This cannot be overridden by flags.

The pure matching/reconciliation logic lives in
`scripts/grandtour-reconciliation.mjs` and is fully covered by fixture tests
in `scripts/grandtour-reconciliation.test.mjs`
(`test/fixtures/reconciliation/`, see that directory's `README.md`) without
needing a live database. The thin, read-only Supabase query layer lives in
`scripts/grandtour-reconciliation-supabase.mjs` — it contains no
`insert`/`upsert`/`update`/`delete` calls anywhere, verified by
`scripts/grandtour-reconciliation-supabase.test.mjs` against a mock client
that only implements read methods.

### Local reconciliation smoke test

`scripts/grandtour-reconciliation-local-smoke.mjs` validates the read-only
reconciliation wiring against a real local Supabase instance — real RLS
policies, real grants, real seeded rows — instead of the mocked client used
by `grandtour-reconciliation-supabase.test.mjs`. It uses hand-built parsed
"official-letour"-shaped stage payloads instead of a live letour.fr fetch,
because the local seed data (`supabase/seed.sql`) isn't a real, currently
running Tour de France stage.

```bash
npx supabase db reset
docker exec -i supabase_db_tipping-suite psql -U postgres -d postgres \
  < supabase/seeds/grandtour_reconciliation_smoke.sql

# From `npx supabase status -o env` — anon key only, never SERVICE_ROLE_KEY:
SUPABASE_URL="http://127.0.0.1:54321" \
SUPABASE_ANON_KEY="<local ANON_KEY>" \
npm run grandtour:reconcile:local-smoke
```

`supabase/seeds/grandtour_reconciliation_smoke.sql` is test-only and is
**not** part of the default `supabase db reset` seed (`supabase/config.toml`
only auto-loads `supabase/seed.sql`) — it must be applied manually, and only
against a local database. It assigns deterministic bib numbers to the 40
riders `supabase/seed.sql` already inserts for `GrandTour France 2026`,
deliberately makes two riders share bib `1` so the ambiguous-rider-match
scenario can be exercised against real data (the schema's
`grandtour_riders_normalized_name_uidx` unique index makes a name-based
ambiguous match impossible within one grand tour, so bib collision is the
only real way to reproduce that case), and deliberately deletes one rider's
`grandtour_stage_startlists` row for stage 2 only (`supabase/seed.sql`
otherwise puts every seeded rider on every stage's startlist, so there is
otherwise no real DB state to exercise a startlist-membership failure
against). These are test-fixture-setup statements in a local-only seed
file, not part of the reconciliation application code, which remains
read-only.

The smoke test resolves the seeded grand tour, fetches reconciliation
context for a road stage (2), the seeded TTT stage (4), and a nonexistent
stage (999), then runs 9 scenarios against that real data: perfect match
(including startlist membership), unmatched rider, a real matched rider
removed from the stage startlist, an artificially empty startlist
(`noStartlistRowsFound`), ambiguous rider, duplicate bib conflict,
unmatched team, missing stage, and TTT-always-unsafe (including when the
startlist check itself passes cleanly). It exits non-zero if any scenario's
assertions fail, and writes a report to
`tmp/grandtour-reconciliation-local-smoke-report.json`.

Validated (2026-07-09, local Supabase via Docker, migrations through
`20260707024106_park_jersey_tips_add_rider_feed_metadata.sql`): all 9
scenarios passed against a live local database, including the two new
startlist scenarios; RLS did not block any of the required reads with the
anon key (`grandtour_stages`, `grandtour_riders`, `grandtour_teams`,
`grandtour_stage_startlists` are fully public-readable); a direct REST
`PATCH` against `grandtour_riders` with the anon key was independently
confirmed to be rejected by PostgreSQL itself (`42501 permission denied`,
`GRANT UPDATE ... TO anon` required) — reconciliation cannot write even if
the application code had a bug, and it never uses the service-role key.

### Apply-mode database foundation and CLI wiring

`supabase/migrations/20260709020000_grandtour_apply_official_stage_result_rpc.sql`
adds a `service_role`-only, `security definer` RPC
(`public.apply_grandtour_official_stage_result`) that atomically writes a
draft (`is_final: false`) `grandtour_stage_results`/`grandtour_stage_result_lines`
set for one non-TTT stage. `scripts/grandtour-feed-import.mjs --apply` now
calls it — see "Applying an official result" above for usage, and
[docs/grandtour-apply-mode-spec.md §15](grandtour-apply-mode-spec.md#15-phase-3-implementation-record)
for the full implementation record (files changed, tests, and a real
end-to-end verification run against local Supabase). There is still no
GitHub Actions or other automation path that could reach `--apply` — it
requires a human-supplied `--from-report` and the service-role key, neither
of which the scheduled workflow has.

DB tests for the RPC live in `supabase/tests/grandtour_apply_official_stage_result.sql`
and run the same way as the other `supabase/tests/*.sql` files:

```bash
docker cp supabase/tests/grandtour_apply_official_stage_result.sql supabase_db_tipping-suite:/tmp/grandtour_apply_official_stage_result.sql
docker exec supabase_db_tipping-suite psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/grandtour_apply_official_stage_result.sql
```

### Jersey holder reconciliation and apply

`supabase/migrations/20260709070000_grandtour_apply_jersey_holders_rpc.sql`
extends the RPC above with an optional `p_jersey_holders` parameter (0 or
exactly 4 `{jersey_type, rider_id}` entries), upserted into
`grandtour_stage_jersey_holders` with `on conflict (stage_id, jersey_type)
do update set rider_id = excluded.rider_id, updated_at = now()`. This
upsert runs regardless of whether the stage result itself was new or
`no_change`, so re-applying with a corrected jersey holder (unchanged top-10
result) still lands the correction.

`scripts/grandtour-feed-provider.mjs`'s official-letour parser now also
fetches each of the four classification tabs per stage — Individual/General
(yellow), Points (green), Climber/Mountains (kom), Youth (white) — and takes
the position-1 leader of each as that jersey's end-of-stage holder. A
`--reconcile` dry-run report's `reconciliation.stages[0].jerseyHolders` array
carries one entry per required jersey type:

```json
{
  "jerseyType": "yellow",
  "sourceClassification": "individual",
  "parsedRiderName": "T. POGACAR",
  "parsedTeamName": "UAE TEAM EMIRATES XRG",
  "bibNumber": 1,
  "matchedRiderId": "3a76d2e6-337c-46c1-8735-206698ffcc7f",
  "matchedBy": "bib_number",
  "nameMismatch": true,
  "teamMismatch": false,
  "onStartlist": true,
  "status": "matched"
}
```

Any jersey holder that is missing, unmatched, ambiguous, or matched but not
on the stage startlist adds a blocker (`"Missing <type> jersey holder."`,
`"Unmatched <type> jersey holder."`, `"Ambiguous <type> jersey holder."`,
`"<Type> jersey holder is not on the stage startlist."`) and forces the
stage's `safeToApply` to `false`, exactly like a bad result-line match — a
bib-matched jersey holder with an abbreviated official-letour name is
allowed (`nameMismatch: true`, not a blocker). Apply mode's own
`validateReportForApply` independently re-confirms all four jersey holders
are present and `status: "matched"` before ever calling the RPC. Finalizing
(`is_final: true`) remains categorically refused by the RPC regardless of
jersey holder completeness — there is still no `--finalize` CLI flag.

The full contract the CLI implements — what gets applied (**top 10** result
lines, not top 5; see the rationale), how every RPC parameter maps to
specific fields on the dry-run/reconciliation report, the five required
confirmation flags, and the required-fields checklist — is in
[docs/grandtour-apply-mode-spec.md §14](grandtour-apply-mode-spec.md#14-phase-3-payload-contract-review-report--rpc-parameters).

Everything in that file runs inside one transaction ending in `ROLLBACK`; it
never persists test data.

### Backfill dry run example

Use a multi-stage manual JSON source file when backfilling completed results.

Example GitHub UI inputs:

- `provider`: `manual-json`
- `source_file`: `data/feeds/tdf-2026/sample-backfill-stages-1-3.json`
- `report_file`: `grandtour-feed-backfill.json`
- `backfill`: `true`
- `from_stage`: `1`
- `to_stage`: `3`

Example GitHub CLI command:

```bash
gh workflow run "GrandTour Daily Feed Dry Run" --repo tmcstay/tipping --field provider=manual-json --field source_file=data/feeds/tdf-2026/sample-backfill-stages-1-3.json --field report_file=grandtour-feed-backfill.json --field import_type=backfill --field from_stage=1 --field to_stage=3
```

Example local command:

```bash
npm run grandtour:feed:dry-run -- --backfill --from-stage 1 --to-stage 3 --provider manual-json --source-file data/feeds/tdf-2026/sample-backfill-stages-1-3.json --report C:\tmp\tdf-backfill-review.json
```

### Backfill report expectations

A backfill dry run should include:

- `mode: dry-run`
- `importType: backfill`
- `fromStage: 1`
- `toStage: 3`
- `stagesConsidered: [1,2,3]`
- `stagesWithResults`
- `stagesMissingResults`
- `stageResultCandidates`
- `tttResultCandidates`
- `candidateJerseyHolderRows`
- `candidateRiderStatusChanges`
- `unmatchedRiders`
- `unmatchedTeams`
- `validationErrors: []`
- `importStatus: validated`

Scheduled workflow runs remain safe dry-runs and do not mutate production data. `apply` mode remains disabled until an approved provider/source is implemented.

### Running a dry run locally with a source file

```bash
npm run grandtour:feed:dry-run -- --provider manual-json --source-file data/feeds/tdf-2026/sample-stage-result.json --report C:\tmp\grandtour-feed-sample.json
```

Sample feed files live in `data/feeds/tdf-2026/`.

Expected sample report summary for `data/feeds/tdf-2026/sample-stage-result.json`:

- `summary.stageResultCandidates: 1`
- `summary.tttResultCandidates: 1`
- `summary.changedRiderStatuses: 1`
- `validationErrors: []`
- `importStatus: validated`

### Safety notes

- Scheduled workflow runs remain dry-run only, including the auto-resolved `official-letour` stage.
- Manual workflow dispatch remains dry-run only.
- `apply` mode remains disabled; `applyEnabled` in every report is always `false`.
- No Supabase client exists in the base dry-run/apply feed scripts; no production mutation occurs during dry-run sample testing or scheduled runs.
- If the scheduled job cannot resolve a stage for the day (rest day, or outside the race window), it writes a `skipped` report and exits successfully rather than guessing a stage or failing loudly.
- Do not add service-role credentials for dry-run sample testing unless future apply mode is explicitly designed and approved.
- The optional `--reconcile` flag is opt-in only (never used by the scheduled workflow), reads with the public anon key only, and never calls `insert`/`upsert`/`update`/`delete`. It reports whether a stage is safe to apply in principle; it does not apply anything itself.

### Inspecting the report

To inspect the generated report, download the `grandtour-feed-dry-run-report` artifact from the workflow run in GitHub Actions. The JSON file contains the review report and validation details.

The provider foundation supports these segments:

- stage metadata
- normal rider stage results
- TTT team results
- official jersey holders
- rider status
- startlist/rider details
- team data

Future providers can be manual JSON/CSV, official/static JSON, a paid API, or a legally appropriate adapter. Every provider should retain source name, source URL, fetched time, confidence, validation errors, and an import summary before any apply step.
