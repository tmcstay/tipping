# GrandTour Deployment

GrandTour uses separate deployment paths for web and native applications:

```text
Expo web     -> Vercel
iOS/Android -> Codemagic
Backend     -> Supabase
```

Vercel deploys only the static Expo web export from `apps/mobile`. Codemagic remains the source of truth for native iOS and Android builds. The existing `codemagic.yaml`, iOS bundle identifier, and Android package name are not part of the Vercel setup.

Supabase remains the shared backend for the web and native applications.

## Vercel Project Settings

Import the Git repository as a Vercel project and enter these settings:

| Setting | Value |
| --- | --- |
| Root Directory | `apps/mobile` |
| Framework Preset | `Other` |
| Install Command | `npm install` |
| Build Command | `npm run web:build` |
| Output Directory | `dist` |

In the Root Directory settings, keep **Include source files outside of the Root Directory in the Build Step** enabled. GrandTour is an npm-workspaces monorepo: the root `package.json` and `package-lock.json` manage dependencies, and `apps/mobile` imports source from `packages/*`.

Vercel normally enables outside-root source access for modern monorepo projects. If workspace imports cannot be resolved, verify this setting first and confirm the deployment includes:

- The repository-root `package.json`
- The repository-root `package-lock.json`
- `packages/shared-types`
- `packages/supabase-client`
- `packages/tipping-core`
- `packages/ui`

Do not configure a second native build pipeline in Vercel.

## Environment Variables

Add these variables in Vercel Project Settings under Environment Variables:

```text
EXPO_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-supabase-anon-or-publishable-key
EXPO_PUBLIC_APP_URL=https://grandtour-three.vercel.app
```

