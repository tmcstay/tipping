# Testing

## Commands

| Command | What it runs |
|---|---|
| `npm run typecheck` | Root `tsc --noEmit`. Expect the pre-existing, unrelated Deno-runtime errors under `supabase/functions/` — not a regression. |
| `npm test` | `packages/tipping-core` tests + `packages/supabase-client` tests (`node --test src/*.test.ts`, run directly via Node's native TS stripping — no build step). |
| `npm run test:data` | Every `scripts/*.test.mjs` file via Node's built-in test runner (see `package.json`'s `test:data` entry for the exact file list — ~30 files covering the feed pipeline, UCI registry, and TDF importer). |
| `apps/mobile`: `npm run test:ui` | Pure UI logic (`lib/*.ts` and a small allow-list of other files), compiled via `tsc` into `dist/mobile-tests`, then run with `node --test`. **Gotcha**: delete `dist/mobile-tests` first if you suspect a file is missing from the `tsc` file list in `package.json` — a stale compiled artifact can make a test "pass" against code that was never recompiled. |
| `apps/mobile`: `npm run test:api` | `apps/mobile/api/**/*.mjs` server routes, `node --test` directly (no `tsc` step — `apps/mobile/tsconfig.json` excludes `api/`). |
| `supabase/tests/*.sql` | pgTAP-style scripts, each run in its own transaction (`begin`/`rollback`), via `docker exec ... psql -f`. Requires local Supabase running. |
| `npm run grandtour:reconcile:local-smoke` | Real local-Supabase end-to-end smoke test of the reconciliation step (read-only). |
| `npm run grandtour:apply:local-smoke` | Real local-Supabase end-to-end smoke test of apply → admin-check → finalise → score (writes, cleans up after itself). |
| `npm run grandtour:admin-stage:local-smoke` | Same chain, driven through the actual `grandtour-admin-stage.mjs` CLI functions rather than direct RPC calls. |
| `npm run uci-rider-sync:local-smoke` | Real local-Supabase end-to-end smoke test of the UCI registry sync (insert → verify → idempotent re-run → review-queue resolution → cleanup). |

## Conventions

- Local Supabase connection details: `npx supabase status` (or `-o env`).
  Local demo anon/service-role keys are well-known Supabase CLI defaults, not
  secrets.
- Always rehearse against **local Supabase only** before any production
  action. Production actions require explicit authorization in the task
  itself — see [DECISIONS.md](../project/DECISIONS.md) #12.
- Even with an explicit authorization, double-check any pasted key's `role`
  claim (decode the JWT) before trusting a label like "anon key" or
  "production key" — this project has caught mislabeled keys before.
- Local-only smoke tests create real throwaway `auth.users` rows (via the
  GoTrue admin API) and delete them afterward — never assume a stray test user
  in local Supabase is intentional; investigate before assuming it's safe to
  delete (it might be another agent's in-progress work).
- **Node-in-CI gotcha**: `@supabase/supabase-js`'s `createClient()` throws on
  Node 20 (missing native WebSocket support). Any GitHub Actions workflow that
  constructs a Supabase client needs `node-version: '22'` or higher.

## Browser/UI verification

No automated rendering/layout test harness exists in this repo — `test:ui`
covers pure logic only. For anything touching layout, navigation, or
Expo-Router-specific behavior, use a real headless-browser session:

```bash
npx --yes playwright@latest install chromium --with-deps
```

(a throwaway `npm install playwright@latest` in a scratch directory, never
added to this repo's `package.json`), against a local static rebuild
(`npm run web:build` inside `apps/mobile`, served with `serve -s dist` for SPA
fallback matching `vercel.json`'s catch-all rewrite). Capture
`console`/`pageerror`/`framenavigated` events, not just visual screenshots —
several real production bugs (an Expo Router navigation-timing crash, a
`Link asChild` style-collapse bug) were only found this way. See
[TROUBLESHOOTING.md](TROUBLESHOOTING.md) for the specific incidents this
method uncovered.

## Postgres/PL-pgSQL test gotchas

- A `returns boolean` SQL function meant to guard an imperative
  `if not fn() then raise` must be written as `select exists(...)` (or with an
  explicit `coalesce(..., false)`) — a bare `where exists(...)`-filtered row
  select returns SQL `NULL` on the false case, and `if not NULL` never takes
  the branch. Always write a genuine negative-path test (a real
  non-privileged session actually calling the guarded function), not just a
  positive-path test.
- An `exception when others` block implicitly rolls back to a savepoint at the
  start of that block — a deliberate setup statement meant to persist past the
  exception must be a separate top-level statement, not inside the same
  `do $$ ... exception ... $$` block being tested.
- A newly created function grants EXECUTE to `PUBLIC` by default.
  `grant execute ... to authenticated` alone does not revoke that — always
  `revoke all on function ... from public;` first when a function should be
  restricted. See [DATABASE.md](DATABASE.md) for the full grant-gap history.
