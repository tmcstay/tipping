# Completed Work

Concise summaries of significant completed work, newest first. Not a full
transcript — see `git log` for exact commits, and `docs/features/*.md` for
the durable technical record of what each piece of work actually built.

---

## 2026-07-17 — Documentation reconciliation
Restructured all project instructions/documentation into
`docs/project/`, `docs/development/`, `docs/features/`, `docs/handovers/`,
with concise root `CLAUDE.md`/`AGENTS.md` routers. No application code
changed. See [RECONCILIATION_REPORT.md](RECONCILIATION_REPORT.md).

## 2026-07-17 — GrandTour full automation live in production
Apply → admin-check → finalise → score now runs unattended daily (19:30 UTC),
behind a dedicated service admin account, with any blocker falling back to
manual review. See [official-data-import.md](../features/official-data-import.md).

## 2026-07-17 — Master UCI rider registry + admin review page
Cross-race rider identity registry (schema + roster-driven sync + admin
review UI), linked to `grandtour_riders` via `master_rider_id`. Schema live
in production; data sync not yet run against production (deferred by product
owner choice). See [official-data-import.md](../features/official-data-import.md).

## 2026-07-16/17 — TDF 2026 rider importer (UCI revision)
Replaced the blocked ProCyclingStats source with UCI's own public rider API
for DOB/nationality/team-history enrichment of the 184-rider startlist. See
[official-data-import.md](../features/official-data-import.md).

## Earlier sessions (2026-07 range) — GrandTour UI/UX consistency pass
Shared grand-tour naming, live lock countdowns, consolidated scoring badges,
admin accordion, participant detail page, a production auth-callback
redirect-loop fix (three iterations), and a production leaderboard crash fix
(`<Link asChild>` inside `.map()`). See
[docs/development/TROUBLESHOOTING.md](../development/TROUBLESHOOTING.md) for
the specific bugs and fixes, and [leaderboards.md](../features/leaderboards.md)/
[authentication.md](../features/authentication.md) for the feature-level
record.

## Earlier sessions — Resend transactional stage-results email
Full pipeline: preferences, job queue, retry RPC, pg_cron + event-driven
dispatch from scoring, live in production. See
[official-data-import.md](../features/official-data-import.md) (the
"Notify" stage of the results pipeline).

## Earlier sessions — GrandTour official-letour feed pipeline (original build)
Parse → reconcile → apply → admin-check → finalise → score, dry-run-by-default
throughout, TTT (`individual_time`) support added later. See
[official-data-import.md](../features/official-data-import.md) and
[ttt-scoring.md](../features/ttt-scoring.md).

## Earliest recorded work — GrandTour MVP pivot from F1Tips
The product pivoted from an F1-branded MVP to the current GrandTour cycling
product. See [docs/project/PRODUCT.md](../project/PRODUCT.md) and the
(superseded) `GRANDTOUR_APP_SCOPE.md` for the original design brief that
drove this pivot.

---

For anything not summarized above, the git log on `main` and each feature
doc's "Current implementation"/"Relevant migrations" sections are
authoritative.
