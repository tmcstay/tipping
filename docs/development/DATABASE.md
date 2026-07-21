# Database

Postgres via Supabase. 50 migration files exist locally as of this review
(`supabase/migrations/`, ordered by timestamp prefix). See
[DECISIONS.md](../project/DECISIONS.md) #3 for the immutability rule.

## Working with migrations

- Never rewrite an applied migration. Add a new one, even to fix a mistake in
  a previous one.
- Before altering, replacing, or adding to existing schema: inspect local and
  remote migration state (`npx supabase migration list --linked` for
  production; local state via `npx supabase db diff`/`status`).
- Rehearse every migration against **local** Supabase first
  (`npx supabase db reset` + the relevant `supabase/tests/*.sql` files +
  `npm run test:data`/`npm test`) before it is ever pushed to production.
- Regenerate `packages/shared-types/src/database.ts`
  (`npx supabase gen types typescript --local`) after any local migration that
  adds columns/RPCs the frontend needs typed access to, before pushing that
  migration to production.
- Production's actual migration boundary has drifted from documentation before
  (a stale note claimed production stopped at an older migration than it
  actually had). **Always verify directly** — don't trust a prior note,
  including notes in this file — via `migration list --linked` or a direct
  schema query.

## Recurring grant/RLS gotchas (read before adding any new table or function)

These have each independently cost a debugging session in this project — check
new work against this list before calling it done.

1. **RLS policies are not sufficient on their own.** A table needs both RLS
   policies *and* an explicit `grant select/insert/update/delete ... to
   <role>` — RLS only filters rows, and is never even consulted if the base
   table grant doesn't exist. This exact class of bug has recurred on at least
   three separate, unrelated tables (`public.profiles`,
   `grandtour_stage_notification_jobs`/`grandtour_notification_preferences`,
   `grandtour_feed_import_runs`/`grandtour_feed_snapshots`) — each time
   presenting as a genuine `permission denied` error, not an RLS-filtered
   empty result.
2. **A newly created function grants EXECUTE to `PUBLIC` by default.**
   `grant execute ... to authenticated` alone does not revoke that — always
   `revoke all on function ... from public;` first when a function should be
   admin/authenticated-only. Verify with a real negative-path test (an `anon`
   or non-admin `authenticated` session actually calling the function), not
   just a positive-path test.
3. **A signature-changing `create or replace function` is not a same-OID
   replace** — Postgres treats a different parameter list as a distinct
   overload, silently leaving both versions defined. Explicitly
   `drop function if exists ...(<old exact signature>)` first when the
   parameter list changes. A fresh `create function` (via drop+recreate) also
   **resets EXECUTE to the PUBLIC default and loses every previously granted
   role's access** — always follow it with an explicit `revoke all` +
   re-grant to every intended role.
4. **`security definer` elevates privileges only inside the function's own
   body** — it grants the *caller* nothing extra. A `security invoker`
   function called from inside a `security definer` function still runs as
   the original caller and needs its own grants (e.g. schema `USAGE`).
5. **Postgres does not guarantee left-to-right short-circuit evaluation of
   `AND`/`OR`** in a single boolean expression. When one branch of a
   condition would fail for a caller who should be allowed by the other
   branch (e.g. `auth.role() = 'service_role' or <RLS-dependent check>`), use
   PL/pgSQL `if/else` control flow instead, which does guarantee an
   unexecuted branch is skipped.
6. **A `returns boolean` function meant to guard an `if not fn() then raise`**
   must be `select exists(...)`, never a bare `where exists(...)`-filtered
   row select — the latter returns SQL `NULL` (not `false`) when no row
   matches, and `if not NULL` never takes the branch. RLS `using`/`with check`
   clauses are unaffected by this (Postgres treats RLS `NULL` as `false`) —
   only imperative `if not X then raise` guards are exposed.
7. **A "prevent delete while final" trigger blocks a legitimate `on delete set
   null` cascade too**, unless the trigger explicitly allows an update that
   only nulls out the referencing FK column. Any new append-only/audit table
   with `on delete set null` FKs needs this carve-out from day one.
8. **A trigger that unconditionally blocks all `UPDATE`s on an append-only
   table** will also block a legitimate FK-driven `SET NULL` when the
   referenced row is deleted — same fix as above, generalized.

## Key tables (GrandTour domain)

See [official-data-import.md](../features/official-data-import.md) for the
full official-results pipeline schema, and
[stage-tipping.md](../features/stage-tipping.md)/[scoring.md](../features/scoring.md)
for the tipping/scoring schema. High-level map:

- `grand_tours`, `grandtour_stages` — race and stage metadata, lock times,
  `ttt_timing_rule`, `manual_result_entry_enabled`.
- `grandtour_teams`, `grandtour_riders`, `grandtour_stage_startlists` — roster
  data, rider status, `master_rider_id` link to the UCI registry.
- `grandtour_tips`, `grandtour_tip_selections` — user picks.
- `grandtour_stage_results`, `grandtour_stage_result_lines`,
  `grandtour_stage_jersey_holders`, `grandtour_stage_team_result_lines` (TTT) —
  official results.
- `grandtour_stage_scores` — computed scores per tip.
- `grandtour_result_audit_log`, `grandtour_feed_import_runs`,
  `grandtour_feed_snapshots` — audit trails for the results pipeline.
- `uci_riders`, `uci_rider_aliases`, `uci_rider_team_history`,
  `uci_rider_specialties`, `uci_rider_review_queue`, `uci_rider_sync_runs` —
  the cross-race UCI master rider registry.
- `profiles`, `user_app_memberships`, `apps` — auth/authorization.
- `grandtour_notification_preferences`, `grandtour_stage_notification_jobs` —
  Resend email pipeline.

## Local seed data caveat

`supabase/seed.sql` uses synthetic stage dates (2026-08-01+) unrelated to the
real production TDF 2026 schedule (which starts ~2026-07-04, one stage/day at
12:00 UTC). Don't assume local `grandtour_stages` rows reflect real-world race
timing — query production directly when reasoning about actual dates.
`grand_tours.source_url` is also `NULL` locally, which breaks the local
leaderboard hook chain until manually set for a session.
