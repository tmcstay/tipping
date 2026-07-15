-- Result-email notification preferences (Resend/send-stage-results feature).
-- Narrowly scoped to the single "results email" toggle described in
-- CLAUDE.md's "Resend transactional email" section - deliberately NOT a
-- general marketing/promotional consent table. No prior notification
-- preference schema exists anywhere in this repo (confirmed by a full-repo
-- grep before writing this migration).
--
-- No existing consent model requires explicit opt-in for this app (this is
-- a results/utility notification tied to a game the user already tips in,
-- not marketing), so new users default to enabled - matching the task's
-- "opt-out by default" instruction. One row per profile, created eagerly by
-- the existing signup trigger (see the handle_new_auth_user() extension
-- below) so job generation never has to special-case a missing row.
create table public.grandtour_notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  results_email_enabled boolean not null default true,
  timezone text not null default 'Australia/Adelaide',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.grandtour_notification_preferences is
  'Per-user opt-in/opt-out for GrandTour stage-result emails only. Not a marketing/promotional consent store - keep it that way.';

alter table public.grandtour_notification_preferences enable row level security;

-- Users may read and update only their own row. No admin/service policy is
-- needed for internal processing: the send-stage-results Edge Function
-- reads this table with the service-role key, which bypasses RLS entirely
-- (the established convention for internal processing in this repo - see
-- CLAUDE.md's apply/admin-check/finalize RPCs, which use the same key for
-- the equivalent trust boundary).
create policy "Users can read their own notification preferences"
  on public.grandtour_notification_preferences
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can insert their own notification preferences"
  on public.grandtour_notification_preferences
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update their own notification preferences"
  on public.grandtour_notification_preferences
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on public.grandtour_notification_preferences from public, anon;
grant select, insert, update on public.grandtour_notification_preferences to authenticated;

-- Shared updated_at trigger helper (new - the existing
-- app_private.set_profile_updated_at() is scoped specifically to
-- public.profiles). Reused by grandtour_stage_notification_jobs below.
create function app_private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger grandtour_notification_preferences_set_updated_at
before update on public.grandtour_notification_preferences
for each row execute function app_private.set_updated_at();

-- Keep new-user provisioning in one place: extend the existing signup
-- trigger to also create a default (enabled) preference row, the same way
-- it already provisions the default `cycling` app membership below. Same
-- parameter list/signature as the current function, so this is a safe
-- same-OID `create or replace` (see CLAUDE.md's Postgres gotchas on why a
-- signature CHANGE would instead need drop + regrant).
create or replace function app_private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  default_app_id uuid;
  requested_display_name text;
  requested_first_name text;
  requested_last_name text;
begin
  requested_display_name := nullif(btrim(new.raw_user_meta_data ->> 'display_name'), '');
  requested_first_name := nullif(btrim(new.raw_user_meta_data ->> 'first_name'), '');
  requested_last_name := nullif(btrim(new.raw_user_meta_data ->> 'last_name'), '');

  insert into public.profiles (
    id,
    email,
    display_name,
    first_name,
    last_name,
    avatar_url,
    is_admin,
    is_dummy,
    created_at,
    updated_at
  )
  values (
    new.id,
    new.email,
    coalesce(
      requested_display_name,
      requested_first_name,
      nullif(split_part(new.email, '@', 1), '')
    ),
    requested_first_name,
    requested_last_name,
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
    first_name = coalesce(public.profiles.first_name, excluded.first_name),
    last_name = coalesce(public.profiles.last_name, excluded.last_name),
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

  insert into public.grandtour_notification_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

-- Backfill a default (enabled) row for every profile that already existed
-- before this migration, so job generation never has to treat "no row" as
-- an ambiguous case for pre-existing users.
insert into public.grandtour_notification_preferences (user_id)
select id from public.profiles
on conflict (user_id) do nothing;
