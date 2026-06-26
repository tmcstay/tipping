-- F1Tips sample seed data.
-- These records are intended for local development/demo use and should be reviewed
-- before production. Race dates and lock times are realistic samples, not a live feed.

with seeded_app as (
  insert into public.apps (
    app_key,
    name,
    sport_type,
    theme,
    ads_enabled,
    subscriptions_enabled,
    dummy_activity_enabled,
    prizes_enabled
  )
  values (
    'f1tips',
    'F1Tips',
    'motorsport',
    '{"primaryColor":"#E10600","secondaryColor":"#111111","backgroundColor":"#FFFFFF"}'::jsonb,
    true,
    true,
    true,
    false
  )
  on conflict (app_key) do update
  set
    name = excluded.name,
    sport_type = excluded.sport_type,
    theme = excluded.theme,
    ads_enabled = excluded.ads_enabled,
    subscriptions_enabled = excluded.subscriptions_enabled,
    dummy_activity_enabled = excluded.dummy_activity_enabled,
    prizes_enabled = excluded.prizes_enabled
  returning id
),
seeded_competition as (
  insert into public.competitions (
    app_id,
    competition_key,
    name,
    sport_type
  )
  select
    seeded_app.id,
    'formula_1',
    'Formula 1',
    'motorsport'
  from seeded_app
  on conflict (app_id, competition_key) do update
  set
    name = excluded.name,
    sport_type = excluded.sport_type
  returning id
),
seeded_season as (
  insert into public.seasons (
    competition_id,
    season_year,
    name,
    status
  )
  select
    seeded_competition.id,
    2026,
    '2026 Formula 1 Season',
    'active'
  from seeded_competition
  on conflict (competition_id, season_year) do update
  set
    name = excluded.name,
    status = excluded.status
  returning id
),
seeded_events as (
  insert into public.events (
    season_id,
    event_key,
    name,
    venue,
    country,
    starts_at,
    lock_at,
    status
  )
  select
    seeded_season.id,
    event_data.event_key,
    event_data.name,
    event_data.venue,
    event_data.country,
    event_data.starts_at,
    event_data.lock_at,
    event_data.status
  from seeded_season
  cross join (
    values
      (
        'australian_gp',
        'Australian Grand Prix',
        'Albert Park Circuit',
        'Australia',
        '2026-03-08 04:00:00+00'::timestamptz,
        '2026-03-08 03:50:00+00'::timestamptz,
        'sample'
      ),
      (
        'chinese_gp',
        'Chinese Grand Prix',
        'Shanghai International Circuit',
        'China',
        '2026-03-15 07:00:00+00'::timestamptz,
        '2026-03-15 06:50:00+00'::timestamptz,
        'sample'
      ),
      (
        'japanese_gp',
        'Japanese Grand Prix',
        'Suzuka Circuit',
        'Japan',
        '2026-03-29 05:00:00+00'::timestamptz,
        '2026-03-29 04:50:00+00'::timestamptz,
        'sample'
      ),
      (
        'miami_gp',
        'Miami Grand Prix',
        'Miami International Autodrome',
        'United States',
        '2026-05-03 20:00:00+00'::timestamptz,
        '2026-05-03 19:50:00+00'::timestamptz,
        'sample'
      ),
      (
        'canadian_gp',
        'Canadian Grand Prix',
        'Circuit Gilles Villeneuve',
        'Canada',
        '2026-05-24 18:00:00+00'::timestamptz,
        '2026-05-24 17:50:00+00'::timestamptz,
        'sample'
      )
  ) as event_data(event_key, name, venue, country, starts_at, lock_at, status)
  on conflict (season_id, event_key) do update
  set
    name = excluded.name,
    venue = excluded.venue,
    country = excluded.country,
    starts_at = excluded.starts_at,
    lock_at = excluded.lock_at,
    status = excluded.status
  returning id, event_key, lock_at
),
seeded_competitors as (
  insert into public.competitors (
    competition_id,
    competitor_key,
    name,
    competitor_type,
    team_name,
    active
  )
  select
    seeded_competition.id,
    driver_data.competitor_key,
    driver_data.name,
    'driver',
    driver_data.team_name,
    true
  from seeded_competition
  cross join (
    values
      ('max_verstappen', 'Max Verstappen', 'Red Bull Racing'),
      ('isack_hadjar', 'Isack Hadjar', 'Red Bull Racing'),
      ('lando_norris', 'Lando Norris', 'McLaren'),
      ('oscar_piastri', 'Oscar Piastri', 'McLaren'),
      ('charles_leclerc', 'Charles Leclerc', 'Ferrari'),
      ('lewis_hamilton', 'Lewis Hamilton', 'Ferrari'),
      ('george_russell', 'George Russell', 'Mercedes'),
      ('kimi_antonelli', 'Kimi Antonelli', 'Mercedes'),
      ('fernando_alonso', 'Fernando Alonso', 'Aston Martin'),
      ('lance_stroll', 'Lance Stroll', 'Aston Martin'),
      ('pierre_gasly', 'Pierre Gasly', 'Alpine'),
      ('franco_colapinto', 'Franco Colapinto', 'Alpine'),
      ('esteban_ocon', 'Esteban Ocon', 'Haas'),
      ('oliver_bearman', 'Oliver Bearman', 'Haas'),
      ('carlos_sainz', 'Carlos Sainz', 'Williams'),
      ('alex_albon', 'Alex Albon', 'Williams'),
      ('liam_lawson', 'Liam Lawson', 'Racing Bulls'),
      ('arvid_lindblad', 'Arvid Lindblad', 'Racing Bulls'),
      ('nico_hulkenberg', 'Nico Hulkenberg', 'Audi'),
      ('gabriel_bortoleto', 'Gabriel Bortoleto', 'Audi'),
      ('sergio_perez', 'Sergio Perez', 'Cadillac'),
      ('valtteri_bottas', 'Valtteri Bottas', 'Cadillac')
  ) as driver_data(competitor_key, name, team_name)
  on conflict (competition_id, competitor_key) do update
  set
    name = excluded.name,
    competitor_type = excluded.competitor_type,
    team_name = excluded.team_name,
    active = excluded.active
  returning id
)
insert into public.markets (
  event_id,
  market_key,
  market_type,
  name,
  lock_at,
  points_rule,
  status
)
select
  seeded_events.id,
  market_data.market_key,
  market_data.market_type,
  market_data.name,
  seeded_events.lock_at,
  market_data.points_rule,
  'open'
from seeded_events
cross join (
  values
    (
      'race_winner',
      'race_winner',
      'Race Winner',
      '{"correct":10,"incorrect":0,"sample":true}'::jsonb
    ),
    (
      'podium',
      'podium',
      'Podium',
      '{"correctDriverInPodium":5,"exactPosition":10,"sample":true}'::jsonb
    ),
    (
      'fastest_lap',
      'fastest_lap',
      'Fastest Lap',
      '{"correct":5,"incorrect":0,"sample":true}'::jsonb
    ),
    (
      'qualifying_winner',
      'qualifying_winner',
      'Qualifying Winner',
      '{"correct":5,"incorrect":0,"sample":true}'::jsonb
    )
) as market_data(market_key, market_type, name, points_rule)
on conflict (event_id, market_key) do update
set
  market_type = excluded.market_type,
  name = excluded.name,
  lock_at = excluded.lock_at,
  points_rule = excluded.points_rule,
  status = excluded.status;
