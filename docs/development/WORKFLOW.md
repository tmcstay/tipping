# Development Workflow

## Before making any change

1. Read [docs/project/CURRENT_STATE.md](../project/CURRENT_STATE.md) for what's
   actually implemented — don't trust a plan or session summary as proof a
   feature is done.
2. Check [docs/handovers/ACTIVE_TASK.md](../handovers/ACTIVE_TASK.md) — if
   another agent (Claude Code or Codex) has active or recent work in this
   area, read it before starting. Update it when you start and finish
   substantial work, so the next agent (of either kind) doesn't duplicate or
   conflict with what you did.
3. Identify the smallest safe change. Avoid broad refactors unless requested
   or required for correctness.
4. Preserve unrelated user changes in a dirty working tree — don't discard or
   overwrite uncommitted work you didn't create.

## Repository conventions

- `apps/mobile`: Expo routes, screens, hooks, app config, mobile composition.
- `packages/tipping-core`: pure scoring, locking, validation, leaderboard
  logic — no I/O, no React, no Supabase client.
- `packages/shared-types`: shared + generated database types.
- `packages/supabase-client`: client creation, auth helpers, typed queries.
- `packages/ui`: reusable presentation components.
- `supabase/migrations`: reviewed schema, constraints, grants, RLS, functions.
  **Never rewrite an applied migration** — add a new one (see
  [DECISIONS.md](../project/DECISIONS.md) #3).
- `supabase/seed.sql`: clearly identified development/sample data only.
- `scripts/`: standalone Node CLIs, each with a co-located `.test.mjs`.
- `docs/`: this documentation tree — keep it current when architecture,
  schema, or major conventions change; it is not a per-commit changelog.

## Coding standards

- Strict TypeScript, clear domain names (stage/rider/event/entry/selection —
  not inherited F1 terminology; see [docs/project/DECISIONS.md](../project/DECISIONS.md)
  for why the product pivoted away from F1Tips branding).
- Keep business logic out of screens — put it in `lib/`, `packages/tipping-core`,
  or `packages/supabase-client`.
- Don't duplicate the stage form or scoring implementation between modes.
- Don't introduce major dependencies without explaining the need.
- Don't remove unrelated behavior while making a targeted change.
- Add a comment only where locking, scoring, authorization, or recalculation
  behavior is genuinely non-obvious — not to narrate what the code does.
- Never commit secrets. Public client config goes in environment variables;
  privileged credentials never touch client code or committed files.
- Generate Supabase types (`npx supabase gen types typescript --local`) rather
  than hand-maintaining database types — re-run after any local-only migration
  that adds columns/RPCs the frontend needs typed access to.

## Verification requirements

Run the most relevant package tests and typecheck after every change. See
[TESTING.md](TESTING.md) for exact commands. For schema work, also verify
constraints, grants, RLS behavior, and migrations locally before considering
the change done — see [DATABASE.md](DATABASE.md).

For UI changes, prefer an actual browser check (Playwright, throwaway install,
never added to `package.json`) over trusting `tsc`/unit tests alone — this
repo's test suite covers pure logic, not rendering/layout, and several real
production bugs (a `Link asChild` render collapse, an invisible badge, a
navigation-timing crash) were only ever caught this way. See
[TROUBLESHOOTING.md](TROUBLESHOOTING.md).

## Cross-agent handover

This repository is worked on by both Claude Code and Codex sessions. Shared
documentation under `docs/` is authoritative for both — neither tool
maintains a separate, conflicting rule set. When you finish a substantial
piece of work:

1. Update [docs/project/CURRENT_STATE.md](../project/CURRENT_STATE.md) if you
   changed what's implemented.
2. Update the relevant `docs/features/*.md` file if you touched that feature.
3. Move your work from `docs/handovers/ACTIVE_TASK.md` into
   `docs/handovers/COMPLETED_WORK.md` (concise summary, not a full transcript)
   and add one line to `docs/handovers/SESSION_LOG.md`.
4. Leave `ACTIVE_TASK.md` either empty/cleared or pointing at genuinely
   outstanding next steps — never leave it describing work that's already
   done, and never leave two agents' in-flight work described as one task.

## Execution authority

See the "Execution authority" sections of root `CLAUDE.md` and `AGENTS.md` —
they are kept identical. In short: routine local inspection, testing, and
development commands are pre-authorised; production writes, deployments, git
history rewrites, and secret exposure always require explicit authorization in
the task itself.
