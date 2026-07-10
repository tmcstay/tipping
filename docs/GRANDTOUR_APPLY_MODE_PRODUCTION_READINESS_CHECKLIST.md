# GrandTour official-letour apply-mode production-readiness checklist

> **NO-GO by default.** This document is a reviewed command plan for the
> *first* controlled production use of `--apply`, not authority to run it.
> Do not run the production apply command until every mandatory gate below
> is complete and both the operator and a reviewer approve the exact
> command and its `--reason`/`--request-id`. This checklist does not
> authorize any production action by itself.

This checklist covers the full stage lifecycle: `apply_grandtour_official_stage_result`
(`scripts/grandtour-feed-import.mjs --apply`, §1–§13), then
`finalize_grandtour_stage_result` and `recalculate_grandtour_stage_scores`
(§14). It assumes familiarity with:

- [docs/grandtour-results-feed.md](grandtour-results-feed.md) — CLI usage,
  the "Applying an official result" section, and the "Known-safe operator
  sequence" already rehearsed end-to-end against local Supabase.
- [docs/grandtour-apply-mode-spec.md](grandtour-apply-mode-spec.md) — the
  full design, especially §14 (payload contract), §15/§16 (implementation
  record), and §13 (Phase 0 grant/trigger verification).
- [docs/GRANDTOUR_PRODUCTION_DEPLOYMENT_CHECKLIST.md](GRANDTOUR_PRODUCTION_DEPLOYMENT_CHECKLIST.md) —
  the general production deployment process this checklist reuses
  conventions from (project identity, backup commands, migration
  confirmation via `supabase migration list --linked`).

As of this checklist, apply mode has been rehearsed **only against local
Supabase**. It has never been run against production. This document exists
so that the *first* production run is preceded by the same rigor as any
other production database change in this repo, not more improvised.

## 0. Preconditions this checklist assumes

- The migration `supabase/migrations/20260709020000_grandtour_apply_official_stage_result_rpc.sql`
  is part of a **reviewed, merged** commit before this checklist is
  relevant — this checklist does not cover code/migration review, only the
  operational sequence for *using* apply mode once that migration is
  already live in production (see §2).
- No GitHub Actions workflow calls `--apply` — confirmed unchanged in
  `.github/workflows/grandtour-daily-feed-dry-run.yml` (no
  `SUPABASE_SERVICE_ROLE_KEY`, no `--apply` anywhere in that file). If this
  is ever no longer true, stop and treat it as a P0 finding before
  proceeding with anything below.

## 1. Fresh production database backup

Before the first production apply, take a fresh backup — do not rely on a
scheduled backup that predates this checklist. Reuse the exact commands
from `docs/GRANDTOUR_PRODUCTION_DEPLOYMENT_CHECKLIST.md`'s backup section:

1. In Supabase Dashboard, open **Database -> Backups** and record the
   latest recoverable backup/PITR restore point timestamp.
2. Take a fresh logical dump (roles, schema, and public data) to a
   destination **outside the git workspace**, e.g.:
   ```powershell
   $backupRoot = Join-Path $env:USERPROFILE "Backups\tipping-suite-production"
   $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
   $backupDir = Join-Path $backupRoot "apply-mode-first-use-$stamp"
   New-Item -ItemType Directory -Path $backupDir -Force | Out-Null

   npx.cmd supabase db dump --linked --role-only --file "$backupDir\roles.sql"
   npx.cmd supabase db dump --linked --schema public --file "$backupDir\schema.sql"
   npx.cmd supabase db dump --linked --schema public --data-only --use-copy --file "$backupDir\public-data.sql"
   npx.cmd supabase migration list --linked | Out-File -Encoding utf8 "$backupDir\migration-history.txt"
   ```
3. Verify every artifact is non-empty and readable before proceeding
   (matching the "Verify every backup artifact" step in the general
   deployment checklist).
4. Because apply mode's blast radius is narrow (§12 below), a **targeted**
   pre-apply snapshot of just the affected stage is also cheap and worth
   taking in addition to the full backup:
   ```powershell
   npx.cmd supabase db dump --linked --schema public --data-only --use-copy `
     -x "select * from grandtour_stage_results where stage_id = '<STAGE_UUID>'" `
     --file "$backupDir\stage-<N>-pre-apply.sql"
   ```
   (Adjust to whatever ad hoc export mechanism is actually available at
   apply time — the point is: know exactly what `grandtour_stage_results`/
   `grandtour_stage_result_lines` looked like for this stage immediately
   before running `--apply`, so rollback in §11 doesn't depend solely on
   the full backup.)

## 2. Confirm deployed migrations, including the apply RPC migration

```powershell
npx.cmd supabase migration list --linked
```

Confirm:

- The remote column is **not blank** for
  `20260709020000_grandtour_apply_official_stage_result_rpc.sql` — i.e. it
  is actually applied to production. If it is missing, **stop** — apply
  mode is not deployed; this is a deployment task, not an apply-mode
  readiness task, and is out of scope for this checklist.
- No migration after that one is pending/unapplied that this checklist
  hasn't been reviewed against (re-review this checklist if the schema has
  moved since it was written).
- Independently confirm the grant this migration adds is actually live
  (mirrors the local Phase 0 verification in spec §13.2 — this checklist
  does not re-derive that finding, only re-confirms it applies to
  production too):
  ```sql
  select grantee, privilege_type
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name in ('grandtour_feed_import_runs', 'grandtour_feed_snapshots')
    and grantee = 'service_role';
  ```
  Expect `SELECT`, `INSERT`, `UPDATE`, `DELETE` all present for
  `service_role` on both tables. If any are missing, **stop** — the audit
  trail the RPC writes to would silently fail mid-transaction (the RPC's
  whole point is atomicity, but a missing grant here means the *entire*
  apply transaction fails, not that it applies without an audit row — safe,
  but confirm this ahead of time rather than discovering it live).

## 3. Service-role key handling

