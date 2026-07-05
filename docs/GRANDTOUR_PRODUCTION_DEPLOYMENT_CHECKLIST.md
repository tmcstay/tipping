# GrandTour Production Deployment Checklist

> **NO-GO by default.** This document is a reviewed command plan, not authority to deploy. Do not run the production write command until every mandatory gate below is complete and both the operator and reviewer approve it.

## Pending GrandTour UI and TTT segment — 5 July 2026

This branch prepares, but does not deploy, the next production segment. Read-only
linked migration inspection confirmed that production currently ends at
`20260702061010` and the following additive migrations remain pending, in order:

1. `20260703025318_extend_grandtour_stage_types.sql`
2. `20260703025324_add_grandtour_ttt_schema_support.sql`
3. `20260703041335_implement_grandtour_ttt_scoring.sql`
4. `20260703045921_add_grandtour_rider_bib_number.sql`

Local-only verification completed for this pending segment:

- A clean `supabase db reset --local` applied every migration and the ordinary
  development seed successfully. The ignored credential-bearing E2E fixture is
  not referenced by committed `supabase/config.toml`.
- Canonical tipping, TTT SQL/RLS, and rider bib-number SQL suites passed.
- Local schema lint reported no errors. Database advisors reported only the
  existing duplicate-permissive-policy performance warnings for public-read and
  admin-manage result policies.
- Core, mobile UI, data/import, typecheck, and Expo web export checks passed.
- No production migration, seed, import, score recalculation, or data write was
  run during this preparation cycle.

This segment remains **NO-GO for production writes** until its branch is reviewed
and merged, a fresh production backup/dry-run gate is completed, environment
variables are confirmed, and an operator explicitly approves the exact migration
command. Apply migrations before deploying frontend code that relies on TTT team
results or canonical rider bibs.

## Production target confirmation

Read-only verification on 2 July 2026 confirmed:

- Project name: `tipping-suite`
- Project ref: `nsdpilmmrfobiapbwona`
- Region: `ap-southeast-1`
- Status: `ACTIVE_HEALTHY`
- PostgreSQL: `17.6.1.127`
- Dashboard: <https://supabase.com/dashboard/project/nsdpilmmrfobiapbwona>

At that verification point, production migration history ended at `20260701053811`. The four canonical workflow migrations plus the live-leaderboard and kill-switch migrations below must be pending immediately before deployment. This is time-sensitive information; verify it again immediately before deployment.

The first four canonical migrations and associated application changes are tracked in `d65c5fea7244cd0f66ed9a7110a6e30294b4634f`. The reviewed successor `9b24d052e1040d9e1ddc6cef5e290b29cf0a00e6` contains the live-leaderboard and kill-switch migrations, client/types/tests, and checklist updates. That commit is pushed to `origin/main`, and its Vercel deployment completed successfully on 3 July 2026.

The credential-bearing E2E fixture remains ignored and is not referenced by the
committed Supabase configuration. Unrelated local design handoff archives are
also ignored. Never run production commands from a dirty development checkout;
use the isolated clean worktree procedure below.

## Required migration order

Production must receive these files in this exact order:

1. `20260701081127_canonical_grandtour_tipping_workflow.sql`
2. `20260701081334_canonical_grandtour_tipping_rpcs_rls.sql`
3. `20260702003933_add_grandtour_tip_lifecycle_statuses.sql`
4. `20260702003948_harden_grandtour_tip_lifecycle.sql`
5. `20260702055447_live_grandtour_leaderboards.sql`
6. `20260702061010_grandtour_tipping_kill_switch.sql`

The enum migration must remain separate from the lifecycle migration because PostgreSQL must commit the new enum values before a later transaction uses them.

Stop if the linked migration list differs, any additional migration is pending, or the ordering differs. Do not repair production migration history during the deployment window.

## Absolute seed and reset prohibition

Never run or supply any of the following against linked production:

- `supabase db reset`
- `--include-seed`
- `--include-all`
- `supabase/seed.sql`
- Anything under `supabase/seeds/`
- `supabase/seeds/grandtour_e2e.sql`

Both `supabase/seed.sql` and `supabase/seeds/grandtour_e2e.sql` are local development fixtures and must not be deployed. The E2E fixture contains predictable test passwords, two test users, one dummy user, and synthetic competitions, leagues, memberships, riders, tips, results, and scores. The six required migrations contain none of those fixture identifiers.

The documented production command does not include seeds. Do not add a seed flag manually and do not use a wrapper, alias, CI job, or deployment script that appends one.

Before deployment, audit automation and review every match from this command:

```powershell
rg -n --hidden --glob '!node_modules/**' --glob '!docs/**' -- "--include-seed|--include-all|grandtour_e2e\.sql|supabase db reset" .
```

Expected local seed configuration references are not proof of a problem. Any CI, release, hosting, or production script match is a stop condition until reviewed. Record confirmation that production automation cannot append `--include-seed` or `--include-all`.

## Pre-deployment control

### 0. Create an isolated clean deployment worktree

Use a detached worktree at the exact reviewed commit. This leaves the development checkout and its local E2E configuration untouched. The tracked, committed `supabase/config.toml` will exist in the clean worktree; only the local modification to that file is excluded.

Run from the ordinary repository checkout:

```powershell
$deploymentCommit = "9b24d052e1040d9e1ddc6cef5e290b29cf0a00e6"
$sourceRepo = (Resolve-Path .).Path
$deployRoot = "C:\tmp\tipping-suite-prod-$($deploymentCommit.Substring(0, 8))"

git fetch origin main
if ((git rev-parse origin/main) -ne $deploymentCommit) {
  throw "origin/main does not match the reviewed deployment commit."
}
if (Test-Path -LiteralPath $deployRoot) {
  throw "Deployment worktree path already exists; inspect it instead of overwriting it."
}

git worktree add --detach $deployRoot $deploymentCommit

# Transfer only ignored Supabase link metadata. Do not copy config.toml, seeds, assets, or source files.
Copy-Item -LiteralPath "$sourceRepo\supabase\.temp" `
  -Destination "$deployRoot\supabase\.temp" -Recurse

Push-Location $deployRoot
if ((git rev-parse HEAD) -ne $deploymentCommit) {
  throw "Clean worktree is on the wrong commit."
}
if (git status --porcelain) {
  throw "Deployment worktree is not clean."
}
if ((Get-Content -Raw .\supabase\.temp\project-ref).Trim() -ne "nsdpilmmrfobiapbwona") {
  throw "Deployment worktree is linked to the wrong Supabase project."
}
if (Select-String -LiteralPath .\supabase\config.toml -Pattern "grandtour_e2e") {
  throw "Local E2E seed configuration leaked into the deployment worktree."
}
foreach ($excluded in @("Logo - General.png", "tour_tips_icon_pack.zip")) {
  if (Test-Path -LiteralPath (Join-Path $deployRoot $excluded)) {
    throw "Excluded local asset exists in deployment worktree: $excluded"
  }
}
```

Remain inside `$deployRoot` for every linked production read and, only after approval, the single production write. Do not run `supabase link`; the verified ignored link metadata is copied from the already-linked checkout. Do not copy `supabase/config.toml`, `supabase/seed.sql`, anything under `supabase/seeds/`, `Logo - General.png`, or `tour_tips_icon_pack.zip` from the development checkout.

### 1. Record the CLI and repository state

Run:

```powershell
npx.cmd supabase --version
git status --short --branch
git diff --check
git log -1 --oneline
git rev-parse HEAD
```

Record:

- Deployment commit SHA: ________________________________
- Supabase CLI version: _________________________________
- Operator name: ________________________________________
- Reviewer/approver name: _______________________________
- Planned deployment time and timezone: _________________

The commit SHA must identify the exact reviewed source being deployed. Do not deploy from a moving branch reference or dirty worktree.

### 2. Confirm all six migration files are tracked

```powershell
git ls-files --error-unmatch -- `
  supabase/migrations/20260701081127_canonical_grandtour_tipping_workflow.sql `
  supabase/migrations/20260701081334_canonical_grandtour_tipping_rpcs_rls.sql `
  supabase/migrations/20260702003933_add_grandtour_tip_lifecycle_statuses.sql `
  supabase/migrations/20260702003948_harden_grandtour_tip_lifecycle.sql `
  supabase/migrations/20260702055447_live_grandtour_leaderboards.sql `
  supabase/migrations/20260702061010_grandtour_tipping_kill_switch.sql
