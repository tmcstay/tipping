\set ON_ERROR_STOP on

begin;

create or replace function pg_temp.assert_true(condition boolean, message text)
returns void
language plpgsql
as $$
begin
  if not coalesce(condition, false) then
    raise exception 'assertion failed: %', message;
  end if;
end;
$$;

create or replace function pg_temp.authenticate(test_user uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.sub', test_user::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
end;
$$;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, created_at, updated_at
)
values
  ('a1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ttt-member-a@example.test', '', now(), now()),
  ('a1000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ttt-member-b@example.test', '', now(), now()),
  ('a1000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ttt-admin@example.test', '', now(), now());

update public.user_app_memberships membership
set role = 'admin'
from public.apps app
where membership.app_id = app.id
  and membership.user_id = 'a1000000-0000-0000-0000-000000000003'
  and app.code = 'cycling';

insert into public.grand_tours (
  id, name, year, starts_at, ends_at, preselection_locks_at
)
values (
  'a2000000-0000-0000-0000-000000000001',
  'TTT Schema Test Tour',
  2098,
  now() + interval '2 days',
  now() + interval '4 days',
  now() + interval '1 day'
);

insert into public.competitions (
  id, app_id, competition_key, name, sport_type, is_active, is_public
)
select
  'a3000000-0000-0000-0000-000000000001',
  app.id,
  'grandtour-ttt-schema-test',
  'TTT Schema Private League',
  'cycling',
  true,
  false
from public.apps app
where app.code = 'cycling';

insert into public.grandtour_competitions (
  id, grand_tour_id, competition_id, name, is_public,
  allow_preselection, allow_daily
)
values (
  'a4000000-0000-0000-0000-000000000001',
  'a2000000-0000-0000-0000-000000000001',
  'a3000000-0000-0000-0000-000000000001',
  'TTT Schema Private League',
  false,
  true,
  true
);

insert into public.competition_memberships (
  competition_id, user_id, role, status, joined_at
)
values
  ('a3000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'player', 'active', now()),
  ('a3000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', 'player', 'active', now());

insert into public.grandtour_teams (id, grand_tour_id, name)
select
  ('a5000000-0000-0000-0000-' || lpad(number::text, 12, '0'))::uuid,
  'a2000000-0000-0000-0000-000000000001',
  'TTT Test Team ' || number
from generate_series(1, 5) number;

insert into public.grandtour_riders (
  id, grand_tour_id, team_id, display_name, normalized_name
)
select
  ('a6000000-0000-0000-0000-' || lpad(number::text, 12, '0'))::uuid,
  'a2000000-0000-0000-0000-000000000001',
  ('a5000000-0000-0000-0000-' || lpad(ceil(number / 2.0)::int::text, 12, '0'))::uuid,
  'TTT Test Rider ' || number,
  'ttt test rider ' || number
from generate_series(1, 10) number;

insert into public.grandtour_stages (
  id, grand_tour_id, stage_number, stage_name, stage_type,
  ttt_timing_rule, starts_at, locks_at
)
values
  (
    'a7000000-0000-0000-0000-000000000001',
    'a2000000-0000-0000-0000-000000000001',
    1,
    'Road Test Stage',
    'road',
    null,
    now() + interval '2 days',
    now() + interval '1 day'
  ),
  (
    'a7000000-0000-0000-0000-000000000002',
    'a2000000-0000-0000-0000-000000000001',
    2,
    'TTT Test Stage',
    'ttt',
    'individual_time',
    now() + interval '3 days',
    now() + interval '2 days'
  );

insert into public.grandtour_stage_startlists (
  stage_id, rider_id, team_id, status
)
select stage.id, rider.id, rider.team_id, 'confirmed'
from public.grandtour_stages stage
cross join public.grandtour_riders rider
where stage.grand_tour_id = 'a2000000-0000-0000-0000-000000000001'
  and rider.grand_tour_id = stage.grand_tour_id;

set local role authenticated;
select pg_temp.authenticate('a1000000-0000-0000-0000-000000000001');

select public.save_grandtour_tip_draft(
  'a4000000-0000-0000-0000-000000000001',
  'a7000000-0000-0000-0000-000000000001',
  'daily',
  'stage',
  '[
    {"selection_type":"stage_top_5","rider_id":"a6000000-0000-0000-0000-000000000001","predicted_position":1},
    {"selection_type":"stage_top_5","rider_id":"a6000000-0000-0000-0000-000000000002","predicted_position":2},
    {"selection_type":"stage_top_5","rider_id":"a6000000-0000-0000-0000-000000000003","predicted_position":3},
    {"selection_type":"stage_top_5","rider_id":"a6000000-0000-0000-0000-000000000004","predicted_position":4},
    {"selection_type":"stage_top_5","rider_id":"a6000000-0000-0000-0000-000000000005","predicted_position":5},
    {"selection_type":"yellow_holder","rider_id":"a6000000-0000-0000-0000-000000000001"},
    {"selection_type":"green_holder","rider_id":"a6000000-0000-0000-0000-000000000002"},
    {"selection_type":"kom_holder","rider_id":"a6000000-0000-0000-0000-000000000003"},
    {"selection_type":"white_holder","rider_id":"a6000000-0000-0000-0000-000000000004"}
  ]'::jsonb,
  'ttt-test-road-draft'
);

