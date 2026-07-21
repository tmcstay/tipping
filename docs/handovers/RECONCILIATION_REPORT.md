# Reconciliation Report

Produced 2026-07-17 by a documentation reconciliation pass (Claude Code).
Scope: inspect the repository's accumulated work and build a shared,
non-duplicated documentation structure for Claude Code and Codex. No
application code was changed.

## Repository state reviewed

- Working tree at session start: `main` up to date with `origin/main`;
  modified-but-uncommitted `CLAUDE.md`/`HANDOFF.md`, and four untracked
  `tmp/tdf-2026-riders*` files (left untouched — not part of this task's
  scope, and consistent with this repo's documented convention of some
  intentionally-tracked `tmp/*.json` artifacts).
- Latest commit: `8fdc546` ("Automate GrandTour apply/check/finalise/score
  after a safe dry run"), 2026-07-17.
- 69 total commits on `main`.

## Branches inspected

`main`, `feature/grandtour-daily-feed-dry-run`,
`feature/grandtour-daily-feed-scoring`,
`feature/grandtour-official-letour-provider`,
`feature/grandtour-tip-entry-results-feed`,
`production/grandtour-ui-ttt-overhaul`, `repo-assistant-work`, plus their
`origin/*` remotes. **All are fully merged into `main`** — `git log
main..<branch>` and `git branch --no-merged main` both confirm zero commits
ahead of `main` on every one of them. `main` is the single source of truth;
no reconciliation of divergent branch work was needed.

## Major Claude Code work identified

The existing root `CLAUDE.md` (pre-reconciliation, ~248KB) was an extremely
detailed, session-by-session build log, self-attributed throughout to Claude
Code sessions, covering: the GrandTour MVP pivot from an F1-branded product,
the full official-letour results pipeline (parse/reconcile/apply/admin-check/
finalise/score), its later full automation, the UCI master rider registry,
the TDF 2026 rider importer, the Resend stage-results email pipeline, and a
long sequence of UI/UX passes (dashboard redesigns, GWFC brand re-theme,
leaderboard rewrites, auth-callback routing fixes across three iterations,
an admin stage-review UI, a participant-detail page). This content was the
primary evidence source for the new `docs/project/` and `docs/features/`
files — see "Documentation files created" below for where each piece landed.

## Major Codex work identified

`AGENTS.md` (pre-reconciliation) was addressed explicitly to "Codex Operating
Instructions" and described the original GrandTour MVP scope (market/
tip_entries schema, daily/preselection/overall structure, an "MVP build
order"). `GRANDTOUR_APP_SCOPE.md` is written in the same voice and appears to
be the detailed design brief that `AGENTS.md` pointed to as canonical. No
commit metadata in this repository distinguishes Codex-authored commits from
Claude-Code-authored commits (git history has no author-tool tag), so
**specific commits cannot be attributed to Codex with confidence** — this
report marks that as unknown rather than guessing. What can be said with
confidence: the original product-pivot design work (F1Tips → GrandTour, the
MVP scope document, the original `AGENTS.md`) reads as the earlier layer of
work in this repository, with the extensive session-logged build-out in
`CLAUDE.md` as a later layer — consistent with (but not proof of) an early
Codex-driven design phase followed by heavy Claude-Code-driven implementation.

## Duplicate or conflicting work found

- **Three independent race-name keyword classifiers** (`grandTourDisplay.ts`
  in `apps/mobile`, its Deno twin in `supabase/functions/_shared/email/`, and
  `raceAccent.ts`). Already disclosed as a known drift risk in the source
  material; carried forward into
  [docs/project/DECISIONS.md](../project/DECISIONS.md) #4 and
  [docs/project/CURRENT_STATE.md](../project/CURRENT_STATE.md).
- **Two competing screens registered for the same `/` route**
  (`app/index.tsx` and `app/(auth)/index.tsx`) — a real, already-fixed
  production bug (not a currently-live conflict), documented in
  [docs/development/TROUBLESHOOTING.md](../development/TROUBLESHOOTING.md)
  as a pattern to avoid recreating.
- **Instruction-file conflict (the actual target of this task)**: the root
  `AGENTS.md`/`GRANDTOUR_APP_SCOPE.md` described an MVP that explicitly
  excluded push notifications and dummy activity, while the (much later)
  `CLAUDE.md` documented a fully-built email notification pipeline and a
  disabled-but-present dummy-user data model — not a contradiction in
  substance (email is not push, and dummy activity stays disabled), but the
  literal old text reads as if it forbids something that was later built.
  Resolved: `AGENTS.md` and `GRANDTOUR_APP_SCOPE.md` are now explicitly
  marked deprecated/historical, and
  [docs/project/PRODUCT.md](../project/PRODUCT.md) states the current,
  reconciled rule set directly.
- **CLI/UI parity gap** (not a conflict, but worth flagging alongside): the
  UCI review CLI (`scripts/uci-rider-review.mjs`) cannot perform the same
  linking action the admin UI can. Recorded as a roadmap item, not fixed in
  this pass (out of scope — documentation only).

## Canonical implementation decisions

Where the old design documents (`GRANDTOUR_APP_SCOPE.md`,
`docs/product-scope.md`) conflicted with the actual shipped code and the
detailed `CLAUDE.md` build log, **the code and the build log were treated as
authoritative** — this matches the task's own instruction ("the code and git
history remain the authority for what has actually been implemented"). The
old design documents were not deleted (they may still hold genuine historical
value and nothing indicated they were safe to remove), but were explicitly
marked deprecated with pointers to their replacement.

## Documentation files created

- `docs/project/PRODUCT.md`, `ARCHITECTURE.md`, `CURRENT_STATE.md`,
  `ROADMAP.md`, `DECISIONS.md`, `GLOSSARY.md`
- `docs/development/WORKFLOW.md`, `TESTING.md`, `DEPLOYMENT.md`,
  `DATABASE.md`, `DATA_IMPORTS.md`, `TROUBLESHOOTING.md`
- `docs/features/stage-tipping.md`, `scoring.md`, `ttt-scoring.md`,
  `jersey-competition.md`, `rider-eligibility.md`, `rider-status.md`,
  `leaderboards.md`, `stage-results.md`, `official-data-import.md`,
  `authentication.md`, `profile-management.md`, `admin-stage-review.md`
- `docs/handovers/ACTIVE_TASK.md`, `COMPLETED_WORK.md`, `SESSION_LOG.md`,
  `RECONCILIATION_REPORT.md` (this file)
- `README.md` (new, repo root)
- `.claude/settings.json` (new — a permissions allowlist for routine local
  dev commands; explicit deny list for destructive git and production
  Supabase writes)

## Documentation files modified

- `CLAUDE.md` — rewritten from a ~248KB session-log narrative into a concise
  router pointing to `docs/`. **The full prior content is not lost**: it
  remains fully recoverable from git history (`git log -p -- CLAUDE.md` /
  `git show <commit>:CLAUDE.md`), and its substance was extracted into the
  new `docs/project/` and `docs/features/` files above (compressed, not
  verbatim — see "Unresolved uncertainties" below for what that compression
  means for fidelity).
- `AGENTS.md` — rewritten into a concise Codex entry point pointing to the
  same `docs/` structure as `CLAUDE.md`, per the task's explicit requirement
  not to maintain two conflicting rule sets.
- `GRANDTOUR_APP_SCOPE.md`, `docs/product-scope.md`,
  `docs/grandtour-working-copy.md`, `docs/tdf-2026-data.md`,
  `docs/authentication.md` — each got a short deprecation/pointer notice
  prepended; content otherwise untouched.
- `HANDOFF.md` — got a pointer notice to `docs/handovers/`; content
  otherwise untouched (it remains a legitimate, accurate record of its own
  session).

## Deprecated files (kept, not removed)

`GRANDTOUR_APP_SCOPE.md`, `docs/product-scope.md`,
`docs/grandtour-working-copy.md`, `docs/tdf-2026-data.md`. None were deleted
— each still holds historical design/session context, and the task's
guidance was to remove a file "only if clearly redundant and safe to
remove," which felt too strong a claim to make unilaterally for documents
that predate this session and whose full historical value wasn't
independently confirmed.

**Not deprecated, kept as live operational references** (still accurate,
cross-referenced from the new structure rather than superseded):
`docs/deployment.md`, `docs/deployment-workflow.md`,
`docs/deployment/codemagic-ios.md`, `docs/grandtour-results-feed.md`,
`docs/grandtour-apply-mode-spec.md`, `docs/grandtour-data-import.md`,
`docs/authentication.md` (marked as still-accurate, referenced first from
`docs/features/authentication.md`).

## Unresolved uncertainties

- **Codex vs. Claude Code authorship cannot be determined from git history
  alone** — no commit trailer or metadata distinguishes the two. This report
  does not guess; see "Major Codex work identified" above.
- **Several claims carried into `docs/project/CURRENT_STATE.md` are
  snapshot claims from the prior `CLAUDE.md` narrative, not independently
  re-verified against live production this session** (exact production
  migration boundary, whether the full-automation workflow's first
  scheduled run has completed, whether the SMTP/`ADMIN_EMAIL` secrets are
  actually set). Each is flagged inline in `CURRENT_STATE.md` and
  `ROADMAP.md` rather than stated as settled fact.
- **Compression fidelity**: the original `CLAUDE.md` was ~248KB of granular,
  often bug-by-bug narrative. The new `docs/features/*.md` and
  `docs/project/*.md` files preserve the load-bearing facts (exact file
  names, migration names, gotchas, production status) but necessarily drop
  some narrative color (exact test-count deltas per session, some
  now-resolved intermediate bug states). The full detail remains recoverable
  from git history if a future session needs it — this was a deliberate
  trade-off in service of the task's explicit request for *concise* root
  files and a *maintainable* structure, not an oversight.
- **`docs/grandtour-apply-mode-spec.md`** is a ~1100-line original design
  spec that predates the implemented apply-mode pipeline. It was judged still
  valuable as a design-rationale reference (referenced from
  `docs/features/official-data-import.md`) rather than deprecated, but its
  "open questions" sections are almost certainly all resolved by now — a
  future pass could trim it, which this session did not do (kept scope to
  documentation *structure*, not a content audit of every existing doc).

## Recommended next implementation task

Not a documentation task: **enforce young-rider (white jersey) eligibility in
stage tip-entry validation** (see
[docs/project/ROADMAP.md](../project/ROADMAP.md)). It's the single clearest,
most concrete, already-scoped functional gap surfaced by this reconciliation
— the eligibility calculation itself is already implemented and tested in
the TDF 2026 importer, so the work is wiring an existing pure function into
the tip-entry validation path, not building new logic from scratch.

## Stale naming search

Searched for "France 2026" (as a bare product-facing label, not a legitimate
local-seed-data value or grand-tour-year reference), obsolete F1 naming in
active GrandTour screens, and "TDF 2026" used where a public-facing label
should say "Tour de France": no stray F1-era naming was found in
`apps/mobile/app/` or `apps/mobile/components/`. `"GrandTour France 2026"` is
a real, intentional local-seed-data string (documented as such throughout
the prior `CLAUDE.md`, not a bug) — the app-layer `formatGrandTourName`
formatter exists specifically to turn that into the correct public display
string, "Tour de France ’26". No further action taken; flagging seed-data
naming as within the CLI/local-dev fixture value space is a code concern
outside this documentation task's scope.