```

This command must succeed. Confirm the files are included in the recorded deployment commit:

```powershell
git show --stat --oneline HEAD
git status --porcelain
```

`git status --porcelain` must return no output. If a deliberately dirty worktree is ever accepted under an emergency procedure, document every changed file and obtain written reviewer approval; do not use that exception for this deployment.

### 3. Verify the existing link; do not relink

```powershell
Get-Content .\supabase\.temp\project-ref
npx.cmd supabase projects list
```

Both results must identify project ref `nsdpilmmrfobiapbwona` and project name `tipping-suite`. `supabase status` describes the local stack and is not hosted production health evidence.

If either result differs, **stop**. Do not run `supabase link` as part of normal deployment. Relinking is a separate recovery procedure requiring investigation, explicit approval, and a fresh review of migration history.

### 4. Compare migration history

```powershell
npx.cmd supabase migration list --local
npx.cmd supabase migration list --linked
```

The remote column must be blank for exactly the six required migrations and no others. Save the output with the deployment record.

### 5. Run application verification

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd --workspace apps/mobile run web:build
git diff --check
```

All commands must pass on the recorded deployment commit.

## LOCAL ONLY: destructive replay and SQL fixture

> **LOCAL ONLY.** The reset command below destroys the local Supabase database. Never run `db reset` against linked production, and never remove the `--local` flag. Stop if the terminal or project context is uncertain.

This optional replay is performed before the production window:

```powershell
npx.cmd supabase db reset --local --yes
docker cp supabase/tests/canonical_grandtour_tipping.sql supabase_db_tipping-suite:/tmp/canonical_grandtour_tipping.sql
docker exec supabase_db_tipping-suite psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/canonical_grandtour_tipping.sql
```

The local replay may run local seeds. That does not authorize running those seeds anywhere else.

## Backup and restore-readiness plan

### 1. Confirm managed recovery

In Supabase Dashboard, open **Database -> Backups** and verify a recent recoverable backup or PITR restore point. Record:

- Production project: `tipping-suite` / `nsdpilmmrfobiapbwona`
- Dashboard location: **Database -> Backups -> Scheduled backups**
- Latest visible recoverable backup: `02 Jul 2026 20:43:58 (+0000)` — `PHYSICAL`
- Other visible scheduled physical backups:
  - `01 Jul 2026 20:44:18 (+0000)`
  - `30 Jun 2026 20:44:18 (+0000)`
  - `29 Jun 2026 20:44:23 (+0000)`
- Retention/PITR window: not established by the supplied dashboard evidence; four scheduled physical backups are visible from 29 June through 2 July 2026
- Person who verified it: `Tony McStay`
- Dashboard limitation: Storage objects are not included in database backups

Managed database backups include Auth data. Logical CLI dumps normally exclude managed schemas such as `auth` and `storage`; Storage object contents are not included in database backups. Do not treat the logical export below as a complete replacement for managed recovery.

### 2. Create a logical export outside the Git workspace

The destination must be external to this repository and protected by encrypted storage, such as BitLocker. Production exports may contain personal and gameplay data.

```powershell
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupRoot = Join-Path $env:USERPROFILE "Backups\tipping-suite-production"
$backupDir = Join-Path $backupRoot $stamp
$workspace = (Resolve-Path ".").Path.TrimEnd('\')

New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
$resolvedBackupDir = (Resolve-Path $backupDir).Path

if ($resolvedBackupDir.StartsWith($workspace, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Unsafe backup destination: backup directory is inside the Git workspace."
}

npx.cmd supabase db dump --linked --role-only --file "$backupDir\roles.sql"
if ($LASTEXITCODE -ne 0) { throw "Role export failed." }

npx.cmd supabase db dump --linked --schema public --file "$backupDir\schema.sql"
if ($LASTEXITCODE -ne 0) { throw "Schema export failed." }

npx.cmd supabase db dump --linked --schema public --data-only --use-copy --file "$backupDir\public-data.sql"
if ($LASTEXITCODE -ne 0) { throw "Public data export failed." }

npx.cmd supabase migration list --linked | Out-File -Encoding utf8 "$backupDir\migration-history.txt"
if ($LASTEXITCODE -ne 0) { throw "Migration history export failed." }
```

### 3. Verify every backup artifact

```powershell
$expectedBackupFiles = @(
  "$backupDir\roles.sql",
  "$backupDir\schema.sql",
  "$backupDir\public-data.sql",
  "$backupDir\migration-history.txt"
)

foreach ($file in $expectedBackupFiles) {
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
    throw "Missing backup file: $file"
  }

  $item = Get-Item -LiteralPath $file
  if ($item.Length -le 0) {
    throw "Empty backup file: $file"
  }
}

Get-Item -LiteralPath $expectedBackupFiles | Select-Object FullName, Length, LastWriteTime
$hashFile = "$backupDir\sha256.txt"
Get-FileHash -Algorithm SHA256 -LiteralPath $expectedBackupFiles |
  ForEach-Object { '{0}  {1}' -f $_.Hash, $_.Path } |
  Set-Content -Encoding utf8 -LiteralPath $hashFile

if (-not (Test-Path -LiteralPath $hashFile -PathType Leaf) -or
    (Get-Item -LiteralPath $hashFile).Length -le 0) {
  throw "Backup hash evidence is missing or empty."
}

Get-Content -LiteralPath $hashFile
```

Copy the hashes into the deployment record. Never copy production exports into this repository, stage them with Git, commit them, upload them to an issue, or place them in an unencrypted shared folder.

### 4. Rehearse restoration before the deployment window

Restore rehearsal must use a disposable local or non-production Supabase environment whose project ref and database URL have been independently checked. Never rehearse against `nsdpilmmrfobiapbwona`.

Because Supabase logical dumps can depend on managed schemas and roles, do not improvise a vanilla PostgreSQL restore during the deployment window. Use the organisation's approved Supabase restore procedure and verify at minimum:

1. The schema export loads without an unreviewed error.
2. Public data loads and representative row counts match the export.
3. Auth-dependent foreign keys and functions resolve correctly.
4. The restored GrandTour tables can be queried.
5. The rehearsal environment is deleted after validation.

Record:

- Rehearsal environment/ref: disposable local Supabase project `grandtour-restore-rehearsal-20260703`, PostgreSQL 17 on host port `55322`; no production project ref or link metadata
- Rehearsal date: `2026-07-03 10:59:05 +09:30` (Australia/Adelaide)
- Backup set timestamp restored: `C:\Users\Tony\Backups\tipping-suite-production\20260703-103820`
- Restore method/runbook ticket: Supabase CLI local stack plus `psql` inside `supabase_db_grandtour-restore-rehearsal-20260703`; no linked command used
- Schema restore result: **PARTIAL PASS** — 31 public tables, five public enum types, constraints, and grants loaded; 33 errors were reviewed and were all caused by intentionally absent `app_private` or `grandtour_private` schemas
- Representative row-count result: **PASS** — restored counts matched COPY counts, including one tour, one GrandTour competition, 23 teams, 173 riders, 21 stages, 3,633 start-list rows, one tip, and one tip selection
- Auth/FK/function validation: **LIMITED / RISK ACCEPTANCE REQUIRED** — four public tables reference `auth.users`, but Auth rows are outside the logical public-data export; data was loaded locally with `session_replication_role = replica`; 10 GrandTour triggers, one profile trigger, and 22 private-function-backed policies were not recreated
- GrandTour query validation: **PASS WITH LIMITATIONS** — all 13 restored GrandTour tables were queryable and representative counts matched the export; private triggers/policies and authenticated behavior were not validated by this restore
- Result/evidence location: this checklist and the Codex execution record for 3 July 2026
- Restore-rehearsal operator: `Tony McStay`
- Reviewer/approver: `Tony McStay`
- Disposable environment deletion confirmed: **YES** — the isolated containers and data volumes were deleted with `supabase stop --project-id grandtour-restore-rehearsal-20260703 --no-backup`; the existing `supabase_db_tipping-suite` local stack remained healthy
- Approver risk acceptance: **ACCEPTED AND RECORDED**

Risk acceptance statement for approval:

> I acknowledge that the logical restore rehearsal validated the public schema structure, public data COPY contents, representative row counts, and GrandTour table queryability, but it did not reproduce production Auth users or the omitted `app_private` and `grandtour_private` schemas. As a result, Auth-dependent foreign keys, private trigger functions, private authorization helpers, and their RLS policy behavior were not functionally exercised by this rehearsal. I accept this residual restore risk based on the verified managed physical backup, external logical backup, prior local migration/RLS tests, and the requirement to stop deployment if the production dry-run or post-migration checks differ from the checklist.

- Risk-acceptance approver: `Tony McStay`
- Restore-rehearsal operator: `Tony McStay`
- Approval/signature or ticket: explicit approval supplied for this checklist update in the Codex deployment-preparation thread
- Approval timestamp and timezone: `03 Jul 2026 11:02 AEST` (as supplied by the approver)
- Accepted limitations: production Auth users were not restored; `app_private` and `grandtour_private` were omitted; private triggers/helpers and authenticated RLS behavior were not exercised
- Acceptance basis: public schema/data loaded, all 13 GrandTour tables were queryable, representative counts matched, and both managed physical and verified external logical backups exist

