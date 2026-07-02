# GrandTour Production Deployment Checklist

> **NO-GO by default.** This document is a reviewed command plan, not authority to deploy. Do not run the production write command until every mandatory gate below is complete and both the operator and reviewer approve it.

## Production target confirmation

Read-only verification on 2 July 2026 confirmed:

- Project name: `tipping-suite`
- Project ref: `nsdpilmmrfobiapbwona`
- Region: `ap-southeast-1`
- Status: `ACTIVE_HEALTHY`
- PostgreSQL: `17.6.1.127`
- Dashboard: <https://supabase.com/dashboard/project/nsdpilmmrfobiapbwona>

At that verification point, production migration history ended at `20260701053811` and exactly four migrations were pending. This is time-sensitive information; verify it again immediately before deployment.

The current worktree is dirty and the four canonical migrations are untracked. Production remains **NO-GO** until the deployment commit is clean, reviewed, and has passed CI.

## Required migration order

Production must receive these files in this exact order:

1. `20260701081127_canonical_grandtour_tipping_workflow.sql`
2. `20260701081334_canonical_grandtour_tipping_rpcs_rls.sql`
3. `20260702003933_add_grandtour_tip_lifecycle_statuses.sql`
4. `20260702003948_harden_grandtour_tip_lifecycle.sql`

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

Both `supabase/seed.sql` and `supabase/seeds/grandtour_e2e.sql` are local development fixtures and must not be deployed. The E2E fixture contains predictable test passwords, two test users, one dummy user, and synthetic competitions, leagues, memberships, riders, tips, results, and scores. The four canonical migrations contain none of those fixture identifiers.

The documented production command does not include seeds. Do not add a seed flag manually and do not use a wrapper, alias, CI job, or deployment script that appends one.

Before deployment, audit automation and review every match from this command:

```powershell
rg -n --hidden --glob '!node_modules/**' --glob '!docs/**' -- "--include-seed|--include-all|grandtour_e2e\.sql|supabase db reset" .
```

Expected local seed configuration references are not proof of a problem. Any CI, release, hosting, or production script match is a stop condition until reviewed. Record confirmation that production automation cannot append `--include-seed` or `--include-all`.

## Pre-deployment control

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

### 2. Confirm all four migration files are tracked

```powershell
git ls-files --error-unmatch -- `
  supabase/migrations/20260701081127_canonical_grandtour_tipping_workflow.sql `
  supabase/migrations/20260701081334_canonical_grandtour_tipping_rpcs_rls.sql `
  supabase/migrations/20260702003933_add_grandtour_tip_lifecycle_statuses.sql `
  supabase/migrations/20260702003948_harden_grandtour_tip_lifecycle.sql
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

The remote column must be blank for exactly the four required migrations and no others. Save the output with the deployment record.

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

- Latest recoverable timestamp: _________________________
- Retention/PITR window: ________________________________
- Person who verified it: _______________________________

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
Get-FileHash -Algorithm SHA256 -LiteralPath $expectedBackupFiles
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

- Rehearsal environment/ref: ____________________________
- Rehearsal date: _______________________________________
- Result/evidence location: _____________________________
- Reviewer: _____________________________________________

A failed or unperformed rehearsal requires explicit risk acceptance from the deployment approver. A verified managed backup/PITR point remains mandatory regardless.

## Production dry run

The dry run is read-only but still requires the verified production link:

```powershell
$dryRunFile = Join-Path $backupDir "db-push-dry-run.txt"
npx.cmd supabase db push --linked --dry-run 2>&1 | Tee-Object -FilePath $dryRunFile
if ($LASTEXITCODE -ne 0) { throw "Production migration dry run failed." }
```

The operator and reviewer must inspect the complete output. It must list exactly these four files, in order, and no seed operation:

1. `20260701081127_canonical_grandtour_tipping_workflow.sql`
2. `20260701081334_canonical_grandtour_tipping_rpcs_rls.sql`
3. `20260702003933_add_grandtour_tip_lifecycle_statuses.sql`
4. `20260702003948_harden_grandtour_tip_lifecycle.sql`

Any additional, missing, reordered, repaired, or seed-related operation is a stop condition.

## Mandatory approval gate before the production write

The following fields must be completed immediately before deployment:

- [ ] Project ref is exactly `nsdpilmmrfobiapbwona`.
- [ ] Project name is exactly `tipping-suite`.
- [ ] The deployment commit SHA matches the reviewed commit.
- [ ] The worktree is clean.
- [ ] All four migration files are tracked and committed.
- [ ] Remote history shows exactly the four expected pending migrations.
- [ ] Dry-run output shows exactly those four migrations in order.
- [ ] No command, alias, wrapper, or automation contains `--include-seed` or `--include-all`.
- [ ] Every backup artifact exists and has a non-zero size.
- [ ] Backup hashes and managed restore point are recorded.
- [ ] Leaderboard snapshot refresh is confirmed.
- [ ] Last-known-good frontend rollback is confirmed.
- [ ] GrandTour tipping kill switch is implemented and tested, or absence has formal go-live risk acceptance.

Approval record:

- Operator: _____________________________________________
- Reviewer/approver: ___________________________________
- Deployment commit SHA: _______________________________
- Backup directory: ____________________________________
- Dry-run evidence: ____________________________________
- Approval timestamp and timezone: ______________________

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

Migration history must show all four versions in both local and remote columns. Save all output with the deployment record.

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
    'clear_grandtour_tip_draft'
  )
order by p.proname, p.oid::regprocedure::text;
```

