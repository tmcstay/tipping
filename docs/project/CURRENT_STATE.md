# Current State

**Last reviewed: 2026-07-17**, during a documentation reconciliation pass. This
file is a snapshot — re-verify anything load-bearing (migration boundary,
per-stage review status, secret/grant state) directly against the database or
GitHub before acting on it, rather than trusting this note indefinitely. See
[docs/handovers/RECONCILIATION_REPORT.md](../handovers/RECONCILIATION_REPORT.md)
for how this snapshot was produced.

## Production state

- **Deploy branch**: `main`. Vercel auto-deploys every push. All four
  `feature/*` branches that previously existed have been fully merged into
  `main` (verified via `git log main..<branch>` — zero commits ahead on any of
  them as of this review). `production/grandtour-ui-ttt-overhaul` and
  `repo-assistant-work` are also fully merged (zero commits ahead of `main`).
- **Supabase migrations**: 50 migration files exist locally
  (`supabase/migrations/`), most recently `20260717060000_confirm_grandtour_rider_master_link_rpc.sql`.
  Production is reported current through the same boundary as of the last
  session that pushed schema — **this has drifted before** (see
  [DECISIONS.md](DECISIONS.md) #12 and the note in
  [official-data-import.md](../features/official-data-import.md)); always
  verify with `npx supabase migration list --linked` before trusting a stale
  claim, including this one.
- **TDF 2026 startlist** (23 teams, 184 riders) is loaded and verified in
  production.
- **GrandTour full automation** (parse/reconcile → apply → admin-check →
  finalise → score → notify) is live in production as of 2026-07-17, running
  daily at 19:30 UTC via `.github/workflows/grandtour-auto-apply-and-score.yml`,
  behind a dedicated `grandtour-automation@tipsuite.app` service admin account.
  **Its first real scheduled production run had not yet been observed** as of
  the session that enabled it — confirm at least one completed run before
  treating this as fully proven end-to-end in production.
- **Resend stage-results email** is live in production (`send-stage-results`
  Edge Function, `pg_cron` every 15 minutes as a fallback, event-driven
  dispatch from scoring as the primary trigger).
- **UCI master rider registry schema** is live in production (6 migrations,
  `20260717010000`–`20260717060000`); **no registry data has been synced to
  production** (`uci_riders` is schema-only there) — explicitly deferred by
  product owner choice, not a technical blocker.

## Implemented (verified against code, tests, and/or a real local or production run)

- Email/password auth, profile (display name + first/last name), signup
  metadata → profile trigger, password reset, auth callback routing (three
  iterations, see [authentication.md](../features/authentication.md)).
- Stage tipping: daily and preselection modes, ordered top-five + 4 jersey
  picks, atomic save, duplicate-rider validation, lock-state resolution
  (including admin manual-lock override).
- TTT (`individual_time` rule only) apply → admin-check → finalise → score,
  full chain, hand-verified point totals.
- Scoring: rider top-five, TTT top-five, jerseys (daily + final), all in
  `packages/tipping-core`, shared by daily and preselection.
- Leaderboards: daily/preselection/overall types exist at the schema level
  (`leaderboard_type`), plus a `previous_rank`/movement RPC
  (`get_grandtour_leaderboard_with_movement`).
- Official-letour results pipeline: parse, reconcile, apply, admin-check,
  finalise, score — CLI and admin-UI paths, both gated, both dry-run-by-default.
- Admin stage review UI (`/admin/grandtour-stages`): collapsed accordion,
  review-results panel, correction workflow, notification-status counts,
  "Run Official Check" / "Apply Official Result" buttons.
- UCI master rider registry: schema, sync CLI, roster-driven seeding, category
  filtering, admin review page (`/admin/uci-rider-review`), linking RPC.
- TDF 2026 rider importer: standalone CLI enriching the 184-rider roster with
  UCI DOB/nationality/team-history.
- Dashboard, stages list, results, leaderboard, my-tips, participant-detail,
  profile screens — all re-themed to the GWFC brand palette, all using the
  shared `resolveCyclingStageClosureState`/`buildClosureDisplay` closure logic.
- Result eligibility guard (`isStageEligibleForResults`) — future stages can
  never appear as results, enforced at query layer + selector + screen.
- Notification preferences (per-user opt-out toggle on Profile).

## Partially implemented / known gaps

- **Preselection mode's own lock UI path is real but comparatively
  under-verified** relative to daily mode — most of the documented session
  history (browser verification, bug fixes) concentrates on daily-mode
  screens. No evidence of a defect; just less recent hands-on verification.