A failed or unperformed rehearsal requires explicit risk acceptance from the deployment approver. A verified managed backup/PITR point remains mandatory regardless.

## Production dry run

The dry run is read-only but still requires the verified production link:

**Executed successfully on 3 July 2026 from the isolated clean worktree. The command used `db push --linked --dry-run`; `db push --linked` without `--dry-run` was not run.**

```powershell
$migrationListFile = Join-Path $backupDir "pre-push-migration-list.txt"
npx.cmd supabase migration list --linked 2>&1 |
  Tee-Object -FilePath $migrationListFile
if ($LASTEXITCODE -ne 0) { throw "Production migration listing failed." }

$dryRunFile = Join-Path $backupDir "db-push-dry-run.txt"
npx.cmd supabase db push --linked --dry-run 2>&1 | Tee-Object -FilePath $dryRunFile
if ($LASTEXITCODE -ne 0) { throw "Production migration dry run failed." }

$forbiddenDryRunText = Select-String -LiteralPath $dryRunFile `
  -Pattern "include-seed|include-all|seed data|seeding data|db reset|grandtour_e2e" `
  -CaseSensitive:$false
if ($forbiddenDryRunText) {
  throw "Dry-run evidence contains a seed/reset indicator; stop and investigate."
}
```

The operator and reviewer must inspect the complete output. It must list exactly these six files, in order, and no seed operation:

1. `20260701081127_canonical_grandtour_tipping_workflow.sql`
2. `20260701081334_canonical_grandtour_tipping_rpcs_rls.sql`
3. `20260702003933_add_grandtour_tip_lifecycle_statuses.sql`
4. `20260702003948_harden_grandtour_tip_lifecycle.sql`
5. `20260702055447_live_grandtour_leaderboards.sql`
6. `20260702061010_grandtour_tipping_kill_switch.sql`

Any additional, missing, reordered, repaired, or seed-related operation is a stop condition.

Recorded result:

- Migration-list evidence: `C:\Users\Tony\Backups\tipping-suite-production\20260703-103820\pre-push-migration-list.txt` — 3,042 bytes
- Dry-run evidence: `C:\Users\Tony\Backups\tipping-suite-production\20260703-103820\db-push-dry-run.txt` — 2,164 bytes
- Linked migration history: PASS — remote history ends at `20260701053811`, with exactly the six expected migrations pending
- Dry-run migration sequence: PASS — exactly the six expected migration filenames appeared once each and in the required order
- Seed/reset scan: PASS — zero matches for `--include-seed`, `--include-all`, `seed data`, `seeding data`, `db reset`, or `grandtour_e2e`
- CLI result: `Finished supabase db push.` after explicitly stating `DRY RUN: migrations will *not* be pushed to the database.`
- Production mutation: **NOT RUN**

## Mandatory approval gate before the production write

The following fields must be completed immediately before deployment:

- [x] Project ref is exactly `nsdpilmmrfobiapbwona`.
- [x] Project name is exactly `tipping-suite`.
- [x] The deployment commit SHA is exactly `9b24d052e1040d9e1ddc6cef5e290b29cf0a00e6`.
- [x] Vercel deployment `27PshMh47zMCjewwZ5mxXn7M4mX6` remains successful.
- [x] The worktree is clean.
- [x] All six migration files are tracked and committed.
- [x] Remote history shows exactly the six expected pending migrations.
- [x] Dry-run output shows exactly those six migrations in order.
- [x] No command, alias, wrapper, or automation contains `--include-seed` or `--include-all`.
- [x] Every backup artifact exists and has a non-zero size.
- [x] Backup hashes and managed restore point are recorded.
- [x] Restore rehearsal evidence is recorded, and the partial-rehearsal limitations are explicitly accepted.
- [x] The immutable previous known-good Vercel deployment ID/URL is recorded.
- [x] A procedure-only Vercel Instant Rollback rehearsal is accepted by the rollback operator and approver; a live routing change was deliberately not performed.
- [x] The pending live leaderboard RPC has been reviewed locally; its unavoidable pre-migration production-smoke limitation and mandatory immediate post-migration tests are accepted.
- [x] Last-known-good frontend rollback is confirmed for read-only containment, paired with disabling GrandTour tipping first.
- [x] The pending kill switch has been reviewed locally; its unavoidable pre-migration production-smoke limitation and mandatory immediate post-migration tests are accepted.

Approval record:

- Operator: `Tony McStay` (signed)
- Reviewer/approver: `Tony McStay` (signed)
- Deployment commit SHA: `9b24d052e1040d9e1ddc6cef5e290b29cf0a00e6`
- Vercel deployment ID/status evidence: `27PshMh47zMCjewwZ5mxXn7M4mX6`, Vercel `success`, updated `2026-07-03T00:47:54Z`
- Backup directory: `C:\Users\Tony\Backups\tipping-suite-production\20260703-103820`
- Managed backup/PITR timestamp: scheduled physical backup `02 Jul 2026 20:43:58 (+0000)`; PITR was not evidenced
- Backup SHA-256 evidence file: `C:\Users\Tony\Backups\tipping-suite-production\20260703-103820\sha256.txt`
- Restore rehearsal or risk-acceptance evidence: partial local rehearsal recorded above; residual restore risk accepted by Tony McStay at `03 Jul 2026 11:02 AEST`
- Dry-run evidence: `C:\Users\Tony\Backups\tipping-suite-production\20260703-103820\db-push-dry-run.txt`
- Migration-list evidence: `C:\Users\Tony\Backups\tipping-suite-production\20260703-103820\pre-push-migration-list.txt`
- Seed/reset automation audit evidence: PASS — dry-run evidence contains zero prohibited indicators; broader automation review remains part of the approval gate
- Previous known-good Vercel deployment: commit `6f7c3254d340a617ff27fe79093f40dcdb180bbd`, deployment `6dT48C5N8nvW83f8ZFaKj8CS2Qzv`; approved for read-only containment only after GrandTour tipping is disabled
- Rollback operator: `Tony McStay` (signed)
- Rollback approver: `Tony McStay` (signed)
- Rollback rehearsal evidence: documented procedure walkthrough completed and accepted; no production routing change was performed
- Exact production command approved: `npx.cmd supabase db push --linked`
- Command boundary: run from the clean deployment worktree only; no additional flags, no seeds, no `--include-seed`, no `--include-all`; stop on first error
- Approval status: **SIGNED / AUTHORISED**
- Approval timestamp and timezone: `03 Jul 2026 11:21 AEST`
- [x] Procedure-only Vercel rollback rehearsal limitation accepted by Tony McStay.
- [x] Pre-migration kill-switch smoke limitation and mandatory immediate post-migration test accepted by Tony McStay.
- [x] Pre-migration live-leaderboard smoke limitation and mandatory immediate post-migration test accepted by Tony McStay.

### Final approval-gate evidence review — 3 July 2026

Read-only review timestamp: `2026-07-03 11:10:39 +09:30` (Australia/Adelaide).

1. **PASS** — linked project ref is exactly `nsdpilmmrfobiapbwona`.
2. **PASS** — linked project name is exactly `tipping-suite` and CLI health is `ACTIVE_HEALTHY`.
3. **PASS** — clean deployment worktree HEAD is exactly `9b24d052e1040d9e1ddc6cef5e290b29cf0a00e6`.
4. **PASS** — current Vercel deployment `27PshMh47zMCjewwZ5mxXn7M4mX6` remains successful; status updated `2026-07-03T00:47:54Z`.
5. **PASS** — `C:\tmp\tipping-suite-prod-9b24d052` is clean.
6. **PASS** — all six required migration files are tracked in the deployment commit.
7. **PASS** — current linked history ends at `20260701053811`, with exactly the six expected migrations pending.
8. **PASS** — saved dry-run evidence contains exactly the six expected filenames once each and in order.
9. **PASS** — dry-run evidence contains zero seed/reset indicators; the clean-repository automation scan found only the intentional ignored E2E fixture path in `.gitignore`, not a production command or wrapper.
10. **PASS** — all seven external evidence/backup files exist and are non-empty.
11. **PASS** — SHA-256 values for the four logical backup artifacts match `sha256.txt`.
12. **PASS** — the scheduled physical backup verified by Tony McStay and the external logical backup are recorded; PITR was not evidenced and is not claimed.
13. **PASS** — partial-restore limitations and Tony McStay's residual-risk acceptance are recorded.
14. **PASS WITH ACCEPTANCE PENDING** — the previous successful Vercel target, post-migration compatibility limits, mandatory kill-switch pairing, exact Instant Rollback steps, and a procedure-only rehearsal are recorded. A true rollback was not performed because it would alter production routing; the final approver must accept that limitation.
15. **PASS WITH POST-MIGRATION TEST REQUIRED** — the server-enforced `grandtour_tipping_enabled` kill switch, disable/re-enable SQL, and exact smoke record are documented. The column/trigger are created by a pending migration, so production evidence cannot exist yet; the final approver must accept the mandatory immediate post-migration test condition.
16. **PASS WITH POST-MIGRATION TEST REQUIRED** — the live `get_grandtour_leaderboard` process, private member/non-member test, draft exclusion, dummy/prize checks, and evidence record are documented. The RPC is created by a pending migration, so production evidence cannot exist yet; the final approver must accept the mandatory immediate post-migration test condition.
17. **FAIL** — final production-write operator, reviewer/approver, rollback rehearsal, and approval timestamp fields are not complete. Prior restore-risk acceptance is not production-write approval.

