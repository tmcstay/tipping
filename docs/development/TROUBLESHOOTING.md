# Troubleshooting

Real bugs found and fixed in this repo, kept here so the same class of bug
isn't re-investigated from scratch. See [DATABASE.md](DATABASE.md) for
Postgres/RLS-specific gotchas — this file covers app/frontend/tooling issues.

## Expo Router / React Native Web

- **`<Link asChild href={...}><Pressable style={({pressed}) => [...]}>`
  collapses to a stacked/vertical layout on web.** When `Link`'s `asChild`
  clones a `Pressable` onto a real `<a>`, that anchor doesn't reliably inherit
  React Native Web's implicit `display: flex`. Fix: never put
  `flexDirection`/`alignItems`/`justifyContent` on the style passed to a
  `Link`-wrapped `Pressable` — put it on a plain inner `<View>` child instead.
- **A *function*-valued `style` prop on a `Link asChild`-wrapped element does
  not survive the clone onto a real `<a>` at all** — not just its flex
  properties, the whole style silently disappears (worse than the bug above).
  Fix: never pass `style={({pressed}) => [...]}` to a `Link`-wrapped
  `Pressable`; track pressed-state via local `useState` +
  `onPressIn`/`onPressOut` and keep `style` a plain value.
- **`<Link asChild>` wrapping a per-row `Pressable` with a different `href` on
  every iteration of a `.map()` crashed React DOM in production** (`"Failed to
  set an indexed property [0] on 'CSSStyleDeclaration'"`). Not root-caused
  into Expo Router's own source. Fix/rule: for a list of navigable rows with
  per-row dynamic hrefs, use `Pressable` + `router.push()` instead — every
  other such list in this app already did.
- **Two screens registered for the same URL path** (`app/index.tsx` and
  `app/(auth)/index.tsx` — Expo Router route groups don't add a URL segment)
  produced a permanent client-side navigation loop on `/` for any
  unauthenticated/loading session — hundreds of same-URL navigations per
  second. Fix/rule: a path may have exactly one owning screen; gate
  auth-dependent content *inside* that one screen (declaratively, with
  `<Redirect>`), never register two competing screens for the same path.
- **Calling `router.replace(...)` imperatively inside a `useEffect` that can
  fire before the navigator finishes mounting** throws `"Attempted to
  navigate before mounting the Root Layout component."` Fix/rule: use the
  declarative `<Redirect href={...}>` component instead of an imperative call
  whenever the redirect might fire on/near first render.
- **Two independent things deciding "where to navigate next" at the same
  moment** (an auth-state-driven `Stack.Protected` guard flip vs. a screen's
  own `router.replace` right after an async call resolves) produces a
  redirect loop/flicker. Fix/rule: gate any post-auth-change navigation on
  having actually observed the same session-state signal the guards use, not
  just on your own async call resolving.
- **The Vercel CLI's "apply to all Preview branches" env var form
  (`vercel env add <NAME> preview --value <v> --yes`, no branch arg) fails
  with `git_branch_required`** in a non-interactive/sandboxed environment,
  even with every non-interactive flag set. No workaround found — use the
  Vercel dashboard for this specific case.

## Supabase CLI / local dev

- `functions serve` fails with an opaque
  `{"_tag":"Error","error":{"code":"UnknownError",...}}` if `supabase/functions/`
  doesn't exist at all — create the directory (even empty) first.
- `--no-verify-jwt` passed as a CLI flag to `functions serve` applies
  **globally to every served function**, not just the one named on the
  command line. Use `config.toml`'s per-function `verify_jwt = false` entry
  instead when serving multiple functions locally.
- Raw `auth.users` inserts (bypassing the normal signup flow/admin API) must
  explicitly set token columns (`confirmation_token`, `recovery_token`, etc.)
  to `''`, not leave them `NULL` — otherwise GoTrue's `/token` endpoint 500s
  with `"converting NULL to string is unsupported"`.
- `@supabase/supabase-js`'s `createClient()` throws on Node 20 (no native
  WebSocket support, no `ws` fallback installed). Use Node 22+ anywhere a
  Supabase client is constructed, including CI.

## HTML scraping / parsing

- **Never flatten HTML to text then regex-match adjacent label/value pairs**
  — once tags are collapsed to a single space, two adjacent fields become
  indistinguishable and a lazy "match up to the next colon" pattern can bleed
  one field's value into another's. Prefer parsing structured embedded JSON
  (`data-props` attributes, etc.) when present; otherwise work on bounded
  raw-HTML windows, never a fully flattened string.

## `apps/mobile` test tooling

- `test:ui`'s `tsc` invocation infers a shared `rootDir` from its explicit
  file list in `package.json`. Adding a file outside `lib/` (e.g. from
  `components/`) changes the inferred `rootDir` and silently nests every
  other file's compiled output, breaking every existing test's
  `require(...)` path at once. Keep everything `test:ui` compiles inside
  `lib/`, with zero imports reaching into `components/`.
- A file is only actually exercised by `test:ui` if it's explicitly listed in
  the `tsc` command in `package.json` — a `require()` in a `.test.cjs` file
  pointing at a compiled path can silently pass off a **stale**, previously
  compiled artifact if the source was never added to that list. Delete
  `dist/mobile-tests` before trusting a green run if you suspect this.
- `packages/supabase-client`'s non-test files bare-import local siblings
  (no `.ts` extension, required for `apps/mobile`'s `tsc` invocation without
  `allowImportingTsExtensions`), but Node's native ESM loader (used by this
  package's own `node --test src/*.test.ts`) requires an explicit extension
  on every relative specifier, even several import-hops deep. A test file
  importing something with its own bare-imported local dependencies throws
  `ERR_MODULE_NOT_FOUND` regardless of the test file's own import style. Not
  fixable in general — extract genuinely dependency-free pure logic into its
  own zero-local-import file when it needs a unit test in this package.

## Known open (unresolved) issue

- **Admin stage-review page (`/admin/grandtour-stages`) full-page-refresh on
  button click**, reported live in production. Investigated with a real
  Playwright session against a local static rebuild and a throwaway admin
  session — could not reproduce (all three named buttons updated in place,
  zero navigation events, zero new document requests; no `<form>` element
  exists anywhere in `apps/mobile`, and React Native Web already sets
  `type="button"` on every `Pressable accessibilityRole="button"`). Root
  cause still open. **Next step, if picked back up**: get the actual browser
  Network-tab detail from a real report (does a new HTML document request
  fire?) before re-investigating blind.

## General method that has repeatedly found real bugs

Code reading alone has missed real production bugs at least twice in this
project's history (see the Expo Router items above). When a UI/navigation bug
is reported and code reading doesn't explain it: install Playwright into a
scratch directory (never `package.json`), build a local static export
(`npm run web:build` + `serve -s dist`), and capture
`console`/`pageerror`/`framenavigated`/network events against a real
throwaway session — not just a visual screenshot.