select public.submit_grandtour_tip(
  (select id from public.grandtour_tips
   where user_id = 'a1000000-0000-0000-0000-000000000001'
     and stage_id = 'a7000000-0000-0000-0000-000000000001'),
  'ttt-test-road-submit'
);

select pg_temp.assert_true(
  (select status = 'submitted'
   from public.grandtour_tips
   where user_id = 'a1000000-0000-0000-0000-000000000001'
     and stage_id = 'a7000000-0000-0000-0000-000000000001'),
  'road stage must accept rider Top 5 and rider jerseys'
);

select public.save_grandtour_tip_draft(
  'a4000000-0000-0000-0000-000000000001',
  'a7000000-0000-0000-0000-000000000002',
  'daily',
  'stage',
  '[
    {"selection_type":"stage_top_5","team_id":"a5000000-0000-0000-0000-000000000001","predicted_position":1},
    {"selection_type":"stage_top_5","team_id":"a5000000-0000-0000-0000-000000000002","predicted_position":2},
    {"selection_type":"stage_top_5","team_id":"a5000000-0000-0000-0000-000000000003","predicted_position":3},
    {"selection_type":"stage_top_5","team_id":"a5000000-0000-0000-0000-000000000004","predicted_position":4},
    {"selection_type":"stage_top_5","team_id":"a5000000-0000-0000-0000-000000000005","predicted_position":5},
    {"selection_type":"yellow_holder","rider_id":"a6000000-0000-0000-0000-000000000005"},
    {"selection_type":"green_holder","rider_id":"a6000000-0000-0000-0000-000000000002"},
    {"selection_type":"kom_holder","rider_id":"a6000000-0000-0000-0000-000000000003"},
    {"selection_type":"white_holder","rider_id":"a6000000-0000-0000-0000-000000000004"}
  ]'::jsonb,
  'ttt-test-team-draft'
);

select public.submit_grandtour_tip(
  (select id from public.grandtour_tips
   where user_id = 'a1000000-0000-0000-0000-000000000001'
     and stage_id = 'a7000000-0000-0000-0000-000000000002'),
  'ttt-test-team-submit'
);

select pg_temp.assert_true(
  (select status = 'submitted'
     and (select count(*) from public.grandtour_tip_selections selection
          where selection.tip_id = grandtour_tips.id
            and selection.selection_type = 'stage_top_5'
            and selection.team_id is not null
            and selection.rider_id is null) = 5
   from public.grandtour_tips
   where user_id = 'a1000000-0000-0000-0000-000000000001'
     and stage_id = 'a7000000-0000-0000-0000-000000000002'),
  'TTT stage must accept team Top 5 and rider jerseys'
);

do $$
begin
  begin
    perform public.save_grandtour_tip_draft(
      'a4000000-0000-0000-0000-000000000001',
      'a7000000-0000-0000-0000-000000000002',
      'daily',
      'stage',
      '[{"selection_type":"stage_top_5","rider_id":"a6000000-0000-0000-0000-000000000001","predicted_position":1}]'::jsonb,
      'ttt-test-reject-rider-draft'
    );
    raise exception 'TTT rider Top 5 draft unexpectedly accepted';
  exception when others then
    if sqlerrm not like '%TTT stage Top 5 selections must target teams%' then raise; end if;
  end;