Gate decision: **NOT APPROVED FOR PRODUCTION WRITE.** The operational evidence package is ready to return to final approval review. The production command remains prohibited until the approver explicitly accepts the procedure-only rollback and two unavoidable pre-migration smoke limitations, then signs the exact command and timestamp.

### Final approval review re-run — 3 July 2026 11:19:40 +09:30

1. **PASS** — project ref is exactly `nsdpilmmrfobiapbwona`.
2. **PASS** — project name is exactly `tipping-suite`; linked project remains `ACTIVE_HEALTHY`.
3. **PASS** — deployment commit is exactly `9b24d052e1040d9e1ddc6cef5e290b29cf0a00e6`.
4. **PASS** — Vercel deployment `27PshMh47zMCjewwZ5mxXn7M4mX6` remains successful.
5. **PASS** — isolated deployment worktree remains clean.
6. **PASS** — all six migrations remain tracked and committed.
7. **PASS** — remote history still ends at `20260701053811`, with exactly the expected six migrations pending.
8. **PASS** — dry-run evidence still contains exactly those six migrations in order.
9. **PASS** — seed/reset scan remains clean.
10. **PASS** — all seven external backup/evidence artifacts exist and are non-empty.
11. **PASS** — recorded SHA-256 values match all four logical backup artifacts.
12. **PASS** — managed scheduled physical-backup evidence is recorded; PITR is not claimed.
13. **PASS** — partial restore rehearsal and residual-risk acceptance are recorded.
14. **PASS** — rollback target `6f7c3254d340a617ff27fe79093f40dcdb180bbd` / `6dT48C5N8nvW83f8ZFaKj8CS2Qzv` is recorded.
15. **FAIL** — procedure-only Vercel rollback rehearsal acceptance remains unchecked and unsigned.
16. **FAIL** — kill-switch pre-migration limitation/immediate post-migration smoke acceptance remains unchecked and unsigned.
17. **FAIL** — live-leaderboard pre-migration limitation/immediate post-migration smoke acceptance remains unchecked and unsigned.
18. **PASS** — rollback procedure requires `grandtour_tipping_enabled = false` before production traffic is switched.
19. **FAIL** — final production-write approval remains `NOT SIGNED / NOT AUTHORISED`; approval timestamp is blank.
20. **PASS FOR COMMAND IDENTITY ONLY** — the sole proposed production command is exactly `npx.cmd supabase db push --linked`; it is not authorised.

Re-run decision: **NOT APPROVED FOR PRODUCTION WRITE.** No objective evidence has regressed, but the four explicit acceptance/signature items remain incomplete.

The operator must read the checklist back to the reviewer. The reviewer must give explicit approval after seeing the target, commit, backup verification, migration list, and dry-run output. Approval given before those checks is invalid.

## PRODUCTION WRITE: run once only after approval

> **STOP. This is the only production mutation command in this checklist. Do not copy or run it until the mandatory approval gate is signed.**

```powershell
npx.cmd supabase db push --linked
```

Do not add flags. In particular, never add `--include-seed` or `--include-all`. Stop on the first error; do not edit migration history, rerun with extra flags, or attempt an ad hoc repair.

## Immediate post-migration checks

Run:

```powershell
npx.cmd supabase migration list --linked
npx.cmd supabase db lint --linked --schema public --level warning --fail-on error
npx.cmd supabase db advisors --linked --type security --level info --fail-on error
```

Migration history must show all six versions in both local and remote columns. Save all output with the deployment record.

### Read-only catalog verification

Run the following read-only SQL in the production SQL editor. Do not alter it into DDL or DML.

```sql
select
  p.oid::regprocedure::text as signature,
  pg_get_function_result(p.oid) as result_type,
  p.prosecdef as security_definer,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'save_grandtour_tip_draft',
    'submit_grandtour_tip',
    'clear_grandtour_tip_draft',
    'get_grandtour_leaderboard'
  )
order by p.proname, p.oid::regprocedure::text;
```

Expected:

- `save_grandtour_tip_draft(uuid,uuid,grandtour_tip_mode,grandtour_tip_scope,jsonb,text)` returns `uuid`.
- `submit_grandtour_tip(uuid,text)` returns `grandtour_tips`.
- `clear_grandtour_tip_draft(uuid,text,text)` returns `boolean`.
- `get_grandtour_leaderboard(uuid,text)` returns live ranked leaderboard rows.
- All four are security invoker (`security_definer = false`).
- `authenticated_can_execute = true` and `anon_can_execute = false` for all four.

Verify RLS on every gameplay table touched by this workflow:

```sql
select
  n.nspname as schema_name,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relname in (
    'grandtour_competitions',
    'grandtour_tips',
    'grandtour_tip_selections',
    'grandtour_stage_scores',
    'grandtour_leaderboard_snapshots',
    'grandtour_game_audit',
    'grandtour_stages',
    'grand_tours',
    'profiles'
  )
order by c.relname;
```

Every listed table must be present with `rls_enabled = true`. Review the advisor output and stop if any new security finding appears.

### Authenticated authorization verification

Do not use the service role for these checks; it bypasses RLS. Use dedicated, clearly labelled, non-prize production QA users and the normal authenticated frontend/client path.

1. Before lock, member B's comparison query must not return member A's draft or submitted tip.
2. After lock, member B may see member A's submitted eligible tip but must never see a draft.
3. A private-league member can read the league and use the save/submit RPCs before lock.
4. A non-member cannot read private-league tips or write a tip to that league.
5. A dummy QA profile is visibly labelled and has `is_prize_eligible = false` in scores and live leaderboard rows.

Record user IDs, competition ID, stage ID, timestamps, expected result, and actual result without recording passwords or tokens.

## Generate and compare production types safely

Do not pipe generated types directly into the committed file. Generate a temporary file first:

```powershell
$tempTypes = Join-Path $env:TEMP "grandtour-database-production-$stamp.ts"
npx.cmd supabase gen types --linked --lang typescript --schema public |
  Set-Content -Encoding utf8 -LiteralPath $tempTypes

if (-not (Test-Path -LiteralPath $tempTypes) -or (Get-Item -LiteralPath $tempTypes).Length -le 0) {
  throw "Generated type file is missing or empty."
}

git diff --no-index -- .\packages\shared-types\src\database.ts $tempTypes
```

For `git diff --no-index`, exit code `1` means differences were found and must be reviewed; it is not permission to copy automatically. Any unexpected RPC or schema difference is a stop condition.

Only after intentional review and approval:

```powershell
Copy-Item -LiteralPath $tempTypes -Destination .\packages\shared-types\src\database.ts
git diff -- .\packages\shared-types\src\database.ts
git diff --check
npm.cmd run typecheck
npm.cmd test
npm.cmd --workspace apps/mobile run web:build
```

Commit reviewed generated-type changes separately if required. Never conceal an unexpected production schema difference by overwriting the generated file.

## Post-deployment smoke test

Use dedicated, clearly labelled, non-prize production QA accounts and a controlled private smoke competition. Do not deploy or recreate the local E2E accounts.

1. Log in with member A and confirm profile loading.
2. Open an upcoming controlled stage and confirm riders/startlist load.
3. Save a complete draft.
4. Verify status remains `draft`, `submitted_at` is null, and score is zero.
5. Confirm member B cannot see member A's draft.
6. Submit the draft and verify `submitted` plus a server timestamp.
7. Confirm the submitted tip is still hidden from member B before lock.
8. After the server lock, confirm member B sees the submitted tip.
9. Confirm a private-league member can save and submit.
10. Confirm a non-member cannot access or submit to the private league.
11. Confirm incomplete and duplicate Top 5 submissions are rejected.
12. Confirm post-lock save, clear, and submit calls fail with server errors.
13. Finalise controlled results and run `score_grandtour_stage` as an authorised admin.
14. Run recalculation once and verify totals remain identical with one score row per tip.
15. Verify ordered Top 5, daily jerseys, overall jerseys, and score JSON.
16. Verify a clearly labelled dummy QA account is shown as dummy and not prize eligible.
17. Load the live leaderboard for Daily, Preselection, and Overall.
18. Verify rows, totals, ranks, stage counts, dummy labels, and prize eligibility directly reflect the latest authoritative score rows.