- Obtain the production `SUPABASE_SERVICE_ROLE_KEY` from the same secure
  source used for other production operations in this repo (never commit
  it, never put it in `EXPO_PUBLIC_*`, never paste it into a shared channel
  in plaintext).
- Set it **only** in the current shell's environment for the duration of
  the apply command, not as a persistent environment variable:
  ```powershell
  $env:SUPABASE_URL = "https://nsdpilmmrfobiapbwona.supabase.co"
  $env:SUPABASE_SERVICE_ROLE_KEY = "<paste at the prompt, not in a script file>"
  ```
- After the apply session is complete, clear it from the shell:
  ```powershell
  Remove-Item Env:\SUPABASE_SERVICE_ROLE_KEY
  ```
- Confirm you have **not** set `SUPABASE_ANON_KEY`/`EXPO_PUBLIC_SUPABASE_ANON_KEY`
  in the same shell in a way that could be confused with the service-role
  key — `runApply` only ever reads `SUPABASE_SERVICE_ROLE_KEY`, and
  additionally decodes its JWT `role` claim and refuses to proceed unless
  it reads exactly `service_role` (spec §15.2), but avoiding the confusion
  in the first place is still good practice.
- Never place the service-role key in a file inside the repository
  checkout, including `tmp/`.

## 4. Production URL confirmation

