# CLAUDE.md

Guidance for Claude Code working in this repository. This file is
intentionally short — it routes you to the detailed, shared documentation
rather than duplicating it. That documentation is also used by Codex
(`AGENTS.md` points to the same files) — **do not fork or duplicate project
knowledge between the two entry points.**

## Project summary

`tipping-suite` is an npm-workspaces monorepo containing **GrandTour**, a
cycling stage-tipping app for the Tour de France, built on Expo (React
Native, web+iOS+Android) and Supabase (Postgres/Auth/RLS/Edge Functions).

## Repository layout

```text
apps/mobile/            The one app (Expo Router: web, iOS, Android)
packages/tipping-core/  Shared pure scoring/locking/validation logic
packages/shared-types/  Shared + generated database types
packages/supabase-client/ Client creation, auth helpers, typed queries
packages/ui/             Reusable presentation components
supabase/                migrations, seed data, Edge Functions, SQL tests
scripts/                 Standalone Node CLIs (results feed, UCI registry, importer)
docs/                    Authoritative documentation — see below
```

## Authoritative documentation — read before starting non-trivial work

| Need | Read |
|---|---|
| What GrandTour actually is, confirmed product rules | [docs/project/PRODUCT.md](docs/project/PRODUCT.md) |
| How the system fits together | [docs/project/ARCHITECTURE.md](docs/project/ARCHITECTURE.md) |
| What's actually implemented right now | [docs/project/CURRENT_STATE.md](docs/project/CURRENT_STATE.md) |
| What's planned/proposed/deferred | [docs/project/ROADMAP.md](docs/project/ROADMAP.md) |
| Why things are built the way they are | [docs/project/DECISIONS.md](docs/project/DECISIONS.md) |
| Domain terms | [docs/project/GLOSSARY.md](docs/project/GLOSSARY.md) |
| How to work in this repo day to day | [docs/development/WORKFLOW.md](docs/development/WORKFLOW.md) |
| Test commands | [docs/development/TESTING.md](docs/development/TESTING.md) |
| Deploy targets and env vars | [docs/development/DEPLOYMENT.md](docs/development/DEPLOYMENT.md) |
| Migration rules, recurring Postgres/RLS gotchas | [docs/development/DATABASE.md](docs/development/DATABASE.md) |
| The three data-import pipelines | [docs/development/DATA_IMPORTS.md](docs/development/DATA_IMPORTS.md) |
| Known bugs and their fixes/workarounds | [docs/development/TROUBLESHOOTING.md](docs/development/TROUBLESHOOTING.md) |
| Any specific feature (stage tipping, scoring, TTT, jerseys, leaderboards, results, official-data-import, auth, profile, admin review, rider eligibility/status) | `docs/features/*.md` |
| What's actively being worked on right now | [docs/handovers/ACTIVE_TASK.md](docs/handovers/ACTIVE_TASK.md) |

## Instruction priority

1. Explicit instructions in the current task/conversation.
2. This file and `docs/` (shared, authoritative for both Claude Code and
   Codex).
3. `GRANDTOUR_APP_SCOPE.md`, `docs/product-scope.md`,
   `docs/grandtour-working-copy.md`, `docs/tdf-2026-data.md` — **superseded**
   historical design/session documents, kept for context only. Where they
   conflict with `docs/`, `docs/` and the actual code win.

## Documentation structure (as of 2026-07-17)

This file, `AGENTS.md`, and the shared `docs/` tree were restructured in a
dedicated reconciliation session — see
[docs/handovers/RECONCILIATION_REPORT.md](docs/handovers/RECONCILIATION_REPORT.md)
for what was consolidated and why, and
[docs/project/CURRENT_STATE.md](docs/project/CURRENT_STATE.md) for what's
actually implemented. No application code changed in that session. The prior,
much longer version of this file (a session-by-session narrative build log)
remains fully readable via `git log -p -- CLAUDE.md`; its substance was
extracted into `docs/project/*.md` and `docs/features/*.md`. **Keep this file
short** — put new durable knowledge into the relevant `docs/` file, not back
into this one.

## Mandatory pre-work inspection

Before making a non-trivial change: read
[docs/project/CURRENT_STATE.md](docs/project/CURRENT_STATE.md) (don't assume
a feature is done because a plan or session note says so — verify against
code/tests), check
[docs/handovers/ACTIVE_TASK.md](docs/handovers/ACTIVE_TASK.md) for
in-flight work by another session or by Codex, and read the relevant
`docs/features/*.md` file.

## Coding and architecture guardrails