end;
$$;

do $$
begin
  begin
    perform public.save_grandtour_tip_draft(
      'a4000000-0000-0000-0000-000000000001',
      'a7000000-0000-0000-0000-000000000001',
      'daily',
      'stage',
      '[{"selection_type":"stage_top_5","team_id":"a5000000-0000-0000-0000-000000000001","predicted_position":1}]'::jsonb,
      'ttt-test-reject-team-road-draft'
    );
    raise exception 'road team Top 5 draft unexpectedly accepted';
  exception when others then
    if sqlerrm not like '%Non-TTT stage Top 5 selections must target riders%' then raise; end if;
  end;
end;
$$;

do $$
begin
  begin
    perform public.save_grandtour_tip_draft(
      'a4000000-0000-0000-0000-000000000001',
      'a7000000-0000-0000-0000-000000000002',
      'daily',
      'stage',
      '[{"selection_type":"yellow_holder","team_id":"a5000000-0000-0000-0000-000000000001"}]'::jsonb,
      'ttt-test-reject-team-jersey'
    );
    raise exception 'team jersey selection unexpectedly accepted';
  exception when others then
    if sqlerrm not like '%Jersey selections must target riders%' then raise; end if;
  end;
end;
$$;

reset role;

insert into public.grandtour_tips (
  id, user_id, competition_id, stage_id, tip_mode, tip_scope, status
)
values
  ('a9000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', 'a4000000-0000-0000-0000-000000000001', 'a7000000-0000-0000-0000-000000000002', 'daily', 'stage', 'draft'),
  ('a9000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000002', 'a4000000-0000-0000-0000-000000000001', 'a7000000-0000-0000-0000-000000000001', 'daily', 'stage', 'draft');

alter table public.grandtour_tip_selections
disable trigger grandtour_tip_selections_validate;

insert into public.grandtour_tip_selections (
  tip_id, selection_type, rider_id, team_id, predicted_position
)
select
  'a9000000-0000-0000-0000-000000000001',
  'stage_top_5',
  ('a6000000-0000-0000-0000-' || lpad(number::text, 12, '0'))::uuid,
  null,
  number
from generate_series(1, 5) number;

insert into public.grandtour_tip_selections (
  tip_id, selection_type, rider_id
)
values
  ('a9000000-0000-0000-0000-000000000001', 'yellow_holder', 'a6000000-0000-0000-0000-000000000001'),
  ('a9000000-0000-0000-0000-000000000001', 'green_holder', 'a6000000-0000-0000-0000-000000000002'),
  ('a9000000-0000-0000-0000-000000000001', 'kom_holder', 'a6000000-0000-0000-0000-000000000003'),
  ('a9000000-0000-0000-0000-000000000001', 'white_holder', 'a6000000-0000-0000-0000-000000000004');

insert into public.grandtour_tip_selections (
  tip_id, selection_type, team_id, predicted_position
)
select
  'a9000000-0000-0000-0000-000000000002',
  'stage_top_5',
  ('a5000000-0000-0000-0000-' || lpad(number::text, 12, '0'))::uuid,
  number
from generate_series(1, 5) number;

insert into public.grandtour_tip_selections (
  tip_id, selection_type, rider_id
)
values
  ('a9000000-0000-0000-0000-000000000002', 'yellow_holder', 'a6000000-0000-0000-0000-000000000001'),
  ('a9000000-0000-0000-0000-000000000002', 'green_holder', 'a6000000-0000-0000-0000-000000000002'),
  ('a9000000-0000-0000-0000-000000000002', 'kom_holder', 'a6000000-0000-0000-0000-000000000003'),
  ('a9000000-0000-0000-0000-000000000002', 'white_holder', 'a6000000-0000-0000-0000-000000000004');

alter table public.grandtour_tip_selections
enable trigger grandtour_tip_selections_validate;

set local role authenticated;
select pg_temp.authenticate('a1000000-0000-0000-0000-000000000002');

do $$
begin
  begin
    perform public.submit_grandtour_tip(
      'a9000000-0000-0000-0000-000000000001',
      'ttt-test-reject-rider-submit'
    );
    raise exception 'TTT rider Top 5 submit unexpectedly accepted';
  exception when others then
    if sqlerrm not like '%Tip is incomplete%' then raise; end if;
  end;
