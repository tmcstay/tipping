-- Create the cycling app only if it does not already exist.
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
on conflict (code) do nothing;

-- Create the competition linked to the cycling app.
insert into public.competitions (
  app_id,
  competition_key,
  name,
  sport_type,
  season,
  starts_at,
  ends_at,
  is_active,
  is_public
)
select
  id,
  'local-grandtour-competition',
  'Local GrandTour Competition',
  'cycling',
  '2026',
  '2026-07-04 12:00:00+00',
  '2026-07-26 12:00:00+00',
  true,
  true
from public.apps
where code = 'cycling'
on conflict (app_id, competition_key) do nothing;

-- Create the grandtour competition linked to the existing Tour de France row.
with selected_tour as (
  select id
  from public.grand_tours
  where id = 'a0cfee7f-5789-5a71-9e03-a9cfe59d5c27'
  limit 1
), selected_competition as (
  select id
  from public.competitions
  where competition_key = 'local-grandtour-competition'
  limit 1
)
insert into public.grandtour_competitions (
  grand_tour_id,
  competition_id,
  name,
  is_public,
  allow_preselection,
  allow_daily
)
select
  selected_tour.id,
  selected_competition.id,
  'Local GrandTour Competition',
  true,
  true,
  true
from selected_tour
cross join selected_competition
on conflict (grand_tour_id, name) do nothing;
