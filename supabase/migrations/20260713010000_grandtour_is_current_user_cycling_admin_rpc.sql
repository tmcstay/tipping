-- Public wrapper around the fixed grandtour_private.is_cycling_admin()
-- check (see 20260710060000_grandtour_admin_check_finalise_authenticated_grants.sql
-- for the NULL-vs-false fix). grandtour_private is not exposed via
-- PostgREST, so a caller holding only the anon/publishable key plus their
-- own authenticated session had no way to ask "am I a cycling admin?"
-- without either a service-role key or re-implementing the membership
-- query a third time. This RPC reuses the single already-fixed
-- implementation instead.
--
-- Used by the admin UI's server-side "Run Official Check" route
-- (apps/mobile/api/admin/grandtour/run-official-check.mjs) to authorize a
-- request before running any dry-run/reconcile fetch. That route never has
-- a service-role key available to it, so this RPC (callable with just the
-- caller's own session) is the only way it can perform this check.
create or replace function public.is_current_user_cycling_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select grandtour_private.is_cycling_admin();
$$;

comment on function public.is_current_user_cycling_admin() is
  'Public wrapper around grandtour_private.is_cycling_admin() (the fixed, NULL-safe admin check) so an authenticated, non-service-role caller can ask "am I a cycling admin?". Always returns a genuine true/false, never NULL. Read-only; performs no writes.';

-- Postgres grants EXECUTE on a new function to PUBLIC by default; revoke
-- that first so only `authenticated` (never `anon`) can call it.
revoke all on function public.is_current_user_cycling_admin() from public;
grant execute on function public.is_current_user_cycling_admin() to authenticated;
