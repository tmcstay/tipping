# GrandTour official-letour apply-mode specification

**Status: Phase 3 CLI wiring is built (§14, §15).** `--apply` now works —
from a previously reviewed `--from-report` file only. It calls
`public.apply_grandtour_official_stage_result` via the service-role key
after re-validating every precondition in §14.5 locally. It never fetches
letour.fr live, never re-runs reconciliation, and refuses to run against the
known production Supabase project without `--confirm-production`. The
scheduled GitHub Actions workflow (`.github/workflows/grandtour-daily-feed-dry-run.yml`)
was not modified and has no service-role credentials configured, so it
cannot reach apply mode. See §15 for what was built, exactly which files
changed, and what remains (finalization, TTT, jersey holders, scoring, and
the `--force`/production-allowlist decisions are all still out of scope —
unchanged from §10).

This document specifies how `apply` mode for the `official-letour` feed
provider should eventually write reconciled stage results into Supabase.
It exists so implementation can be reviewed against a precise plan before
CLI wiring is written.

## 1. Scope

In scope: writing official rider-based stage results (`grandtour_stage_results`
+ `grandtour_stage_result_lines`) for non-TTT stages, once dry-run parsing
and reconciliation both report success.

Out of scope for the first implementation (see §10):
- TTT team results (`grandtour_stage_team_result_lines`) — blocked until an
  official team-result source is confirmed (see [docs/grandtour-results-feed.md](grandtour-results-feed.md)).
- Jersey holders (`grandtour_stage_jersey_holders`) — the official-letour
  parser does not currently scrape jersey holders at all (see §3.1's
  blocking gap).
- Automatic score calculation (`recalculate_grandtour_stage_scores`).
- Any change to `--reconcile` or dry-run behavior; this spec is additive on
  top of the existing dry-run/reconciliation pipeline documented in
  [docs/grandtour-results-feed.md](grandtour-results-feed.md).

## 2. Reviewed inputs

Schema: `supabase/migrations/20260629080958_grandtour_mvp.sql`,
`20260630011922_integrate_tdf_2026_data.sql`,
`20260703025318_extend_grandtour_stage_types.sql`,
`20260703025324_add_grandtour_ttt_schema_support.sql`,
`20260703041335_implement_grandtour_ttt_scoring.sql`,
`20260703045921_add_grandtour_rider_bib_number.sql`,
`20260707024106_park_jersey_tips_add_rider_feed_metadata.sql`.

Code: `scripts/grandtour-feed-provider.mjs`, `scripts/grandtour-feed-import.mjs`,
`scripts/grandtour-stage-calendar.mjs`, `scripts/grandtour-reconciliation.mjs`,
`scripts/grandtour-reconciliation-supabase.mjs`,
`scripts/grandtour-reconciliation-local-smoke.mjs`, `scripts/import-tdf-2026.mjs`
(the existing service-role write precedent this spec follows).

## 3. Target tables

| Table | Write in v1? | Notes |
| --- | --- | --- |
| `grandtour_stage_results` | Yes | One row per stage (`unique (stage_id)`). Carries `is_final`. |
| `grandtour_stage_result_lines` | Yes | One row per placed rider (`unique (stage_result_id, actual_position)`, `unique (stage_result_id, rider_id)`). `actual_position` allows 1–10; finalization requires exactly 5 or 10 lines. |
| `grandtour_stage_team_result_lines` | No (v1) | TTT only; blocked by §1. |
| `grandtour_stage_jersey_holders` | No (v1) | Blocked by §3.1. |
| `grandtour_feed_import_runs` / `grandtour_feed_snapshots` | Yes (recommended) | Already exist (added in `20260707024106_park_jersey_tips_add_rider_feed_metadata.sql`), currently unused by any script. Right shape for the audit/reporting fields in §9 — see §9.1. **Verified: currently have zero read/write grants for any role, including `service_role` — a migration is required before Phase 2 can use them; see §13.2.** |
| `grandtour_game_audit` | Indirect only | Already populated automatically by the existing `audit_result_mutation` trigger on writes to `grandtour_stage_results`/`grandtour_stage_result_lines`/`grandtour_stage_team_result_lines`. Apply mode does not need to write this table directly. |

### 3.1 Blocking gap: jersey holders are required to finalize a result

`grandtour_private.validate_final_result()` (redefined most recently in
`20260703025324_add_grandtour_ttt_schema_support.sql`) raises an exception
unless, at the moment `is_final` transitions to `true`:

- `grandtour_stage_result_lines` (or `grandtour_stage_team_result_lines` for
  TTT) has exactly 5 or 10 rows for that result, **and**
- `grandtour_stage_jersey_holders` has **exactly 4** rows for that stage
  (all four jersey types), **unconditionally, regardless of stage type**.

The `official-letour` parser (`parseLetourRankingStageRows` in
`scripts/grandtour-feed-provider.mjs`) does not scrape jersey holders at
all — `payload.jersey_holders` is always `[]` for this provider. This means:

**Apply mode cannot set `is_final = true` on any stage result in v1**, no
matter how clean the reconciliation is, until either (a) jersey-holder
scraping is added to the `official-letour` provider, or (b) the
finalization trigger's jersey-holder requirement is revisited. This is not
a soft warning — it is a hard `raise exception` in a `before insert or
update` trigger, so any attempt to insert with `is_final: true` (or flip an
existing row to `true`) without exactly 4 jersey holders already present
will fail atomically.

**v1 apply mode must only ever write `is_final: false` (draft/provisional)
result rows.** Finalization is a distinct, later, explicitly human-triggered
action (see §10), consistent with jersey tips already being parked for user
entry per `docs/grandtour-results-feed.md`.

### 3.2 Other write-order constraints discovered in the schema

- `grandtour_private.validate_result_line()` requires the rider to already
  have a row in `grandtour_stage_startlists` for that stage. A reconciled
  rider match (`reconciliation.stages[].matchedRiders[].riderId`) is
  necessary but **not sufficient** — the rider must also be on that
  specific stage's startlist, or the insert fails. **Implemented**:
  `grandtour-reconciliation.mjs`'s `checkStartlistMembership()` and
  `fetchReconciliationContext()`'s `existingStartlist` read now perform this
  check as part of `reconcileStageResult()` — see §4, precondition 10, which
  is no longer a gap. Presence of any startlist row is treated as
  sufficient, matching the trigger, which does not filter by row `status`.
- Once a result is `is_final: true`, `grandtour_private.validate_result_line()`
  and `prevent_final_result_line_delete()` block further inserts/updates/
  deletes on its lines until `is_final` is explicitly set back to `false`
  ("reopened") first. Not relevant to v1 (which never finalizes), but
  directly shapes the correction workflow for whenever finalization is
  added later (§10).
- **Verified (§13.2) — corrects an earlier error in this section**: an
  earlier draft of this spec claimed `grandtour_stage_results`,
  `grandtour_stage_result_lines`, and `grandtour_stage_jersey_holders` have
  no explicit `grant ... to service_role`. That was wrong — a single-line
  `grep` pattern missed a multi-line grant statement
  (`20260629080958_grandtour_mvp.sql:1106-1128`). `service_role` **does**
  have `SELECT, INSERT, UPDATE, DELETE` on all three tables (and on
  `grandtour_stage_team_result_lines`, via its own explicit grant), and this
  is now empirically confirmed against a live local instance, not just
  inferred from platform defaults. See §13 for the full verification.
  `grandtour_feed_import_runs`/`grandtour_feed_snapshots`, by contrast, were
  correctly flagged as unconfirmed and turned out to have **zero** grants
  for any role — see §13.2 and §9.1.
- `grandtour_stage_results`/`_result_lines`/`_jersey_holders` have **no
  provenance columns** (no `source_url`, `data_confidence`, or
  `imported_by`/`import_run_id`), unlike `grandtour_riders`/`grandtour_teams`/
  `grandtour_stages`. See §9.1 for how this spec proposes to carry
  provenance without a schema change in v1.

## 4. Apply preconditions

Apply mode must refuse to write anything unless **all** of the following
are true. Each maps to a field the current dry-run/reconciliation pipeline
already produces (`scripts/grandtour-feed-provider.mjs`,
`scripts/grandtour-reconciliation.mjs`):

