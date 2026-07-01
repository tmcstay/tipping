-- Authentication and suite-wide app membership foundation.
-- Existing applied tables are evolved in place; authorization is app-owned and
-- never depends on user-editable auth metadata.

alter table public.apps rename column app_key to code;
alter table public.apps rename column sport_type to sport;
alter table public.apps
  add column is_active boolean not null default true;

-- GrandTour MVP feature flags stay disabled. Future apps may opt in explicitly.
alter table public.apps alter column ads_enabled set default false;
alter table public.apps alter column subscriptions_enabled set default false;
update public.apps
set
  ads_enabled = false,
  subscriptions_enabled = false,
  dummy_activity_enabled = false,
  prizes_enabled = false;

insert into public.apps (
  code,
  name,
  sport,
  is_active,
  ads_enabled,
  subscriptions_enabled,
  dummy_activity_enabled,
  prizes_enabled
)
values (
  'cycling',
  'GrandTour',
  'cycling',
  true,
  false,
  false,
  false,
  false
)
on conflict (code) do update
set
  name = excluded.name,
  sport = excluded.sport,
  is_active = excluded.is_active,
  ads_enabled = excluded.ads_enabled,
  subscriptions_enabled = excluded.subscriptions_enabled,
  dummy_activity_enabled = excluded.dummy_activity_enabled,
  prizes_enabled = excluded.prizes_enabled;

alter table public.profiles
  add column email text;

alter table public.profiles
  alter column updated_at set default now();

update public.profiles profile
set
  email = auth_user.email,
  display_name = coalesce(
    nullif(btrim(profile.display_name), ''),
    nullif(split_part(auth_user.email, '@', 1), '')
  ),
  updated_at = coalesce(profile.updated_at, profile.created_at, now())
from auth.users auth_user
where auth_user.id = profile.id;

alter table public.competitions
  add column season text,
  add column starts_at timestamptz,
  add column ends_at timestamptz,
  add column is_active boolean not null default true,
  add column is_public boolean not null default true,
  add constraint competitions_date_order_check
    check (ends_at is null or starts_at is null or ends_at >= starts_at);

create table public.user_app_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  app_id uuid not null references public.apps(id) on delete cascade,
  role text not null default 'user',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  unique (user_id, app_id),
  check (role in ('user', 'moderator', 'admin', 'system')),
  check (status in ('active', 'suspended', 'banned'))
);

create table public.competition_memberships (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'player',
  created_at timestamptz not null default now(),
  unique (competition_id, user_id),
  check (role in ('player', 'moderator', 'admin'))
);

create index user_app_memberships_app_role_idx
on public.user_app_memberships (app_id, role, status);

create index user_app_memberships_user_idx
on public.user_app_memberships (user_id);

create index competition_memberships_competition_idx
on public.competition_memberships (competition_id);

create index competition_memberships_user_idx
on public.competition_memberships (user_id);

alter table public.user_app_memberships enable row level security;
alter table public.competition_memberships enable row level security;

create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

