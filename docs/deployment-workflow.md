# Deployment Workflow

## Chosen Workflow

The native deployment path is:

```text
GitHub -> Codemagic -> TestFlight
```

Supabase Cloud is the backend for database, auth, and future edge services. Vercel now deploys only the Expo web export from `apps/mobile`; it does not replace or modify the Codemagic native workflow. See [`docs/deployment.md`](./deployment.md) for the web deployment settings.

## Repository

This repo is an npm workspace monorepo:

- `apps/mobile` is the Expo React Native app.
- `packages/*` contains shared TypeScript packages used by the app.
- `supabase` contains migrations, sample seed data, and Supabase CLI config.
- `codemagic.yaml` defines the iOS TestFlight CI workflow.

Commit source files, package manifests, `package-lock.json`, Supabase migrations, seed files, docs, and `codemagic.yaml` to GitHub. Do not commit `node_modules`, `.expo`, local `.env` files, generated native folders, or Supabase local temp folders.

## Supabase Cloud

Create a Supabase Cloud project, then apply the schema from `supabase/migrations`. The sample data in `supabase/seed.sql` can be applied for demo/dev data if wanted.

The mobile app expects these public Expo environment variables at build time:

```text
EXPO_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-or-publishable-key
```

In Codemagic, create an environment variable group named `supabase_cloud` containing:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`

Expo inlines `EXPO_PUBLIC_` variables during bundling, so they must be present in Codemagic when the iOS app is built. The anon/publishable key is client-safe, but never use or commit a Supabase service role key in the mobile app.

## Codemagic

The root `codemagic.yaml` workflow is named:

```text
iOS TestFlight (Codemagic)
```

Workflow ID:

```text
ios-testflight
```

The workflow:

1. Installs npm dependencies from the repo root.
2. Verifies Supabase Cloud `EXPO_PUBLIC_` variables.
3. Runs `npm run typecheck --workspace apps/mobile`.
4. Runs `npm run test --workspace packages/tipping-core`.
5. Runs `npx expo prebuild --platform ios --clean` from `apps/mobile`.
6. Sets the export-compliance flag and installs CocoaPods.
7. Applies the existing Codemagic iOS signing profiles.
8. Uses `CM_BUILD_NUMBER`, clamped to a minimum of `2`, for the native Xcode build number and prints the resulting `CFBundleVersion` values.
9. Builds a signed IPA.
10. Publishes the IPA through the existing App Store Connect integration.

See [`docs/deployment/codemagic-ios.md`](./deployment/codemagic-ios.md) for the
build-number incident, safeguards, and settings that must remain in place.

Codemagic setup needed in the UI:

- Connect the GitHub repository.
- Ensure Codemagic detects `codemagic.yaml` at the repo root.
- Create the `supabase_cloud` environment variable group.
- Create or connect the App Store Connect API key integration. The workflow currently references the integration as `codemagic_tipping_api_key`; rename that value in `codemagic.yaml` if your Codemagic integration has a different name.
- Create an environment variable group named `app_store_connect`.
- Configure iOS automatic signing for bundle ID `app.tipping`.

Apple/App Store Connect requirements:

- Apple Developer Program membership.
- App Store Connect app record for bundle ID `app.tipping`.
- App Store Connect API key with sufficient permissions, commonly App Manager.
- Apple Distribution certificate and App Store provisioning profile, either generated/fetched by Codemagic or uploaded in Codemagic signing identities.

Required Codemagic variables/integrations:

- `EXPO_PUBLIC_SUPABASE_URL` in group `supabase_cloud`.
- `EXPO_PUBLIC_SUPABASE_ANON_KEY` in group `supabase_cloud`.
- App Store Connect API integration named `codemagic_tipping_api_key`, or update `codemagic.yaml` to match your integration name.
- iOS signing assets for `app.tipping` configured in Codemagic.

## Local Commands

Useful local checks before pushing:

```powershell
npm install
npm.cmd run typecheck --workspace apps/mobile
npm.cmd run test --workspace packages/tipping-core
```

## EAS

`apps/mobile/eas.json` remains in the repo from the previous setup. It is optional for the Codemagic workflow and is not used by `codemagic.yaml`. It can stay for now as a fallback/reference, but Codemagic is the chosen build pipeline.

## Vercel

Vercel deploys the Expo web version from `apps/mobile` only. Codemagic remains responsible for native builds. See [`docs/deployment.md`](./deployment.md) for the required Vercel monorepo settings, environment variables, export command, and SPA rewrite troubleshooting.
