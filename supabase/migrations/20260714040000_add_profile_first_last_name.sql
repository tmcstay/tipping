-- The dashboard greeting ("Hi Tony") and profile screen need a real given
-- name, distinct from display_name (which powers public/leaderboard
-- identity). Neither first_name nor last_name existed on public.profiles
-- before this migration - this is a genuine schema gap, not a bug.
alter table public.profiles
  add column first_name text,
  add column last_name text;

-- Authenticated users may already update their own display_name/avatar_url
-- (20260701040559_add_auth_and_memberships.sql) - extend the same grant to
-- the two new columns rather than opening up the whole row.
revoke update on table public.profiles from authenticated;
grant update (display_name, avatar_url, first_name, last_name) on table public.profiles to authenticated;