end;
$$;

do $$
begin
  begin
    perform public.submit_grandtour_tip(
      'a9000000-0000-0000-0000-000000000002',
      'ttt-test-reject-team-road-submit'
    );
    raise exception 'road team Top 5 submit unexpectedly accepted';
  exception when others then
    if sqlerrm not like '%Tip is incomplete%' then raise; end if;
  end;
end;
$$;

-- Replace the deliberately invalid TTT draft with a valid rotated team pick.
-- This user predicts the official yellow rider but not the winning team.
select public.save_grandtour_tip_draft(
  'a4000000-0000-0000-0000-000000000001',
  'a7000000-0000-0000-0000-000000000002',
  'daily',
  'stage',
  '[
    {"selection_type":"stage_top_5","team_id":"a5000000-0000-0000-0000-000000000002","predicted_position":1},
    {"selection_type":"stage_top_5","team_id":"a5000000-0000-0000-0000-000000000003","predicted_position":2},
    {"selection_type":"stage_top_5","team_id":"a5000000-0000-0000-0000-000000000004","predicted_position":3},
    {"selection_type":"stage_top_5","team_id":"a5000000-0000-0000-0000-000000000005","predicted_position":4},
    {"selection_type":"stage_top_5","team_id":"a5000000-0000-0000-0000-000000000001","predicted_position":5},
    {"selection_type":"yellow_holder","rider_id":"a6000000-0000-0000-0000-000000000001"},
    {"selection_type":"green_holder","rider_id":"a6000000-0000-0000-0000-000000000002"},
    {"selection_type":"kom_holder","rider_id":"a6000000-0000-0000-0000-000000000003"},
    {"selection_type":"white_holder","rider_id":"a6000000-0000-0000-0000-000000000004"}
  ]'::jsonb,
  'ttt-test-rotated-team-draft'
);

select public.submit_grandtour_tip(
  'a9000000-0000-0000-0000-000000000001',
  'ttt-test-rotated-team-submit'
);

reset role;

insert into public.grandtour_stage_results (id, stage_id, is_final)
values (
  'a8000000-0000-0000-0000-000000000002',
  'a7000000-0000-0000-0000-000000000002',
  false
);

set local role authenticated;
select pg_temp.authenticate('a1000000-0000-0000-0000-000000000001');

do $$
begin
  begin
    insert into public.grandtour_stage_team_result_lines (
      stage_result_id, team_id, actual_position
    ) values (
      'a8000000-0000-0000-0000-000000000002',
      'a5000000-0000-0000-0000-000000000001',
      1
    );
    raise exception 'non-admin team result write unexpectedly accepted';
  exception when insufficient_privilege then null;
  end;
end;
$$;

select pg_temp.assert_true(
  (select count(*) = 0 from public.grandtour_stage_team_result_lines),
  'non-final team results must not be visible to a normal member'
);

select pg_temp.authenticate('a1000000-0000-0000-0000-000000000003');

insert into public.grandtour_stage_team_result_lines (
  stage_result_id, team_id, actual_position
)
select
  'a8000000-0000-0000-0000-000000000002',
  ('a5000000-0000-0000-0000-' || lpad(number::text, 12, '0'))::uuid,
  number
from generate_series(1, 5) number;

reset role;
update public.grandtour_stage_results
set is_final = true, review_status = 'finalised'
where id = 'a8000000-0000-0000-0000-000000000002';

set local role authenticated;
select pg_temp.authenticate('a1000000-0000-0000-0000-000000000003');
select public.recalculate_grandtour_stage_scores(
  'a7000000-0000-0000-0000-000000000002',
  'TTT team component before jerseys',
  'ttt-team-only-score'
);

select pg_temp.assert_true(
  (select score.top5_score = 30
     and score.bonus_score = 4
     and score.jersey_score = 0
     and score.total_score = 34
     and (score.score_details ->> 'jersey_pending')::boolean
     and score.score_details ->> 'team_stage_score' = '34'
     and score.score_details ->> 'official_yellow_holder_rider_id' is null
   from public.grandtour_stage_scores score
   join public.grandtour_tips tip on tip.id = score.tip_id
   where tip.user_id = 'a1000000-0000-0000-0000-000000000001'
     and tip.stage_id = 'a7000000-0000-0000-0000-000000000002'),
  'missing TTT jersey results must preserve team points and remain pending'
);