- **DNS/DNF rider-status handling** exists as data (`grandtour_riders.status`,
  `grandtour_stage_startlists.status` enums including `dns`/`dnf`/`otl`/etc.)
  but there is no dedicated document or confirmed end-to-end UX audit of how a
  DNS/DNF rider is presented in the tip picker or results screens. Flagged in
  [ROADMAP.md](ROADMAP.md).
- **Young-rider (white jersey) eligibility** — the cutoff-date rule is
  implemented and tested in the TDF 2026 importer's `specialty`/eligibility
  module, but there's no evidence it's wired into stage-tipping validation
  (i.e. nothing stops a user picking an over-25 rider for white jersey in the
  UI). Flagged in [ROADMAP.md](ROADMAP.md).
- **Manual result entry** (admin hand-enters a result when the feed fails) —
  the enabling flag (`grand_tours.manual_result_entry_enabled`) and its setter
  RPC exist; no RPC or UI reads/acts on it yet.
- **"Unfinalise" RPC** does not exist — a finalised result cannot be reopened
  except via the correction RPC (which requires new content) or direct table
  access.
- **UCI rider review page has no way to trigger a registry sync from the UI**
  — only the CLI can run `--seed-from-roster`. Deferred by explicit product
  decision, scope not yet defined (execution model + race scope both open).
- **Only Tour de France is a real race in the data model.** Giro/Vuelta accent
  colors exist as unreachable code (`getRaceHeadingAccent`) — cosmetic-only,
  not a sign of broader multi-race readiness.
- **CLI/UI parity gap**: `scripts/uci-rider-review.mjs --resolve` cannot link
  `master_rider_id` (only `resolve_uci_rider_review_item`); only the admin
  page and `tdf-2026-registry-match-report.mjs --apply` call
  `confirm_grandtour_rider_master_link`.

## Known defects (open, disclosed)

- **Admin stage-review page full-page-refresh-on-button-click**, reported by
  the product owner in production. Investigated with a real headless-browser
  session; could not be reproduced locally. Root cause unconfirmed — see
  [TROUBLESHOOTING.md](../development/TROUBLESHOOTING.md).
- **Rescoring/correcting an already-notified stage always re-sends
  stage-results emails to every participant**, even to users whose own score
  didn't change. By design of the current dispatch mechanism, not yet
  revisited as a product decision.
- **The automated dry-run's findings never surface in the app** — no
  persistence layer connects the GitHub Actions run to `/admin/grandtour-stages`.
- **Three independent race-name keyword classifiers exist** (`grandTourDisplay.ts`,
  its Deno twin, and `raceAccent.ts`) with no shared source — a future race
  added to one and not the others would silently disagree. Low current risk
  (one real race), flagged for whenever a second race is added.
- **`public.profiles`/notification-table grant gaps have recurred at least
  three separate times** (profiles, notification tables, `grandtour_feed_import_runs`/
  `grandtour_feed_snapshots`) — each fixed individually; no systematic audit
  of every RLS-bearing table's grants has been run. See
  [DATABASE.md](../development/DATABASE.md).

## Operational dependencies

- Resend (transactional email) — hosted secrets configured, live.
- GitHub Actions secrets: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ADMIN_EMAIL`,
  `SUPABASE_ADMIN_PASSWORD`, `ADMIN_USER_ID` (full-automation workflow),
  `SMTP_*` + `ADMIN_EMAIL` (dry-run notification — **not yet confirmed set**,
  see [ROADMAP.md](ROADMAP.md)).
- Vercel env vars: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
  `EXPO_PUBLIC_APP_URL` (Production confirmed set; Preview still needs a
  one-time manual dashboard add — CLI could not set it, see
  [DEPLOYMENT.md](../development/DEPLOYMENT.md)).
- `grand_tours.source_url` is `NULL` in local dev seed data — breaks the local
  leaderboard hook chain until manually set; production value unverified.

## Recent verification (as last documented in code/session history)

- 556 `test:data` (Node `scripts/*.test.mjs`), 74 root `npm test`
  (`tipping-core` + `supabase-client`), 225 mobile `test:ui`, 20 mobile
  `test:api`, 11 SQL test files (pgTAP-style) — all passing as of the last
  session that touched the GrandTour automation pipeline (commit `8fdc546`).
  Re-run before relying on these counts — see
  [TESTING.md](../development/TESTING.md) for exact commands.