Expected:

- `save_grandtour_tip_draft(uuid,uuid,grandtour_tip_mode,grandtour_tip_scope,jsonb,text)` returns `uuid`.
- `submit_grandtour_tip(uuid,text)` returns `grandtour_tips`.
- `clear_grandtour_tip_draft(uuid,text,text)` returns `boolean`.
- All three are security invoker (`security_definer = false`).
- `authenticated_can_execute = true` and `anon_can_execute = false` for all three.

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
    'grandtour_tours',
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
5. A dummy QA profile is visibly labelled and has `is_prize_eligible = false` in scores and snapshots.

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
17. Refresh leaderboard snapshots using the separately approved process below.
18. Verify Daily, Preselection, and Overall rows, totals, and ranks.

Stop the smoke test and initiate containment if authorization, locking, scoring, or privacy differs from the expected result.

## Leaderboard snapshot refresh and validation

The repository currently has a `grandtour_leaderboard_snapshots` table and read queries, but no repository-owned refresh function, RPC, scheduled job, or documented admin builder. Test SQL inserts fixture snapshots directly; that is not a production refresh process.

Therefore, leaderboard go-live is **blocked** until one of the following is implemented and reviewed:

- An idempotent, authorised database/admin refresh function with auditability; or
- A documented external/admin process that deterministically rebuilds all three leaderboard types.

Do not manually insert production snapshots by copying the test fixture. The approved process must define its command or admin action, owner, authorization, retry behavior, and correction behavior here before deployment:

- Refresh command/admin action: _________________________
- Authorised operator role: _____________________________
- Process owner: ________________________________________
- Evidence of staging rehearsal: ________________________

After refresh, run this read-only validation:

```sql
select
  competition_id,
  leaderboard_type,
  count(*) as row_count,
  count(distinct user_id) as distinct_users,
  min(rank) as best_rank,
  max(rank) as worst_rank,
  max(snapshot_at) as latest_snapshot_at
from public.grandtour_leaderboard_snapshots
group by competition_id, leaderboard_type
order by competition_id, leaderboard_type;

select count(*) as dummy_eligibility_mismatches
from public.grandtour_leaderboard_snapshots s
join public.profiles p on p.id = s.user_id
where s.is_dummy <> p.is_dummy
   or s.is_prize_eligible <> (not p.is_dummy);
```

For the controlled competition, all expected types must exist, each user must have no more than one current row per leaderboard type, snapshot timestamps must match the refresh, and `dummy_eligibility_mismatches` must be zero.

## Rollback and containment

### Frontend rollback procedure

Complete and rehearse this before go-live:

