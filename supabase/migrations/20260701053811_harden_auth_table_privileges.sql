-- Repair hosted policy drift and make Data API privileges explicit. RLS remains
-- authoritative for rows; grants define the operations each API role may try.

drop policy if exists "Users can update their own profile"
on public.profiles;

create policy "Users can update their own profile"
on public.profiles for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

revoke all privileges on table
  public.profiles,
  public.apps,
  public.user_app_memberships,
  public.competitions,
  public.competition_memberships
from anon;

revoke all privileges on table public.profiles from authenticated;
grant select on table public.profiles to authenticated;
grant update (display_name, avatar_url)
on table public.profiles to authenticated;

revoke all privileges on table public.apps, public.competitions
from authenticated;
grant select, insert, update
on table public.apps, public.competitions
to authenticated;

revoke all privileges on table
  public.user_app_memberships,
  public.competition_memberships
from authenticated;
grant select, insert, update, delete
on table public.user_app_memberships, public.competition_memberships
to authenticated;

grant all privileges on table
  public.profiles,
  public.apps,
  public.user_app_memberships,
  public.competitions,
  public.competition_memberships
to service_role;
