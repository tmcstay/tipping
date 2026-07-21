# Session Log

Brief, chronological. One or two lines per session/commit cluster — full
detail lives in `git log`, feature docs, and (for this specific pass)
`RECONCILIATION_REPORT.md`. Do not paste chat transcripts here.

- **2026-07-17** — Documentation reconciliation (Claude Code): restructured
  all instructions/docs; no application code changed.
- **2026-07-17** — Full GrandTour automation (apply→check→finalise→score)
  built and enabled live in production.
- **2026-07-17** — Master UCI rider registry schema, roster-driven sync, and
  admin review page built; schema pushed to production, data sync deferred.
- **2026-07-16** — GrandTour UI/UX consistency pass: shared naming, live
  countdowns, consolidated scoring badges, admin accordion, participant
  detail page; a production leaderboard crash and a heading-color/alignment
  fix followed.
- **2026-07-16** — Resend stage-results email: event-driven dispatch from
  scoring, provider-error-message capture fix.
- **2026-07-15** — Resend stage-results email pipeline (preferences, job
  queue, retry RPC, cron) built and deployed.
- **2026-07-15** — `public.profiles` SELECT grant restored (a grant-gap bug
  that had recurred across two earlier sessions).
- **2026-07-14** — GWFC brand re-theme extended to stage list/tip entry;
  leaderboard movement RPC; profile first/last name.
- **2026-07-14** — TTT (`individual_time`) support: apply, admin-check,
  finalise, admin UI.
- **2026-07-13** — Dashboard visual redesign (minimalist, single-accent,
  user-centric hierarchy); production auth-callback redirect-loop fixed for
  real (duplicate `/` route registration was the root cause, after two
  earlier fix attempts).
- **Earlier (2026-07 range)** — GrandTour MVP build-out: schema, scoring,
  locking, official-letour feed pipeline, TDF 2026 rider importer, admin
  review workflow. See `docs/handovers/COMPLETED_WORK.md` and `git log` for
  the full sequence — too many individual commits to enumerate here.
- **Earliest** — Product pivot from F1Tips to GrandTour (cycling).