Stop the smoke test and initiate containment if authorization, locking, scoring, or privacy differs from the expected result.

## Live leaderboard process and validation

Launch does not require `grandtour_leaderboard_snapshots`. The app calls `get_grandtour_leaderboard(uuid,text)`, which derives Daily, Preselection, and Overall standings from authoritative `grandtour_stage_scores` joined to tips whose lifecycle status is `scored` or `corrected`.

The RPC is read-only, `STABLE`, security-invoker, available only to `authenticated`, and explicitly checks competition access. Database RLS continues to protect scores, tips, and profiles. Draft, missed, voided, and deleted tips are excluded. Overall is calculated as Daily plus Preselection, including final overall-jersey points. Repeated calls do not write rows, so there is no refresh job, duplicate-row risk, or stale snapshot batch.

The existing snapshot table remains available for a future historical/reporting feature, but no production snapshot refresh or manual snapshot insert is part of launch.

Historical pre-migration evidence status: **CANNOT BE COMPLETED BEFORE MIGRATION.** At approval time, migration `20260702055447_live_grandtour_leaderboards.sql` was pending in production, so `get_grandtour_leaderboard(uuid,text)` could not yet be called there. This limitation is superseded by the post-migration evidence recorded below.

Immediate post-migration smoke classification: **MANDATORY AUTHORIZATION TEST.** Use controlled, clearly labelled, non-prize QA accounts. A private-league member must successfully call Daily, Preselection, and Overall; a non-member must receive an access error; drafts must remain excluded; dummy/prize fields must be correct. Do not use the service role because it bypasses RLS.

For an authenticated read-only SQL verification, replace the two placeholders with a controlled private-league member and competition, then run:

```sql
begin read only;
set local role authenticated;
select set_config('request.jwt.claim.sub', '<QA_MEMBER_UUID>', true);
select
  user_id,
  leaderboard_type,
  rank,
  total_score,
  stages_tipped,
  last_stage_score,
  is_dummy,
  is_prize_eligible,
  display_name
from public.get_grandtour_leaderboard(
  '<QA_GRANDTOUR_COMPETITION_UUID>'::uuid,
  'overall'
);
rollback;
```

Validate through a normal authenticated private-league member session, never with the service role:

1. Call `get_grandtour_leaderboard` for `daily`, `preselection`, and `overall`.
2. Confirm one row per scored user and no draft-only user.
3. Confirm Overall totals equal Daily plus Preselection.
4. Confirm a dummy row has `is_dummy = true` and `is_prize_eligible = false`.
5. Repeat the calls and confirm the rows are unchanged when scores are unchanged.
6. Confirm a private-league non-member receives an access error.
7. Correct and rescore one controlled stage, then confirm the next read reflects the corrected totals without any refresh action.

Post-migration private-league leaderboard evidence record:

- Controlled private competition: ______________________
- Member QA user: ______________________________________
- Non-member QA user: __________________________________
- Daily/Preselection/Overall member reads: PASS / FAIL ___
- Non-member blocked: PASS / FAIL _______________________
- Draft-only user excluded: PASS / FAIL _________________
- Overall equals Daily plus Preselection: PASS / FAIL ____
- Dummy label/prize eligibility: PASS / FAIL ____________
- Operator/reviewer/timezone: ___________________________

Pre-migration limitation acceptance wording:

> I acknowledge that the live private-league leaderboard RPC is created by the pending migration and cannot be production-smoke-tested beforehand. I approve migration only on the condition that member access, non-member denial, draft exclusion, all three leaderboard modes, Overall arithmetic, and dummy/prize fields are verified immediately afterward with controlled non-prize QA accounts. Any authorization or privacy mismatch is a stop condition.

- Acceptance approver: `Tony McStay`
- Acceptance timestamp/timezone: `03 Jul 2026 11:21 AEST`
- Status: **ACCEPTED; immediate post-migration smoke test required**

## Rollback and containment

### Frontend rollback procedure

Complete and rehearse this before go-live. Vercel's successful deployment record for the reviewed application commit is:

- Current commit SHA: `9b24d052e1040d9e1ddc6cef5e290b29cf0a00e6`
- Current deployment record: `https://vercel.com/tmcstay-gmailcoms-projects/grandtour/27PshMh47zMCjewwZ5mxXn7M4mX6`

Record the immutable deployment that actually served production successfully before the current release. Do not merely write `main` or a mutable production URL:

- Last known good commit SHA candidate: `6f7c3254d340a617ff27fe79093f40dcdb180bbd`
- Previous known-good Vercel deployment candidate: `https://vercel.com/tmcstay-gmailcoms-projects/grandtour/6dT48C5N8nvW83f8ZFaKj8CS2Qzv`
- Previous deployment evidence: GitHub Vercel status `success` / `Deployment has completed`, updated `2026-07-01T05:51:08Z`; production-domain compatibility and Instant Rollback rehearsal still require operator/reviewer confirmation
- Hosting/deployment target: Vercel project `grandtour`
- Approved rollback method: Vercel Instant Rollback
- Rollback compatibility result: **READ-ONLY COMPATIBLE; TIP ENTRY MUST BE DISABLED**
- Rollback operator: `Tony McStay` (prepared; confirm during final approval)
- Rollback approver: `Tony McStay` (procedure-only acceptance requires final confirmation)
- Evidence of rehearsal: documented/tabletop procedure walkthrough completed at `2026-07-03 11:15:14 +09:30`; no production rollback or domain change was performed
- True Instant Rollback rehearsal: **NOT PERFORMED** because it would mutate production routing
- Procedure-only rehearsal acceptance: **PENDING FINAL APPROVAL REVIEW**
- Rollback approval timestamp/timezone: __________________
- Rollback completion evidence: _________________________

Compatibility inspection of commit `6f7c3254d340a617ff27fe79093f40dcdb180bbd` found:

- Authentication, profile, tour, stage, competition, team, rider, and start-list reads use tables and columns retained by the additive migrations and are expected to remain available.
- Its GrandTour writer directly inserts/updates `grandtour_tips` and `grandtour_tip_selections`, only captures one predicted winner, does not call the canonical atomic RPCs, and does not submit a score-eligible entry. It is not compatible with canonical post-migration tip entry.
- Its leaderboard reads `grandtour_leaderboard_snapshots`, not `get_grandtour_leaderboard`; this path may be empty or stale because snapshots are not refreshed for launch.
- It does not understand the remote kill-switch UI flag. The database trigger will still reject its direct tip writes when `grandtour_tipping_enabled = false`, although the old UI may show controls and then display a server error.
- Therefore any rollback after these migrations must first set `grandtour_tipping_enabled = false`. Treat the old deployment as read-only containment, not as a fully functional tipping release.

Documented Instant Rollback procedure rehearsal:

1. Disable GrandTour tip entry in production and verify `grandtour_tipping_enabled = false` before switching traffic.
2. Open Vercel project `grandtour` -> **Deployments** and filter to production deployments from `main`.
3. Locate deployment `6dT48C5N8nvW83f8ZFaKj8CS2Qzv`; verify commit `6f7c3254d340a617ff27fe79093f40dcdb180bbd` and its prior successful-production evidence.
4. Open the deployment's three-dot menu and select **Instant Rollback**; confirm only after the rollback approver authorises the incident action.
5. Verify the production domain serves the recorded deployment ID and that Vercel reports rollback completion.
6. Smoke-test login, profile, tour, stage, team, rider, competition, and start-list reads. Treat the legacy snapshot leaderboard as non-authoritative and keep tip entry disabled.
7. To undo rollback after a reviewed fix, promote the approved deployment and verify production-domain assignment and smoke tests again.

If application behavior fails after migration:

1. Stop further scoring and result finalisation.
2. Notify the rollback approver and record the incident time.
3. In Vercel, open the `grandtour` project's Deployments page, filter to production deployments from `main`, and locate the recorded previous known-good deployment.
4. Verify its immutable deployment ID/URL and commit SHA against the approved rollback record.
5. Use **Instant Rollback** on that deployment. Do not rebuild from a dirty checkout and do not select an unrecorded preview deployment.
6. Confirm Vercel reports the rollback complete and that the production domain serves the recorded deployment.
7. Smoke test authentication, stage loading, navigation, read-only tip status, comparison, score breakdown, and all three leaderboards.
8. Confirm tip-entry actions are compatible with the migrated schema. If uncertain, disable `grandtour_tipping_enabled` until compatibility is proven.
9. Keep the incident open until RLS, RPC, lock, and data-integrity checks pass.

Smoke-test record after rollback:

- Production deployment ID/URL: _________________________
- Auth login: PASS / FAIL _______________________________
- Stage load/navigation: PASS / FAIL ____________________
- Read-only tips/scores/leaderboards: PASS / FAIL ________
- Tip-entry compatibility or kill switch disabled: ______
- Tested by/date/timezone: ______________________________
- Rollback approver sign-off: ___________________________

