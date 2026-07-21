# Official Data Import

Covers three distinct, independently-built pipelines. See
[docs/development/DATA_IMPORTS.md](../development/DATA_IMPORTS.md) for the
quick command index, and the still-authoritative operational docs
[docs/grandtour-results-feed.md](../grandtour-results-feed.md) /
[docs/grandtour-apply-mode-spec.md](../grandtour-apply-mode-spec.md) for the
full original design record and rehearsed operator sequences.

## Purpose
Import official Tour de France stage results, jersey holders, and rider
identity/biographical data safely, with a fully-gated dry-run-first workflow,
so tipping can be scored against a trustworthy official record without ever
risking an unreviewed automated write to production.

## Confirmed rules
- **Dry-run by default everywhere.** Every write path requires explicit
  multi-flag confirmation and refuses a known production Supabase URL
  without `--confirm-production`.
- **Apply is one-stage-only, top-10-only, drafts-only.** Admin-check,
  finalise, and score are separate, later, independently-approved steps.
- Apply mode never re-fetches or re-reconciles live — it only trusts a
  `--from-report` file, checked for freshness (max 6 hours old).
- Official results have exactly one source: letour.fr. UCI rider
  DOB/nationality/team-history has exactly one source: UCI's own public
  rider API. See [DECISIONS.md](../project/DECISIONS.md) #8.
- A UCI identity match is never guessed: more than one plausible
  (high/medium-confidence) candidate always degrades to a review item.

## Pipeline 1: Official-letour results feed

**Stages**: Parse (`scripts/grandtour-feed-provider.mjs`) → Reconcile
(`scripts/grandtour-reconciliation.mjs` + `-supabase.mjs`) → Apply (RPC
`apply_grandtour_official_stage_result`) → Admin-check
(`mark_grandtour_stage_result_checked`) → Finalise
(`finalize_grandtour_stage_result`) → Score
(`recalculate_grandtour_stage_scores`) → Notify (Resend, see
[stage-results.md](stage-results.md) for the user-facing side and the
Resend/email section of `CLAUDE.md`'s predecessor content, now folded into
this pipeline's automation below).

**Automation**: `.github/workflows/grandtour-auto-apply-and-score.yml` runs
the full chain unattended, daily at 19:30 UTC, behind a dedicated
`grandtour-automation@tipsuite.app` service admin account. Any blocker
(unmatched rider, parser drift, low-confidence reconciliation, TTT with an
unsupported timing rule, or any write-step failure) always falls back to
manual review — never retried automatically at the write phase.
`.github/workflows/grandtour-auto-dry-run.yml` remains as a manual-only,
read-only fallback (it lost its own `schedule:` trigger once the full-chain
workflow took over the daily slot, to avoid two competing scheduled runs).

**TTT support**: only `ttt_timing_rule = 'individual_time'` stages are
applyable — see [ttt-scoring.md](ttt-scoring.md).

**Admin UI**: `/admin/grandtour-stages` — "Run Official Check" (preview-only
dry-run via a server route, `apps/mobile/api/admin/grandtour/run-official-check.mjs`),
"Apply Official Result" (a second server route that re-fetches and
re-validates server-side, never trusts the browser's copy, and applies using
the admin's own session — never a service-role key in Vercel), "Update
Results / Re-run Official Import" (the correction workflow, requires a
CLI-generated report pasted in — no server-side scraping endpoint exists).
See [admin-stage-review.md](admin-stage-review.md) for the full UI.

**Key RPCs** (all `security definer`, all callable by `service_role` or an
authenticated cycling admin):
`apply_grandtour_official_stage_result`,
`mark_grandtour_stage_result_checked`, `finalize_grandtour_stage_result`,
`correct_grandtour_stage_result_from_reviewed_report`,
`set_grandtour_manual_result_entry_enabled` (service-role-only).
`recalculate_grandtour_stage_scores` is the one exception — `security
invoker`, requires a real authenticated cycling-admin session.

## Pipeline 2: UCI master rider registry

Cross-race canonical rider identity (`uci_riders` + `uci_rider_aliases` +
`uci_rider_team_history` + `uci_rider_specialties` + `uci_rider_review_queue`
+ `uci_rider_sync_runs`), linked to (never replacing) the tour-scoped
`grandtour_riders` table via a single nullable `master_rider_id` column.

- **Source**: `GET https://www.uci.org/api/riders/<disciplineCode>/<year>`
  — a genuine first-party, unauthenticated, paginated JSON API backing UCI's
  own rider search widget. `category` param filters to men's professional
  team categories (`WTT`/`PRT`/`CTM` by default — women's categories are
  deliberately excluded).
- **Roster-driven seeding** (the actual intended workflow, not a calendar
  job): `node scripts/uci-rider-sync.mjs --seed-from-roster letour --apply`
  drives UCI lookups off a race's own official roster (search by name per
  entrant), then `node scripts/tdf-2026-registry-match-report.mjs --apply`
  links/queues that race's entries against the registry.
