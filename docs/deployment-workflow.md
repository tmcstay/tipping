# Deployment Workflow

## Repository

This repo is an npm workspace monorepo:

- `apps/mobile` is the Expo React Native app.
- `packages/*` contains shared TypeScript packages used by the app.
- `supabase` contains database migrations, seed data, and Supabase CLI config.

Push source, package manifests, `package-lock.json`, Supabase migrations, seed files, docs, and EAS config to GitHub. Do not push `node_modules`, `.expo`, local `.env` files, or Supabase local temp folders.

## Supabase Cloud

Create a Supabase Cloud project, then apply the schema in `supabase/migrations` and optional sample data in `supabase/seed.sql`.

The mobile app expects these public Expo environment variables:

```text
EXPO_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-or-publishable-key
```

For EAS builds, set them in Expo/EAS environment variables rather than committing real values:

```powershell
cd apps/mobile
npx eas-cli env:create --environment production --name EXPO_PUBLIC_SUPABASE_URL --value https://your-project-ref.supabase.co --visibility plain
npx eas-cli env:create --environment production --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value your-supabase-anon-or-publishable-key --visibility plain
```

The anon/publishable key is intended for client use, but it is still project-specific configuration. Never use or commit Supabase service role keys in the mobile app.

## Expo EAS

Run EAS commands from `apps/mobile` so the Expo project config and `eas.json` are local to the app. Because this app is in an npm workspace, keep the root `package-lock.json` committed.

Initial setup:

```powershell
npm install
cd apps/mobile
npx eas-cli login
npx eas-cli build:configure
```

iOS TestFlight build:

```powershell
cd apps/mobile
npx eas-cli build --platform ios --profile production
npx eas-cli submit --platform ios --profile production
```

You need an Apple Developer Program account, App Store Connect access, and an app record matching bundle identifier `com.tippingsuite.f1tips`.

## Vercel

There is currently no admin web or marketing web app to deploy. Vercel has nothing meaningful to deploy yet. Add `apps/admin-web` or `apps/marketing-web` first, then create separate Vercel projects pointing at those app directories.