Procedure-only rehearsal risk acceptance wording:

> I acknowledge that a true Vercel Instant Rollback rehearsal was not performed because it would alter production routing. I reviewed the immutable rollback target and the documented Vercel steps. I accept the procedure-only rehearsal for this deployment on the condition that GrandTour tip entry is disabled before rollback, the previous release is used only for read-only containment, and the listed authentication and browsing smoke tests are completed immediately after any real rollback.

- Procedure-only acceptance approver: `Tony McStay`
- Acceptance timestamp/timezone: `03 Jul 2026 11:21 AEST`
- Status: **ACCEPTED** — disable GrandTour tipping first, then use the recorded previous Vercel deployment for read-only containment.

### GrandTour tipping kill switch

The remote flag is `public.apps.grandtour_tipping_enabled` for the row whose `code = 'cycling'`. Its default is `true`. Database triggers enforce it for inserts, updates, and deletes on GrandTour tips and selections, so disabled writes fail even from an older client. Read-only stages, existing tips, comparisons, scores, and live leaderboards remain available.

Historical pre-migration evidence status: **CANNOT BE COMPLETED BEFORE MIGRATION.** At approval time, migration `20260702061010_grandtour_tipping_kill_switch.sql` was pending in production, so the column and guard trigger did not yet exist there. This limitation is superseded by the post-migration evidence recorded below.

Immediate post-migration smoke classification: **MANDATORY CONTAINMENT TEST.** Complete the disable/read-only/server-rejection/re-enable sequence below before leaving the deployment window. If any check fails, leave tipping disabled where possible, stop user tip entry, and begin incident containment.

When disabled, the current frontend hides Save Draft, Submit Tips, Clear Tip, and the Overall Jerseys navigation item; rider pickers become read-only and the entry screens show:

> GrandTour tipping is temporarily unavailable while we make updates.

An authorised operator disables entry in Supabase Dashboard SQL Editor with:

```sql
begin;
update public.apps
set grandtour_tipping_enabled = false
where code = 'cycling'
returning code, grandtour_tipping_enabled;
commit;
```

Re-enable entry only after incident approval and smoke testing:

```sql
begin;
update public.apps
set grandtour_tipping_enabled = true
where code = 'cycling'
returning code, grandtour_tipping_enabled;
commit;
```

Verify the remote state read-only:

```sql
select code, is_active, grandtour_tipping_enabled
from public.apps
where code = 'cycling';
```

Disabled verification:

1. Reload or reopen the app so it refetches remote configuration.
2. Confirm stage browsing, existing tip status, comparison, score breakdown, and leaderboards still load.
3. Confirm the Overall Jerseys navigation item is hidden.
4. Confirm stage and overall-jersey entry screens show the temporary-unavailability message and no Save, Submit, or Clear actions.
5. Using a controlled pre-lock QA tip, confirm Save Draft, Submit Tips, and Clear Tip each fail server-side with the same temporary-unavailability message.
6. Set the flag back to `true`, reload the app, and confirm controlled pre-lock tip entry works again.

Post-migration kill-switch evidence record:

- Controlled non-prize QA user/competition: ____________
- Default `true` verified: ______________________________
- Disabled UI/read-only paths: PASS / FAIL ______________
- Server rejected Save/Submit/Clear: PASS / FAIL _________
- Re-enabled and pre-lock write passed: PASS / FAIL ______
- Operator/reviewer/timezone: ___________________________

Pre-migration limitation acceptance wording:

> I acknowledge that the production kill-switch column and trigger are created by the pending migration and therefore cannot be smoke-tested in production beforehand. I approve migration only on the condition that disable, read-only behavior, server rejection, and re-enable are tested immediately afterward with controlled non-prize QA data, and that failure triggers containment rather than continued tip entry.

- Acceptance approver: `Tony McStay`
- Acceptance timestamp/timezone: `03 Jul 2026 11:21 AEST`
- Status: **ACCEPTED; immediate post-migration smoke test required**

### Database rollback boundaries

Reversible through reviewed follow-up work:

- Redeploy the last-known-good frontend after compatibility review.
- Replace RPC definitions or RLS policies with a new corrective migration.
- Revoke RPC execution only through pre-reviewed emergency SQL with a matching restore procedure.

Difficult or effectively irreversible:

- PostgreSQL enum values cannot be cleanly removed without a replacement enum and dependent-column rewrite.
- Audit events and lifecycle history should not be deleted.
- New columns, indexes, constraints, and backfilled bridges should not be casually reversed.
- Score recalculation modifies totals, statuses, score rows, and audit history.
- PITR restoration introduces downtime and may discard writes after the selected restore point.

Prefer a reviewed roll-forward migration. Never edit, delete, or mark an applied migration as repaired during incident response without a separate recovery plan and approval.

## Principal risks

- **Enum additions:** effectively permanent.
- **RLS replacement:** may unexpectedly hide rows or block writes.
- **RPC mismatch:** generated production types and frontend payloads must match exactly.
- **Private leagues:** depend on active app membership, generic competition bridging, and active competition membership.
- **Lock data:** missing or invalid timestamps fail closed; manual locks override timestamps.
- **Score recalculation:** test one controlled stage before any broader operation.
- **Seed deployment:** seed flags would create predictable users and synthetic production data.
- **Live leaderboard:** reads authoritative score rows at request time; monitor query performance as league size grows. Snapshots are not a launch dependency.
- **Feature shutdown:** the remote `grandtour_tipping_enabled` flag is server-enforced; verify both disable and re-enable paths before go-live.
- **Deployment source:** the migrations are committed, but deployment must use a clean checkout of the reviewed and pushed commit; the local-only `supabase/config.toml` E2E change must remain outside the deployment commit.
- **Backup scope:** logical public-schema exports do not replace managed Auth/Storage recovery.

## Final plain-English go/no-go checklist

Proceed only when every answer is yes:

- [ ] Am I linked to `tipping-suite` / `nsdpilmmrfobiapbwona`?
- [ ] Is the exact deployment commit reviewed, recorded, and checked out with a clean worktree?
- [ ] Are all six required migrations tracked and committed?
- [ ] Does linked migration history show exactly the expected six pending migrations?
- [ ] Did CI/deployment automation pass the seed-flag audit?
- [ ] Is a recent managed backup/PITR point recorded?
- [ ] Are all logical backup files outside Git, non-empty, hashed, and securely stored?
- [ ] Has restoration been rehearsed or has the approver formally accepted that risk?
- [ ] Does the reviewed dry run list exactly the expected six files in order?
- [ ] Are `--include-seed` and `--include-all` absent from the production command and all wrappers?
- [ ] Have production lock times and private memberships been checked?
- [ ] Do typecheck, tests, SQL tests, and web export pass on the deployment commit?
- [ ] Is an exact, rehearsed frontend rollback release and workflow recorded?
- [ ] Has the remote tipping kill switch been tested disabled and re-enabled using controlled QA accounts?
- [ ] Does the live leaderboard RPC pass member, non-member, draft-exclusion, correction, dummy, and idempotency checks?
- [ ] Are controlled production QA accounts and a non-prize smoke competition ready?
- [ ] Has the team agreed not to run broad score recalculation during deployment?
- [ ] Have the operator and reviewer signed the mandatory approval gate?

## Read-only preparation evidence — 3 July 2026

Preparation was executed through the verification stage and stopped before backup creation, production dry-run, or any production mutation.

- Evidence timestamp: `2026-07-03 10:34:45 +09:30` (Australia/Adelaide)
- Isolated worktree: `C:\tmp\tipping-suite-prod-9b24d052`
- Deployment commit: `9b24d052e1040d9e1ddc6cef5e290b29cf0a00e6`
- Git state: detached at the deployment commit; clean before and after verification
- `origin/main`: matched the deployment commit after `git fetch origin main`
- Supabase CLI: `2.109.0`
- Linked project: `tipping-suite` / `nsdpilmmrfobiapbwona`
- Linked project health reported by the CLI: `ACTIVE_HEALTHY`
- Local E2E config leak check: PASS; clean `supabase/config.toml` contains no `grandtour_e2e` reference
- Excluded asset check: PASS; `Logo - General.png` and `tour_tips_icon_pack.zip` are absent
- Six migration files tracked check: PASS
- Production migration history: PASS; remote history ends at `20260701053811`, with exactly the following six local-only migrations pending in order:
  1. `20260701081127`
  2. `20260701081334`
  3. `20260702003933`
  4. `20260702003948`
  5. `20260702055447`
  6. `20260702061010`
