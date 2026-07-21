# Admin Stage Review

## Purpose
Give an authorized cycling admin a UI (not just the CLI/SQL) to run the
apply → admin-check → finalise → score workflow, correct an already-applied
result, and see notification-delivery status — safely, without a
service-role key ever touching the browser.

## Confirmed rules
- Gated by `useGrandTourAdminAccess()` — checks the signed-in user holds an
  active `admin` role on the `cycling` app
  (`public.apps`/`public.user_app_memberships`), read via normal RLS with the
  publishable/anon key. No service-role key is ever used by this panel.
- `p_checked_by`/`p_finalized_by` are always the signed-in user's own
  `auth.uid()`, never a free-text field.
- Every RPC call re-validates every gate server-side — the UI is convenience,
  not the authorization boundary.

## User experience
`/admin/grandtour-stages` — reachable from Profile → "GrandTour stage review
(admin)" (only shown to confirmed admins). Per-stage collapsed-by-default
accordion (`GrandTourStageAdminAccordion`) showing stage number/name/date,
review-status, final/not-final, and an at-a-glance
`"7/10 lines · 3/4 jerseys · 0 scored"` count. Sections per stage card, in
order:
1. **Review Results** — expandable; shows the actual top-10 result lines
   (or team lines for a supported TTT stage) and 4 jersey holders before any
   action. Mark Checked stays disabled until this has loaded at least once.
2. **Run Official Check** — preview-only dry-run via a server route
   (`apps/mobile/api/admin/grandtour/run-official-check.mjs`); never applies,
   never a service-role key. Result renders in "Latest official check ▼".
   Never feeds Mark Checked/Finalise/Score gating — those only look at
   what's actually applied.
3. **Apply Official Result** — enabled only once a check has run,
   `safeToApply=true`, and the stage isn't already final. Calls a second
   server route that re-fetches and re-validates server-side (never trusts
   the browser), applies using the admin's own session.
4. **Update Results / Re-run Official Import** — the correction workflow
   (Part C). Paste a CLI-generated `--reconcile` report, preview a diff
   against the currently-stored result, enter a required reason, confirm,
   call `correct_grandtour_stage_result_from_reviewed_report`. Deliberately
   never fetches letour.fr itself — no server-side scraping endpoint exists.
5. A compact, read-only notification-status counts line (pending/processing/
   sent/failed/skipped per stage).

Mark Checked / Finalise / Score buttons follow the same RPC gates as the
CLI.

## Data model
No new tables specific to the admin UI — reads
`grandtour_stage_results`/`_result_lines`/`_jersey_holders`/
`_team_result_lines`, `grandtour_feed_import_runs`/`_snapshots`,
`grandtour_stage_notification_jobs` (for the counts line), all via
`packages/supabase-client/src/grandtourAdmin.ts`.

## Relevant source files
- `apps/mobile/app/admin/grandtour-stages.tsx`
- `apps/mobile/components/GrandTourStageAdminAccordion.tsx`,
  `GrandTourStageAdminCard.tsx`
- `apps/mobile/lib/grandtourAdminExperience.ts`,
  `grandtourOfficialCheckExperience.ts`, `grandtourCorrectionExperience.ts`
- `packages/supabase-client/src/grandtourAdmin.ts`
- `apps/mobile/api/admin/grandtour/run-official-check.mjs`,
  `apply-official-result.mjs`
- `apps/mobile/hooks/useGrandTourAdmin.ts`

## Relevant migrations
- `20260710060000_grandtour_admin_check_finalise_authenticated_grants.sql` —
  the migration that made this UI's RPC calls functional at all (previously
  `service_role`-only) and fixed the `is_cycling_admin()` NULL-vs-false bug
  (see [DATABASE.md](../development/DATABASE.md) gotcha #6).
- `20260714010000_grandtour_apply_authenticated_grant.sql` — same extension
  for apply.
- `20260713010000_grandtour_is_current_user_cycling_admin_rpc.sql` — the
  public wrapper RPC the server routes use to authorize (they have no
  service-role key available).
- `20260717010000_grandtour_feed_import_runs_authenticated_grant.sql` —
  fixed a real `permission denied` on page load for a genuine admin session
  (local-only as of the last review — not yet pushed to production, see
  [CURRENT_STATE.md](../project/CURRENT_STATE.md)).

## Current implementation
Fully built and functional, including the correction workflow and
notification-status visibility.

## Outstanding work
- **No interactive "retry this failed job" button** for a failed
  notification job — the RPC (`retry_grandtour_stage_notification_job`) and
  data-layer function exist and are safe to call, but no UI picker was
  built.
- **Full-page-refresh-on-button-click**, reported live in production, not
  reproduced locally — see
  [TROUBLESHOOTING.md](../development/TROUBLESHOOTING.md).
- No UCI-registry-sync trigger button (see
  [official-data-import.md](official-data-import.md)).

## Edge cases
- Bib numbers prefer the stage's `grandtour_stage_startlists.bib_number`
  override, falling back to the rider's canonical `grandtour_riders.bib_number`
  — the two can genuinely differ in real data; don't assume a small
  hand-picked fixture bib reflects a real column without checking.
- After a correction, the affected stage card automatically resets to
  `review_status=correction_required`/`is_final=false`/`score_count=0`, and
  Mark Checked/Finalise/Score become available again from scratch.

## Acceptance criteria
- A non-admin authenticated user sees no admin data or controls.
- No action is available before its prerequisite gate (checked before
  finalised, finalised before scored).

## Tests
No dedicated automated test harness for this screen's rendering (this repo's
`test:ui` covers pure logic only) — verified historically via real
Playwright sessions against a local rebuild with a throwaway admin account.
See [TESTING.md](../development/TESTING.md) "Browser/UI verification".
