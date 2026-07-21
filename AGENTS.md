# AGENTS.md

Entry point for Codex working in this repository. **Shared project
documentation under `docs/` is authoritative for both Codex and Claude
Code** — `CLAUDE.md` points to the same files. Do not maintain a separate or
conflicting set of project rules here.

## Project summary

`tipping-suite` is an npm-workspaces monorepo containing **GrandTour**, a
cycling stage-tipping app for the Tour de France, built on Expo (React
Native, web+iOS+Android) and Supabase (Postgres/Auth/RLS/Edge Functions).
GrandTour is independent — never use official Tour de France branding,
protected logos, or wording implying endorsement/affiliation.

## Read before editing anything

| Need | Read |
|---|---|
| Product purpose, confirmed rules | [docs/project/PRODUCT.md](docs/project/PRODUCT.md) |
| System architecture | [docs/project/ARCHITECTURE.md](docs/project/ARCHITECTURE.md) |
| What's actually implemented | [docs/project/CURRENT_STATE.md](docs/project/CURRENT_STATE.md) |
| Planned/proposed/deferred work | [docs/project/ROADMAP.md](docs/project/ROADMAP.md) |
| Why things are built this way | [docs/project/DECISIONS.md](docs/project/DECISIONS.md) |
| Domain terms | [docs/project/GLOSSARY.md](docs/project/GLOSSARY.md) |
| Day-to-day workflow, coding standards | [docs/development/WORKFLOW.md](docs/development/WORKFLOW.md) |
| Test commands | [docs/development/TESTING.md](docs/development/TESTING.md) |
| Deploy targets | [docs/development/DEPLOYMENT.md](docs/development/DEPLOYMENT.md) |
| Migration rules, recurring Postgres/RLS gotchas | [docs/development/DATABASE.md](docs/development/DATABASE.md) |
| The three data-import pipelines | [docs/development/DATA_IMPORTS.md](docs/development/DATA_IMPORTS.md) |
| Known bugs and fixes | [docs/development/TROUBLESHOOTING.md](docs/development/TROUBLESHOOTING.md) |
| A specific feature | `docs/features/*.md` |
| What's actively being worked on | [docs/handovers/ACTIVE_TASK.md](docs/handovers/ACTIVE_TASK.md) |

`GRANDTOUR_APP_SCOPE.md` (repo root) and `docs/product-scope.md` are
**superseded** original design documents, kept only for historical context.
Where they conflict with `docs/` or the actual code, `docs/` and the code
win.

## Before changing code

1. Read [docs/project/CURRENT_STATE.md](docs/project/CURRENT_STATE.md) — do
   not assume a feature is complete because a plan, session note, or older
   doc says so; verify against code and tests.
2. Read [docs/handovers/ACTIVE_TASK.md](docs/handovers/ACTIVE_TASK.md) — if
   Claude Code (or a prior Codex session) has active or very recent work in
   the area you're about to touch, read it first. **Do not start a
   parallel or duplicate implementation of something already in progress or
   already done** — extend or fix it instead.
3. Read the relevant `docs/features/*.md` file.
4. Identify the smallest safe change; state assumptions that materially
   affect the design; implement one coherent feature at a time.

## Technology and architecture

Expo Router (iOS/Android/web), TypeScript, Supabase, npm workspaces. One
reusable platform, one shared tipping engine — sport-specific behavior
belongs in configuration/rule definitions, not duplicated screens. Keep
business logic out of screens: scoring/locking/validation live only in
`packages/tipping-core`; typed Supabase access lives in
`packages/supabase-client`. Full detail:
[docs/project/ARCHITECTURE.md](docs/project/ARCHITECTURE.md).

## Coding standards

Strict TypeScript, generic domain names (stage/rider/entry — not F1
terminology), small reviewable changes, no unexplained major dependencies,
never commit secrets, comment only where behavior is genuinely non-obvious.
Full list: [docs/development/WORKFLOW.md](docs/development/WORKFLOW.md).

## Testing requirements

Run the most relevant package tests and `npm run typecheck` after every
change. Exact commands: [docs/development/TESTING.md](docs/development/TESTING.md).
For schema work, also verify constraints/grants/RLS locally before
considering it done — see [docs/development/DATABASE.md](docs/development/DATABASE.md).

## Database and security rules

Migrations are immutable once applied — add a new one, never rewrite an
applied one. Every table exposed via the Data API needs both RLS **and** an
explicit grant (RLS alone is not enough — see
[docs/development/DATABASE.md](docs/development/DATABASE.md) for a list of
bugs this exact gap has caused, more than once). Never expose a service-role
or secret key in client code. Every write-capable script/RPC defaults to
dry-run and requires explicit confirmation before touching production.

## At completion — required documentation update

Before reporting a task done:

1. Update [docs/project/CURRENT_STATE.md](docs/project/CURRENT_STATE.md) and
   the relevant `docs/features/*.md` file if what's implemented changed.
2. Move your work from `docs/handovers/ACTIVE_TASK.md` into
   `docs/handovers/COMPLETED_WORK.md`, and add one line to
   `docs/handovers/SESSION_LOG.md`.
3. Report changed files, verification performed, and remaining risks —
   don't claim a UI change works without an actual browser/app check.

Do not rewrite the whole project unless explicitly asked. Preserve unrelated
changes already present in a dirty working tree — they may be another
session's (Claude Code's or Codex's) in-progress work.

## Execution authority

Routine local execution (reading/editing files, running tests/typecheck/
builds/linters, local Supabase, local git inspection, local browser
automation for verification) is pre-authorised for the assigned task. It does
**not** extend to production database/auth/config changes, hosted
deployments, git history rewrites or force-pushes, secret exposure, or
weakening any safety/auth/RLS gate — those always require explicit
authorization in the task itself. Full detail, identical to Claude Code's own
copy of this boundary, in root `CLAUDE.md`'s "Execution authority" section.
