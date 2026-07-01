# Authentication and authorization

GrandTour uses Supabase email/password authentication. Expo clients receive only
the project URL and publishable key; no service-role or secret key belongs in a
mobile/web environment file.

## Client setup

Copy `apps/mobile/.env.example` to a local environment file and set:

```text
EXPO_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your-key
```

The shared client persists sessions with React Native AsyncStorage and refreshes
tokens while the native app is active. `AuthProvider` restores the session before
the protected Expo Router stack is rendered.

Production projects should enable email confirmation, configure custom SMTP, and
configure the project Site URL/redirect allow-list for the deployed web origin
and `grandtour://` mobile deep-link callback. Recovery links establish a recovery
session and route to `/reset-password`. The local Supabase configuration keeps
confirmation disabled so the integration test can create an immediately usable
session.

## Authorization model

- `profiles` stores private user-facing profile data. Clients can read their own
  row and update only `display_name` and `avatar_url`.
- `user_app_memberships` is the authority for `user`, `moderator`, `admin`, and
  `system` roles. Status is `active`, `suspended`, or `banned`.
- `competition_memberships` stores player/staff participation in a competition.
- Signup creates a non-dummy profile and an active `user` membership for the
  cycling app. User metadata supplies only the initial display name; policies do
  not use it for authorization.
- The legacy `profiles.is_admin` column remains for migration compatibility but
  new policies no longer authorize from it.

The small `app_private.has_*_role` functions are `SECURITY DEFINER` because a
membership policy cannot query its own RLS-protected table without recursion.
They live in an unexposed schema, use an empty search path, return only booleans,
and have no `PUBLIC` execute grant.

## Admin and dummy users

Role changes, suspensions, dummy-user creation, and system memberships must be
performed by a trusted server/admin script or by an already authorized app admin
through the protected policies. Never ship a service-role or secret key to Expo.

A dummy profile must correspond to a real `auth.users` row. Create that auth user
with `supabase.auth.admin.createUser()` in a server-only process, then update its
profile to `is_dummy = true` and assign a `system` membership using the same
server-side client. Public signup always forces `is_dummy = false`. Dummy activity
and its UI remain disabled for the MVP.

To bootstrap the first admin, use a trusted SQL/admin session to update the
cycling membership, not user metadata:

```sql
update public.user_app_memberships membership
set role = 'admin'
from public.apps app
where membership.app_id = app.id
  and app.code = 'cycling'
  and membership.user_id = '<auth-user-uuid>';
```

## Verification

Against a local Supabase instance, load values from `supabase status -o env` into
`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and
`SUPABASE_SERVICE_ROLE_KEY`, then run `npm run test:auth`. The service role is used
only to remove the temporary test users.

The integration check covers signup, automatic profile creation, private-profile
RLS, default app membership, blocked dummy/admin self-escalation, and logout. Also
verify before release:

- logged-out navigation lands on `/login` and protected screens are unavailable;
- logged-in navigation lands on the main app and a refreshed browser/native app
  restores the session;
- the recovery email uses an allow-listed production redirect;
- security and performance advisors have no new actionable findings.
