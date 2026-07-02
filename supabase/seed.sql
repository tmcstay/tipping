-- GrandTour MVP deterministic sample data.
--
-- This is synthetic development/test data. It is not an official race schedule,
-- team list, rider list, route, or licensed cycling dataset, and it must not be
-- presented as affiliated with or endorsed by any real-world race organiser.

insert into public.grand_tours (
  id,
  name,
  year,
  starts_at,
  ends_at,
  preselection_locks_at
)
values (
  '10000000-0000-4000-8000-000000000001',
  'GrandTour France 2026',
  2026,
  '2026-08-01 10:00:00+00',
  '2026-08-21 17:00:00+00',
  '2026-07-31 23:00:00+00'
)
on conflict (id) do update
set
  name = excluded.name,
  year = excluded.year,
  starts_at = excluded.starts_at,
  ends_at = excluded.ends_at,
  preselection_locks_at = excluded.preselection_locks_at;

insert into public.competitions (
  id, app_id, competition_key, name, sport_type, season,
  starts_at, ends_at, is_active, is_public
)
select
  '21000000-0000-4000-8000-000000000001',
  app.id,
  'grandtour-france-2026-public',
  'GrandTour France 2026 Public League',
  'cycling',
  '2026',
  '2026-08-01 10:00:00+00',
  '2026-08-21 17:00:00+00',
  true,
  true
from public.apps app
where app.code = 'cycling'
on conflict (id) do update set
  name = excluded.name,
  starts_at = excluded.starts_at,
  ends_at = excluded.ends_at,
  is_active = excluded.is_active,
  is_public = excluded.is_public;

insert into public.grandtour_competitions (
  id,
  grand_tour_id,
  competition_id,
  name,
  is_public,
  allow_preselection,
  allow_daily
)
values (
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000001',
  'GrandTour France 2026 Public League',
  true,
  true,
  true
)
on conflict (id) do update
set
  grand_tour_id = excluded.grand_tour_id,
  competition_id = excluded.competition_id,
  name = excluded.name,
  is_public = excluded.is_public,
  allow_preselection = excluded.allow_preselection,
  allow_daily = excluded.allow_daily;

