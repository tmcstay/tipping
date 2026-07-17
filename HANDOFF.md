# HANDOFF.md

Session handoff notes. Superseded by the next session's update — treat as a point-in-time snapshot, not a permanent record (see CLAUDE.md for durable architecture notes).

Last updated: end of session, 2026-07-17. This session built full automation of the GrandTour official-results workflow — apply, admin-check, finalise, and score now run unattended, not just the pre-existing dry-run/reconcile step. **Everything in this session is committed to the working tree but NOT yet pushed to `origin/main`, and NOT yet live in production** — Tony asked for the design and build, but production enablement (the dedicated service admin account, the four new GitHub secrets, the schedule going live) is explicitly a separate, later, Tony-authorised step. See CLAUDE.md's "GrandTour full automation: apply, check, finalise & score run unattended" section for full technical detail.

## What was completed this session

**1. Scoped the automation with Tony via `AskUserQuestion` before building anything.** Three decisions locked in: automate the **full chain including scoring/emails** (the highest-blast-radius option — a parser mistake could same-day email every tipper unattended); any blocker **always falls back to manual review**, never retried automatically; scoring credentials come from a **dedicated service admin account**, never Tony's own login (since `recalculate_grandtour_stage_scores` requires a real authenticated session, not just a service-role key).

**2. Designed the build in `EnterPlanMode` and got explicit approval** before writing any code — the plan is preserved at `C:\Users\Tony\.claude\plans\quiet-percolating-orbit.md`.

**3. Built `scripts/grandtour-auto-apply-and-score.mjs`** — a thin orchestrator that calls the existing dry-run wrapper unchanged, then (only on a genuine safe `success`) spawns the existing `grandtour-feed-import.mjs --apply` and `grandtour-admin-stage.mjs --check-finalise-score` as subprocesses, exactly as a human operator already runs them. No apply/check/finalise/score logic was reimplemented anywhere.

**4. Mid-build, Tony asked for the real participant count in the success email** (an earlier draft would have said "see the logs"). Implemented by capturing (not just streaming) the check-finalise-score subprocess's stdout and parsing the real `tips_affected` number out of its own existing JSON output, via a new bracket-matching, string-aware JSON extractor — verified both against synthetic fixtures and against real captured output from a live local Supabase run.

**5. Extended `scripts/grandtour-auto-dry-run-notify.mjs`** with three new pipeline-level email outcomes (`applied_and_scored`, `review_incomplete_after_apply`, `apply_failed`) layered on top of the existing dry-run vocabulary — one notify script, no duplication, zero behaviour change for the existing dry-run-only workflow.

**6. Created `.github/workflows/grandtour-auto-apply-and-score.yml`** (new file) and **removed the `schedule:` trigger from the existing `grandtour-auto-dry-run.yml`** (kept as a manual-only, read-only fallback) — so there's exactly one scheduled daily run for this pipeline, not two.

**7. Fixed the fallout**: a pre-existing test (`grandtour-auto-dry-run-workflow.test.mjs`) asserted the old workflow still had a `schedule:` trigger — updated to assert the opposite, plus a new 15-test file (`grandtour-auto-apply-and-score-workflow.test.mjs`) covering the new workflow's own load-bearing safety properties (always passes `--confirm-production`, never hard-codes a secret, kill-switch never fails the job, reads `final-write-summary.json` specifically, distinct artifact/concurrency-group names).

**8. Local rehearsal against real Supabase** (not just mocks): `npx supabase db reset`, then the pre-existing `grandtour:apply:local-smoke`/`grandtour:admin-stage:local-smoke` npm scripts (16/16 and 12/12 scenarios — proving the real RPC chain this orchestrator drives), plus a throwaway script that spawned the *actual* CLI subprocesses (not in-process function calls) with the exact argv shapes the orchestrator itself builds, against a real throwaway admin account it created and deleted. Both exited 0; the real stdout's `tips_affected` was correctly parsed. All rows/users cleaned up afterward, confirmed via direct query.

## Verification

- 25 new orchestrator unit tests, 8 new notify tests, 15 new workflow-YAML tests, 2 fixed pre-existing workflow tests — all passing.
- Full pre-existing suite unaffected: 556 `test:data`, 74 root `npm test`, 225 mobile `test:ui`, 20 mobile `test:api`, all passing.
- `tsc --noEmit`: clean aside from the same pre-existing, unrelated Deno-runtime errors in `supabase/functions/`.
- Real local Supabase rehearsal (see item 8 above) — both the apply RPC and the mark-checked→finalise→score RPC chain proven live, via both the in-process functions (existing smoke tests) and the actual CLI subprocess boundary (this session's own throwaway verification, discarded after use, never committed).
- Did **not** attempt a genuine live-fetch dry-run "success" classification against local Supabase — local seed `grandtour_riders` data is synthetic (documented pre-existing gap, unrelated to this session), so a real letour.fr fetch reconciled against it would never cleanly match. Every branch of the orchestrator's own logic (blocker fallback, TTT fallback via the CLI's existing unconditional refusal, apply failure, check-finalise-score failure, missing-credentials skip) is instead covered deterministically by the 25 mocked unit tests, combined with the real-RPC proof above for the success path specifically.

## Exact next steps for the next session

1. **Nothing has been pushed to `origin/main` yet.** Review the diff with Tony, then commit + push when he's ready (git commits/pushes require his explicit approval per this session's own working preferences — not done automatically).
2. **Production enablement is a separate, later, explicitly-authorised step**, per `docs/GRANDTOUR_APPLY_MODE_PRODUCTION_READINESS_CHECKLIST.md` §17.10:
   - Create the dedicated service admin account in production (sign-up + `user_app_memberships` role grant — SQL provided in §17.10).
   - Set four new GitHub Actions repository secrets: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ADMIN_EMAIL`, `SUPABASE_ADMIN_PASSWORD`, `ADMIN_USER_ID`.
   - Confirm the schedule swap (old workflow's cron removal + new workflow's cron) is intentional and ready before merging to `main` — the new workflow starts running the moment it lands on the default branch with a `schedule:` trigger, whether or not the four secrets exist yet (though it gracefully no-ops to dry-run-only behaviour without them).
3. **CLI parity gap, unrelated but worth remembering**: `scripts/uci-rider-review.mjs --resolve` still has no equivalent of the admin page's "Confirm Match" (from an earlier session) — untouched this session.
4. Everything from prior sessions' own next-steps not touched this session (the production UCI data sync decision, local seed data realism, admin-page RLS-visibility test gap, duplicate stage-results-email product question, the unexplained "page refreshes on button click" report) is unrelated to this session's work and still stands as documented in CLAUDE.md.

## Open questions / decisions that need revisiting

- **When should production enablement actually happen?** Not decided this session — the build is done and locally rehearsed, but Tony hasn't yet said when to create the production admin account / set the secrets / let the schedule go live.
- **Should the write-phase failure emails (`review_incomplete_after_apply`/`apply_failed`) eventually gain a retry-from-the-admin-UI action**, similar to the existing failed-notification-job retry RPC? Not built, not requested — a natural follow-up once this pipeline has run in production for a while and any real failure patterns are known.
- Everything in prior sessions' own "Open questions" not touched this session is still unresolved and unrelated to this session's work.