- Last known good commit SHA: ___________________________
- Last known good tag/release ID: _______________________
- Hosting/deployment target: ____________________________
- Exact approved redeploy command or CI workflow: _______
- Rollback approver: ____________________________________
- Rollback operator: ____________________________________
- Evidence of staging rehearsal: ________________________

If application behavior fails after migration:

1. Stop further scoring, result finalisation, and leaderboard refreshes.
2. Notify the rollback approver and record the incident time.
3. Redeploy the recorded immutable last-known-good release using the recorded CI workflow or command. Do not deploy from a dirty local checkout.
4. Confirm the deployed release/commit identifier.
5. Smoke test authentication, stage loading, navigation, and previously supported read paths.
6. Confirm the old frontend does not issue incompatible writes against the migrated schema.
7. Keep the incident open until RLS, RPC, lock, and data-integrity checks pass.

The exact redeploy workflow cannot be inferred safely from this repository and must be filled in before approval.

### GrandTour tipping kill switch

No dedicated GrandTour tipping kill switch currently exists. The existing `allow_daily` and `allow_preselection` competition fields are business-mode controls, not a complete emergency feature flag, and must not be treated as one.

Before go-live, implement and test a formal server-controlled or deployment-controlled flag that:

- Removes or disables GrandTour tip-entry actions in the frontend.
- Shows a clear temporary-unavailability message.
- Does not weaken database RLS or lock enforcement.
- Can be enabled without rebuilding from an unreviewed source tree.
- Has a named owner, audited activation procedure, and rollback test.

Until that exists, frontend rollback is the only UI containment method and the missing kill switch remains a formal go-live blocker unless the accountable approver explicitly accepts the risk in writing.

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
- **Leaderboard snapshots:** no confirmed refresh process currently exists.
- **Feature shutdown:** no dedicated GrandTour tipping kill switch currently exists.
- **Deployment source:** the current dirty worktree and untracked migrations cannot be deployed.
- **Backup scope:** logical public-schema exports do not replace managed Auth/Storage recovery.

## Final plain-English go/no-go checklist

Proceed only when every answer is yes:

- [ ] Am I linked to `tipping-suite` / `nsdpilmmrfobiapbwona`?
- [ ] Is the exact deployment commit reviewed, recorded, and checked out with a clean worktree?
- [ ] Are all four canonical migrations tracked and committed?
- [ ] Does linked migration history show exactly the expected four pending migrations?
- [ ] Did CI/deployment automation pass the seed-flag audit?
- [ ] Is a recent managed backup/PITR point recorded?
- [ ] Are all logical backup files outside Git, non-empty, hashed, and securely stored?
- [ ] Has restoration been rehearsed or has the approver formally accepted that risk?
- [ ] Does the reviewed dry run list exactly the expected four files in order?
- [ ] Are `--include-seed` and `--include-all` absent from the production command and all wrappers?
- [ ] Have production lock times and private memberships been checked?
- [ ] Do typecheck, tests, SQL tests, and web export pass on the deployment commit?
- [ ] Is an exact, rehearsed frontend rollback release and workflow recorded?
- [ ] Is the tipping kill switch implemented and tested, or is its absence formally accepted?
- [ ] Is a reviewed leaderboard snapshot-refresh process implemented and rehearsed?
- [ ] Are controlled production QA accounts and a non-prize smoke competition ready?
- [ ] Has the team agreed not to run broad score recalculation during deployment?
- [ ] Have the operator and reviewer signed the mandatory approval gate?

## Current verdict

Production deployment and full go-live remain **NO-GO** until all of the following are resolved:

1. The dirty worktree is committed, reviewed, and clean, including all four migration files.
2. A managed restore point and verified external logical backup are recorded.
3. The leaderboard snapshot-refresh process is implemented, documented, and rehearsed.
4. The exact frontend rollback release and redeployment workflow are recorded and rehearsed.
5. A GrandTour tipping kill switch is implemented and tested, or its absence receives explicit written risk acceptance.
6. The mandatory production write approval gate is completed by both operator and reviewer.
