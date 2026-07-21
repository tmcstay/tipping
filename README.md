# tipping-suite — GrandTour

GrandTour is a cycling stage-tipping app for the Tour de France, built as an
npm-workspaces monorepo: Expo (React Native, web + iOS + Android) on the
frontend, Supabase (Postgres/Auth/RLS/Edge Functions) on the backend.

## Start here

- **Working on this repo with Claude Code?** Read [CLAUDE.md](CLAUDE.md).
- **Working on this repo with Codex?** Read [AGENTS.md](AGENTS.md).
- Both route to the same shared documentation in [docs/](docs/) — that
  directory, not this file, is where the real project knowledge lives.

## Quick links

- [docs/project/PRODUCT.md](docs/project/PRODUCT.md) — what this product is
- [docs/project/CURRENT_STATE.md](docs/project/CURRENT_STATE.md) — what's
  actually implemented right now
- [docs/project/ARCHITECTURE.md](docs/project/ARCHITECTURE.md) — how it fits
  together
- [docs/development/WORKFLOW.md](docs/development/WORKFLOW.md) — day-to-day
  conventions
- [docs/development/TESTING.md](docs/development/TESTING.md) — how to run
  tests

## Repository layout

```text
apps/mobile/            The one app (Expo Router: web, iOS, Android)
packages/tipping-core/  Shared pure scoring/locking/validation logic
packages/shared-types/  Shared + generated database types
packages/supabase-client/ Client creation, auth helpers, typed queries
packages/ui/             Reusable presentation components
supabase/                migrations, seed data, Edge Functions, SQL tests
scripts/                 Standalone Node CLIs (results feed, UCI registry, importer)
docs/                    Project documentation
```

## Basic commands

```bash
npm run typecheck      # root tsc --noEmit
npm test                # tipping-core + supabase-client tests
npm run test:data       # scripts/*.test.mjs
```

See [docs/development/TESTING.md](docs/development/TESTING.md) for the full
list, including `apps/mobile`'s own `test:ui`/`test:api` and the Supabase
local-smoke scripts.
