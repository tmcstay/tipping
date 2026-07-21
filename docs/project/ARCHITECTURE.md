# Architecture

## Monorepo layout (npm workspaces)

```text
apps/mobile/            Expo Router app (iOS, Android, web) — the only app
  app/                  file-based routes (screens)
  api/                  Vercel Node serverless functions (apps/mobile/api/**)
  components/, lib/, hooks/, screens/, config/, auth/, navigation/
  tests/                pure-logic unit tests (compiled via tsc, run with node --test)

packages/tipping-core/  Pure scoring, locking, validation, leaderboard logic.
                         No I/O. Shared by every consumer that needs to score or
                         evaluate a lock — the single source of truth referenced
                         throughout docs/features/.
packages/shared-types/  Hand-written + generated (`supabase gen types typescript`)
                         database types.
packages/supabase-client/ Client creation, auth helpers, typed query functions
                         (`src/cycling.ts`, `src/grandtourAdmin.ts`,
                         `src/uciRiderAdmin.ts`, etc).
packages/ui/             Reusable presentation components (buttons/cards/forms/layout).

supabase/
  migrations/            Ordered, immutable SQL migrations (do not rewrite once
                          applied — see DECISIONS.md #3).
  functions/              Deno Edge Functions: send-test-email, send-stage-results,
                          _shared/email/ (rendering, shared by both).
  seed.sql                Local/dev-only seed data (synthetic, not the real 2026
                          schedule — see CURRENT_STATE.md).
  tests/                  pgTAP-style SQL test files, run in transactions.

scripts/                 ~80 standalone Node CLIs and their .test.mjs files:
                          the letour.fr feed pipeline, the UCI rider registry
                          sync, the TDF 2026 rider importer, admin CLIs, local
                          smoke tests. See ARCHITECTURE.md "Script layer" below
                          and docs/development/DATA_IMPORTS.md.

.github/workflows/       grandtour-auto-dry-run.yml (manual fallback, dry-run
                          only), grandtour-auto-apply-and-score.yml (scheduled,
                          full apply→check→finalise→score chain),
                          grandtour-daily-feed-dry-run.yml.

docs/                     This documentation tree.
```

## Applications

Only **one** app exists: `apps/mobile` (Expo SDK 54 / React Native 0.81,
Expo Router). It targets iOS, Android, and web from one codebase, and is what
deploys to both Vercel (web) and Codemagic/TestFlight (iOS). No `admin-web` or
`marketing-web` app exists — earlier scope documents mention them as future
possibilities only.

## Backend: Supabase

Postgres + Auth + RLS + Edge Functions + `pg_cron`/`pg_net` for scheduled
in-database jobs. There is no other backend. Every table exposed through the
Supabase Data API has RLS enabled; every privileged write goes through either
a `security definer` RPC (narrowly scoped, explicitly reviewed) or a
service-role-only script. See [DATABASE.md](../development/DATABASE.md) for the
grant/RLS gotchas discovered across many sessions — they recur, and any new
table or function should be checked against that list before being considered
done.

## Script layer (`scripts/`)

Three independent pipelines live here, sharing only generic utilities
(`source-fetch-utils.mjs`'s retry/cache/circuit-breaker, `tdf-data-utils.mjs`'s
name/team normalization):

1. **Official-letour results feed** (parse → reconcile → apply → admin-check →
   finalise → score → notify). See [official-data-import.md](../features/official-data-import.md).
2. **UCI master rider registry** (cross-race identity registry, roster-driven
   sync, race-entry matching). See [official-data-import.md](../features/official-data-import.md).
3. **TDF 2026 rider importer** (one-off startlist enrichment CLI, independent
   of both of the above). See [official-data-import.md](../features/official-data-import.md).

## Shared scoring/locking logic

`packages/tipping-core` is the only place scoring and lock-state resolution are
implemented. Both the mobile app and — indirectly, via RPCs that mirror the
same rules in SQL — the database enforce the same outcomes. See
[DECISIONS.md](DECISIONS.md) #1 for why this boundary is load-bearing.

## Authentication flow

Supabase Auth (email/password only — no OAuth). `detectSessionInUrl: false`
always; `/auth/callback` is the one route that explicitly consumes a
code/token pair. See [authentication.md](../features/authentication.md) for the
full flow and the production incidents that shaped it (redirect loops, the
`Link asChild` / Expo Router navigation-timing bugs).

## External data sources

- `https://www.letour.fr/en/riders` and `https://www.letour.fr/en/rankings/stage-<N>`
  — official Tour de France site, HTML-scraped (no public API). Source of stage
  results, jersey holders, and the startlist.
- `https://www.uci.org/api/riders/<discipline>/<year>` — UCI's own
  first-party, unauthenticated JSON API backing their rider search widget.
  Source of DOB, nationality, team history, canonical identity.
- CyclingFantasy and ProCyclingStats were both evaluated and **removed** —
  both return HTTP 403 to every automated fetch; no bypass was attempted (see
  the safety rules in root CLAUDE.md/AGENTS.md). Wikidata was evaluated and
  rejected once UCI proved reachable and richer.

## Deploy targets

- **Vercel**: `apps/mobile`'s web export, auto-deploys on push to `main`. Also
  hosts the two admin server routes under `apps/mobile/api/admin/grandtour/`
  (Node serverless functions — the only server-side code that runs with an
  authenticated admin's own session, never a service-role key).
- **Supabase Cloud**: schema, RPCs, Edge Functions, cron — deployed via the
  Supabase CLI (`db push`, `functions deploy`), independent of the Vercel git
  push.
- **Codemagic / TestFlight**: iOS build pipeline (`codemagic.yaml`). See
  [DEPLOYMENT.md](../development/DEPLOYMENT.md) and
  [docs/deployment/codemagic-ios.md](../deployment/codemagic-ios.md).
- **GitHub Actions**: the two scheduled GrandTour automation workflows
  (dry-run and full apply/score) plus a manual-only backfill workflow.
