# Profile Management

## Purpose
Let a user view and edit their own display identity and notification
preferences.

## Confirmed rules
- Three name fields in one Account card: First name, Last name, Display
  name — all optional except at signup, where First name is required (it
  drives the dashboard greeting).
- A user can update only specific columns on their own `profiles` row
  (never another user's).
- Notification preference (`results_email_enabled`) is a single toggle,
  backed directly by RLS (no RPC needed).

## User experience
`apps/mobile/app/profile.tsx` — Account card (name fields), Notifications
card ("Email me my stage results" switch), admin links (only shown to
confirmed admins: "GrandTour stage review (admin)", "UCI rider review
(admin)"), and a build-version corner label.

## Data model
`profiles` (first_name/last_name/display_name/avatar_url),
`grandtour_notification_preferences` (one row per user,
`results_email_enabled`, `timezone`, auto-provisioned by the signup trigger
and backfilled for pre-existing profiles).

## Relevant source files
- `apps/mobile/app/profile.tsx`
- `packages/supabase-client/src/grandtourNotificationPreferences.ts` —
  `getNotificationPreference`, `setResultsEmailEnabled`.
- `apps/mobile/lib/errorMessage.ts` — `toSafeErrorMessage`, replacing an
  ad hoc inline error-message check (guards against ever showing
  `[object Object]`, though the specific reported bug was never reproducible
  in the code at the time it was investigated).
- `apps/mobile/lib/dashboardGreeting.ts` — `resolveDashboardFirstName`
  (`first_name` → `display_name`'s first token → `"there"`).

## Relevant migrations
- `20260714040000_add_profile_first_last_name.sql` — adds
  `first_name`/`last_name` columns.
- `20260715030000_grandtour_notification_preferences.sql` — the preferences
  table and its auto-provisioning trigger extension.

## Current implementation
Fully built, including the admin-links gating and the build-version label.

## Outstanding work
None currently open and confirmed — the historically-reported "profile save
fails" and "`[object Object]` error" symptoms both traced back to the
`profiles` grant bug (see [DATABASE.md](../development/DATABASE.md) gotcha
#1), which is now fixed.

## Edge cases
- A user with no `first_name` and no `display_name` still gets a sensible
  greeting fallback (`"there"`), never a blank or broken string.

## Acceptance criteria
- A profile edit persists and is reflected immediately without a page
  reload.
- Notification preference changes take effect for the next scored stage.

## Tests
`apps/mobile` `test:ui` (`dashboardGreeting`, `errorMessage`).
