alter table public.apps
  add column grandtour_tipping_enabled boolean not null default true;

comment on column public.apps.grandtour_tipping_enabled is
  'Remote emergency switch for GrandTour tip-entry writes. Read-only game data remains available.';

create or replace function grandtour_private.guard_tip_entry_enabled()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_competition_id uuid;
  entry_enabled boolean;
begin
  if coalesce(current_setting('grandtour.admin_override', true), '') = 'on' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_table_name = 'grandtour_tips' then
    target_competition_id := case
      when tg_op = 'DELETE' then old.competition_id
      else new.competition_id
    end;
  elsif tg_table_name = 'grandtour_tip_selections' then
    select tip.competition_id
    into target_competition_id
    from public.grandtour_tips tip
    where tip.id = case when tg_op = 'DELETE' then old.tip_id else new.tip_id end;
  else
    raise exception 'Unsupported GrandTour tip-entry guard target.';
  end if;

  select app.grandtour_tipping_enabled
  into entry_enabled
  from public.grandtour_competitions grandtour_competition
  join public.competitions competition
    on competition.id = grandtour_competition.competition_id
  join public.apps app on app.id = competition.app_id
  where grandtour_competition.id = target_competition_id
    and app.code = 'cycling'
    and app.is_active;

  if entry_enabled is distinct from true then
    raise exception 'GrandTour tipping is temporarily unavailable while we make updates.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function grandtour_private.guard_tip_entry_enabled()
from public, anon, authenticated, service_role;

drop trigger if exists grandtour_tips_entry_enabled_guard
on public.grandtour_tips;
create trigger grandtour_tips_entry_enabled_guard
before insert or update or delete
on public.grandtour_tips
for each row execute function grandtour_private.guard_tip_entry_enabled();

drop trigger if exists grandtour_tip_selections_entry_enabled_guard
on public.grandtour_tip_selections;
create trigger grandtour_tip_selections_entry_enabled_guard
before insert or update or delete
on public.grandtour_tip_selections
for each row execute function grandtour_private.guard_tip_entry_enabled();
