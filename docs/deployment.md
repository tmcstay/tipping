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
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-or-publishable-key
```

Set them for Production and Preview deployments. Add Development values too if the Vercel CLI will be used locally.

Expo embeds `EXPO_PUBLIC_` variables into the browser bundle. The Supabase URL and anon/publishable key are intended for public clients when Row Level Security is configured correctly.

Never add a Supabase `service_role` key, secret key, database password, or other privileged credential to an `EXPO_PUBLIC_` variable or the Vercel client build.

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
6. Add both required `EXPO_PUBLIC_SUPABASE_*` variables.
7. Deploy and test `/`, a nested route, and a browser refresh on that nested route.
8. Add a production domain only after the preview deployment is verified.