reset role;
update public.grandtour_stage_results
set is_final = false, review_status = 'draft'
where id = 'a8000000-0000-0000-0000-000000000002';

insert into public.grandtour_stage_jersey_holders (
  stage_id, jersey_type, rider_id
)
values
  ('a7000000-0000-0000-0000-000000000002', 'yellow', 'a6000000-0000-0000-0000-000000000001'),
  ('a7000000-0000-0000-0000-000000000002', 'green', 'a6000000-0000-0000-0000-000000000002'),
  ('a7000000-0000-0000-0000-000000000002', 'kom', 'a6000000-0000-0000-0000-000000000003'),
  ('a7000000-0000-0000-0000-000000000002', 'white', 'a6000000-0000-0000-0000-000000000004');

update public.grandtour_stage_results
set is_final = true, review_status = 'finalised'
where id = 'a8000000-0000-0000-0000-000000000002';

set local role authenticated;
select pg_temp.authenticate('a1000000-0000-0000-0000-000000000001');

select pg_temp.assert_true(
  (select count(*) = 5 from public.grandtour_stage_team_result_lines),
  'final TTT team results must be readable through RLS'
);

select pg_temp.assert_true(
  (select rider_id = 'a6000000-0000-0000-0000-000000000001'
     from public.grandtour_stage_jersey_holders
     where stage_id = 'a7000000-0000-0000-0000-000000000002'
       and jersey_type = 'yellow'),
  'TTT yellow jersey must be stored as an individual rider'
);

select pg_temp.authenticate('a1000000-0000-0000-0000-000000000003');
select public.recalculate_grandtour_stage_scores(
  'a7000000-0000-0000-0000-000000000002',
  'TTT schema test',
  'ttt-schema-score'
);

select pg_temp.assert_true(
  (select score.top5_score = 30
     and score.bonus_score = 4
     and score.jersey_score = 15
     and score.total_score = 49
     and score.score_details ->> 'stage_result_type' = 'team'
     and score.score_details ->> 'ttt_timing_rule' = 'individual_time'
     and score.score_details ->> 'team_stage_score' = '34'
     and score.score_details ->> 'winning_team_bonus' = '4'
     and not (score.score_details ->> 'jersey_pending')::boolean
     and score.score_details ->> 'official_yellow_holder_rider_id'
       = 'a6000000-0000-0000-0000-000000000001'
     and score.score_details -> 'top_five' -> 0 ->> 'points' = '6'
   from public.grandtour_stage_scores score
   join public.grandtour_tips tip on tip.id = score.tip_id
   where tip.user_id = 'a1000000-0000-0000-0000-000000000001'
     and tip.stage_id = 'a7000000-0000-0000-0000-000000000002'),
  'TTT exact teams and winner bonus must not infer the yellow rider'
);

select pg_temp.assert_true(
  (select score.top5_score = 15
     and score.bonus_score = 0
     and score.jersey_score = 20
     and score.total_score = 35
     and score.score_details -> 'top_five' -> 0 ->> 'points' = '3'
     and score.score_details ->> 'winning_team_bonus' = '0'
     and score.score_details -> 'jerseys' @> '[{"selection_type":"yellow_holder","points":5}]'::jsonb
   from public.grandtour_stage_scores score
   join public.grandtour_tips tip on tip.id = score.tip_id
   where tip.user_id = 'a1000000-0000-0000-0000-000000000002'
     and tip.stage_id = 'a7000000-0000-0000-0000-000000000002'),
  'official yellow rider must score independently of the winning team'
);

select public.recalculate_grandtour_stage_scores(
  'a7000000-0000-0000-0000-000000000002',
  'TTT idempotence check',
  'ttt-idempotence-score'
);

select pg_temp.assert_true(
  (select count(*) = 1 and max(score.total_score) = 49
   from public.grandtour_stage_scores score
   join public.grandtour_tips tip on tip.id = score.tip_id
   where tip.user_id = 'a1000000-0000-0000-0000-000000000001'
     and tip.stage_id = 'a7000000-0000-0000-0000-000000000002'),
  'TTT recalculation must update one deterministic score row'
);

select 'GrandTour TTT SQL/RLS tests passed' as result;
rollback;