- TypeScript: PASS (`npm.cmd run typecheck`)
- Core tests: PASS (25 passed, 0 failed)
- Expo web export: PASS (`apps/mobile/dist/index.html` produced)
- `git diff --check`: PASS
- Dependency installation: PASS from the committed lockfile; npm reported 14 moderate dependency advisories, which were not modified or auto-fixed during this preparation
- External production backups: PASS; created and verified outside both Git workspaces
- Backup directory: `C:\Users\Tony\Backups\tipping-suite-production\20260703-103820`
- Backup artifacts:
  - `roles.sql` — 297 bytes — SHA-256 `25873CEC56A2CC6514E204F420231777F85C03DA818CAA7090CDCDFA89776ECD`
  - `schema.sql` — 77,853 bytes — SHA-256 `277480DB4648C17CCD976C25662FB6BE950B7D98BE5A09B4137708ED7E2F78F5`
  - `public-data.sql` — 1,133,338 bytes — SHA-256 `F092CB38C579BECF5DF542BB4BF9EF920AB6EF4040534BBB744328F71C818A09`
  - `migration-history.txt` — 896 bytes — SHA-256 `C33FAE8971B8E781DCD54F47D63DBA6D8258ADFF8204430A11C136D0CA8AE4B6`
- SHA-256 evidence: `C:\Users\Tony\Backups\tipping-suite-production\20260703-103820\sha256.txt` — 582 bytes
- External-path verification: PASS; backup is outside `C:\Users\Tony\Documents\tipping-suite` and `C:\tmp\tipping-suite-prod-9b24d052`
- Managed backup dashboard verification: PASS — latest visible scheduled physical backup is `02 Jul 2026 20:43:58 (+0000)`, verified by Tony McStay
- PITR availability/retention: NOT EVIDENCED; do not describe the scheduled backup evidence as PITR
- Storage limitation acknowledged: Storage objects are not included in database backups
- Production migration dry-run: **PASS** — exactly six expected migrations in order; evidence saved externally; zero seed/reset indicators
- `supabase db push --linked`: **RAN ONCE AFTER APPROVAL**; all six expected migrations applied. Do not run it again.
- Restore-risk operator: `Tony McStay`
- Restore-risk approver: `Tony McStay`

The restore rehearsal, residual-risk acceptance, production dry run, rollback-procedure acceptance, pre-migration limitation acceptances, and final operator/reviewer approval were completed before the production write. The operator subsequently reported that the exact single approved command completed; the post-migration migration-history check below independently confirms that all six expected versions are now applied. Do not run `db push` again.

## Historical 3 July deployment verdict

The production migration is **APPLIED AND VERIFIED**. GrandTour tip entry is enabled. Current production data has no private league, scored leaderboard rows, or dummy profile, so those data-dependent smoke assertions remain unexercised and must be completed before promoting those paths to users.

- [x] The isolated worktree at `9b24d052e1040d9e1ddc6cef5e290b29cf0a00e6` is created, verified clean, and linked to exactly `nsdpilmmrfobiapbwona` without copying the local E2E config or unrelated assets.
- [x] A visible managed scheduled physical backup and verified external logical backup are recorded. Storage objects are explicitly outside database-backup scope.
- [x] A partial disposable local restore rehearsal is recorded, and Tony McStay accepted the residual restore risk at `03 Jul 2026 11:02 AEST`.
- [x] The previous Vercel target, compatibility limits, kill-switch pairing, and procedure-only rollback rehearsal are documented and accepted by Tony McStay at `03 Jul 2026 11:21 AEST`.
- [x] The production dry run is saved and mechanically verified as exactly the six expected migrations in order with zero seed/reset indicators.
- [x] The mandatory production write approval gate is completed by operator and reviewer Tony McStay at `03 Jul 2026 11:21 AEST` for exactly `npx.cmd supabase db push --linked`.

### Final approval review after signatures — 3 July 2026 11:21 AEST

1. **PASS** — project ref is exactly `nsdpilmmrfobiapbwona`.
2. **PASS** — project name is exactly `tipping-suite`.
3. **PASS** — deployment commit SHA is exactly `9b24d052e1040d9e1ddc6cef5e290b29cf0a00e6`.
4. **PASS** — reviewed Vercel deployment remains successful.
5. **PASS** — isolated deployment worktree remains clean.
6. **PASS** — all six migrations are tracked and committed.
7. **PASS** — linked production history shows exactly the six expected pending migrations.
8. **PASS** — saved dry-run evidence shows exactly those six migrations in order.
9. **PASS** — seed/reset scan is clean.
10. **PASS** — external backup artifacts exist and are non-empty.
11. **PASS** — backup SHA-256 evidence is recorded and verified.
12. **PASS** — managed scheduled physical-backup evidence is recorded; PITR is not claimed.
13. **PASS** — partial restore rehearsal and residual-risk acceptance are recorded.
14. **PASS** — previous rollback target is recorded.
15. **PASS** — procedure-only Vercel rollback rehearsal is explicitly accepted.
16. **PASS** — kill-switch pre-migration limitation is explicitly accepted, with immediate post-migration smoke testing required.
17. **PASS** — live-leaderboard pre-migration limitation is explicitly accepted, with immediate post-migration smoke testing required.
18. **PASS** — rollback after migration requires disabling GrandTour tipping before switching production traffic.
19. **PASS** — operator and reviewer/approver have signed the production-write approval with timestamp and timezone.
20. **PASS** — the exact approved command is `npx.cmd supabase db push --linked`, with no additional flags or seeds and stop-on-first-error handling.

Historical final approval decision: **SAFE TO RUN THE SINGLE PRODUCTION MIGRATION COMMAND** from `C:\tmp\tipping-suite-prod-9b24d052` only. That command subsequently ran once and must not be run again.

## Post-migration execution and verification — 3 July 2026

Verification completed at `03 Jul 2026 12:09 AEST` from the clean deployment worktree `C:\tmp\tipping-suite-prod-9b24d052` at commit `9b24d052e1040d9e1ddc6cef5e290b29cf0a00e6`, linked to `tipping-suite` / `nsdpilmmrfobiapbwona`.

### Migration outcome

- Operator-reported production command outcome: all six expected migrations applied.
- Independent migration-history verification: **PASS** — all six versions appear in both Local and Remote columns, in order, with no additional pending migration.
- Migration-history evidence: `C:\Users\Tony\Backups\tipping-suite-production\20260703-103820\post-migration-list.txt`
- CLI warning after the migration: `failed to cache migrations catalog` because `pgdelta-target-ca.crt` was missing.
- Warning disposition: **NON-BLOCKING CLI CATALOG-CACHE WARNING**. Migration history, RPC catalog, RLS catalog, kill-switch state, and live RPC execution all verify successfully. Do not rerun `db push` to address this warning.
- `supabase db push --linked` rerun: **PROHIBITED / NOT RUN DURING VERIFICATION**.

### Database verification

- `supabase db lint --linked --schema public --level warning --fail-on error`: **PASS** — no schema errors found.
- Lint evidence: `C:\Users\Tony\Backups\tipping-suite-production\20260703-103820\post-migration-db-lint.txt`
- `supabase db advisors --linked --type security --level info --fail-on error`: **PASS AT ERROR THRESHOLD** — no error-level finding.
- Advisor evidence: `C:\Users\Tony\Backups\tipping-suite-production\20260703-103820\post-migration-security-advisors.txt`
- Non-blocking advisor follow-ups: INFO notices for RLS-enabled dormant tables without policies (`ad_placements`, `chat_messages`, `chat_zones`, `results`, `subscriptions`, `system_posts`, and legacy `tips`), plus WARN that Auth leaked-password protection is disabled. These are not findings on the canonical GrandTour gameplay tables but should be triaged separately.
- Catalog verification: **PASS** — the four expected RPC signatures and return types are present; all are security invoker; `authenticated` can execute; `anon` cannot execute.
- RLS verification: **PASS** — RLS is enabled on all nine checklist gameplay tables, including the correctly named `grand_tours` table.
- Catalog and RLS evidence: `C:\Users\Tony\Backups\tipping-suite-production\20260703-103820\post-migration-catalog-verification.json`

### Kill-switch smoke result