-- Membership policies query the membership table itself. This narrowly scoped
-- definer function avoids recursive RLS while exposing only a boolean decision.
create function app_private.has_app_role(
  target_app_id uuid,
  allowed_roles text[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_app_memberships membership
    where membership.user_id = (select auth.uid())
      and membership.app_id = target_app_id
      and membership.status = 'active'
      and membership.role = any (allowed_roles)
  );
$$;

create function app_private.has_any_app_role(allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_app_memberships membership
    where membership.user_id = (select auth.uid())
      and membership.status = 'active'
      and membership.role = any (allowed_roles)
  );
$$;

create function app_private.has_app_code_role(
  target_app_code text,
  allowed_roles text[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_app_memberships membership
    join public.apps app on app.id = membership.app_id
    where membership.user_id = (select auth.uid())
      and membership.status = 'active'
      and membership.role = any (allowed_roles)
      and app.code = target_app_code
      and app.is_active
  );
$$;

revoke all on function app_private.has_app_role(uuid, text[]) from public;
revoke all on function app_private.has_any_app_role(text[]) from public;
revoke all on function app_private.has_app_code_role(text, text[]) from public;
grant execute on function app_private.has_app_role(uuid, text[]) to authenticated;
grant execute on function app_private.has_any_app_role(text[]) to authenticated;
grant execute on function app_private.has_app_code_role(text, text[]) to authenticated;

create function app_private.set_profile_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function app_private.set_profile_updated_at();

-- This is privileged because auth owns auth.users and signup must create public
-- rows atomically. It has no client EXECUTE grant and uses a fixed search path.
create function app_private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  default_app_id uuid;
  requested_display_name text;
begin
  requested_display_name := nullif(btrim(new.raw_user_meta_data ->> 'display_name'), '');

  insert into public.profiles (
    id,
    email,
    display_name,
    avatar_url,
    is_admin,
    is_dummy,
    created_at,
    updated_at
  )
  values (
    new.id,
    new.email,
    coalesce(requested_display_name, nullif(split_part(new.email, '@', 1), '')),
    null,
    false,
    false,
    now(),
    now()
  )
  on conflict (id) do update
  set
    email = excluded.email,
    display_name = coalesce(public.profiles.display_name, excluded.display_name),
    updated_at = now();

  select app.id
  into default_app_id
  from public.apps app
  where app.code = 'cycling'
    and app.is_active;

  if default_app_id is not null then
    insert into public.user_app_memberships (user_id, app_id, role, status)
    values (new.id, default_app_id, 'user', 'active')
    on conflict (user_id, app_id) do nothing;
  end if;

  return new;
end;
$$;

create function app_private.handle_auth_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
  set email = new.email
  where id = new.id;
  return new;
end;
$$;

revoke all on function app_private.handle_new_auth_user() from public, anon, authenticated;
revoke all on function app_private.handle_auth_user_email_change() from public, anon, authenticated;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function app_private.handle_new_auth_user();

create trigger on_auth_user_email_changed
after update of email on auth.users
for each row
when (old.email is distinct from new.email)
execute function app_private.handle_auth_user_email_change();

-- Backfill profiles and normal cycling memberships for pre-existing auth users.
insert into public.profiles (
  id,
  email,
  display_name,
  avatar_url,
  is_admin,
  is_dummy,
  created_at,
  updated_at
)
select
  auth_user.id,
  auth_user.email,
  coalesce(
    nullif(btrim(auth_user.raw_user_meta_data ->> 'display_name'), ''),
    nullif(split_part(auth_user.email, '@', 1), '')
  ),
  null,
  false,
  false,
  coalesce(auth_user.created_at, now()),
  now()
from auth.users auth_user
on conflict (id) do update
set email = excluded.email;

insert into public.user_app_memberships (user_id, app_id, role, status)
select
  profile.id,
  app.id,
  case when profile.is_admin then 'admin' else 'user' end,
  'active'
from public.profiles profile
cross join public.apps app
where app.code = 'cycling'
on conflict (user_id, app_id) do update
set role = case
  when excluded.role = 'admin' then 'admin'
  else public.user_app_memberships.role
end;

drop policy if exists "Public can read apps" on public.apps;
drop policy if exists "Public can read competitions" on public.competitions;

create policy "Authenticated users can read active apps"
on public.apps for select
to authenticated
using (is_active);

create policy "Admins can create apps"
on public.apps for insert
to authenticated
with check ((select app_private.has_any_app_role(array['admin'])));

create policy "Admins can update apps"
on public.apps for update
to authenticated
using ((select app_private.has_app_role(id, array['admin'])))
with check ((select app_private.has_app_role(id, array['admin'])));

create policy "Authenticated users can read active competitions"
on public.competitions for select
to authenticated
using (is_active);

create policy "App staff can create competitions"
on public.competitions for insert
to authenticated
with check ((select app_private.has_app_role(app_id, array['admin', 'moderator'])));

create policy "App staff can update competitions"
on public.competitions for update
to authenticated
using ((select app_private.has_app_role(app_id, array['admin', 'moderator'])))
with check ((select app_private.has_app_role(app_id, array['admin', 'moderator'])));

create policy "Users can read their own app memberships"
on public.user_app_memberships for select
to authenticated
using (
  user_id = (select auth.uid())
  or (select app_private.has_app_role(app_id, array['admin']))
);

create policy "App admins can create memberships"
on public.user_app_memberships for insert
to authenticated
with check ((select app_private.has_app_role(app_id, array['admin'])));

create policy "App admins can update memberships"
on public.user_app_memberships for update
to authenticated
using ((select app_private.has_app_role(app_id, array['admin'])))
with check ((select app_private.has_app_role(app_id, array['admin'])));

create policy "App admins can delete memberships"
on public.user_app_memberships for delete
to authenticated
using ((select app_private.has_app_role(app_id, array['admin'])));

create policy "Users and app staff can read competition memberships"
on public.competition_memberships for select
to authenticated
using (
  user_id = (select auth.uid())
  or exists (
    select 1
    from public.competitions competition
    where competition.id = competition_memberships.competition_id
      and (select app_private.has_app_role(
        competition.app_id,
        array['admin', 'moderator']
      ))
  )
);

create policy "Users can join public active competitions"
on public.competition_memberships for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and role = 'player'
  and exists (
    select 1
    from public.competitions competition
    join public.user_app_memberships app_membership
      on app_membership.app_id = competition.app_id
     and app_membership.user_id = (select auth.uid())
     and app_membership.status = 'active'
    where competition.id = competition_memberships.competition_id
      and competition.is_active
      and competition.is_public
  )
);

create policy "App staff can manage competition memberships"
on public.competition_memberships for all
to authenticated
using (
  exists (
    select 1
    from public.competitions competition
    where competition.id = competition_memberships.competition_id
      and (select app_private.has_app_role(
        competition.app_id,
        array['admin', 'moderator']
      ))
  )
)
with check (
  exists (
    select 1
    from public.competitions competition
    where competition.id = competition_memberships.competition_id
      and (select app_private.has_app_role(
        competition.app_id,
        array['admin', 'moderator']
      ))
  )
);

-- Replace legacy profile-boolean authorization with app-owned roles.
drop policy if exists "Admins can read all GrandTour tips" on public.grandtour_tips;
drop policy if exists "Admins can read all GrandTour selections" on public.grandtour_tip_selections;
drop policy if exists "Admins can manage GrandTour stage results" on public.grandtour_stage_results;
drop policy if exists "Admins can manage GrandTour result lines" on public.grandtour_stage_result_lines;
drop policy if exists "Admins can manage GrandTour jersey holders" on public.grandtour_stage_jersey_holders;
drop policy if exists "Admins can manage GrandTour scores" on public.grandtour_stage_scores;
drop policy if exists "Admins can manage GrandTour leaderboard snapshots" on public.grandtour_leaderboard_snapshots;
drop policy if exists "Admins can manage GrandTour data audit" on public.data_audit;

create policy "Admins can read all GrandTour tips"
on public.grandtour_tips for select
to authenticated
using ((select app_private.has_app_code_role('cycling', array['admin'])));

create policy "Admins can read all GrandTour selections"
on public.grandtour_tip_selections for select
to authenticated
using ((select app_private.has_app_code_role('cycling', array['admin'])));

create policy "Admins can manage GrandTour stage results"
on public.grandtour_stage_results for all
to authenticated
using ((select app_private.has_app_code_role('cycling', array['admin'])))
with check ((select app_private.has_app_code_role('cycling', array['admin'])));

create policy "Admins can manage GrandTour result lines"
on public.grandtour_stage_result_lines for all
to authenticated
using ((select app_private.has_app_code_role('cycling', array['admin'])))
with check ((select app_private.has_app_code_role('cycling', array['admin'])));

create policy "Admins can manage GrandTour jersey holders"
on public.grandtour_stage_jersey_holders for all
to authenticated
using ((select app_private.has_app_code_role('cycling', array['admin'])))
with check ((select app_private.has_app_code_role('cycling', array['admin'])));

create policy "Admins can manage GrandTour scores"
on public.grandtour_stage_scores for all
to authenticated
using ((select app_private.has_app_code_role('cycling', array['admin'])))
with check ((select app_private.has_app_code_role('cycling', array['admin'])));

create policy "Admins can manage GrandTour leaderboard snapshots"
on public.grandtour_leaderboard_snapshots for all
to authenticated
using ((select app_private.has_app_code_role('cycling', array['admin'])))
with check ((select app_private.has_app_code_role('cycling', array['admin'])));

create policy "Admins can manage GrandTour data audit"
on public.data_audit for all
to authenticated
using ((select app_private.has_app_code_role('cycling', array['admin'])))
with check ((select app_private.has_app_code_role('cycling', array['admin'])));

revoke select on table public.apps, public.competitions from anon;
grant select on table public.apps, public.competitions to authenticated;
grant insert, update on table public.apps, public.competitions to authenticated;

revoke update on table public.profiles from authenticated;
grant update (display_name, avatar_url) on table public.profiles to authenticated;

grant select, insert, update, delete
on table public.user_app_memberships, public.competition_memberships
to authenticated;

grant all privileges
on table public.user_app_memberships, public.competition_memberships
to service_role;