(`EXPO_PUBLIC_SUPABASE_ANON_KEY` is also accepted as a legacy alias for `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — see `packages/supabase-client/src/client.ts`.)

Set them for the **Production** environment. Set `EXPO_PUBLIC_APP_URL` for **Preview** too, to the *same* production URL (`https://grandtour-three.vercel.app`) — not each preview deployment's own dynamic URL — per the "production-only Auth redirects" decision below. Add Development values (with `EXPO_PUBLIC_APP_URL=http://localhost:8081`) if the Vercel CLI will be used locally.

Expo embeds `EXPO_PUBLIC_` variables into the browser bundle. The Supabase URL and anon/publishable key are intended for public clients when Row Level Security is configured correctly.

Never add a Supabase `service_role` key, secret key, database password, or other privileged credential to an `EXPO_PUBLIC_` variable or the Vercel client build.

### `EXPO_PUBLIC_APP_URL` and Auth redirect links

`EXPO_PUBLIC_APP_URL` is the app's own deployed web origin, consumed by `getAuthRedirectUrl` (`packages/supabase-client/src/authRedirect.ts`) to build the `emailRedirectTo`/`redirectTo` URLs Supabase Auth puts into sign-up confirmation and password-reset emails. If it is missing (or resolves to a `localhost`/`127.0.0.1` origin) in a non-development build, `getAuthRedirectUrl` throws loudly at the call site rather than silently generating a localhost email link — a misconfigured Vercel environment fails visibly (an in-app error when Sign Up/Forgot Password is used) instead of quietly shipping broken emails.

**Preview deployments:** this project uses approach **(A) — production-only Auth redirects.** Every environment (Production and Preview) is configured with the *same* `EXPO_PUBLIC_APP_URL` value (the production domain), so Auth email links always land on the one stable, allow-listed production origin regardless of which Vercel deployment triggered the email. Preview deployments are not individually supported as Auth redirect targets — a signup or password reset tested from a preview URL will still land the user on production. This was chosen because there is no current need to test the Auth email flow against ephemeral preview URLs, and it avoids having to allow-list a Vercel preview wildcard in Supabase (see below). If preview-specific Auth testing later becomes necessary, switch to approach (B): read the current origin at runtime (`window.location.origin` on web) and allow-list the Vercel preview wildcard in Supabase's Redirect URLs instead of hard-coding `EXPO_PUBLIC_APP_URL`.

### Supabase Auth dashboard configuration

In the Supabase dashboard, **Authentication → URL Configuration**, set:

| Setting | Value |
| --- | --- |
| Site URL | `https://grandtour-three.vercel.app` |
| Redirect URLs | `https://grandtour-three.vercel.app/auth/callback`, `https://grandtour-three.vercel.app/reset-password`, `http://localhost:8081/auth/callback`, `http://localhost:8081/reset-password` |

Add each Redirect URL as its own exact entry rather than relying only on a wildcard, even though Supabase supports wildcard patterns — exact URLs are less error-prone and match the production-only approach above. Do not add a Vercel preview wildcard unless the project deliberately switches to approach (B) above.

## Local Web Export

From the monorepo root:

```powershell
npm install
npm --workspace apps/mobile run web:build
```

The export is written to:

```text
apps/mobile/dist
```

The `dist` directory is generated output and remains excluded from Git.

The equivalent command from `apps/mobile` is:

```powershell
npm run web:build
```

Because npm detects the parent workspace, dependencies and shared packages resolve from the monorepo root.

## Expo Router Refresh 404s

Expo Router's default web output is a single-page application. Directly opening or refreshing a route such as `/leaderboard` asks the host for that path before Expo Router runs in the browser.

`apps/mobile/vercel.json` includes a catch-all rewrite to `/index.html`. This lets Expo Router handle the requested path client-side.

If route refreshes return 404 on Vercel:

1. Confirm the Vercel Root Directory is `apps/mobile`.
2. Confirm `apps/mobile/vercel.json` is present in the deployment source.
3. Remove any dashboard routing override that conflicts with the repository configuration.
4. Confirm the deployment output is `apps/mobile/dist` and contains `index.html`.
5. Redeploy after clearing the Vercel build cache if an older configuration is still active.

If the Expo web output is later changed from SPA/single output to static or server rendering, review the rewrite before deploying; a universal catch-all rewrite is specifically for the current SPA export.

## Deployment Responsibilities

### Vercel

- Installs the npm workspace dependencies.
- Runs the Expo web export.
- Hosts the generated static `dist` directory.
- Supplies public Supabase configuration at build time.

### Codemagic

- Builds and signs native iOS/Android applications.
- Remains independent of Vercel web deployments.
- Continues to use the existing native identifiers and workflow.

### Supabase

- Hosts the database and authentication backend.
- Enforces data access through grants and Row Level Security.
- Must never expose privileged server credentials to the Expo client.

## Manual Vercel Dashboard Steps

1. Import the Git repository into Vercel.
2. Select `apps/mobile` as the Root Directory.
3. Enable outside-root source access for the monorepo.
4. Select the `Other` framework preset.
5. Enter the install, build, and output settings listed above.
6. Add both required `EXPO_PUBLIC_SUPABASE_*` variables, plus `EXPO_PUBLIC_APP_URL` set to the production domain (for both Production and Preview environments — see "`EXPO_PUBLIC_APP_URL` and Auth redirect links" above).
7. In the Supabase dashboard, set Authentication → URL Configuration's Site URL and Redirect URLs per the table above.
8. Deploy and test `/`, a nested route, and a browser refresh on that nested route.
9. Test a real sign-up and password reset end-to-end; confirm both emails link back to the production domain, not `localhost` (see "Manual QA" below).
10. Add a production domain only after the preview deployment is verified.

## Manual QA: Auth email links

After deploying `EXPO_PUBLIC_APP_URL` and the Supabase dashboard settings above:

1. **Sign-up confirmation:** sign up with a real, reachable test email on the production URL. Open the confirmation email and confirm the link's origin is the production domain, not `localhost`. Click it and confirm it lands on `/auth/callback`, shows a success state, and routes into the app.
2. **Password reset:** from `/forgot-password` on the production URL, request a reset for a real test account. Open the email and confirm the link's origin is the production domain, not `localhost`. Click it, confirm `/reset-password` loads with a valid recovery session, enter and confirm a new password, and confirm it signs out the recovery session and routes back to `/login`.
3. **Scheduled GrandTour dry-run:** manually dispatch `.github/workflows/grandtour-auto-dry-run.yml` (Actions → "Run workflow") and review the "Print trigger diagnostics" step's output. Separately, after the next scheduled `17:17 UTC` run, review its diagnostics output to confirm it resolved the expected scheduled defaults (not blank/incorrect values) and either found an eligible stage or exited cleanly with `finalStatus: "no_eligible_stage"`.