- **Matching priority** (never fuzzy-guessed): explicit UCI id on the entry
  → another trusted external id (none exist yet) → exact canonical
  `normalized_name` → exact alias → scored candidate (deterministic tiers,
  a DOB conflict always forces low confidence) → manual review queue. Only
  exact-identity match methods auto-link `master_rider_id`; a `scored` match
  is always queued for human confirmation, never auto-linked.
- **Admin UI**: `/admin/uci-rider-review` — lists pending review-queue items,
  side-by-side comparison, four actions (Confirm Match, Approve as new
  rider, Ignore, Flag for source correction).
- **Key RPC**: `confirm_grandtour_rider_master_link` — sets
  `master_rider_id` and, if a review item is supplied, resolves it and
  optionally creates an alias, all in one transaction. Idempotent on an
  identical `(grandtour_rider_id, uci_rider_id)` pair.

## Pipeline 3: TDF 2026 rider importer

Standalone CLI (`scripts/tdf-2026-rider-importer.mjs`), independent of both
pipelines above — enriches the 184-rider TDF 2026 startlist with UCI-sourced
DOB/nationality/team-history before any of it existed in the master
registry. Source hierarchy: letour.fr roster page → UCI rider-details data →
existing Supabase row (preserves a trusted existing value). DOB merge is
stricter than every other field: a low-confidence UCI match never writes an
empty DOB; a genuine conflict between trusted-existing and new-confident
values keeps the existing value and reports `conflict: true`.

## Relevant source files
See [ARCHITECTURE.md](../project/ARCHITECTURE.md) "Script layer" for the full
file map — too many individual files to duplicate here without drifting; the
authoritative list of exact filenames lives in the script directory itself
(`scripts/`) and each file's own header comment.

## Relevant migrations
All results-pipeline and registry migrations from
`20260629080958_grandtour_mvp.sql` through
`20260717060000_confirm_grandtour_rider_master_link_rpc.sql`. See
[DATABASE.md](../development/DATABASE.md) for the recurring grant/RLS
gotchas this pipeline has repeatedly hit.

## Current implementation
All three pipelines are built, tested, and (for the results feed and the
registry schema) live in production. See
[CURRENT_STATE.md](../project/CURRENT_STATE.md) for exactly what's confirmed
live vs. schema-only vs. never-run-against-production.

## Outstanding work
- No production UCI registry **data** sync has been run (schema only).
- No UI trigger for the registry sync exists — CLI only.
- Manual result entry (for when the feed itself fails) is designed but not
  built.
- No "unfinalise" RPC.
- The automated dry-run's findings never surface in the app.
- See [ROADMAP.md](../project/ROADMAP.md) for the full list.

## Edge cases
See [ttt-scoring.md](ttt-scoring.md) for TTT-specific edge cases, and
[DATABASE.md](../development/DATABASE.md) for the Postgres trigger-ordering
gotcha (`is_final` must be flipped false *before* deleting result lines when
correcting an already-finalised stage).

## Acceptance criteria
- A stage can never be finalised without first being admin-checked.
- Scoring can never run before finalisation.
- No write path ever accepts a service-role key from the browser or Vercel.

## Tests
`npm run test:data` (the full `scripts/*.test.mjs` suite — this is the
majority of that suite), plus `supabase/tests/grandtour_apply_official_stage_result.sql`,
`supabase/tests/grandtour_finalize_stage_result.sql`,
`supabase/tests/confirm_grandtour_rider_master_link.sql`, and the
local-smoke npm scripts listed in [TESTING.md](../development/TESTING.md).