- Initial `cycling` app flag: `true`.
- Disable operation: **PASS** — flag returned `false`.
- Server enforcement: **PASS** — authenticated `save_grandtour_tip_draft`, `submit_grandtour_tip`, and `clear_grandtour_tip_draft` each returned exactly `GrandTour tipping is temporarily unavailable while we make updates.`
- Test-data containment: **PASS** — the complete Stage 2 smoke draft existed only inside a transaction and rolled back to zero rows; the pre-existing Stage 1 draft remained present and unchanged.
- Re-enable operation: **PASS** — flag returned `true`.
- Re-enabled write: **PASS** — authenticated Save Draft returned a tip ID inside a rollback-only transaction.
- Final state: **PASS** — `grandtour_tipping_enabled = true`, the Stage 2 smoke row count is zero, and the original Stage 1 draft count is one.
- UI read-only/hidden-action observation: **NOT EXECUTED** — no authenticated production browser session was available. Server enforcement, the safety-critical boundary, passed. Complete the UI observation during the next controlled authenticated production session.
- Evidence:
  - `C:\Users\Tony\Backups\tipping-suite-production\20260703-103820\post-migration-kill-switch-disabled.json`
  - `C:\Users\Tony\Backups\tipping-suite-production\20260703-103820\post-migration-kill-switch-server-rejection.txt`
  - `C:\Users\Tony\Backups\tipping-suite-production\20260703-103820\post-migration-kill-switch-rollback-verification.txt`
  - `C:\Users\Tony\Backups\tipping-suite-production\20260703-103820\post-migration-kill-switch-enabled.json`
  - `C:\Users\Tony\Backups\tipping-suite-production\20260703-103820\post-migration-kill-switch-reenabled-write.txt`
  - `C:\Users\Tony\Backups\tipping-suite-production\20260703-103820\post-migration-kill-switch-final-state.txt`

### Live leaderboard smoke result

- Current production fixture inventory: one public GrandTour competition, one active real cycling user, one draft, zero scores, zero private competition memberships, and zero dummy profiles.
- Authenticated public-competition access for Daily, Preselection, and Overall: **PASS** — each call completed and returned an empty set, as expected with zero scores.
- Draft exclusion: **PASS** — the authenticated user has one draft while the leaderboard returned zero rows; the function definition also restricts inputs to tips with `scored` or `corrected` status.
- Repeated-read consistency: **PASS** — repeated Overall reads were identical.
- Unauthorised identity rejection: **PASS** — returned `GrandTour competition access is required.`
- Security-invoker status and live rank/dummy/prize projections: **PASS BY CATALOG/FUNCTION DEFINITION**.
- Private-league member access: **NOT EXECUTED** — production has no private GrandTour competition or active private membership.
- Private-league non-member rejection: **NOT EXECUTED AGAINST A PRIVATE LEAGUE** — generic unauthorised access rejection passed against the public competition, but this does not replace the private-league policy test.
- Runtime dummy label / prize eligibility and score totals: **NOT EXECUTED** — production has no dummy profile or score row. No dummy/test data was inserted to manufacture evidence.
- Evidence:
  - `C:\Users\Tony\Backups\tipping-suite-production\20260703-103820\post-migration-qa-inventory.json`
  - `C:\Users\Tony\Backups\tipping-suite-production\20260703-103820\post-migration-leaderboard-member-smoke.json`
  - `C:\Users\Tony\Backups\tipping-suite-production\20260703-103820\post-migration-leaderboard-nonmember-smoke.txt`
  - `C:\Users\Tony\Backups\tipping-suite-production\20260703-103820\post-migration-leaderboard-definition.txt`

### Production types and application verification

- Temporary generated types: `C:\Users\Tony\AppData\Local\Temp\grandtour-database-production-20260703-post-migration.ts` (`63,409` bytes).
- Committed `packages/shared-types/src/database.ts` overwritten: **NO**.
- Production type diff: **REVIEWED** — one metadata-only hunk adds `__InternalSupabase.PostgrestVersion = "14.5"`; no schema, RPC, or application type-shape difference.
- Type diff evidence: `C:\Users\Tony\Backups\tipping-suite-production\20260703-103820\post-migration-production-types.diff`
- TypeScript: **PASS**.
- Core tests: **PASS** — 25 passed, 0 failed.
- Expo web export: **PASS**.
- Evidence:
  - `C:\Users\Tony\Backups\tipping-suite-production\20260703-103820\post-migration-typecheck.txt`
  - `C:\Users\Tony\Backups\tipping-suite-production\20260703-103820\post-migration-tests.txt`
  - `C:\Users\Tony\Backups\tipping-suite-production\20260703-103820\post-migration-web-export.txt`
  - `C:\Users\Tony\Backups\tipping-suite-production\20260703-103820\post-migration-sha256.txt`

### Post-migration containment decision

- Production GrandTour tip entry final state: **ENABLED**.
- Immediate containment required: **NO** — migration/catalog checks, server-side kill switch enforcement, re-enable write, typecheck, tests, and web export passed.
- Safe to keep the currently deployed public competition live: **YES, WITH MONITORING**.
- Remaining operational follow-ups:
  1. Complete authenticated production UI observation for disabled read-only state and hidden Save/Submit/Clear actions.
  2. Before enabling or promoting a private league, create approved non-prize QA membership data and verify private member access plus private non-member rejection.
  3. Before dummy/prize-bearing leaderboard rows are relied upon, verify runtime dummy labelling, prize ineligibility, totals, and rank using approved controlled data.
  4. Triage the unrelated security-advisor INFO/WARN findings separately; do not change schema during this verification window.

## Operator summary and 24–48 hour watch

### What changed

- Six additive GrandTour migrations introduced the canonical draft/submission lifecycle, atomic tipping RPCs, server-side locking and RLS hardening, lifecycle statuses, live score-derived leaderboards, and the remote GrandTour tip-entry kill switch.
- The deployed frontend uses the canonical RPC workflow and the live leaderboard path.
- No production seed, reset, local E2E fixture, persistent smoke-test data, or broad score recalculation was used.

### What passed

- Migration history, schema lint, RPC signatures and grants, security-invoker status, gameplay-table RLS, and the final enabled kill-switch state.
- Server-side kill-switch rejection for Save Draft, Submit, and Clear; rollback-only write success after re-enable; no smoke rows persisted.
- Authenticated public leaderboard access, unauthorised-user rejection, draft exclusion, and repeat-read consistency.
- Production type comparison, TypeScript, 25 core tests, and Expo web export.
- Evidence is stored outside Git at `C:\Users\Tony\Backups\tipping-suite-production\20260703-103820` with `post-migration-sha256.txt`.

### What was not verified

These are non-blocking follow-up QA items, not evidence of a current failure:

1. Authenticated production UI behavior while the kill switch is disabled: read-only browsing remains available, entry routes/actions are hidden or disabled, and the maintenance message is visible.
2. Private-league member access and private-league non-member rejection after an approved production private league and controlled non-prize QA memberships exist.
3. Runtime dummy labelling, prize ineligibility, ranks, and totals after approved dummy/scored data exists.

Do not create production test data solely to close these items without separate approval.

### Monitor for 24–48 hours

- [ ] Authentication/login and profile-loading failures.
- [ ] Stage, rider, start-list, lock-time, tip-status, score-breakdown, and leaderboard load failures.
- [ ] Elevated Supabase API/Postgres or Vercel errors involving `save_grandtour_tip_draft`, `submit_grandtour_tip`, `clear_grandtour_tip_draft`, or `get_grandtour_leaderboard`.
- [ ] Save/Submit/Clear failures before a valid server lock, or any successful write at/after lock.
- [ ] Drafts appearing to another user or any private-competition access anomaly.
- [ ] Submitted tips unexpectedly remaining drafts, missing server timestamps, or scoring before submission.
- [ ] Unexpected maintenance messages while `grandtour_tipping_enabled = true`.
- [ ] Live leaderboard latency, inconsistent repeated reads, incorrect Daily/Preselection/Overall totals, or duplicate rows.
- [ ] Any dummy profile shown without a dummy label or with prize eligibility.
- [ ] Confirm the external evidence directory remains intact, outside Git, and unmodified.

### First response if an issue appears

1. **Disable GrandTour tip entry first** using the reviewed kill-switch procedure in this checklist, then verify `grandtour_tipping_enabled = false`. Keep stage, result, score, and leaderboard reads available.
2. Record the time, affected user/competition/stage IDs, request ID, observed error, Vercel deployment, and relevant Supabase logs without recording passwords, tokens, or secrets.
3. Do not rerun migrations, `db push`, seeds, reset commands, or broad score recalculation as an incident response.
4. If the issue is frontend-only, keep tipping disabled and use the recorded Vercel rollback target for read-only containment after approval.
5. If authorization, privacy, locking, or data integrity is uncertain, leave tipping disabled and escalate for a reviewed corrective migration or recovery plan. Do not perform ad hoc production SQL repairs.
6. Re-enable tipping only after the cause is understood, the fix or containment is approved, and disable/read-only/server-rejection/re-enable smoke tests pass.

### Final deployment record

- Status: **PRODUCTION SAFE TO KEEP LIVE WITH MONITORING**.
- Containment action currently required: **NO**.
- GrandTour tipping: **ENABLED**.
- Applied migrations: **ALL SIX EXPECTED MIGRATIONS**.
- `pgdelta-target-ca.crt` catalog-cache warning: **NON-BLOCKING**, because linked migration history and catalog verification passed.
- Evidence directory: `C:\Users\Tony\Backups\tipping-suite-production\20260703-103820`.