| # | Precondition | Source field (today) |
| --- | --- | --- |
| 1 | Provider is `official-letour` | `review.provider === "official-letour"` |
| 2 | Dry-run parse status is `ok` for the target stage | `stageFetchMetadata[].status === "ok"` |
| 3 | No parser drift detected | `review.parserDriftDetected === false` |
| 4 | Reconciliation ran and passed | `review.reconciliation.stages[].safeToApply === true` for the target stage |
| 5 | Stage is not TTT | `!review.reconciliation.stages[].isTtt` (stage 1, or any `team_time_trial` stage type, is unconditionally excluded — see §1) |
| 6 | No unmatched riders/teams | `matchedRiders.length === parsedRiders.length` and `unmatchedRiders.length === 0`, same for teams |
| 7 | No ambiguous riders/teams | `ambiguousRiders.length === 0`, `ambiguousTeams.length === 0` |
| 8 | No duplicate bib conflicts | `duplicateBibConflicts.length === 0` |
| 9 | Stage record exists | `!missingStageRecord` |
| 10 | Every matched rider is on that stage's startlist | `review.reconciliation.stages[].startlistValidationPassed === true` (implemented — see §3.2) |
| 11 | Dry-run report artifact exists on disk for this run | See §8.4 |

Preconditions 1–11 can now all be evaluated purely from the existing report
JSON without any new Supabase read at apply time — precondition 10
(`fetchReconciliationContext` reading `grandtour_stage_startlists` scoped to
`stage_id`, and `reconcileStageResult`/`checkStartlistMembership` checking
every matched rider against it) is implemented as of the dry-run/
reconciliation pipeline, not merely planned. `startlistValidationPassed`
is `false` both when a specific matched rider is missing
(`matchedRidersMissingFromStartlist`) and when zero startlist rows exist for
the stage at all (`noStartlistRowsFound: true`, reported distinctly so it
doesn't read as "every rider happened to pass").

If **any** precondition fails, apply mode must exit non-zero with a
specific, itemized reason per failed precondition (not just "safeToApply
was false") and must not attempt any write.

## 5. Transaction boundaries and write order

All writes for a single stage happen in **one Postgres transaction**
(Supabase JS: a single `rpc()` call to a `security definer` function that
does the work server-side, not a sequence of client-side `.insert()` calls —
see §5.1 for why).

Order within the transaction:

1. Re-check preconditions 9 and 10 server-side (defense in depth — the
   client-side precondition check in §4 can go stale between the dry run
   and the apply call).
2. `insert ... on conflict (stage_id) do update` into `grandtour_stage_results`
   with `is_final: false`, capturing whether this was an insert or an
   update (see §6).
3. Delete any existing `grandtour_stage_result_lines` for that
   `stage_result_id` **only if** the incoming set differs from the existing
   set (see §6/§7 — never a blind delete-then-insert).
4. Insert the new `grandtour_stage_result_lines` rows (`actual_position`
   1–5, or 1–10 if a full top-10 is available from the source).
5. Record the outcome in `grandtour_feed_import_runs` (+ one
   `grandtour_feed_snapshots` row per segment written), per §9.1.
6. Commit. On any error at any step, the whole transaction rolls back —
   partial writes are not possible by construction, which directly answers
   "partial import failure" in §7.

### 5.1 Why an RPC, not direct client-side writes

`import-tdf-2026.mjs` (the existing precedent) does direct client-side
`.upsert()` calls per table with no explicit multi-table transaction,
because that importer's `on conflict` upserts are individually idempotent
and cross-table consistency is looser (grand tour → competition → teams →
riders → stages → startlist, each stage additive). Apply mode's writes are
different: `grandtour_private.validate_result_line()` and
`validate_final_result()` are triggers that run per-row, and a five/ten-row
result is only meaningful as a complete set — a client-side loop of
individual inserts that fails halfway through leaves a stage with 3 of 5
result lines and no way to distinguish that from "a stage that only had 3
official finishers." A single `security definer` RPC function
(`public.apply_grandtour_official_stage_result(p_stage_id, p_lines jsonb,
p_import_run_id uuid)`, modeled on the existing
`public.recalculate_grandtour_stage_scores` and
`public.save_grandtour_tip_draft` RPC patterns already in the schema) makes
the whole write atomic and keeps the write path in one auditable place
rather than scattered across client-side script logic.

## 6. Idempotency rules

- **Rerunning the same official result must not duplicate lines.** The
  `unique (stage_result_id, rider_id)` and `unique (stage_result_id,
  actual_position)` constraints on `grandtour_stage_result_lines` already
  make a blind re-insert fail loudly rather than duplicate — but apply mode
  should not rely on constraint violations as its idempotency mechanism.
  Instead: compute a diff between the incoming parsed top-N and the existing
  `grandtour_stage_result_lines` for that stage before writing. If the diff
  is empty (same riders, same positions), apply mode reports `no_change`
  and performs **zero writes** — not even a no-op upsert — so
  `grandtour_stage_results.updated_at` and the audit trail only move when
  something actually changed.
- **Changed official results must be detected and reported, not silently
  applied.** If the diff is non-empty and the existing result was not
  previously imported by this same pipeline (see §9.1 — no matching
  `grandtour_feed_import_runs` row, or `import_status` isn't from a prior
  official-letour apply), treat it as a **manual-correction conflict**
  (§7.3), not a routine update — do not overwrite. If the diff is non-empty
  and the existing result *was* previously imported by this same pipeline
  (i.e., nothing external has touched it since), apply mode may update it,
  but must record the prior values as `old_value` — this is already
  automatic via the existing `audit_result_mutation` trigger, which writes
  `old_value`/`new_value` jsonb on every `grandtour_stage_results`/
  `grandtour_stage_result_lines` mutation.
- **Idempotency key**: the natural key for "have I already applied this
  exact result" is `(stage_id, sorted list of (rider_id, actual_position))`,
  not a timestamp or run ID — official results for a finished stage do not
  change under normal circumstances, so content equality is the correct
  test, not recency.

## 7. Conflict handling

| Scenario | Behavior |
| --- | --- |
| **7.1 No existing result** | Straightforward insert (draft, `is_final: false`). No conflict. |
| **7.2 Existing result present, identical content** | No-op per §6 (`no_change`). Not an error. |
| **7.3 Existing result present, different content, not previously applied by this pipeline** | Refuse to overwrite. Report `manual_correction_conflict` with a diff (existing vs. incoming) and exit non-zero. Overwriting requires a separate, explicit, human-reviewed action outside apply mode's normal flow (e.g. an `--acknowledge-manual-override <reason>` flag that still requires a human to have read the diff — not a silent `--force`). |
| **7.4 Existing result present, different content, previously applied by this pipeline (official source itself changed, e.g. a post-race jury correction)** | This is the "official result changed after prior import" case. Apply mode may update it (§6, second bullet), but must require the same `--confirm-stage <N>` gate as any other apply (§8), and must log both old and new values (automatic via `audit_result_mutation`). This should be rare enough that a real implementation may reasonably choose to always require `7.3`-style confirmation rather than auto-applying even here — that's a decision for whoever implements this, not settled by this spec. |
| **7.5 Rider/team mismatch discovered only at write time** (e.g. reconciliation passed, but the rider was removed from the startlist between dry-run and apply) | Precondition re-check in transaction step 1 (§5) catches this and aborts the transaction before any row is written. Reported as a precondition failure, not a partial-write conflict. |
| **7.6 Partial import failure** (DB error, connection drop, etc. mid-write) | Cannot happen for the result/lines write itself, because it is one transaction (§5) — Postgres guarantees all-or-nothing. It *can* happen for step 5 (recording the import run) if that is a separate statement; keep step 5 inside the same transaction as steps 2–4 to close this gap entirely rather than accepting "applied but unaudited" as a possible state. |

## 8. Safety gates

All of the following are required together; none is sufficient alone.

1. **`--apply`** — already exists (currently unconditionally throws after
   writing the review report; see `scripts/grandtour-feed-import.mjs`).
   Under this spec, once implemented, `--apply` triggers the precondition
   checks in §4; if any fail, it still throws exactly as today, before
   attempting the transaction in §5.
2. **`--confirm-provider official-letour`** — new flag, required
   in addition to `--provider official-letour`. Two independent flags that
   must agree is a deliberate anti-typo/anti-copy-paste gate (mirrors why
   `import-tdf-2026.mjs` requires both `SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY` to be set explicitly rather than defaulting
   either).
3. **`--confirm-stage <stage_number>`** — new flag, required, and must
   exactly equal the single stage being applied (`fromStage === toStage
   === confirm-stage`). Applying a *range* is out of scope for v1 — apply
   mode should refuse multi-stage ranges outright, forcing one human
   decision per stage. This directly prevents a backfill-style
   `--from-stage 1 --to-stage 21 --apply` from ever being possible.
4. **Production environment guard** — apply mode refuses to run unless an
   explicit `--confirm-production` flag is passed **and** the resolved
   Supabase URL is recognized as the production project (checked against
   `KNOWN_PRODUCTION_PROJECT_REFS` in `scripts/grandtour-apply.mjs` — see
   §12's resolved question and §15). Running apply mode against a
   local/staging Supabase URL does **not** require `--confirm-production`.
   **Implemented in §15** — `--confirm-production`'s real semantics are now
   wired in `runApply`. `--force` remains unwired/undecided — it is not
   part of this spec's design and was intentionally left alone by Phase 3;
   its purpose should still be re-decided or removed by whoever next
   touches it.
5. **Dry-run report artifact requirement** — apply mode must be given the
   path to a dry-run report JSON file (`--from-report <path>`, new flag)
   produced by a prior `--reconcile` run for the exact same stage, and must
   re-validate that report's preconditions (§4) rather than re-running the
   parse itself. This guarantees a human (or CI step) had the opportunity
   to read the dry-run/reconciliation report before apply runs — apply mode
   should not be a single command that parses, reconciles, and applies all
   in one breath. The report's `generatedAt`/`fetchedAt` should also be
   checked against a max-age threshold (e.g. reject if older than a few
   hours) so a stale, no-longer-representative report can't be used to
   greenlight an apply against since-changed source data.

None of gates 2–5 exist in the codebase today; all are new flags/checks to
be added when apply mode is implemented.

## 9. Audit / reporting fields

Required fields, and where they should live:

| Field | Source | Storage |
| --- | --- | --- |
| Source provider | `review.provider` (`"official-letour"`) | `grandtour_feed_import_runs.provider_name` |
| Source URL | `review.sourceUrl` / per-stage `stageFetchMetadata[].url` | `grandtour_feed_import_runs.source_url` (run-level); `grandtour_feed_snapshots.source_url` (per-segment, if multiple stages ever apply in one run — not v1, see §8.3) |
| Fetched timestamp | `review.fetchedAt` | `grandtour_feed_import_runs.fetched_at` |
| Parser status | `stageFetchMetadata[].status`, `review.parserDriftDetected` | `grandtour_feed_import_runs.summary` (jsonb) |
| Reconciliation summary | `review.reconciliation.stages[]` (matched/unmatched/ambiguous counts, `safeToApply`, `blockers`) | `grandtour_feed_import_runs.summary` (jsonb) |
| Applied by / applied at | N/A today — apply mode runs as a script, not an authenticated user | See §9.2 |
| Old/new result values | N/A (automatic) | `grandtour_game_audit.old_value`/`new_value`, populated automatically by the existing `audit_result_mutation` trigger — apply mode does not need to write this itself |

### 9.1 Use the existing `grandtour_feed_import_runs` / `grandtour_feed_snapshots` tables

These tables already exist (`20260707024106_park_jersey_tips_add_rider_feed_metadata.sql`)
and are unused by any current script. Their shape is already a close match
for this spec's needs:

```
grandtour_feed_import_runs (
  id, grand_tour_id, provider_name, source_url, mode,        -- 'dry_run' | 'review' | 'apply'
  import_status,                                              -- 'pending' | 'validated' | 'applied' | 'failed' | 'skipped'
  fetched_at, applied_at, validation_errors jsonb, summary jsonb, created_at
)
grandtour_feed_snapshots (
  id, import_run_id, segment, source_name, source_url, fetched_at,
  confidence, raw_payload jsonb, normalized_payload jsonb, validation_errors jsonb, created_at
)
```

This gives apply mode a place to write, in the same transaction as the
result/lines write (§5): one `grandtour_feed_import_runs` row per apply
attempt (`mode: 'apply'`, `import_status: 'applied' | 'failed'`,
`applied_at: now()`), and one `grandtour_feed_snapshots` row per stage
(`segment: 'stage_result'`, `raw_payload`: the parsed official-letour rows,
`normalized_payload`: the rows as written). This is also where the
reconciliation summary (§9, row 4) and parser status live — as `summary`
jsonb on the run row — since the result tables themselves have no
provenance columns (§3.2) and this spec does not propose adding any in v1
(adding an `import_run_id` FK to `grandtour_stage_results` is a reasonable
future migration but is not required to satisfy this task's audit
requirements, since the run/snapshot tables already carry everything
needed, joinable by `stage_id` + `fetched_at`).

**Verified (§13.2) — this was a real gap, not just an unconfirmed caveat.**
These two tables' RLS policies restrict `authenticated` access to
`grandtour_private.is_cycling_admin()`, but neither table has **any**
`SELECT`/`INSERT`/`UPDATE`/`DELETE` grant for any role, including
`service_role` — confirmed empirically against a local instance
(`information_schema.role_table_grants` shows only schema-level
`REFERENCES`/`TRIGGER`/`TRUNCATE`). `service_role`'s RLS bypass
(`rolbypassrls = true`) does not help, because the failure happens at the
`GRANT` check, before RLS is ever evaluated. A migration adding at minimum

```sql
grant select, insert, update, delete
on table public.grandtour_feed_import_runs, public.grandtour_feed_snapshots
to service_role;
```

is a **required prerequisite for Phase 2** (§11) — verified live in a
rolled-back local transaction to be sufficient and correct (see §13.2 for
the exact evidence), but not applied as a real migration by this task,
which is verification/documentation only.

### 9.2 "Applied by"

Apply mode runs as a script using the service-role key
(`scripts/import-tdf-2026.mjs`'s existing pattern — see §11, Phase 0),
which has no `auth.uid()`. `grandtour_game_audit.actor_user_id` will
therefore be `null` for these writes, same as it already is for anything
written via a service-role script today. This spec proposes recording the
*operational* identity (who/what ran the apply command) as a plain text
field, not a `profiles`/`auth.users` foreign key: add an
`operator` text field to the jsonb `summary` written into
`grandtour_feed_import_runs` (e.g. `{ "operator": "manual-cli:tmcstay",
"operator_kind": "human" }` or `{ "operator": "github-actions:run-12345",
"operator_kind": "ci" }`), sourced from an environment variable or CLI flag
at apply time. This deliberately does not require a schema change.

## 10. What apply mode must not do yet

- **Must not score tips automatically.** `public.recalculate_grandtour_stage_scores`
  is an existing, separate, admin-invoked RPC gated by
  `grandtour_private.is_cycling_admin()`. Apply mode must never call it.
  Scoring remains a distinct, explicit, human-triggered action even after a
  result is eventually finalized.
- **Must not handle TTT results.** Enforced structurally by precondition 5
  (§4) — any stage where `isTtt` is true is rejected outright, not
  soft-warned.
- **Must not overwrite manual admin corrections without an explicit flag.**
  See §7.3/§7.4 — the default behavior on any content mismatch against a
  not-previously-pipeline-applied result is to refuse and report, never to
  silently overwrite.
- **Must not finalize results (`is_final: true`).** See §3.1 — this is a
  hard schema-level blocker (jersey holders), not a policy choice that
  could be relaxed by a flag.
- **Must not write jersey holders or team result lines.** Both out of
  scope for v1 per §1/§3.

## 11. Recommended implementation phases

**Phase 0 — verification (no product code) (done)**
Verified against a local `supabase db reset` instance — see §13 for full
results. Summary: `service_role` can already write
`grandtour_stage_results`/`_result_lines`/`_jersey_holders`/
`_team_result_lines` today (no migration needed there); the trigger
behaviors from §3.1/§3.2 (jersey-holder finalization gate, startlist
rejection) behave exactly as read from source; `grandtour_feed_import_runs`/
`grandtour_feed_snapshots` currently have **no** grants for any role and
need a migration before Phase 2 can use them (§13.2, §9.1) — not applied by
this task.

**Phase 1 — read-side precondition completeness (done)**
The startlist-membership check (precondition 10, §4) is implemented in
`grandtour-reconciliation-supabase.mjs`/`grandtour-reconciliation.mjs`
(`checkStartlistMembership`, `existingStartlist`, `startlistValidationPassed`,
`noStartlistRowsFound`), covered by fixture tests
(`scripts/grandtour-reconciliation.test.mjs`) and validated against a real
local Supabase instance (`scripts/grandtour-reconciliation-local-smoke.mjs`,
`docs/grandtour-results-feed.md`'s "Local reconciliation smoke test"). Still
entirely read-only; no apply-mode code exists yet.

**Phase 2 — the write RPC (done, database-side only)**
`supabase/migrations/20260709020000_grandtour_apply_official_stage_result_rpc.sql`
adds `public.apply_grandtour_official_stage_result(p_stage_id, p_result_lines,
p_reconciliation, p_dry_run_status, p_source, p_finalize, p_reason,
p_request_id)` — a `security definer` function, `EXECUTE`-granted to
`service_role` only (not `anon`/`authenticated`) — covering steps 2–5 of §5
in one transaction (step 1's precondition re-check happens via the
function's own parameter validation plus the pre-existing
`validate_result_line`/`validate_final_result` triggers). The same
migration also applies the `grandtour_feed_import_runs`/
`grandtour_feed_snapshots` grant fix proven in §13.2. Covered by
`supabase/tests/grandtour_apply_official_stage_result.sql` (9 scenarios,
all passing against local Supabase — see the project's task history for
the full pass/fail record). **No CLI wiring exists** —
`scripts/grandtour-feed-import.mjs` does not reference this function, and
`--apply` still throws immediately after writing the review report exactly
as before. The v1 foundation deliberately does not distinguish §7.4
("changed by a prior apply of this pipeline") from §7.3 ("manually
corrected") — any existing draft result with different content is always
refused, matching the safer default `open questions` §12 already leaned
toward; refining that distinction is left for a later phase if needed.

**Phase 3 — CLI wiring and safety gates (done — see §15)**
§14's contract is now implemented exactly as specified: the top-10
selection/truncation rule (§14.1), the review-report-field → RPC-parameter
mapping (§14.2), the five required confirmation gates (§14.3), the
required-fields checklist (§14.5), and RPC-response handling (§14.6). See
§15 for the full implementation record (files changed, tests, and what's
still deferred). `--force` remains unwired/undecided (still out of scope);
no GitHub Actions changes were made — apply mode remains a
manually-invoked, human-supervised command, unreachable from any
automation.

**Phase 4 — idempotency and conflict-handling tests**
Test scenarios from §6/§7 against local Supabase, mirroring
`scripts/grandtour-reconciliation-local-smoke.mjs`'s approach: no-existing-
result, identical-rerun (no-op), changed-by-pipeline (allowed update),
changed-outside-pipeline (refused, manual-correction conflict), stale
report (rejected by max-age check).

**Phase 5 (later, separate spec)** — jersey-holder scraping, TTT
team-result source, and finalization workflow. Each is a big enough change
(a new parser data source, or a new confirmed-source integration) to
deserve its own spec rather than being bolted onto this one.

## 12. Open questions for whoever implements this

- ~~Should `--confirm-production`'s production-project allowlist live in
  the repo or be environment-supplied?~~ — **resolved: repo-committed.**
  `docs/GRANDTOUR_PRODUCTION_DEPLOYMENT_CHECKLIST.md` already documents the
  production project as `tipping-suite` / project ref `nsdpilmmrfobiapbwona`
  (non-secret — a project ref is not a credential) as the established source
  of truth elsewhere in this repo's deployment process. §15's implementation
  hardcodes this same ref in `scripts/grandtour-apply.mjs`'s
  `KNOWN_PRODUCTION_PROJECT_REFS`, matched against the Supabase URL's
  hostname (`<ref>.supabase.co`). Update that constant if the checklist's
  documented ref ever changes.
- Should 7.4 (official result changed after prior import) really
  auto-apply, or should every apply — first-time or correction — require
  the same explicit human confirmation? This spec leans toward "always
  require confirmation" as the safer default but leaves the final call to
  implementation, since it doesn't change any of the schema/transaction
  design above either way.
- ~~Top-5 vs top-10 result lines~~ — **resolved, see §14.1.** v1 always
  applies top 10.

## 14. Phase 3 payload contract: review report → RPC parameters

This section is the finalized, unambiguous contract Phase 3 CLI wiring must
implement. It maps today's actual field names in
`scripts/grandtour-feed-provider.mjs`/`scripts/grandtour-feed-import.mjs`/
`scripts/grandtour-reconciliation.mjs` output to the RPC's parameters
(`supabase/migrations/20260709020000_grandtour_apply_official_stage_result_rpc.sql`).
It documents the decisions as final; it does not change any code.

### 14.1 Top-N policy (decided, and resolved — see the note below)

**v1 CLI-driven apply is top 10 only, never top 5.** An earlier draft of
this section stated that headline rule but then also let the CLI accept
exactly 5 rows as a fallback when only 5 were parsed — an internal
inconsistency between the stated policy and the implemented selection rule.
That inconsistency is now resolved in favor of the stated policy: **exactly
5 rows is refused**, the same as 1–9. Rationale for top-10-only:

- The schema already anticipates capturing more than five:
  `20260630011922_integrate_tdf_2026_data.sql`'s comment on
  `grandtour_stage_result_lines_actual_position_check` says "The original
  GrandTour game only needs the top five. Stage-winner v1 awards one point
  through tenth place, so result entry may now store either a top-five or
  full top-ten classification without changing the canonical top-five
  score." Applying top 10 now means that future scoring feature needs no
  backfill of historical results.
- `grandtour_private.validate_final_result()` already only accepts exactly
  5 or 10 lines at finalization time — top 10 is a first-class, already-supported
  shape, not a workaround.
- Capturing more data than the current game strictly needs is free at apply
  time (the official-letour parser already scrapes the full field, typically
  100+ riders) and strictly cheaper than a future re-scrape/backfill.
- A real official-letour road/ITT stage never has exactly 5 official
  finishers in practice — accepting a 5-row apply added complexity for a
  case that exists only in synthetic test fixtures, not real usage. Keeping
  the policy to one fixed number (10) removes an entire class of "which
  count did this apply use" ambiguity from every downstream report/audit
  record.

**Note — this is a CLI policy, not a database constraint.** The RPC itself
(`apply_grandtour_official_stage_result`) still accepts either exactly 5 or
exactly 10 lines at the database level (`jsonb_array_length(p_result_lines)
not in (5, 10)` is the RPC's own hard `raise exception` boundary) — that
constraint exists for schema/finalization generality, mirroring
`grandtour_private.validate_final_result()`, and was not narrowed by this
resolution (out of scope — see the task that resolved this ambiguity: it
was scoped to CLI/docs/tests consistency, not the RPC/migration). The CLI's
`selectTopNRows()` (`scripts/grandtour-apply.mjs`) is the actual v1 policy
gate; the RPC's looser 5-or-10 acceptance is a defense-in-depth floor a
future, different caller could rely on, not something the official-letour
CLI path is expected to ever exercise with 5.

**Exact selection rule**, applied by the CLI before calling the RPC, for a
single stage's parsed `stage_results[i].riders` array (each row:
`{ position, rider_name, bib_number, team_name, time, gap }` —
see `parseLetourRankingStageRows` in `scripts/grandtour-feed-provider.mjs`,
persisted onto the reconciliation report as `stages[].parsedRiders`):

1. Drop any row without an integer `position` (a row with a missing/garbled
   position never contributes to the count).
2. Reject outright if any two remaining rows share the same `position`
   value — ambiguous source data must never be silently resolved by picking
   one arbitrarily.
3. Select rows with `position` in `1..10` (using the `position` field, not
   array order, since the parser could in principle emit rows out of order).
4. If the selected count is anything other than exactly 10 (0-9, or a
   position-11+ row without a full 1-10 set beneath it), **refuse to apply
   this stage** with a specific message naming the actual count and total
   rows parsed, rather than letting the RPC's generic count-mismatch error
   surface first.
5. `actual_position` sent to the RPC is each row's **original parsed
   `position` value**, not a re-numbered 1..N index. The true published
   position is never silently renumbered — a stage with a disqualification
   that leaves a gap (e.g. positions 1,2,4,5,6,7,8,9,10,11 with 3 missing)
   still applies with that same gap in `actual_position`, not a renumbered
   contiguous sequence.

### 14.2 Field mapping: review/reconciliation report → RPC parameters

Given a single target stage number `N` (Phase 3 always applies exactly one
stage per invocation — see §14.3, `--confirm-stage`), and assuming the CLI
already has, in memory: `review` (from `buildFeedReview`), `review.reconciliation`
(from `buildReconciliationReport`, present only when `--reconcile` was used),
`payload` (the raw provider payload, specifically `payload.stage_results`),
and the reconciliation `context` fetched by `fetchReconciliationContext`:

| RPC parameter | Built from | Exact source path / rule |
| --- | --- | --- |
| `p_stage_id` | `review.reconciliation.stages[0].stageId` | **Available (§14.4, closed).** Sourced from the same `grandtour_stages` read `fetchReconciliationContext` already performs for reconciliation — no second query. Phase 3 must read this directly from the `--from-report` file, never re-query `grandtour_stages` by `stage_number` at apply time (that would reintroduce exactly the "trust the payload, not a fresh read" risk §5 step 1 warns about, just for the *stage id* instead of the *result*). |
| `p_result_lines` | `payload.stage_results.find(r => r.stage_number === N).riders`, truncated per §14.1, each row's rider resolved to a `riderId` via §14.1's join (below) | `[{ "rider_id": <uuid>, "actual_position": <int> }, ...]` |
| `p_reconciliation` | `review.reconciliation.stages.find(s => s.stageNumber === N)` | Passed through **unmodified** — the RPC re-validates its exact fields (`safeToApply`, `isTtt`, `missingStageRecord`, `startlistValidationPassed`, `unmatchedRiders`, `ambiguousRiders`, `unmatchedTeams`, `ambiguousTeams`, `duplicateBibConflicts`, `matchedRiders`). The CLI must not construct this object by hand or omit fields — pass the real `reconcileStageResult()` output object as-is. |
| `p_dry_run_status` | `{ parserStatus, parserDriftDetected }` | `parserStatus` = `review.stageFetchMetadata.find(m => m.stageNumber === N)?.status`; `parserDriftDetected` = `review.parserDriftDetected` (this one is report-wide, not per-stage — see §14.3's single-stage-range requirement for why that's safe) |
| `p_source` | `{ provider_name, source_url, fetched_at, confidence }` | `provider_name` = `review.provider` (must equal `"official-letour"` — the RPC hard-requires this); `source_url` = `review.stageFetchMetadata.find(m => m.stageNumber === N)?.url` (per-stage; more precise than `review.sourceUrl`, which is only populated for single-stage requests anyway); `fetched_at` = `review.fetchedAt`; `confidence` = hardcode `"official"` (the `official-letour` provider always sets this on its raw payload today, but does not surface it onto `review` — no report field currently carries it, so the CLI may hardcode it for this provider rather than wait for a report field addition) |
| `p_finalize` | Always `false`, hardcoded by the CLI. **Never** exposed as a CLI flag in Phase 3 — see §10. |
| `p_reason` | CLI-supplied, e.g. `--reason` (new, optional flag; default: `` `applied via grandtour-feed-import.mjs --apply --confirm-stage=${N}` ``) |
| `p_request_id` | CLI-supplied, e.g. `--request-id` (new, optional flag; default: a generated value such as `apply-${stageNumber}-${Date.now()}`) — used purely for log/audit correlation (stored in `grandtour_feed_import_runs.summary.request_id`), not for idempotency, which the RPC already handles via content comparison (§6) |

**Rider-to-UUID join for `p_result_lines`** (needed because
`payload.stage_results[].riders[]` carries `bib_number`/`rider_name`, not a
`riderId`, while `review.reconciliation.stages[].matchedRiders[]` carries
`riderId`/`bibNumber` but not `position`): for each selected top-10 row,
find its `riderId` by matching, in the same precedence order
`classifyRiderMatch` itself uses (`scripts/grandtour-reconciliation.mjs`):

1. `matchedRiders` entry where `bibNumber === row.bib_number` (primary), else
2. `matchedRiders` entry whose `riderName`, normalized, matches `row.rider_name`, normalized (fallback — should be rare in practice since `matchedBy` on the entry already records which path matched originally; the CLI can just read `matchedBy`/`bibNumber` off the `matchedRiders` entry directly instead of re-implementing normalization, since `reconcileStageResult()` already did this work — see §14.4, this is simpler once `stageId` is added to also add `position` correlation, or, without a code change, the CLI can build a `bibNumber -> riderId` map from `matchedRiders` and look up each selected row by `row.bib_number`).

If a selected row (position 1–10, or all 5) cannot be resolved to a
`matchedRiders` entry, this indicates an internal inconsistency (it should
be impossible if `safeToApply` is true, per §14.5) — the CLI must treat
this as a hard failure and refuse to call the RPC, not skip that position or
silently shrink the line count.

### 14.3 Required confirmation gates (finalized)

All of the following, together — none is sufficient alone (restates and
finalizes §8):

1. `--apply` (exists; currently unconditional-throw, to be replaced with
   real behavior in Phase 3).
2. `--confirm-provider official-letour` (new) — must be passed and must
   equal `--provider official-letour` exactly. Two independently-typed
   flags that must agree.
3. `--confirm-stage <N>` (new) — **required, and must be a single stage
   number.** Phase 3 must reject `--from-stage`/`--to-stage` ranges wider
   than one stage when `--apply` is passed (i.e. `--confirm-stage` must
   equal both `--from-stage` and `--to-stage`, which must be equal to each
   other). This is why `p_dry_run_status.parserDriftDetected` being
   report-wide rather than per-stage (§14.2) is safe: a Phase-3 apply
   invocation's report only ever covers one stage.
4. `--from-report <path>` (new) — path to a dry-run report JSON file
   already on disk, produced by a prior `--reconcile` run for the exact
   same stage. Phase 3 must **re-read this file from disk** and validate
   it (§14.5) rather than re-running the parse/reconcile itself in the same
   invocation — this guarantees a human (or CI step) had the opportunity to
   read the report before apply runs. Reject if the report's `stageDate`/
   `fetchedAt` is older than a max-age threshold (recommend 6 hours,
   configurable) — a stale report must not greenlight an apply against
   since-changed source data.
5. `--confirm-production` (new) — required **only** when the resolved
   `SUPABASE_URL` matches the production project (checked against an
   allowlist — see the still-open question in §12 about where that
   allowlist lives). Not required for local/staging URLs, so local Phase 3
   development/testing is not needlessly gated.

If any gate is missing or its value doesn't match, the CLI must refuse
before reading the report file, before connecting to Supabase, and before
attempting any RPC call.

### 14.4 Required code addition before Phase 3 can be built — CLOSED

**`reconcileStageResult()`'s return object now has a `stageId` field**
(`scripts/grandtour-reconciliation.mjs`). Previously `existingStage` was
accepted as a parameter and used only to compute `missingStageRecord`; the
actual UUID was discarded, leaving Phase 3 with no correctness-preserving
way to obtain `p_stage_id` from a `--from-report` file. That gap is now
closed:

- `scripts/grandtour-reconciliation-supabase.mjs`'s `fetchReconciliationContext`
  now also selects `stage_type` and `starts_at` on the `grandtour_stages`
  read it already performs, and returns `existingStage: { id, stageNumber,
  stageType, stageDate }` (`stageDate` is the UTC calendar-date portion of
  `starts_at`, since `grandtour_stages` has no plain date column).
- `reconcileStageResult()`'s return object now includes `stageId`,
  `stageDate`, and `stageType`, sourced directly from that same
  `existingStage` object — the exact one `fetchReconciliationContext` read,
  with **no second query**. When `existingStage` is `null` (missing stage
  record), all three are `null`, never a stale or guessed value.
- `stageType` in the *output* is the authoritative `grandtour_stages.stage_type`
  enum value (e.g. `"road"`, `"hilly"`, `"team_time_trial"`) — distinct from
  the `stageType` *parameter* `reconcileStageResult` already accepted, which
  only drives the `isTtt` heuristic and may be a caller-side guess (e.g.
  "stage 1 is always TTT") rather than a DB read. Both are useful; they
  answer different questions and are kept separate on purpose.

This directly satisfies §14.2's `p_stage_id` mapping: Phase 3 can now read
`review.reconciliation.stages[0].stageId` straight out of a `--from-report`
file with no additional Supabase call at apply time.

Verified: 66 automated Node tests pass (`npm run test:data`, up from 64 —
2 new Supabase-mock tests added), including a dedicated test proving the
exact UUID `fetchReconciliationContext` reads flows unchanged into
`reconcileStageResult()`'s `stageId` with no second lookup
(`scripts/grandtour-reconciliation-supabase.test.mjs`). The local
reconciliation smoke test (`scripts/grandtour-reconciliation-local-smoke.mjs`)
was also updated and re-run against a live local Supabase instance — 9/9
scenarios pass, with new assertions that `stageId` is present and
UUID-shaped for both the road stage (2) and TTT stage (4) scenarios, and
`null` for the missing-stage (999) scenario.

No other required-but-missing fields were found — §14.2's other mappings
are all derivable from existing report fields today.

### 14.5 Required-fields-present checklist before apply is allowed

Before the CLI may call the RPC at all (in addition to §14.3's flags), the
loaded `--from-report` JSON must satisfy every one of these, checked by the
CLI itself (not deferred to the RPC's own re-validation, which is defense
in depth, not the primary gate a human-facing error message should come
from):

- `provider === "official-letour"`
- `dryRun === true` and `applyEnabled === false` (sanity: this really is a
  dry-run report, not something hand-edited to claim otherwise)
- `parserDriftDetected === false`
- `stageFetchMetadata` contains an entry for stage `N` with `status === "ok"`
- `reconciliation` is present (i.e. the report was generated with
  `--reconcile`; a plain dry-run report without reconciliation must be
  rejected with a message telling the operator to re-run with `--reconcile`)
- `reconciliation.stages` contains exactly one entry, for stage `N`
  (guaranteed by §14.3's single-stage requirement, but the CLI should still
  assert it rather than silently taking `stages[0]`)
- That entry's `stageId` is present and non-null (§14.4)
- That entry's `safeToApply === true`
- `reconciliation.overallSafeToApply === true` (redundant with the above
  for a single-stage report, but cheap to assert and catches a
  reconciliation-report construction bug)
- `fetchedAt` (or `stageDate`, whichever the report source uses) is within
  the max-age threshold from §14.3, gate 4

Any failure here must produce a specific, itemized message naming the
missing/failing field — never a generic "report invalid."

### 14.6 Handling the RPC response

The RPC (`public.apply_grandtour_official_stage_result`) either returns a
JSONB object or raises a Postgres exception (surfaced by `@supabase/supabase-js`'s
`.rpc()` as `{ data: null, error: {...} }`). Phase 3 CLI behavior:

| Outcome | CLI behavior |
| --- | --- |
| `data.status === "applied"` | Print `stage_result_id`, `import_run_id`, `line_count` from the response. Exit code 0. This is the only outcome that means new rows were written. |
| `data.status === "no_change"` | Print the same fields (`import_run_id` will be absent — no audit run was written, per §6). Exit code 0. **Not an error** — log it clearly as "already applied, no changes" rather than silently looking identical to a fresh apply, so an operator re-running the same command doesn't mistake a no-op for a fresh write. |
| `error` present (any RPC-raised exception) | Print `error.message` verbatim — the RPC's `raise exception` messages are already specific (e.g. naming which precondition field failed, or "already has a different draft result"). Exit code 1. **Never partially retry or fall back** — every RPC failure mode is either a precondition problem (fix the report/inputs and re-run `--reconcile` first) or a genuine conflict (§7.3/§7.4, needs human review) — there is no failure mode where a partial success is possible, because the whole write is one transaction (§5). |

No other outcome shape is possible: the RPC never returns partial success,
and (per §5/§13.3) never leaves partial `grandtour_stage_results`/
`grandtour_stage_result_lines` rows on failure.

## 13. Phase 0 verification results (verified 2026-07-09, local Supabase)

Ran against a local `supabase db reset` instance (Docker), migrations
through `20260707024106_park_jersey_tips_add_rider_feed_metadata.sql`, using
a new verification-only script,
`supabase/seeds/grandtour_apply_mode_phase0_verification.sql`. That script
is never auto-applied (only `supabase/seed.sql` is, per
`supabase/config.toml`), runs entirely inside one transaction that ends in
`ROLLBACK` (including its one `GRANT`, which is transactional DDL in
Postgres), and was confirmed afterward to have persisted **zero** rows and
**zero** grant changes (re-queried both directly). It builds on
`supabase/seed.sql`'s seeded grand tour and
`supabase/seeds/grandtour_reconciliation_smoke.sql`'s existing modification
(rider `40000000-...-003` deliberately removed from stage 2's startlist,
from the prior reconciliation-verification task). No application code
(`scripts/grandtour-reconciliation*.mjs` or anywhere else) was changed to
produce these results — everything here was exercised directly in `psql`
against the real schema/RLS/grants.

### 13.1 Which roles can read

Unchanged from the prior "Local reconciliation smoke test" verification:
`grandtour_stages`, `grandtour_riders`, `grandtour_teams`,
`grandtour_stage_startlists` are fully `SELECT`-able by `anon`/
`authenticated`. `grandtour_stage_results`/`_result_lines`/
`_jersey_holders`/`_team_result_lines` are `SELECT`-granted to `anon`/
`authenticated` at the table level, additionally RLS-gated to
`is_final = true` rows only. `grandtour_feed_import_runs`/
`grandtour_feed_snapshots` are **not readable by any role** — see 13.2.

### 13.2 Which roles can write, and which tables need explicit grants

`service_role` has `rolbypassrls = true`; `anon` and `authenticated` do not
(confirmed via `pg_roles`). RLS bypass only affects row-level security — it
does **not** substitute for a missing table-level `GRANT`, which is
evaluated first and independently.

| Table | `anon` | `authenticated` | `service_role` |
| --- | --- | --- | --- |
| `grandtour_stage_results` | `SELECT` only | `SELECT, INSERT, UPDATE, DELETE` (RLS: `profiles.is_admin`) | `SELECT, INSERT, UPDATE, DELETE` (RLS bypassed) |
| `grandtour_stage_result_lines` | `SELECT` only | `SELECT, INSERT, UPDATE, DELETE` (RLS: `profiles.is_admin`) | `SELECT, INSERT, UPDATE, DELETE` (RLS bypassed) |
| `grandtour_stage_jersey_holders` | `SELECT` only | `SELECT, INSERT, UPDATE, DELETE` (RLS: `profiles.is_admin`) | `SELECT, INSERT, UPDATE, DELETE` (RLS bypassed) |
| `grandtour_stage_team_result_lines` | `SELECT` only | `SELECT, INSERT, UPDATE, DELETE` (RLS: `is_cycling_admin()`) | `SELECT, INSERT, UPDATE, DELETE` (RLS bypassed) |
| `grandtour_feed_import_runs` | **none** | **none** | **none** — confirmed gap |
| `grandtour_feed_snapshots` | **none** | **none** | **none** — confirmed gap |

**Correction to §3.2**: an earlier draft of this spec claimed the first four
result tables had no explicit `service_role` grant. That was wrong — caused
by a `grep` pattern that only matched grant statements on a single line,
missing the actual multi-line statement at
`supabase/migrations/20260629080958_grandtour_mvp.sql:1106-1128`:

```sql
grant insert, update, delete on table
  public.grandtour_stage_results,
  public.grandtour_stage_result_lines,
  public.grandtour_stage_jersey_holders,
  public.grandtour_stage_scores,
  public.grandtour_leaderboard_snapshots
to authenticated;

grant all privileges on table
  public.grand_tours, public.grandtour_competitions, public.grandtour_teams,
  public.grandtour_riders, public.grandtour_stages,
  public.grandtour_stage_startlists, public.grandtour_tips,
  public.grandtour_tip_selections, public.grandtour_stage_results,
  public.grandtour_stage_result_lines, public.grandtour_stage_jersey_holders,
  public.grandtour_stage_scores, public.grandtour_leaderboard_snapshots
to service_role;
```

This is now confirmed by direct query
(`information_schema.role_table_grants`), not just by re-reading the
migration text — table 13.2 above is the query result.

**`grandtour_feed_import_runs`/`grandtour_feed_snapshots` really do have zero
grants**, for every role including `service_role`. Root cause: their
migration (`20260707024106_park_jersey_tips_add_rider_feed_metadata.sql`)
enabled RLS and added `is_cycling_admin()`-gated policies for `authenticated`,
but never added the corresponding table-level `GRANT` the way every other
migration in this schema did for its own new tables (`data_audit`,
`grandtour_stage_team_result_lines`) or via the bulk `grant ... to
service_role` list shown above. The RLS policies on these two tables are
currently unreachable: no role can get far enough (past the `GRANT` check)
for Postgres to even evaluate them. `service_role`'s `rolbypassrls` does not
help — the failure is `permission denied for table
grandtour_feed_import_runs`, not an RLS rejection, and Postgres's own error
hint states the exact fix: `GRANT INSERT ON public.grandtour_feed_import_runs
TO service_role;`.

**Verified remediation** (proven live, inside the same rolled-back
transaction — granted, retried the insert, succeeded, then rolled back):

```sql
grant select, insert, update, delete
on table public.grandtour_feed_import_runs, public.grandtour_feed_snapshots
to service_role;
```

This is a real, proven gap in the existing schema. It blocks §9.1's
audit-table design exactly as written today. **No migration was created by
this task** (verification/documentation only, per task scope) — this is a
documented, verified prerequisite for whoever implements Phase 2 (§11), not
a fix applied now.

### 13.3 Trigger/constraint behavior — confirmed exactly as read in §3.1/§3.2

All five checks below were run as `service_role` (except the `anon` row)
against stage 2 (`50000000-0000-4000-8000-000000000002`, a real seeded road
stage), using real seeded riders, inside the rolled-back verification
transaction:

| # | Check | Result |
| --- | --- | --- |
| 1 | `anon` insert into `grandtour_stage_results` | **Rejected**: `permission denied for table grandtour_stage_results` (grant-level; RLS never evaluated) |
| 2 | `service_role` insert a draft `grandtour_stage_results` row with `is_final: false` | **Succeeded** |
| 3 | `service_role` insert 5 `grandtour_stage_result_lines` for riders on stage 2's startlist | **Succeeded** |
| 4 | `service_role` insert a 6th result line for rider `...003`, deliberately absent from stage 2's startlist | **Rejected**: `Result rider must be on the stage start list.` (`grandtour_private.validate_result_line()`) |
| 5 | `service_role` update that result to `is_final: true` with 0 jersey holders present | **Rejected**: `A final stage result requires all four individual jersey holders.` (`grandtour_private.validate_final_result()`) |

A follow-up `select count(*)` confirmed the 5 legitimate result lines from
check 3 were unaffected by the two rejected attempts (checks 4 and 5), each
of which was individually wrapped in its own `SAVEPOINT`/`ROLLBACK TO
SAVEPOINT` so the surrounding transaction could continue after each expected
error.

These results directly confirm: **draft (`is_final: false`) result
insertion succeeds** for `service_role` today with no schema changes needed
(§3.1's "must only ever write `is_final: false`" conclusion holds, and is
achievable right now); **finalization without exactly 4 jersey holders
fails** exactly as predicted; **a result line for a rider not on the
stage's startlist is rejected** exactly as predicted (§3.2, precondition 10
in §4 — implemented in `scripts/grandtour-reconciliation.mjs` in a prior
task — is confirmed to actually prevent reaching this trigger failure, not
just theoretically aligned with it).

### 13.4 Preferred write path: the `security definer` RPC (§5.1) — confirmed preferred, with a stronger reason

`service_role` already has direct `INSERT`/`UPDATE`/`DELETE` on
`grandtour_stage_results`/`_result_lines` today (13.2), so a naive
implementation *could* skip the RPC in §5.1 and issue raw client-side
`.insert()`/`.upsert()` calls the way `import-tdf-2026.mjs` does for the
base entity tables. This verification adds a concrete reason that would
still be worse than the RPC approach:

- The two trigger rejections in 13.3 fire **per row/statement**, not per
  batch. A client-side loop of individual inserts that fails partway
  through (e.g. row 3 of 5 hits a rider recently pulled from the startlist)
  leaves a partial, ambiguous result — exactly the "3 of 5 lines, no way to
  tell if that's a partial failure or a genuinely short field" scenario
  §5.1 warned about, and this task's step 4/5 checks demonstrate that
  failure mode fires immediately and independently per statement with no
  built-in batching or all-or-nothing guarantee at the client level.
- `grandtour_feed_import_runs`/`grandtour_feed_snapshots` need a new
  migration regardless (13.2) — that migration should scope write access to
  a `security definer` function's definer role rather than opening broad
  direct `service_role` table access to tables that carry raw scraped
  payloads (`grandtour_feed_snapshots.raw_payload`) and audit/import
  history, keeping the audit write path in one auditable place, consistent
  with how `recalculate_grandtour_stage_scores`/`save_grandtour_tip_draft`
  already work in this schema.

At the time this section was written, no RPC existed yet; this recorded why
§5.1's original recommendation held up under empirical testing before any
was built. The RPC now exists
(`supabase/migrations/20260709020000_grandtour_apply_official_stage_result_rpc.sql`,
§11 Phase 2) as a `security definer` function exactly as recommended here,
and as of §15 it is now reachable — deliberately narrowly — via
`scripts/grandtour-feed-import.mjs --apply --from-report <path>`, still
`service_role`-only and still unreachable from any automation.

## 15. Phase 3 implementation record

Implemented `--apply`'s real behavior per §14's contract, exactly as
specified there — this section records what was built, where, and how it
was verified.

### 15.1 Files changed

- `scripts/grandtour-apply.mjs` (new) — all pure Phase 3 logic, independently
  testable with no Supabase/filesystem access: `validateReportForApply`
  (§14.5's full checklist plus §14.3 gate 4's max-age check),
  `selectTopNRows` (§14.1), `mapRowsToResultLines` (§14.2's rider-UUID join),
  `buildApplyRpcParams` (§14.2's exact 8-parameter mapping),
  `interpretRpcResponse` (§14.6), `isProductionSupabaseUrl` +
  `KNOWN_PRODUCTION_PROJECT_REFS` (§14.3 gate 5), `decodeJwtRole` (defense
  in depth against an anon key being placed in `SUPABASE_SERVICE_ROLE_KEY`).
- `scripts/grandtour-reconciliation.mjs` — `reconcileStageResult()`'s return
  object gained a `parsedRiders` field (the raw parsed rider rows for that
  stage: `position`, `rider_name`, `bib_number`, `team_name`, `time`, `gap`).
  This was a necessary, previously-undocumented prerequisite discovered
  while implementing §14.2: `p_result_lines` needs finishing positions, but
  neither the review report nor the reconciliation report carried them
  before this — only `matchedRiders` (identity, no position) existed. Since
  apply mode must not re-fetch or re-reconcile (tasks 6/7), the `--from-report`
  file itself has to carry this data, so it's now embedded at
  `--reconcile` time, the same way `stageId` was added in the prior task.
- `scripts/grandtour-feed-provider.mjs` — `parseFeedArgs` gained
  `--from-report`, `--confirm-provider`, `--confirm-stage`, `--reason`,
  `--request-id`, plus validation requiring all of §14.3's gates together
  whenever `--apply` is passed (and rejecting `--apply` combined with
  `--reconcile`, and a mismatched `--from-stage`/`--to-stage` against
  `--confirm-stage`) — all checked synchronously, before any file read or
  network activity.
- `scripts/grandtour-feed-import.mjs` — added `runApply(options, deps)`,
  which reads and validates the `--from-report` file, builds RPC parameters,
  and calls `apply_grandtour_official_stage_result` exactly once via the
  service-role key. `main()` now branches to `runApply` immediately when
  `--apply` is set, before any provider instantiation, live fetch, or
  reconciliation — satisfying tasks 6/7 structurally, not just by
  convention. The file gained a standard ESM entry-point guard
  (`import.meta.url === pathToFileURL(process.argv[1]).href`) so `main`/
  `runApply` can be imported and tested without triggering execution, while
  `node scripts/grandtour-feed-import.mjs` still runs exactly as before.
  `deps.createClient` is dependency-injectable, defaulting to the real
  `@supabase/supabase-js` import — this is what makes the RPC-call
  integration tests possible without mocking Node's module system.

### 15.2 Safety properties verified

- **Anon/reconcile env vars are never accepted for apply.** `runApply`
  reads only `SUPABASE_SERVICE_ROLE_KEY` (never `SUPABASE_ANON_KEY`), and
  additionally decodes the JWT's `role` claim and refuses to proceed unless
  it reads exactly `"service_role"` — so an anon key accidentally placed in
  `SUPABASE_SERVICE_ROLE_KEY` is caught before any network call, not just
  a missing-variable check.
- **No live fetch, no re-reconciliation during apply**, structurally: the
  `--apply` branch in `main()` returns before `ManualJsonGrandTourFeedProvider`/
  `OfficialLetourGrandTourFeedProvider` are ever instantiated.
- **Production guard**: `isProductionSupabaseUrl` checked against
  `nsdpilmmrfobiapbwona` (the documented production project ref — see the
  resolved §12 question) before any report is read; local/staging URLs are
  never gated.
- **All local validation happens before any Supabase connection.** Verified
  by a dedicated test asserting `createClient` is never called when
  `validateReportForApply` fails (`scripts/grandtour-feed-import.test.mjs`).
- **The RPC is called at most once per invocation, with `p_finalize` always
  `false`**, verified both by a mocked-client unit test and by a real
  end-to-end run against local Supabase (§15.3).
- **Jersey holders, team result lines, and tip scoring are never touched**
  by any Phase 3 code — `runApply` has no reference to
  `grandtour_stage_jersey_holders`, `grandtour_stage_team_result_lines`, or
  `recalculate_grandtour_stage_scores`, and this was independently confirmed
  in the real end-to-end run (§15.3).
- **The scheduled GitHub Actions workflow was not modified** and has no
  `SUPABASE_SERVICE_ROLE_KEY` configured, so it cannot reach `--apply`
  regardless of any future accidental flag change to the workflow file
  alone — the credential itself is the actual barrier.

### 15.3 Verification

- **Automated tests**: `npm run test:data` — 128/128 pass, including 45 new
  pure-function tests (`scripts/grandtour-apply.test.mjs`), 9 new
  `runApply` integration tests against a dependency-injected mock Supabase
  client (`scripts/grandtour-feed-import.test.mjs`), and 8 new CLI
  argument-validation tests (`scripts/grandtour-feed-provider.test.mjs`).
  Covered: missing `--from-report`, wrong provider, stage mismatch, missing/
  non-UUID `stageId`, parser drift, unsafe reconciliation
  (`safeToApply`/`startlistValidationPassed`), TTT (both via `isTtt` and via
  `stageType`), row counts 1-4/6-9 rejected, and exactly 10 accepted (at
  this point in Phase 3, exactly 5 was still accepted too — see §16, which
  resolved that to a refusal), missing/wrong-role service key rejected,
  production URL without `--confirm-production` rejected, a valid report
  calling the RPC exactly once with `p_finalize: false`, `no_change`
  handled as success, and an RPC error surfaced as a thrown failure with no
  retry.
- **SQL tests**: all four `supabase/tests/*.sql` files pass unchanged
  (no schema was modified by this task).
- **Local reconciliation smoke test**: 9/9 scenarios still pass.
- **Real end-to-end run against local Supabase** (not mocked, Phase 3): built
  a hand-written `--from-report` file referencing real seeded stage 2 and
  five real seeded riders (5 rows was still policy-valid at the time — see
  §16 for the top-10 re-run that superseded this), then ran the actual
  `node scripts/grandtour-feed-import.mjs --apply --provider official-letour
  --confirm-provider official-letour --confirm-stage 2 --from-report <path>`
  command with the real local service-role key. Result: `status: "applied"`,
  a `grandtour_stage_results` row with `is_final: false`, 5
  `grandtour_stage_result_lines` in the correct positions, zero
  `grandtour_stage_jersey_holders` rows, zero `grandtour_stage_team_result_lines`
  rows, and one correctly-populated `grandtour_feed_import_runs` row —
  verified directly via `psql`. Re-running the identical command returned
  `status: "no_change"` with exit code 0 and created no new rows. All rows
  created by this verification were deleted afterward to leave the local
  database exactly as found; production was never touched (URL was always
  `http://127.0.0.1:54321`).

> Before the first production use of `--apply`, follow
> [docs/GRANDTOUR_APPLY_MODE_PRODUCTION_READINESS_CHECKLIST.md](GRANDTOUR_APPLY_MODE_PRODUCTION_READINESS_CHECKLIST.md)
> — it turns this spec's gates into an operator-facing checklist with
> backup, migration confirmation, and sign-off steps.

## 16. Top-N policy resolution and Phase 4 conflict/idempotency hardening

Resolved a documented inconsistency (§14.1 originally said "top 10, never
top 5" as its headline rule, but its own "exact selection rule" still
accepted exactly 5 rows as a fallback) and expanded conflict/idempotency
test coverage. No RPC/migration change — this was a CLI-policy and
test/docs consistency fix only, per this task's scope.

### 16.1 Resolved: v1 is top-10-only, exactly 5 is now refused

`scripts/grandtour-apply.mjs`'s `selectTopNRows()` no longer accepts a
5-row stage. The only accepted case is exactly 10 rows with unique,
integer positions in 1–10; every other count (0–9, or a 1–10 set with
gaps/duplicates) is refused with a specific message. §14.1 above was
rewritten to match. The RPC's own 5-or-10 acceptance
(`apply_grandtour_official_stage_result`, unchanged) remains a
looser database-level floor, not the v1 policy — this distinction is now
spelled out explicitly in §14.1 to prevent the same inconsistency from
recurring.

Also added: `selectTopNRows()` now explicitly rejects duplicate parsed
`position` values (previously this could silently produce a wrong-length
selection with an unhelpful generic count error) and reports the actual
counts precisely when a set of 1–10 positions isn't fully present.

### 16.2 Phase 4 test coverage added

- `scripts/grandtour-apply.test.mjs`: exactly-5-rejected, duplicate
  positions rejected, a row with a missing/non-integer position correctly
  reduces the count and is rejected, and an 11-row set with all of 1–10
  present still selects exactly those 10 (11th row ignored) — 4 new tests
  (48 total in this file, up from 45).
- `scripts/grandtour-feed-import.test.mjs`: exactly-5-rejected before the
  RPC is ever called; a stage mismatch cannot be bypassed by editing only
  `report.fromStage`/`toStage` (leaving `reconciliation.stages[0].stageNumber`
  untouched) or vice versa — both independently-checked fields must agree,
  proving the redundant cross-check design in §14.5 actually holds under a
  partial-edit attempt — 3 new tests (12 total in this file, up from 9).
- `scripts/grandtour-apply-local-smoke.mjs` (new) — the top-10 counterpart
  to the ad hoc 5-row manual verification done in §15.3, now a committed,
  re-runnable script (`npm run grandtour:apply:local-smoke`) using 10 real
  seeded riders (bib 4–13, spanning 3 real teams) against a real local
  Supabase instance via the actual `runApply()` code path (not mocked).
  Covers, against the **real** RPC: a valid top-10 apply succeeds; the
  draft result and exactly 10 correctly-ordered result lines exist; zero
  jersey holders and zero team result lines were written; an audit run +
  snapshot row were written; an identical reapply is idempotent
  (`no_change`, no duplicate rows); and — the key new Phase 4 coverage this
  task asked for against real data, not a mock — **a changed reapply
  (positions 1/2 swapped) is rejected, and the original 10 result lines are
  independently re-read afterward and confirmed byte-for-byte unchanged.**
  The script verifies no pre-existing result before it starts, and deletes
  every row it creates afterward, confirmed by a final independent read.
  Refuses outright against any URL matching `KNOWN_PRODUCTION_PROJECT_REFS`,
  with no override flag (unlike the real CLI's `--confirm-production`),
  since it is a disposable dev convenience script, not an operational tool.

Verified 2026-07-09: `npm run test:data` — 134/134 pass (up from 128); all
four `supabase/tests/*.sql` files pass unchanged; the reconciliation local
smoke test — 9/9; the new `grandtour-apply-local-smoke.mjs` — 6/6 against a
real local Supabase instance, with independently-confirmed zero residue
after cleanup.

### 16.3 What was intentionally not changed

- The RPC's `jsonb_array_length(p_result_lines) not in (5, 10)` constraint
  (`supabase/migrations/20260709020000_grandtour_apply_official_stage_result_rpc.sql`)
  — out of scope; this task resolved CLI/docs/test consistency, not the
  database contract.
- Finalization, jersey-holder writes, TTT apply, and tip scoring remain
  entirely unreachable from apply mode, unchanged from §10.
- The scheduled GitHub Actions workflow was not modified and still cannot
  reach `--apply` (no service-role credential configured).
- The §7.3/§7.4 manual-correction-vs-pipeline-reapply distinction remains
  deliberately unimplemented — any differing existing draft is still always
  refused outright (now with real-data proof in §16.2 that the original
  lines survive that refusal untouched).