insert into public.grandtour_teams (
  id,
  grand_tour_id,
  name,
  short_name
)
values
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Aurore Vélo', 'AUV'),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'Northstar Cycling', 'NST'),
  ('30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'Velocità Corse', 'VLC'),
  ('30000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', 'Iberia Road Collective', 'IRC'),
  ('30000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', 'Summit Pro Cycling', 'SPC'),
  ('30000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000001', 'Atlantic Racing', 'ATR'),
  ('30000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000001', 'Oranje Wheels', 'ORW'),
  ('30000000-0000-4000-8000-000000000008', '10000000-0000-4000-8000-000000000001', 'Alpine Horizon', 'ALH')
on conflict (id) do update
set
  grand_tour_id = excluded.grand_tour_id,
  name = excluded.name,
  short_name = excluded.short_name;

insert into public.grandtour_riders (
  id,
  grand_tour_id,
  team_id,
  display_name,
  country,
  rider_type,
  is_active,
  normalized_name
)
select
  id::uuid,
  grand_tour_id::uuid,
  team_id::uuid,
  display_name,
  country,
  rider_type,
  is_active,
  lower(regexp_replace(trim(display_name), '\s+', ' ', 'g'))
from (values
  ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'Luc Moreau', 'France', 'gc', true),
  ('40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'Étienne Caron', 'France', 'sprinter', true),
  ('40000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'Mathieu Delorme', 'France', 'climber', true),
  ('40000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'Rémi Vaillant', 'Belgium', 'puncheur', true),
  ('40000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'Julien Mercier', 'France', 'domestique', true),

  ('40000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', 'Elias Berg', 'Norway', 'gc', true),
  ('40000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', 'Nils Andersen', 'Denmark', 'time_trial', true),
  ('40000000-0000-4000-8000-000000000008', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', 'Soren Lindholm', 'Denmark', 'climber', true),
  ('40000000-0000-4000-8000-000000000009', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', 'Mikkel Vester', 'Denmark', 'sprinter', true),
  ('40000000-0000-4000-8000-000000000010', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', 'Oskar Nyberg', 'Sweden', 'domestique', true),

  ('40000000-0000-4000-8000-000000000011', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000003', 'Matteo Rinaldi', 'Italy', 'gc', true),
  ('40000000-0000-4000-8000-000000000012', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000003', 'Luca Ferretti', 'Italy', 'sprinter', true),
  ('40000000-0000-4000-8000-000000000013', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000003', 'Davide Conti', 'Italy', 'climber', true),
  ('40000000-0000-4000-8000-000000000014', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000003', 'Enzo Bellini', 'Italy', 'puncheur', true),
  ('40000000-0000-4000-8000-000000000015', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000003', 'Paolo Moretti', 'Italy', 'time_trial', true),

  ('40000000-0000-4000-8000-000000000016', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000004', 'Javier Solano', 'Spain', 'gc', true),
  ('40000000-0000-4000-8000-000000000017', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000004', 'Miguel Ortega', 'Spain', 'climber', true),
  ('40000000-0000-4000-8000-000000000018', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000004', 'Carlos Mena', 'Spain', 'sprinter', true),
  ('40000000-0000-4000-8000-000000000019', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000004', 'Diego Navarro', 'Spain', 'puncheur', true),
  ('40000000-0000-4000-8000-000000000020', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000004', 'Rubén Castaño', 'Spain', 'domestique', true),

  ('40000000-0000-4000-8000-000000000021', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000005', 'Jonas Keller', 'Switzerland', 'gc', true),
  ('40000000-0000-4000-8000-000000000022', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000005', 'Lukas Steiner', 'Austria', 'climber', true),
  ('40000000-0000-4000-8000-000000000023', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000005', 'Felix Baumann', 'Germany', 'time_trial', true),
  ('40000000-0000-4000-8000-000000000024', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000005', 'Adrian Vogel', 'Switzerland', 'puncheur', true),
  ('40000000-0000-4000-8000-000000000025', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000005', 'Tobias Frei', 'Switzerland', 'domestique', true),

  ('40000000-0000-4000-8000-000000000026', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000006', 'Thomas Byrne', 'Ireland', 'gc', true),
  ('40000000-0000-4000-8000-000000000027', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000006', 'Liam Doyle', 'Ireland', 'sprinter', true),
  ('40000000-0000-4000-8000-000000000028', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000006', 'Callum Price', 'United Kingdom', 'time_trial', true),
  ('40000000-0000-4000-8000-000000000029', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000006', 'Owen Mercer', 'United Kingdom', 'puncheur', true),
  ('40000000-0000-4000-8000-000000000030', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000006', 'Nathan Reed', 'Australia', 'domestique', true),

  ('40000000-0000-4000-8000-000000000031', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000007', 'Bram de Vries', 'Netherlands', 'sprinter', true),
  ('40000000-0000-4000-8000-000000000032', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000007', 'Koen Smit', 'Netherlands', 'gc', true),
  ('40000000-0000-4000-8000-000000000033', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000007', 'Daan Vermeer', 'Netherlands', 'time_trial', true),
  ('40000000-0000-4000-8000-000000000034', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000007', 'Joris van Dijk', 'Netherlands', 'puncheur', true),
  ('40000000-0000-4000-8000-000000000035', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000007', 'Lars Meijer', 'Netherlands', 'domestique', true),

  ('40000000-0000-4000-8000-000000000036', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000008', 'Hugo Laurent', 'France', 'climber', true),
  ('40000000-0000-4000-8000-000000000037', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000008', 'Marc Besson', 'France', 'gc', true),
  ('40000000-0000-4000-8000-000000000038', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000008', 'Theo Girard', 'France', 'sprinter', true),
  ('40000000-0000-4000-8000-000000000039', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000008', 'Bastien Roche', 'France', 'puncheur', true),
  ('40000000-0000-4000-8000-000000000040', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000008', 'Antonin Perrin', 'France', 'domestique', true)
) as seeded_riders (
  id,
  grand_tour_id,
  team_id,
  display_name,
  country,
  rider_type,
  is_active
)
on conflict (id) do update
set
  grand_tour_id = excluded.grand_tour_id,
  team_id = excluded.team_id,
  display_name = excluded.display_name,
  normalized_name = excluded.normalized_name,
  country = excluded.country,
  rider_type = excluded.rider_type,
  is_active = excluded.is_active;

insert into public.grandtour_stages (
  id,
  grand_tour_id,
  stage_number,
  stage_name,
  stage_type,
  starts_at,
  locks_at,
  start_location,
  finish_location,
  distance_km
)
values
  ('50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 1, 'Stage 1', 'flat', '2026-08-01 10:00:00+00', '2026-08-01 09:50:00+00', 'Northport', 'Riverside', 178.5),
  ('50000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 2, 'Stage 2', 'hilly', '2026-08-02 10:00:00+00', '2026-08-02 09:50:00+00', 'Riverside', 'Hillcrest', 164.0),
  ('50000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 3, 'Stage 3', 'mountain', '2026-08-03 10:00:00+00', '2026-08-03 09:50:00+00', 'Hillcrest', 'Summit Vale', 152.5),
  ('50000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', 4, 'Stage 4', 'team_time_trial', '2026-08-04 10:00:00+00', '2026-08-04 09:50:00+00', 'Lakeview', 'Lakeview', 38.0),
  ('50000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', 5, 'Stage 5', 'flat', '2026-08-05 10:00:00+00', '2026-08-05 09:50:00+00', 'Lakeview', 'Westfield', 191.0),
  ('50000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000001', 6, 'Stage 6', 'hilly', '2026-08-06 10:00:00+00', '2026-08-06 09:50:00+00', 'Westfield', 'Stonebridge', 173.5),
  ('50000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000001', 7, 'Stage 7', 'mountain', '2026-08-07 10:00:00+00', '2026-08-07 09:50:00+00', 'Stonebridge', 'Pine Summit', 146.0),
  ('50000000-0000-4000-8000-000000000008', '10000000-0000-4000-8000-000000000001', 8, 'Stage 8', 'flat', '2026-08-08 10:00:00+00', '2026-08-08 09:50:00+00', 'Pine Valley', 'Eastport', 205.0),
  ('50000000-0000-4000-8000-000000000009', '10000000-0000-4000-8000-000000000001', 9, 'Stage 9', 'individual_time_trial', '2026-08-09 10:00:00+00', '2026-08-09 09:50:00+00', 'Eastport', 'Eastport', 32.5),
  ('50000000-0000-4000-8000-000000000010', '10000000-0000-4000-8000-000000000001', 10, 'Stage 10', 'mountain', '2026-08-10 10:00:00+00', '2026-08-10 09:50:00+00', 'Meadowtown', 'High Pass', 158.0),
  ('50000000-0000-4000-8000-000000000011', '10000000-0000-4000-8000-000000000001', 11, 'Stage 11', 'hilly', '2026-08-11 10:00:00+00', '2026-08-11 09:50:00+00', 'High Pass', 'Old Quarter', 181.5),
  ('50000000-0000-4000-8000-000000000012', '10000000-0000-4000-8000-000000000001', 12, 'Stage 12', 'flat', '2026-08-12 10:00:00+00', '2026-08-12 09:50:00+00', 'Old Quarter', 'Southbank', 199.0),
  ('50000000-0000-4000-8000-000000000013', '10000000-0000-4000-8000-000000000001', 13, 'Stage 13', 'mountain', '2026-08-13 10:00:00+00', '2026-08-13 09:50:00+00', 'Southbank', 'Eagle Ridge', 142.0),
  ('50000000-0000-4000-8000-000000000014', '10000000-0000-4000-8000-000000000001', 14, 'Stage 14', 'flat', '2026-08-14 10:00:00+00', '2026-08-14 09:50:00+00', 'Eagle Valley', 'Central Plains', 208.5),
  ('50000000-0000-4000-8000-000000000015', '10000000-0000-4000-8000-000000000001', 15, 'Stage 15', 'mountain', '2026-08-15 10:00:00+00', '2026-08-15 09:50:00+00', 'Central Plains', 'Grand Col', 169.0),
  ('50000000-0000-4000-8000-000000000016', '10000000-0000-4000-8000-000000000001', 16, 'Stage 16', 'individual_time_trial', '2026-08-16 10:00:00+00', '2026-08-16 09:50:00+00', 'Grand Col', 'Market Square', 41.0),
  ('50000000-0000-4000-8000-000000000017', '10000000-0000-4000-8000-000000000001', 17, 'Stage 17', 'hilly', '2026-08-17 10:00:00+00', '2026-08-17 09:50:00+00', 'Market Square', 'Forest Gate', 176.0),
  ('50000000-0000-4000-8000-000000000018', '10000000-0000-4000-8000-000000000001', 18, 'Stage 18', 'mountain', '2026-08-18 10:00:00+00', '2026-08-18 09:50:00+00', 'Forest Gate', 'Cloud Peak', 154.5),
  ('50000000-0000-4000-8000-000000000019', '10000000-0000-4000-8000-000000000001', 19, 'Stage 19', 'flat', '2026-08-19 10:00:00+00', '2026-08-19 09:50:00+00', 'Cloud Valley', 'Harbour City', 187.0),
  ('50000000-0000-4000-8000-000000000020', '10000000-0000-4000-8000-000000000001', 20, 'Stage 20', 'mountain', '2026-08-20 10:00:00+00', '2026-08-20 09:50:00+00', 'Harbour City', 'Final Summit', 133.5),
  ('50000000-0000-4000-8000-000000000021', '10000000-0000-4000-8000-000000000001', 21, 'Stage 21', 'flat', '2026-08-21 10:00:00+00', '2026-08-21 09:50:00+00', 'Final Summit', 'Grand Avenue', 112.0)
on conflict (id) do update
set
  grand_tour_id = excluded.grand_tour_id,
  stage_number = excluded.stage_number,
  stage_name = excluded.stage_name,
  stage_type = excluded.stage_type,
  starts_at = excluded.starts_at,
  locks_at = excluded.locks_at,
  start_location = excluded.start_location,
  finish_location = excluded.finish_location,
  distance_km = excluded.distance_km;

-- MVP simplification: every seeded rider starts every seeded stage.
insert into public.grandtour_stage_startlists (stage_id, rider_id)
select stage.id, rider.id
from public.grandtour_stages stage
join public.grandtour_riders rider
  on rider.grand_tour_id = stage.grand_tour_id
where stage.grand_tour_id = '10000000-0000-4000-8000-000000000001'
  and rider.is_active
on conflict (stage_id, rider_id) do nothing;