- Confirm `$env:SUPABASE_URL` resolves to `nsdpilmmrfobiapbwona.supabase.co`
  — the same project ref documented in
  `docs/GRANDTOUR_PRODUCTION_DEPLOYMENT_CHECKLIST.md` ("Production target
  confirmation") — by echoing it back before running anything:
  ```powershell
  $env:SUPABASE_URL
  ```
- This project ref is also what `scripts/grandtour-apply.mjs`'s
  `KNOWN_PRODUCTION_PROJECT_REFS` checks against
  (`isProductionSupabaseUrl`) — the CLI itself will refuse to run without
  `--confirm-production` if this URL is used, as an independent check on
  top of this manual confirmation step. Do not treat the CLI's check as a
  substitute for this manual one, or vice versa — both must independently
  agree this is intentional.
- Explicitly state out loud / in the operator log which environment you
  believe you are targeting, before running any command in §7.

## 5. Report generation

Generate a fresh dry-run + reconciliation report **against production
Supabase** (reconciliation only ever reads, via the anon key — see
`docs/grandtour-results-feed.md`'s "Reconciliation dry run" section):

```bash
npm run grandtour:feed:dry-run -- --provider official-letour \
  --from-stage <N> --to-stage <N> --reconcile \
  --report C:\tmp\grandtour-stage-<N>-prod-review.json
```

Requires `SUPABASE_URL` (production) and `SUPABASE_ANON_KEY`
(production's public anon key — never the service-role key for this step).
This step does not write anything; it is safe to re-run as many times as
needed while `parserDriftDetected`/`safeToApply` issues are worked through.

**Do not reuse a report generated against local or staging Supabase for a
production apply.** `stageId` and every `matchedRiders[].riderId` are real
production UUIDs only when the report was generated against production —
using a non-production report's UUIDs against production would either fail
outright (stage/rider not found) or, in the worst case of colliding UUIDs
across environments, apply against the wrong row. Always regenerate the
report against the same environment you are about to apply to.

## 6. Report review checklist (read the file yourself before proceeding)

Read `C:\tmp\grandtour-stage-<N>-prod-review.json` and confirm every one of
these before doing anything in §7 — this is the same list already rehearsed
locally in `docs/grandtour-results-feed.md`'s "Known-safe operator
sequence," repeated here for the production context:

- [ ] `provider` is `"official-letour"`
- [ ] `dryRun: true`, `applyEnabled: false`
- [ ] `parserDriftDetected: false`
- [ ] `importStatus` is `"validated"` or `"review_required"` (never
      `"failed"`/`"skipped"`)
- [ ] `reconciliation.overallSafeToApply: true`
- [ ] `reconciliation.stages[0].safeToApply: true` and `.blockers` is `[]`
- [ ] `reconciliation.stages[0].startlistValidationPassed: true`
- [ ] `reconciliation.stages[0].isTtt: false`, and `.stageType` is not
      `team_time_trial`/`ttt`
- [ ] `reconciliation.stages[0].unmatchedRiders`, `.ambiguousRiders`,
      `.unmatchedTeams`, `.ambiguousTeams`, and `.duplicateBibConflicts`
      are all `[]`
- [ ] `reconciliation.stages[0].stageId` is present and looks like a real
      UUID
- [ ] `reconciliation.stages[0].parsedRiders` contains true official
      positions 1–10, each exactly once, no gaps, no duplicates
- [ ] `stageFetchMetadata` has an entry for stage `<N>` with
      `status: "ok"`
- [ ] `fetchedAt` is recent (apply refuses anything older than 6 hours —
      don't let review/approval turnaround itself invalidate the report;
      regenerate if it goes stale)
- [ ] The riders in `parsedRiders` positions 1–10, read by a human, actually
      look like a plausible stage result (sanity-check names/order against
      an independent source — official-letour parsing correctness is not
      fully provable by the report's own fields alone)

If **any** box is unchecked, do not proceed to §7. See §13 ("do not
proceed") for what each specific failure means and what to do instead.

## 7. Exact apply command

Only after every box in §6 is checked, §1–§4 are complete, and a second
person has reviewed the same report and the exact command below:

```bash
node scripts/grandtour-feed-import.mjs --apply \
  --provider official-letour \
  --from-report "C:\tmp\grandtour-stage-<N>-prod-review.json" \
  --confirm-provider official-letour \
  --confirm-stage <N> \
  --confirm-production \
  --reason "<name/role>: first production apply, stage <N>, approved by <reviewer>" \
  --request-id "prod-apply-stage-<N>-<yyyyMMdd-HHmmss>" \
  --report "C:\tmp\grandtour-stage-<N>-prod-apply-outcome.json"
```

All seven flags are required together for a production apply:

| Flag | Why |
| --- | --- |
| `--apply` | Enters apply mode at all. |
| `--from-report <path>` | The exact reviewed report from §5/§6 — never regenerated or edited between review and apply. |
| `--confirm-provider official-letour` | Must match `--provider official-letour` exactly; a typo'd or mismatched value refuses before any Supabase connection. |
| `--confirm-stage <N>` | Must match the report's single stage number exactly; prevents applying the wrong stage from a stale/renamed file. |
| `--confirm-production` | Required specifically because `SUPABASE_URL` resolves to the known production project ref (§4) — omitting it is a hard refusal, not a warning. |
| `--reason <text>` | Human-readable audit text, stored in `grandtour_feed_import_runs.summary.reason` — write who is running this and why/which approval it has. |
| `--request-id <id>` | Correlates this specific run in logs/audit rows — use a value that is unique and traceable back to this checklist run (e.g. includes a timestamp). |

Do not add `--force` (its behavior is explicitly undecided/unwired — spec
§8) or any flag not listed here.

## 8. Expected success output

The command prints the full outcome JSON and a one-line summary, then exits
`0`. Expect:

```json
{
  "outcome": {
    "status": "applied",
    "exitCode": 0,
    "message": "Applied: stage_result_id=<uuid> import_run_id=<uuid> line_count=10."
  }
}
```

`rpcResponse.data.line_count` must read `10`. Record `stage_result_id` and
`import_run_id` from this output immediately — they are needed for §10 and
§11.

If the command instead throws and exits non-zero, **do not retry
immediately** — read the error message (it is the RPC's own specific
`raise exception` text or a local validation failure, both self-describing
per spec §14.6) and treat it as a stop condition; see §13.

## 9. Idempotency re-run check

Immediately re-run the **exact same command** from §7 (same report file,
same flags, same `--request-id` value is fine — it's not used for
idempotency, only audit correlation):

```json
{
  "outcome": {
    "status": "no_change",
    "exitCode": 0,
    "message": "No changes: stage <stage_id> already has this exact result applied (stage_result_id=<uuid>, line_count=10)."
  }
}
```

`no_change` and exit `0` confirms the apply is idempotent and that
re-running it (e.g. if the operator is unsure whether the first run
completed) is safe. It must **not** create a second
`grandtour_feed_import_runs` row — confirm via §10's queries.

## 10. Post-apply verification queries

Run these read-only queries against production (safe with the anon key for
`is_final`-gated tables once true, but these rows are still drafts — use
the service-role key, or a read-only production console/dashboard query
tool) immediately after §8 and again after §9:

```sql
-- Exactly one draft result for this stage.
select id, stage_id, is_final
from public.grandtour_stage_results
where stage_id = '<STAGE_UUID>';
-- expect: 1 row, is_final = false

-- Exactly 10 lines, in ascending position order, matching the report's rider order.
select actual_position, rider_id
from public.grandtour_stage_result_lines
where stage_result_id = '<STAGE_RESULT_UUID>'
order by actual_position;
-- expect: 10 rows, actual_position 1..10 (or the true gapped positions from the report), no duplicates

-- Zero jersey holders written by this apply.
select count(*) from public.grandtour_stage_jersey_holders where stage_id = '<STAGE_UUID>';
-- expect: 0 (or unchanged from pre-apply count if jersey holders exist for other reasons)

-- Zero team result lines written by this apply.
select count(*) from public.grandtour_stage_team_result_lines where stage_result_id = '<STAGE_RESULT_UUID>';
-- expect: 0

-- No score rows were created or touched for this stage (confirms no scoring function ran).
select count(*) from public.grandtour_stage_scores where stage_id = '<STAGE_UUID>';
-- expect: unchanged from the pre-apply count (0 if this is the first-ever result for the stage)

-- Exactly one audit run for this apply (not two, after the idempotent re-run in §9).
select id, mode, import_status, provider_name, reason, request_id
from public.grandtour_feed_import_runs
where id = '<IMPORT_RUN_UUID>';
-- expect: 1 row, mode = 'apply', import_status = 'applied'

select count(*) from public.grandtour_feed_snapshots where import_run_id = '<IMPORT_RUN_UUID>';
-- expect: 1
```

Record the query output (or a screenshot) alongside this checklist run for
the audit trail.

## 11. Rollback/cleanup plan for draft result rows

Apply mode only ever writes a **draft** (`is_final: false`) result. This
significantly limits rollback scope compared to a finalized result (no
scores, no jersey holders, no team lines, no user-facing leaderboard
impact — see §12). Two rollback scenarios:

**A. The applied result is simply wrong (bad source data, wrong stage,
etc.) and needs to be removed entirely**, before anyone finalizes or scores
it:

```sql
-- Deletes the draft result and cascades to its lines (grandtour_stage_result_lines
-- has ON DELETE CASCADE on stage_result_id). Requires an authenticated admin
-- session (RLS: "Admins can manage GrandTour stage results") or the
-- service-role key — never the anon key.
delete from public.grandtour_stage_results where id = '<STAGE_RESULT_UUID>';

-- Optional: remove the audit trail for a fully-aborted attempt (keep this
-- only if the audit trail should not reflect the mistaken apply at all;
-- more commonly, leave the audit rows in place as an honest record and
-- rely on grandtour_game_audit's automatic old_value/new_value trail
-- instead of deleting them).
delete from public.grandtour_feed_snapshots where import_run_id = '<IMPORT_RUN_UUID>';
delete from public.grandtour_feed_import_runs where id = '<IMPORT_RUN_UUID>';
```

Then confirm with the same §10 queries that all counts are back to their
pre-apply values.

**B. The applied result needs to be corrected (right stage, wrong
riders/positions)**: v1 apply mode has no correction workflow — re-running
apply with a different report against an existing differing draft is
**refused** by design (spec §6/§7.3), not silently overwritten. To correct
a draft result in production today, use the existing manual/admin path
(the "Admins can manage GrandTour stage results" RLS policy already
supports authenticated-admin direct edits to `grandtour_stage_results`/
`grandtour_stage_result_lines`, the same mechanism that predates apply mode
entirely) — **not** a second apply-mode invocation. If this becomes a
recurring need, that is a signal to build the §7.3/§7.4 correction
workflow the spec already flagged as deferred, not to work around the
refusal.

**If a restore from the §1 backup is ever needed** (e.g. broader damage
suspected beyond just this stage's result), follow the restore process in
`docs/GRANDTOUR_PRODUCTION_DEPLOYMENT_CHECKLIST.md` — this checklist's
targeted row-level cleanup above should be sufficient for anything apply
mode alone could have caused, since it never touches any table this
checklist hasn't already enumerated.

## 12. What must not happen (as part of *apply* specifically)

`apply_grandtour_official_stage_result` itself is structurally incapable of
the following — confirmed by the RPC's own code and by real end-to-end
local rehearsal (spec §15/§16), not just by convention. Finalization and
scoring are not permanently out of scope for this pipeline — they are
separate, later, explicitly-gated steps covered in §14 — but neither may
ever happen *as a side effect of apply itself*:

- **Scoring**: `apply_grandtour_official_stage_result` never calls
  `public.recalculate_grandtour_stage_scores`, and never will — scoring
  only ever runs as its own explicit §14 step, against an already-final
  result. §10's `grandtour_stage_scores` count check must read 0
  immediately after apply.
- **Finalization**: `p_finalize` is always hardcoded `false` by the CLI and
  is never exposed as a flag on the apply path; the RPC additionally
  refuses outright if a caller ever passed `p_finalize: true`.
  `grandtour_stage_results.is_final` must read `false` immediately after
  every apply (§10) — it only ever becomes `true` via the separate,
  explicit §14 finalize step.
- **Jersey holders are written by apply, but only the 4 reviewed ones**:
  unlike the original apply-only design, `apply_grandtour_official_stage_result`
  now also upserts the reconciled `grandtour_stage_jersey_holders` rows
  (yellow/green/kom/white) from `p_jersey_holders`, as part of the same
  reviewed report (see §6/§7 — the report's `jerseyHolders` block is
  reviewed exactly like `matchedRiders`). §10's jersey-holder query should
  show exactly 4 rows matching the reviewed report after apply, not 0 and
  not more than 4.
- **TTT apply**: the RPC independently re-derives `stage_type` from
  `grandtour_stages` (never trusting the report) and refuses any stage
  whose type is `team_time_trial`/`ttt`, regardless of what the report
  claims. §6's `isTtt`/`stageType` review checks are defense-in-depth on
  top of this, not the only protection.

If any post-apply check in §10 shows a team result line, score row, or
`is_final: true` — or a jersey-holder count that isn't exactly 4 and
doesn't match the reviewed report — **stop immediately**, do not run any
further commands, and treat it as a critical incident requiring the
restore path in §11, not a "try again" situation. (This should be
impossible per the code review above; if it happens, the RPC itself has a
bug, not just this specific apply run.)

## 13. Do not proceed if any of the following are true

These map directly to §6's review checklist — restated here as explicit
stop conditions with what to do instead:

| Condition | What it means | What to do |
| --- | --- | --- |
| `parserDriftDetected: true` | The letour.fr page markup likely changed; the parsed data may be systematically wrong, not just missing a few riders. | Do not apply. Investigate the parser (`scripts/grandtour-feed-provider.mjs`'s `table_not_found`/`parse_empty` classification) before trusting any report from this run. |
| `reconciliation.safeToApply: false` (or `overallSafeToApply: false`) | One or more of the sub-checks below failed; `.blockers` names exactly which. | Do not apply. Read `.blockers`, fix the underlying cause, regenerate the report. |
| `startlistValidationPassed: false` | A matched rider isn't on `grandtour_stage_startlists` for this stage (or the startlist itself is empty). | Do not apply. Confirm the production startlist is correct/current for this stage before retrying — this may indicate stale/missing startlist data, not a parser problem. |
| `stageType: team_time_trial` (or `"ttt"`, or `isTtt: true`) | TTT stages are never safe to apply in v1 — no official team-result source is confirmed yet. | Do not apply, ever, for this stage, regardless of how clean everything else looks. This is not a "fix and retry" condition. |
| Fewer than 10 valid parsed riders (or any duplicate/gapped positions in 1–10) | v1 policy is top-10-only (spec §14.1/§16); this stage cannot be applied by this tool as-is. | Do not apply. If the stage genuinely has fewer than 10 official finishers, this is a real product-policy gap (see spec §16.3's "intentionally not changed" list) — escalate rather than work around it. |
| Any `unmatchedRiders`/`ambiguousRiders`/`unmatchedTeams`/`ambiguousTeams`/`duplicateBibConflicts` non-empty | At least one rider/team in the source data can't be confidently identified against production `grandtour_riders`/`grandtour_teams`. | Do not apply. This usually means production rider/team data needs a correction (e.g. via `scripts/import-tdf-2026.mjs`) before this stage can be applied — fix the data, regenerate the report, re-review. |
| `stageId` missing/not a UUID | The reviewed report doesn't carry a resolvable production stage row — either the stage doesn't exist yet in production, or the report was generated against the wrong environment. | Do not apply. Confirm the stage exists in production `grandtour_stages` and that the report in hand was generated against production (§5's warning), not local/staging. |

## 14. Admin review, finalization, and scoring (separate, later steps)

Apply (§7) only ever writes a **draft** result
(`review_status = 'imported'`, `source_mode = 'official_feed'`). Nothing in
§1–§13 admin-checks, finalizes, or scores anything. The full lifecycle for
one stage is:

```
dry-run (--reconcile)  ->  apply (result + jerseys, as draft)  ->  verify counts (§10)
  ->  admin checks result  ->  admin finalises stage  ->  verify (is_final=true)
  ->  score stage  ->  verify leaderboard  ->  only then continue to the next stage
```

Treat admin-check, finalize, and score as their own separately-approved
actions — do not run them in the same sitting as apply without a fresh
review, even though the commands below are safe to queue up once §10's
post-apply verification is clean. **Do not start the next stage's dry-run
until this stage's leaderboard has been verified** — working stages
strictly in order keeps the audit trail (§14.4) and any manual-entry
decisions (§14.5) easy to reason about.

### 14.0 Program path (recommended): `scripts/grandtour-admin-stage.mjs`

Hand-running the SQL in §14.1–§14.3 still works and is documented in full
below for reference/debugging, but the **recommended path** is the CLI —
it resolves the stage UUID from `--grand-tour-name`/`--grand-tour-year`/
`--stage` instead of requiring a pasted UUID, re-validates every gate the
RPCs themselves enforce *before* calling them (so a bad precondition fails
with a clear message instead of a raw Postgres error), and prints the RPC
response plus a full verification summary after every command — enough to
paste directly into a handoff without a manual follow-up query.

It never writes to any table directly; every mutation still goes through
`mark_grandtour_stage_result_checked`, `finalize_grandtour_stage_result`,
or `recalculate_grandtour_stage_scores` — it does not replace §14.5's
not-yet-built manual-entry path, and it does not run apply (§7).

**Commands:**

| Flag | Calls |
|---|---|
| `--mark-checked` | `mark_grandtour_stage_result_checked` |
| `--finalise` (alias `--finalize`) | `finalize_grandtour_stage_result` |
| `--score` | `recalculate_grandtour_stage_scores` |
| `--check-finalise-score` (alias `--check-finalize-score`) | All three in sequence, each with its own fresh preflight run immediately before its own RPC call |

**Required arguments:** `--stage <n>`, `--admin-user <uuid>`.
**Optional:** `--grand-tour-name` (default `"Tour de France"`),
`--grand-tour-year` (default `2026`), `--note`, `--reason`,
`--request-id` (a stable timestamped one is generated per phase
otherwise), `--recalculate` (required to re-run `--score` once the stage
already has score rows — see §14.3), `--confirm-production` (required for
any write against a known production `SUPABASE_URL`, same convention as
`--apply`).

**Credentials, by command:**

- `--mark-checked` / `--finalise`: `SUPABASE_URL` +
  `SUPABASE_SERVICE_ROLE_KEY` — same service-role convention as `--apply`,
  since both RPCs are `service_role`-only and take an explicit
  `p_checked_by`/`p_finalized_by`.
- `--score`: `SUPABASE_URL` + `SUPABASE_ANON_KEY` +
  `SUPABASE_ADMIN_EMAIL` + `SUPABASE_ADMIN_PASSWORD`. `recalculate_grandtour_stage_scores`
  is `security invoker` and checks `auth.uid()` directly — it cannot be
  called with the service-role key. The CLI signs in as
  `SUPABASE_ADMIN_EMAIL`/`SUPABASE_ADMIN_PASSWORD` and **refuses to
  proceed unless the resulting session's user id matches `--admin-user`
  exactly**, so the audit trail's checked-by/finalised-by/acting-scorer
  identities can never silently diverge from the caller's stated identity.
- `--check-finalise-score`: both credential sets above. All required
  credentials are validated up front, before any RPC is called, so a
  missing/invalid `--score` credential is caught before mark-checked and
  finalise have already run.

The service-role client and the authenticated-admin client are never
reused for each other's purpose.

**Idempotency behaviour** (matches the underlying RPCs, not weakened):

- `--mark-checked` on an already-`admin_checked` stage: allowed, re-runs
  (refreshes the check note/timestamp) rather than refusing.
- `--finalise` on an already-`finalised` stage: allowed, the RPC itself
  returns `{"status": "no_change", ...}`.
- `--score` on a stage that already has score rows: **refused** unless
  `--recalculate` is also passed.

**Example — full chain for one stage, production:**

```powershell
$env:SUPABASE_URL = "<production-url>"
$env:SUPABASE_SERVICE_ROLE_KEY = "<service-role-key>"
$env:SUPABASE_ANON_KEY = "<anon-key>"
$env:SUPABASE_ADMIN_EMAIL = "<real-admin-email>"
$env:SUPABASE_ADMIN_PASSWORD = "<real-admin-password>"

node scripts/grandtour-admin-stage.mjs --check-finalise-score `
  --stage 4 `
  --admin-user <ADMIN_USER_UUID> `
  --confirm-production `
  --note "cross-checked top 10 and all 4 jerseys against letour.fr" `
  --reason "stage 4 admin review, approved by <reviewer>"
```

Run `node scripts/grandtour-admin-stage.mjs --help` for the full option
list. §14.1–§14.3 below remain the reference for what each RPC does and
its manual-SQL equivalent, whichever path is used.

### 14.0.1 UI path: admin app screen (`/admin/grandtour-stages`)

A third way to run the same three-step review workflow, for operators who
prefer the actual app (deployed via Vercel, see `docs/deployment.md`) over
the CLI or hand-run SQL. Same RPCs, same gates, no service-role key
involved at all — the Vercel build only ever receives
`EXPO_PUBLIC_SUPABASE_URL`/`EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.

**Requires `20260710060000_grandtour_admin_check_finalise_authenticated_grants.sql`
to be pushed to production first** (not yet pushed as of this note — see
CLAUDE.md's Production state). Before that migration is live,
`mark_grandtour_stage_result_checked`/`finalize_grandtour_stage_result` are
still `service_role`-only in production, and the Mark Checked/Finalise
buttons will fail with a permission-denied error (Score already worked
without it, since `recalculate_grandtour_stage_scores` was already
`authenticated`-granted). That migration also fixes a real pre-existing
bug in `grandtour_private.is_cycling_admin()` (it returned SQL NULL instead
of false for non-admins, silently disabling every `if not is_cycling_admin()
then raise` guard, including the one `recalculate_grandtour_stage_scores`
already had) — see the migration's own comments and CLAUDE.md's Postgres
gotchas for the full story.

**Route:** `/admin/grandtour-stages` (file:
`apps/mobile/app/admin/grandtour-stages.tsx`). Reachable from Profile ("More")
→ "GrandTour stage review (admin)", which only appears once
`useGrandTourAdminAccess()` confirms the signed-in user holds an active
`admin` role on the `cycling` app (`public.apps`/`public.user_app_memberships`,
read via normal RLS with the app's own publishable/anon key — never a
service-role key). Visiting the route directly without that role shows an
"Admin access required" message and no controls or stage data render.

**Per-stage summary** (`packages/supabase-client/src/grandtourAdmin.ts`,
`listGrandTourStageAdminSummaries`): stage number, stage result id,
`is_final`, `review_status`, result line count, jersey holder count, score
count, and the four score-award totals. Computed from four separate,
un-joined per-table queries (`grandtour_stage_results`,
`grandtour_stage_result_lines`, `grandtour_stage_jersey_holders`,
`grandtour_stage_scores`) aggregated client-side — the same
no-join-multiplication approach as §14.0's CLI `fetchStageState`, batched
across the whole race in one round trip per table instead of one round
trip per stage.

**Buttons:** Mark Checked / Finalise / Score, gated exactly as specified —
Mark Checked needs 10 lines + 4 jerseys + not final + zero scores; Finalise
needs `review_status = admin_checked` + not final + zero scores; Score
needs `review_status = finalised` + `is_final = true`. `p_checked_by`/
`p_finalized_by` are always the signed-in user's own id (`auth.uid()` via
the session `useAuth()` already holds) — there is no free-text admin-id
field to get wrong. Each button click calls its RPC, shows the raw RPC
response plus a readable message (or the thrown error, verbatim, in red),
and immediately refetches the whole stage list so the summary and button
gating never lag behind what the RPC actually did.

**Stage 5 UI smoke test** (per current production state: stage 5 already
has 10 result lines + 4 jersey holders loaded from apply, still
draft/unscored):

1. Sign in to the app as a user with an active `admin` role on the
   `cycling` app.
2. Open Profile → "GrandTour stage review (admin)" (or navigate directly to
   `/admin/grandtour-stages`).
3. Find the Stage 5 card. Confirm: `is_final = false`, `review_status` is
   not yet `admin_checked`, Result lines = 10, Jersey holders = 4, Score
   rows = 0. The **Mark Checked** button should be enabled; **Finalise**
   and **Score** should be disabled.
4. Click **Mark Checked**. Confirm the success message and raw RPC result
   appear, then confirm the refreshed card shows `review_status =
   admin_checked`. **Finalise** should now be enabled.
5. Click **Finalise**. Confirm the success message/raw result, then confirm
   the refreshed card shows `is_final = true` and `review_status =
   finalised`. **Score** should now be enabled; **Mark Checked** and
   **Finalise** should now be disabled.
6. Click **Score**. Confirm the success message/raw result (the RPC's
   return value is the count of tips scored), then confirm the refreshed
   card shows Score rows `> 0` for any stage with real submitted tips (`0`
   only if genuinely no tips were submitted for stage 5).
7. If any step's RPC call fails, the card shows the thrown error message in
   place of the success message and the summary still refetches — confirm
   the error is legible and the stage's `review_status`/`is_final` did not
   silently advance.

### 14.1 Admin check: `public.mark_grandtour_stage_result_checked`

Added by `supabase/migrations/20260710020000_grandtour_stage_result_review_workflow_schema.sql`
(schema: `grandtour_stage_results.review_status`/`admin_checked_*` columns,
`public.grandtour_result_audit_log`) and
`supabase/migrations/20260710030000_grandtour_admin_review_workflow_rpc.sql`
(the RPC itself). `security definer`, `service_role`-only. Sets
`review_status = 'admin_checked'` and records `admin_checked_at`/
`admin_checked_by`/`admin_check_note` — nothing else. Required before
finalize will accept the stage (§14.2). Refuses unless:

- a draft/imported result exists for the stage (apply, or a manual entry —
  §14.5 — must have run first),
- the stage is not TTT,
- the result has **exactly 10** result lines,
- the result has **exactly 4** jersey holders (yellow, green, kom, white).

Logs one `admin_checked` row to `public.grandtour_result_audit_log`. This
is the point in the workflow where a human actually reads the reviewed
report/data and confirms it looks right — `p_note` should record what was
checked (e.g. "cross-checked top 10 and all 4 jerseys against letour.fr
directly").

**Program path (§14.0):**

```powershell
node scripts/grandtour-admin-stage.mjs --mark-checked --stage <N> --admin-user <ADMIN_USER_UUID> --confirm-production --note "<what you checked>"
```

**Exact manual-SQL command** (production, service-role key — same
key-handling practice as §3; `p_checked_by` must be the real
`auth.users.id` of the approving admin, since
`grandtour_stage_results.admin_checked_by` is foreign-keyed to it):

```sql
select public.mark_grandtour_stage_result_checked(
  '<STAGE_UUID>'::uuid,
  '<ADMIN_USER_UUID>'::uuid,
  '<what you checked, e.g. cross-checked top 10 and all 4 jerseys against letour.fr>',
  'check-stage-<N>-<yyyyMMdd-HHmmss>'
);
```

**Expected output**: `{"status": "checked", "stage_id": "...",
"stage_result_id": "...", "review_status": "admin_checked"}`.

**Post-check verification**:

```sql
select review_status, admin_checked_at, admin_checked_by, admin_check_note
from public.grandtour_stage_results where stage_id = '<STAGE_UUID>';
-- expect: review_status = 'admin_checked', the other three populated

select action, changed_by, reason, created_at from public.grandtour_result_audit_log
where stage_id = '<STAGE_UUID>' and action = 'admin_checked'
order by created_at desc limit 1;
-- expect: exactly one row, changed_by/reason matching what you passed above
```

### 14.2 Finalize: `public.finalize_grandtour_stage_result`

Redesigned by `supabase/migrations/20260710030000_grandtour_admin_review_workflow_rpc.sql`
(the original single-gate version from `20260710010000_grandtour_finalize_stage_result_rpc.sql`
has been replaced — its 3-arg signature no longer exists). `security
definer`, `service_role`-only. Sets `grandtour_stage_results.is_final =
true` and `review_status = 'finalised'` — nothing else. Refuses unless:

- a draft result exists for the stage,
- the stage is not TTT,
- **`review_status = 'admin_checked'`** (§14.1 must have run first — this
  is the new gate; finalize no longer accepts a merely-imported result),
- the result still has **exactly 10** result lines,
- the result still has **exactly 4** jersey holders,
- no `grandtour_stage_scores` rows already exist for the stage.

Re-finalizing an already-final result returns `{"status": "no_change", ...}`
rather than erroring. Logs one `finalised` row to
`public.grandtour_result_audit_log` (the pre-existing
`grandtour_stage_results_audit` trigger also independently logs the same
transition to `public.grandtour_game_audit` with `action =
'result_finalised'` — both exist, for different purposes; see the schema
migration's comments).

**Before finalizing**, re-run §14.1's post-check verification fresh and
confirm `review_status = 'admin_checked'` still holds (no one has since
edited the draft).

**Program path (§14.0):**

```powershell
node scripts/grandtour-admin-stage.mjs --finalise --stage <N> --admin-user <ADMIN_USER_UUID> --confirm-production --reason "<name/role>: finalize stage <N>, approved by <reviewer>"
```

**Exact manual-SQL command** (production, service-role key;
`p_finalized_by` must also be a real `auth.users.id`):

```sql
select public.finalize_grandtour_stage_result(
  '<STAGE_UUID>'::uuid,
  '<ADMIN_USER_UUID>'::uuid,
  '<name/role>: finalize stage <N>, approved by <reviewer>',
  'finalize-stage-<N>-<yyyyMMdd-HHmmss>'
);
```

Run via `npx.cmd supabase db query --linked` (or an equivalent
service-role-authenticated connection) — never via the anon/publishable
key, and never via the Supabase Studio SQL editor's default connection
unless it's confirmed to run as a role with the `service_role` grant.

**Expected output**: `{"status": "finalized", "stage_id": "...",
"stage_result_id": "...", "is_final": true, "review_status": "finalised"}`
on first run, or `{"status": "no_change", ...}` on a harmless re-run.

**Post-finalize verification**:

```sql
select is_final, review_status, finalised_at, finalised_by, finalisation_reason
from public.grandtour_stage_results where stage_id = '<STAGE_UUID>';
-- expect: is_final = true, review_status = 'finalised', other three populated

select count(*) from public.grandtour_stage_result_lines lines
join public.grandtour_stage_results results on results.id = lines.stage_result_id
where results.stage_id = '<STAGE_UUID>';
-- expect: 10 (unchanged from before finalize)

select count(*) from public.grandtour_stage_jersey_holders where stage_id = '<STAGE_UUID>';
-- expect: 4 (unchanged from before finalize)

select count(*) from public.grandtour_stage_scores where stage_id = '<STAGE_UUID>';
-- expect: 0 (finalize itself never scores)

select action, changed_by, reason, request_id, created_at from public.grandtour_result_audit_log
where stage_id = '<STAGE_UUID>' and action = 'finalised'
order by created_at desc limit 1;
-- expect: exactly one row, changed_by/reason/request_id matching what you passed above
```

### 14.3 Score: `public.recalculate_grandtour_stage_scores`

This RPC already existed (`20260703041335_implement_grandtour_ttt_scoring.sql`)
— this checklist does not change it. Two things make it different from
every other command in this document:

- It is `security invoker`, not `security definer`, and it explicitly
  requires `grandtour_private.is_cycling_admin() = true` — which checks
  `auth.uid()` against `user_app_memberships` for the `cycling` app. **The
  service-role key alone is not sufficient** — `auth.uid()` is null under a
  plain service-role call, so `is_cycling_admin()` evaluates false and the
  RPC raises `'GrandTour administrator access is required.'`. It must be
  called as an authenticated user who holds `role = 'admin'` on the
  `cycling` app, not via the same service-role connection used for apply/
  finalize.
- It is idempotent by design for *re-scoring* an already-final stage
  (`score_action` distinguishes `score_calculated` vs
  `score_recalculated`) — this is expected and fine to re-run if a
  correction is needed later, unlike apply/finalize's stricter refusal
  conventions.

**Program path (§14.0)** — this is the CLI's main reason for existing: it
signs in as `SUPABASE_ADMIN_EMAIL`/`SUPABASE_ADMIN_PASSWORD` to get a real
authenticated cycling-admin session (never the service-role key), and
refuses to proceed unless that session's user id matches `--admin-user`:

```powershell
node scripts/grandtour-admin-stage.mjs --score --stage <N> --admin-user <ADMIN_USER_UUID> --confirm-production --reason "<name/role>: score stage <N> after finalization, approved by <reviewer>"
```

Add `--recalculate` to intentionally re-run scoring for a stage that
already has score rows — otherwise `--score` refuses rather than silently
rescoring.

**Exact manual-SQL command** (production, run as an authenticated
cycling-admin user — e.g. through the app's own admin session, not a raw
service-role connection):

```sql
select public.recalculate_grandtour_stage_scores(
  '<STAGE_UUID>'::uuid,
  '<name/role>: score stage <N> after finalization, approved by <reviewer>',
  'score-stage-<N>-<yyyyMMdd-HHmmss>'
);
```

**Expected output**: an integer — the number of tips (re)scored. `0` is a
valid result if no tips were submitted for this stage; it is not itself an
error, but is worth double-checking against expectations for a real
production stage with real user tips.

**Post-score verification**:

```sql
select count(*) from public.grandtour_stage_scores where stage_id = '<STAGE_UUID>';
-- expect: > 0 for a real stage with submitted tips (0 only if none were submitted)

select tip_mode, top5_score, jersey_score, bonus_score, total_score
from public.grandtour_stage_scores where stage_id = '<STAGE_UUID>' limit 5;
-- spot-check a handful of rows look sane (scores within the documented
-- 0-50/0-100 canonical ranges — see grandtour_stage_scores_canonical_breakdown_check)
```

Scoring's own audit trail lives in the pre-existing `public.grandtour_game_audit`
(`action = 'score_calculated'` or `'score_recalculated'`) —
`recalculate_grandtour_stage_scores` was not modified by this workflow and
does not write to the newer `public.grandtour_result_audit_log`.
(`'scored'` is a reserved value in that table's action list for possible
future use, currently unwritten.)

```sql
select action, reason, request_id, created_at from public.grandtour_game_audit
where stage_id = '<STAGE_UUID>' and action in ('score_calculated', 'score_recalculated')
order by created_at desc limit 1;
```

If scoring must ever be undone, there is no dedicated "unscore" RPC —
deleting `grandtour_stage_scores` rows directly (service-role or a
sufficiently-privileged admin) and re-running `recalculate_grandtour_stage_scores`
is the closest existing path; treat this as its own reviewed action, not
covered further by this checklist.

### 14.4 Verify leaderboard, then move to the next stage

Before touching the next stage's dry-run, confirm the just-scored stage is
correctly reflected wherever the app surfaces standings (leaderboard views,
`grandtour_leaderboard_snapshots` if applicable to this competition). At
minimum:

```sql
select count(*) from public.grandtour_stage_scores where stage_id = '<STAGE_UUID>';
-- re-confirm the same count as the post-score verification above (nothing
-- else should have changed it in between)

select tip.user_id, score.total_score
from public.grandtour_stage_scores score
join public.grandtour_tips tip on tip.id = score.tip_id
where score.stage_id = '<STAGE_UUID>'
order by score.total_score desc
limit 10;
-- spot-check the top of the stage leaderboard looks plausible
```

Only once this looks right should the operator move on to the next stage's
`--reconcile` dry-run (§5).

### 14.5 Manual result entry — designed, not implemented

**No manual result entry RPC exists yet.** This section documents the
intended contract for one, per product requirement #2 ("admins can
manually correct or enter stage results and jersey holders when the
official feed fails, days are skipped, or testing is needed") — it is
deliberately not implemented in this pass, since no existing admin UI/RPC
convention for ad hoc result entry exists in this codebase to build on, and
a from-scratch write path into production result tables deserves its own
dedicated review rather than being bundled into this workflow's schema
change. `public.grand_tours.manual_result_entry_enabled` (default `false`)
and `public.set_grandtour_manual_result_entry_enabled(...)` (§14.6) already
exist and are usable today as the gate a future manual-entry RPC would
check — enabling the flag alone does nothing yet, since nothing reads it.

Intended contract for a future `manual_upsert_grandtour_stage_result`-style
RPC, for whoever picks this up:

- Require `manual_result_entry_enabled = true` for the stage's grand tour
  (re-check via `set_grandtour_manual_result_entry_enabled`, §14.6) —
  refuse otherwise with a clear "manual entry is disabled for this grand
  tour" message.
- `service_role`-only, same grant pattern as every other RPC here.
- Refuse if the existing result (if any) is already final — a final result
  must go through an explicit "unfinalise" step first (not designed here;
  `'unfinalised'` is already reserved in `grandtour_result_audit_log`'s
  action list for when that's built).
- Require exactly 10 result lines and exactly 4 jersey holders for a
  normal (non-TTT, non-cancelled) stage — same counts §14.1/§14.2 already
  enforce — **unless** the stage is explicitly marked
  cancelled/neutralised/no-result (a stage-level concept that does not
  exist in the schema yet either, and would need its own addition if this
  is built).
- Write `manual_result_created` (first write for a stage) or
  `manual_result_updated`/`jersey_holder_updated` (subsequent edits) to
  `grandtour_result_audit_log`, with `before_payload`/`after_payload`
  capturing the full result-line/jersey-holder sets, not just a diff —
  matching this workflow's existing audit rows.
- Set `source_mode = 'manual_admin'` (or `'mixed'` if some rows came from
  the feed and others were hand-corrected) and
  `review_status = 'review_required'` (a fresh manual entry) or
  `'correction_required'` (an edit to something already
  admin_checked/imported) — never `'admin_checked'` or `'finalised'`
  directly; those remain §14.1/§14.2's job, unchanged, so a manual edit
  still goes through the same human review gate as a feed-imported one.
- Never score, never finalize — identical restriction to apply mode.

### 14.6 Manual result entry toggle: `public.set_grandtour_manual_result_entry_enabled`

Added by `supabase/migrations/20260710020000_grandtour_stage_result_review_workflow_schema.sql`.
`security definer`, `service_role`-only. Flips
`grand_tours.manual_result_entry_enabled` and logs to
`public.grandtour_game_audit` (`action = 'admin_override'`, since this is a
tour-level setting change with no single `stage_id`, unlike
`grandtour_result_audit_log`'s stage-scoped rows).

```sql
select public.set_grandtour_manual_result_entry_enabled(
  '<GRAND_TOUR_UUID>'::uuid,
  true,  -- or false to disable again
  '<ADMIN_USER_UUID>'::uuid,
  '<why, e.g. letour.fr feed down for stage 6>'
);
```

**Expected output**: `{"status": "updated", "grand_tour_id": "...",
"manual_result_entry_enabled": true}`.

Since no manual-entry RPC reads this flag yet (§14.5), enabling it today
has no operational effect beyond the flag and audit row themselves — it is
safe to exercise in production ahead of time if desired, but there is
nothing else to verify afterward until §14.5 is built.

## 15. Sign-off

Before running §7's command in production, record (in whatever change-log
mechanism this team uses for production changes):

- Operator name, reviewer name, date/time.
- Stage number and `stageId` being applied.
- Confirmation that §1–§6 are complete, with the §6 checklist filled in.
- The exact `--reason`/`--request-id` values that will be used.

After §7–§10 complete, record the actual `stage_result_id`/`import_run_id`
and the §10 query results (or link to where they're recorded) as the
closing entry for this apply.
