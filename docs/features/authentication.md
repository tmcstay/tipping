# Authentication

## Purpose
Email/password sign-up, login, logout, password reset — the foundation every
other feature's authorization depends on.

## Confirmed rules
- Supabase Auth, email/password only — **no OAuth** anywhere in this app.
- `detectSessionInUrl: false` always
  (`packages/supabase-client/src/client.ts`) — the Supabase client never
  auto-consumes a code/token pair from the URL; `/auth/callback` is the one
  place that explicitly does.
- `profiles` stores private user-facing data (display name, first/last
  name, avatar); users can read their own row and update only specific
  columns.
- `user_app_memberships` is the sole authority for `user`/`moderator`/`admin`/
  `system` roles — never user-editable metadata.
- Signup creates a non-dummy profile + an active `user` membership on the
  `cycling` app automatically (via `app_private.handle_new_auth_user()`).
- Public signup always forces `is_dummy = false`.
- Never ship a service-role or secret key to Expo/the browser — every
  privileged operation goes through a `security definer` RPC or a
  server-only script.

## User experience
- Sign up / log in / log out / forgot password / reset password screens,
  restyled onto the GWFC brand palette (`screens/authStyles.ts`).
- Sign-up collects First name (required — drives the dashboard greeting),
  Last name (optional), Display name (optional).
- `/reset-password` requires a password + confirm-password pair, then signs
  the recovery session out and routes to `/login` — a deliberate choice over
  silently continuing under the short-lived recovery session.
- `AppShell`'s header shows a race eyebrow (see
  [DECISIONS.md](../project/DECISIONS.md) #4) and, on Profile, a build-version
  label (`v<git-sha>`).

## Data model
`profiles`, `user_app_memberships`, `apps`, plus `app_private.has_*_role()`
(`SECURITY DEFINER`, unexposed schema, empty search path, no `PUBLIC`
grant — required only because a membership policy can't query its own
RLS-protected table without recursion).

## Relevant source files
- `packages/supabase-client/src/auth.ts`, `client.ts`, `authRedirect.ts`
- `apps/mobile/auth/AuthProvider.tsx`
- `apps/mobile/app/auth/callback.tsx` → `AuthCallbackScreen.tsx`
- `apps/mobile/lib/authCallbackExperience.ts`,
  `apps/mobile/components/ProtectedRoute.tsx`
- `apps/mobile/screens/ForgotPasswordScreen.tsx`, `ResetPasswordScreen.tsx`

## Relevant migrations
- `20260715010000_grant_profiles_select_authenticated.sql` — restored a
  silently-revoked `profiles` SELECT grant (see
  [DATABASE.md](../development/DATABASE.md) gotcha #1).
- `20260715020000_signup_first_last_name_metadata.sql` — signup trigger now
  copies `first_name`/`last_name` from metadata, and prefers a real first
  name over an email-fragment fallback for `display_name`.

## Current implementation
Fully built. The `/auth/callback` route went through **three** separate
fix iterations before the actual root cause was found — see
[TROUBLESHOOTING.md](../development/TROUBLESHOOTING.md) "Expo Router / React
Native Web" for the specific bugs (a stuck-spinner issue, a competing-redirect
race, and finally a genuine duplicate-route-registration navigation loop).
The verified, current mechanism: `decideAuthCallbackAction` classifies the
callback params into exactly one action (`show_error`/`exchange_code`/
`set_session`/`redirect_home`), every navigation uses the declarative
`<Redirect>` component (never an imperative `router.replace` in an effect
that could fire before the navigator mounts), and `/` has exactly one owning
screen (`app/index.tsx`, with `app/(auth)/index.tsx` removed entirely).

## Outstanding work
None currently open specific to authentication itself — see
[profile-management.md](profile-management.md) for adjacent profile-defect
history.

## Edge cases
- Preview Vercel deployments deliberately do **not** get their own Auth
  redirect target — both Production and Preview point at the same production
  origin, so every Auth email always lands on one stable, allow-listed URL.
- Web and native use two genuinely different mechanisms for the
  password-reset redirect (`getAuthRedirectUrl` on web,
  `Linking.createURL` + a native URL listener on native) — both intentional,
  not duplicated logic.

## Acceptance criteria
- Logged-out navigation lands on `/login`; protected screens are
  unavailable.
- Logged-in navigation lands on the main app; a refreshed session restores
  correctly.
- The recovery email always uses an allow-listed production redirect.

## Tests
`npm run test:auth` (against local Supabase — signup, automatic profile
creation, private-profile RLS, default app membership, blocked
dummy/admin self-escalation, logout). `apps/mobile` `test:ui`
(`authCallbackExperience`).