See [docs/development/WORKFLOW.md](docs/development/WORKFLOW.md) for the full
list. Load-bearing summary: keep business logic out of screens; scoring and
locking live only in `packages/tipping-core`; never duplicate the stage form
or scoring implementation between daily and preselection modes; use generic
domain names (stage/rider/entry), not inherited F1 terminology; generate
Supabase types rather than hand-maintaining them.

## Testing requirements

Run the most relevant package tests and `npm run typecheck` after every
change; see [docs/development/TESTING.md](docs/development/TESTING.md) for
exact commands. For UI changes, a real browser check (Playwright) is
expected before claiming a change is verified — this repo's automated tests
cover pure logic only, not rendering/layout, and multiple real production
bugs were only ever caught this way.

## Database migration rules

Migrations are immutable once applied — never rewrite one; add a new one.
Always rehearse against local Supabase first. Full detail, and a list of
grant/RLS bugs that have recurred more than once, in
[docs/development/DATABASE.md](docs/development/DATABASE.md).

## Security rules

Never expose a Supabase service-role or secret key in client code. Enable
RLS on every table exposed through the Data API, with an explicit
table-level grant to match (RLS alone is not sufficient — see
[docs/development/DATABASE.md](docs/development/DATABASE.md)). Every
write-capable script/RPC defaults to dry-run and requires explicit
confirmation flags before touching production
([docs/project/DECISIONS.md](docs/project/DECISIONS.md) #12). Never bypass
CAPTCHA/Cloudflare/robots/rate limits/auth on any external data source.

## Git rules

Only commit when explicitly asked. Never force-push, rewrite history, or
delete branches without explicit instruction. See the "Execution authority"
section below for the full boundary.

## Completion and reporting requirements

When you finish substantial work: update
[docs/project/CURRENT_STATE.md](docs/project/CURRENT_STATE.md) and the
relevant feature doc if implementation state changed; move your work from
`docs/handovers/ACTIVE_TASK.md` into `docs/handovers/COMPLETED_WORK.md` and
add one line to `docs/handovers/SESSION_LOG.md`. Report exactly what changed,
how it was verified, and what remains — don't claim a UI change is done
without an actual browser check.

## Execution authority

For tasks assigned in this repository, routine local execution is
pre-authorised.

Claude Code may, without requesting confirmation:

- read, search, create, edit, move, and delete repository files needed for
  the assigned task
- run local package-manager commands, scripts, tests, type checks, builds,
  formatters, linters, and development servers
- use local browser automation (Playwright or equivalent) for inspection and
  verification
- start, stop, inspect, reset, and modify local Supabase services and local
  test data
- run local Docker commands required by documented test/dev workflows
- access localhost services, public documentation, and public data sources
  needed for the task
- inspect Git status, diffs, branches, logs, and commit history
- install temporary local tooling not committed unless required by the task
- create and remove temporary fixtures, test users, caches, reports, and
  generated files after verification
- retry failed local commands, adjust the implementation, and continue until
  the task is complete or a genuine blocker is identified

Do not pause merely to ask permission for routine local file access, command
execution, browser access, package installation, test execution, or local
service access — that permission is already granted for the current assigned
task.

This authority does **not** override production and safety rules. Unless the
user explicitly authorises the specific action in the current task, do not:

- modify production databases, production authentication data, hosted
  secrets, production storage, or production configuration
- run production migrations, RPCs, imports, scoring, or correction workflows
- deploy to Vercel, Supabase, app stores, Edge Functions, or any other hosted
  environment
- commit, push, force-push, merge, open/merge pull requests, create
  releases, or change protected branches
- expose, print, copy, transmit, or commit secrets, access tokens, private
  keys, service-role keys, passwords, or credential-bearing files
- weaken authentication, authorisation, RLS, permission checks, safety
  gates, confirmation flags, audit trails, or dry-run defaults
- use destructive Git operations (`reset --hard`, `clean -fd`, history
  rewriting, branch deletion) unless explicitly requested
- delete untracked user files, personal files, or unrelated repository
  content
- bypass CAPTCHA, Cloudflare, robots restrictions, authentication, rate
  limits, or any provider's access controls
- substitute a production action for a local rehearsal

When a task explicitly authorises a production/deployment/Git-write/other
restricted action: verify the target environment and command before
execution, follow every repository safety gate, rehearse locally first where
required, and report exactly what was changed and how it was verified.

If a routine command is needed to complete the task, run it rather than
asking the user to run it manually. Ask for user input only when essential
information is genuinely unavailable — a missing business decision,
credential value, external approval, or irreversible production choice.
