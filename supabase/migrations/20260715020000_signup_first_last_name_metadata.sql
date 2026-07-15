-- Sign-up now collects first/last name (apps/mobile/screens/SignupScreen.tsx).
-- A confirmation-email signup has no session until the user confirms, so the
-- client can't write profile rows post-signup - the fields travel as user
-- metadata and this trigger function copies them into public.profiles, the
-- same mechanism display_name has always used.
--
-- display_name's fallback also changes: metadata display_name -> metadata
-- first_name -> email local-part. The public leaderboard identity should
-- only be an email fragment as a last resort, never when a real first name
-- was provided.
--
-- Same parameter list as the existing function, so this is a safe same-OID
-- `create or replace` (trigger binding, ownership, and the absence of any
-- client EXECUTE grant are all preserved - see CLAUDE.md's Postgres gotchas
-- for why a signature CHANGE would have needed drop + regrant instead).

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

  return new;
end;
$$;
