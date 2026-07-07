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
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'member-a@example.test', '', now(), now()),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'member-b@example.test', '', now(), now()),
  ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'outsider@example.test', '', now(), now()),
  ('10000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dummy@example.test', '', now(), now()),
  ('10000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@example.test', '', now(), now()),
  ('10000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'top-five-only@example.test', '', now(), now());

update public.profiles
set is_dummy = true, display_name = 'Demo User'
where id = '10000000-0000-0000-0000-000000000004';

update public.user_app_memberships membership
set role = 'admin'
from public.apps app
where membership.app_id = app.id
  and membership.user_id = '10000000-0000-0000-0000-000000000005'
  and app.code = 'cycling';

insert into public.grand_tours (
  id, name, year, starts_at, ends_at, preselection_locks_at
)
values (
  '20000000-0000-0000-0000-000000000001',
  'Canonical Test Tour',
  2099,
  now() + interval '2 days',
  now() + interval '3 days',
  now() + interval '1 day'
);

insert into public.competitions (
  id, app_id, competition_key, name, sport_type, is_active, is_public
)
select
  '30000000-0000-0000-0000-000000000001',
  app.id,
  'canonical-private-test',
  'Canonical Private League',
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
  '40000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  'Canonical Private League',
  false,
  true,
  true
);

insert into public.competition_memberships (
  competition_id, user_id, role, status, joined_at
)
values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'player', 'active', now()),
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'player', 'active', now()),
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000004', 'player', 'active', now()),
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000006', 'player', 'active', now());

insert into public.grandtour_teams (id, grand_tour_id, name)
values (
  '50000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  'Test Team'
);

insert into public.grandtour_riders (
  id, grand_tour_id, team_id, display_name, normalized_name
)
select
  ('60000000-0000-0000-0000-' || lpad(number::text, 12, '0'))::uuid,
  '20000000-0000-0000-0000-000000000001',
  '50000000-0000-0000-0000-000000000001',
  'Test Rider ' || number,
  'test rider ' || number
from generate_series(1, 8) number;

insert into public.grandtour_stages (
  id, grand_tour_id, stage_number, stage_name, stage_type, starts_at, locks_at
)
values (
  '70000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  1,
  'Test Stage',
  'flat',
  now() + interval '2 days',
  now() + interval '1 day'
);

insert into public.grandtour_stage_startlists (stage_id, rider_id, team_id, status)
select
  '70000000-0000-0000-0000-000000000001',
  rider.id,
  '50000000-0000-0000-0000-000000000001',
  'confirmed'
from public.grandtour_riders rider
where rider.grand_tour_id = '20000000-0000-0000-0000-000000000001';

set local role authenticated;
select pg_temp.authenticate('10000000-0000-0000-0000-000000000001');

select public.save_grandtour_tip_draft(
  '40000000-0000-0000-0000-000000000001',
  '70000000-0000-0000-0000-000000000001',
  'daily',
  'stage',
  '[
    {"selection_type":"stage_top_5","rider_id":"60000000-0000-0000-0000-000000000001","predicted_position":1},
    {"selection_type":"stage_top_5","rider_id":"60000000-0000-0000-0000-000000000002","predicted_position":2},
    {"selection_type":"stage_top_5","rider_id":"60000000-0000-0000-0000-000000000003","predicted_position":3},
    {"selection_type":"stage_top_5","rider_id":"60000000-0000-0000-0000-000000000004","predicted_position":4},
    {"selection_type":"stage_top_5","rider_id":"60000000-0000-0000-0000-000000000005","predicted_position":5},
    {"selection_type":"yellow_holder","rider_id":"60000000-0000-0000-0000-000000000001"},
    {"selection_type":"green_holder","rider_id":"60000000-0000-0000-0000-000000000002"},
    {"selection_type":"kom_holder","rider_id":"60000000-0000-0000-0000-000000000003"},
    {"selection_type":"white_holder","rider_id":"60000000-0000-0000-0000-000000000004"}
  ]'::jsonb,
  'test-draft-a'
);

select pg_temp.assert_true(
  (select status = 'draft' and submitted_at is null
   from public.grandtour_tips
   where user_id = '10000000-0000-0000-0000-000000000001'
     and tip_mode = 'daily'),
  'saving a complete draft must not auto-submit'
);

reset role;
update public.apps
set grandtour_tipping_enabled = false
where code = 'cycling';
set local role authenticated;
select pg_temp.authenticate('10000000-0000-0000-0000-000000000001');

do $$
begin
  begin
    perform public.submit_grandtour_tip(
      (select id from public.grandtour_tips
       where user_id = '10000000-0000-0000-0000-000000000001'
         and tip_mode = 'daily'),
      'test-disabled-submit'
    );
    raise exception 'disabled submit unexpectedly accepted';
  exception when others then
    if sqlerrm <> 'GrandTour tipping is temporarily unavailable while we make updates.' then
      raise;
    end if;
  end;
end;
$$;

select pg_temp.assert_true(
  (select count(*) = 1
   from public.grandtour_tips
   where user_id = '10000000-0000-0000-0000-000000000001'
     and status = 'draft'),
  'kill switch must preserve read-only access to an existing draft'
);

reset role;
update public.apps
set grandtour_tipping_enabled = true
where code = 'cycling';
set local role authenticated;
select pg_temp.authenticate('10000000-0000-0000-0000-000000000001');

select public.submit_grandtour_tip(
  (select id from public.grandtour_tips
   where user_id = '10000000-0000-0000-0000-000000000001'
     and tip_mode = 'daily'),
  'test-submit-a'
);

select pg_temp.assert_true(
  (select status = 'submitted' and submitted_at is not null
   from public.grandtour_tips
   where user_id = '10000000-0000-0000-0000-000000000001'
     and tip_mode = 'daily'),
  'a complete top-five and jersey tip must submit'
);

select pg_temp.authenticate('10000000-0000-0000-0000-000000000006');

select public.save_grandtour_tip_draft(
  '40000000-0000-0000-0000-000000000001',
  '70000000-0000-0000-0000-000000000001',
  'daily',
  'stage',
  '[
    {"selection_type":"stage_top_5","rider_id":"60000000-0000-0000-0000-000000000001","predicted_position":1},
    {"selection_type":"stage_top_5","rider_id":"60000000-0000-0000-0000-000000000002","predicted_position":2},
    {"selection_type":"stage_top_5","rider_id":"60000000-0000-0000-0000-000000000003","predicted_position":3},
    {"selection_type":"stage_top_5","rider_id":"60000000-0000-0000-0000-000000000004","predicted_position":4},
    {"selection_type":"stage_top_5","rider_id":"60000000-0000-0000-0000-000000000005","predicted_position":5}
  ]'::jsonb,
  'test-top-five-only-draft'
);

select public.submit_grandtour_tip(
  (select id from public.grandtour_tips
   where user_id = '10000000-0000-0000-0000-000000000006'
     and tip_mode = 'daily'),
  'test-top-five-only-submit'
);

select pg_temp.assert_true(
  (select status = 'submitted'
   from public.grandtour_tips
   where user_id = '10000000-0000-0000-0000-000000000006'
     and tip_mode = 'daily'),
  'top-five-only stage tip must submit while jersey tipping is parked'
);

reset role;

update public.grandtour_tips
set status = 'draft', submitted_at = null
where user_id = '10000000-0000-0000-0000-000000000006'
  and tip_mode = 'daily'
  and tip_scope = 'stage';

reset role;
update public.apps
set grandtour_tipping_enabled = false
where code = 'cycling';
set local role authenticated;
select pg_temp.authenticate('10000000-0000-0000-0000-000000000001');

do $$
begin
  begin
    perform public.save_grandtour_tip_draft(
      '40000000-0000-0000-0000-000000000001',
      '70000000-0000-0000-0000-000000000001',
      'daily',
      'stage',
      '[]'::jsonb,
      'test-disabled-save'
    );
    raise exception 'disabled save unexpectedly accepted';
  exception when others then
    if sqlerrm <> 'GrandTour tipping is temporarily unavailable while we make updates.' then
      raise;
    end if;
  end;
end;
$$;

do $$
begin
  begin
    perform public.clear_grandtour_tip_draft(
      (select id from public.grandtour_tips
       where user_id = '10000000-0000-0000-0000-000000000001'
         and tip_mode = 'daily'),
      'test disabled clear',
      'test-disabled-clear'
    );
    raise exception 'disabled clear unexpectedly accepted';
  exception when others then
    if sqlerrm <> 'GrandTour tipping is temporarily unavailable while we make updates.' then
      raise;
    end if;
  end;
end;
$$;

reset role;
update public.apps
set grandtour_tipping_enabled = true
where code = 'cycling';
set local role authenticated;

select pg_temp.authenticate('10000000-0000-0000-0000-000000000002');

select public.save_grandtour_tip_draft(
  '40000000-0000-0000-0000-000000000001',
  '70000000-0000-0000-0000-000000000001',
  'preselection',
  'stage',
  '[{"selection_type":"stage_top_5","rider_id":"60000000-0000-0000-0000-000000000001","predicted_position":1}]'::jsonb,
  'test-incomplete'
);

do $$
begin
  begin
    perform public.submit_grandtour_tip(
      (select id from public.grandtour_tips
       where user_id = '10000000-0000-0000-0000-000000000002'
         and tip_mode = 'preselection'),
      'test-incomplete-submit'
    );
    raise exception 'incomplete tip unexpectedly submitted';
  exception when others then
    if sqlerrm = 'incomplete tip unexpectedly submitted' then raise; end if;
  end;
end;
$$;

do $$
begin
  begin
    perform public.save_grandtour_tip_draft(
      '40000000-0000-0000-0000-000000000001',
      '70000000-0000-0000-0000-000000000001',
      'preselection',
      'stage',
      '[
        {"selection_type":"stage_top_5","rider_id":"60000000-0000-0000-0000-000000000001","predicted_position":1},
        {"selection_type":"stage_top_5","rider_id":"60000000-0000-0000-0000-000000000001","predicted_position":2}
      ]'::jsonb,
      'test-duplicate-rider'
    );
    raise exception 'duplicate rider unexpectedly accepted';
  exception when unique_violation then null;
  end;
end;
$$;

do $$
begin
  begin
    perform public.save_grandtour_tip_draft(
      '40000000-0000-0000-0000-000000000001',
      '70000000-0000-0000-0000-000000000001',
      'preselection',
      'stage',
      '[
        {"selection_type":"stage_top_5","rider_id":"60000000-0000-0000-0000-000000000001","predicted_position":1},
        {"selection_type":"stage_top_5","rider_id":"60000000-0000-0000-0000-000000000002","predicted_position":1}
      ]'::jsonb,
      'test-duplicate-position'
    );
    raise exception 'duplicate position unexpectedly accepted';
  exception when unique_violation then null;
  end;
end;
$$;

select pg_temp.assert_true(
  public.clear_grandtour_tip_draft(
    (select id from public.grandtour_tips
     where user_id = '10000000-0000-0000-0000-000000000002'
       and tip_mode = 'preselection'),
    'clear before lock',
    'test-clear-before-lock'
  ),
  'tip must clear before lock'
);

select pg_temp.assert_true(
  (select status = 'deleted' and total_score = 0
   from public.grandtour_tips
   where user_id = '10000000-0000-0000-0000-000000000002'
     and tip_mode = 'preselection'),
  'clear must soft-delete the tip instead of removing its audit identity'
);

select pg_temp.assert_true(
  (select count(*) = 0
   from public.grandtour_tip_selections selection
   join public.grandtour_tips tip on tip.id = selection.tip_id
   where tip.user_id = '10000000-0000-0000-0000-000000000002'
     and tip.tip_mode = 'preselection'),
  'clear must remove active selections from the soft-deleted tip'
);

select public.save_grandtour_tip_draft(
  '40000000-0000-0000-0000-000000000001',
  '70000000-0000-0000-0000-000000000001',
  'preselection',
  'stage',
  '[
    {"selection_type":"stage_top_5","rider_id":"60000000-0000-0000-0000-000000000002","predicted_position":1},
    {"selection_type":"stage_top_5","rider_id":"60000000-0000-0000-0000-000000000003","predicted_position":2},
    {"selection_type":"stage_top_5","rider_id":"60000000-0000-0000-0000-000000000004","predicted_position":3},
    {"selection_type":"stage_top_5","rider_id":"60000000-0000-0000-0000-000000000005","predicted_position":4},
    {"selection_type":"stage_top_5","rider_id":"60000000-0000-0000-0000-000000000001","predicted_position":5},
    {"selection_type":"yellow_holder","rider_id":"60000000-0000-0000-0000-000000000001"},
    {"selection_type":"green_holder","rider_id":"60000000-0000-0000-0000-000000000002"},
    {"selection_type":"kom_holder","rider_id":"60000000-0000-0000-0000-000000000003"},
    {"selection_type":"white_holder","rider_id":"60000000-0000-0000-0000-000000000004"}
  ]'::jsonb,
  'test-draft-b'
);

select public.submit_grandtour_tip(
  (select id from public.grandtour_tips
   where user_id = '10000000-0000-0000-0000-000000000002'
     and tip_mode = 'preselection'),
  'test-submit-b'
);

select public.save_grandtour_tip_draft(
  '40000000-0000-0000-0000-000000000001',
  '70000000-0000-0000-0000-000000000001',
  'daily',
  'stage',
  '[]'::jsonb,
  'test-unsubmitted-draft'
);

select pg_temp.assert_true(
  (select count(*) = 0
   from public.grandtour_tips
   where user_id = '10000000-0000-0000-0000-000000000001'),
  'other member tips must remain hidden before lock'
);

select pg_temp.authenticate('10000000-0000-0000-0000-000000000003');
do $$
begin
  begin
    perform public.save_grandtour_tip_draft(
      '40000000-0000-0000-0000-000000000001',
      '70000000-0000-0000-0000-000000000001',
      'daily',
      'stage',
      '[]'::jsonb,
      'test-outsider'
    );
    raise exception 'private league outsider unexpectedly saved';
  exception when others then
    if sqlerrm = 'private league outsider unexpectedly saved' then raise; end if;
  end;
end;
$$;

select pg_temp.authenticate('10000000-0000-0000-0000-000000000001');
select public.save_grandtour_tip_draft(
  '40000000-0000-0000-0000-000000000001',
  null,
  'preselection',
  'overall_jerseys',
  '[
    {"selection_type":"overall_yellow_winner","rider_id":"60000000-0000-0000-0000-000000000001"},
    {"selection_type":"overall_green_winner","rider_id":"60000000-0000-0000-0000-000000000002"},
    {"selection_type":"overall_kom_winner","rider_id":"60000000-0000-0000-0000-000000000003"},
    {"selection_type":"overall_white_winner","rider_id":"60000000-0000-0000-0000-000000000004"}
  ]'::jsonb,
  'test-overall-draft'
);

select public.submit_grandtour_tip(
  (select id from public.grandtour_tips
   where user_id = '10000000-0000-0000-0000-000000000001'
     and tip_scope = 'overall_jerseys'),
  'test-overall-submit'
);

select pg_temp.authenticate('10000000-0000-0000-0000-000000000004');
select public.save_grandtour_tip_draft(
  '40000000-0000-0000-0000-000000000001',
  '70000000-0000-0000-0000-000000000001',
  'daily',
  'stage',
  '[
    {"selection_type":"stage_top_5","rider_id":"60000000-0000-0000-0000-000000000001","predicted_position":1},
    {"selection_type":"stage_top_5","rider_id":"60000000-0000-0000-0000-000000000002","predicted_position":2},
    {"selection_type":"stage_top_5","rider_id":"60000000-0000-0000-0000-000000000003","predicted_position":3},
    {"selection_type":"stage_top_5","rider_id":"60000000-0000-0000-0000-000000000004","predicted_position":4},
    {"selection_type":"stage_top_5","rider_id":"60000000-0000-0000-0000-000000000005","predicted_position":5},
    {"selection_type":"yellow_holder","rider_id":"60000000-0000-0000-0000-000000000001"},
    {"selection_type":"green_holder","rider_id":"60000000-0000-0000-0000-000000000002"},
    {"selection_type":"kom_holder","rider_id":"60000000-0000-0000-0000-000000000003"},
    {"selection_type":"white_holder","rider_id":"60000000-0000-0000-0000-000000000004"}
  ]'::jsonb,
  'test-dummy-draft'
);
select public.submit_grandtour_tip(
  (select id from public.grandtour_tips
   where user_id = '10000000-0000-0000-0000-000000000004'),
  'test-dummy-submit'
);

reset role;
update public.grandtour_stages
set locks_at = now() - interval '1 second'
where id = '70000000-0000-0000-0000-000000000001';
update public.grand_tours
set preselection_locks_at = now() - interval '1 second'
where id = '20000000-0000-0000-0000-000000000001';

set local role authenticated;
select pg_temp.authenticate('10000000-0000-0000-0000-000000000001');

select pg_temp.assert_true(
  (select count(*) = 2
   from public.grandtour_tips
   where user_id = '10000000-0000-0000-0000-000000000001'),
  'member A stage and overall tips must still exist before lock rejection tests'
);

select pg_temp.assert_true(
  grandtour_private.tip_is_locked(
    '40000000-0000-0000-0000-000000000001',
    '70000000-0000-0000-0000-000000000001',
    'daily',
    'stage'
  ),
  'database lock resolver must report the stage as locked'
);

do $$
begin
  begin
    perform public.save_grandtour_tip_draft(
      '40000000-0000-0000-0000-000000000001',
      '70000000-0000-0000-0000-000000000001',
      'daily',
      'stage',
      '[]'::jsonb,
      'test-edit-after-lock'
    );
    raise exception 'edit after lock unexpectedly accepted';
  exception when others then
    if sqlerrm = 'edit after lock unexpectedly accepted' then raise; end if;
  end;
end;
$$;

do $$
begin
  begin
    perform public.clear_grandtour_tip_draft(
      (select id from public.grandtour_tips
       where user_id = '10000000-0000-0000-0000-000000000001'
         and tip_mode = 'daily'),
      'after lock',
      'test-clear-after-lock'
    );
    raise exception 'clear after lock unexpectedly accepted';
  exception when others then
    if sqlerrm = 'clear after lock unexpectedly accepted' then raise; end if;
  end;
end;
$$;

select pg_temp.authenticate('10000000-0000-0000-0000-000000000002');
select pg_temp.assert_true(
  (select count(*) >= 1
   from public.grandtour_tips
   where user_id = '10000000-0000-0000-0000-000000000001'
     and status <> 'draft'),
  'same private league member must see submitted tips after lock'
);

select pg_temp.authenticate('10000000-0000-0000-0000-000000000001');
select pg_temp.assert_true(
  (select count(*) = 0
   from public.grandtour_tips
   where user_id = '10000000-0000-0000-0000-000000000002'
     and status = 'draft'),
  'another member must never see drafts, including after lock'
);

select pg_temp.authenticate('10000000-0000-0000-0000-000000000003');
select pg_temp.assert_true(
  (select count(*) = 0
   from public.grandtour_tips
   where competition_id = '40000000-0000-0000-0000-000000000001'),
  'private league outsider must not see post-lock tips'
);

reset role;
update public.apps
set grandtour_tipping_enabled = false
where code = 'cycling';

insert into public.grandtour_stage_results (id, stage_id, is_final)
values (
  '80000000-0000-0000-0000-000000000001',
  '70000000-0000-0000-0000-000000000001',
  false
);

insert into public.grandtour_stage_result_lines (
  stage_result_id, rider_id, actual_position
)
select
  '80000000-0000-0000-0000-000000000001',
  ('60000000-0000-0000-0000-' || lpad(number::text, 12, '0'))::uuid,
  number
from generate_series(1, 5) number;

insert into public.grandtour_stage_jersey_holders (stage_id, jersey_type, rider_id)
values
  ('70000000-0000-0000-0000-000000000001', 'yellow', '60000000-0000-0000-0000-000000000001'),
  ('70000000-0000-0000-0000-000000000001', 'green', '60000000-0000-0000-0000-000000000002'),
  ('70000000-0000-0000-0000-000000000001', 'kom', '60000000-0000-0000-0000-000000000003'),
  ('70000000-0000-0000-0000-000000000001', 'white', '60000000-0000-0000-0000-000000000004');

update public.grandtour_stage_results
set is_final = true
where id = '80000000-0000-0000-0000-000000000001';

set local role authenticated;
select pg_temp.authenticate('10000000-0000-0000-0000-000000000005');
select pg_temp.assert_true(
  public.score_grandtour_stage(
    '70000000-0000-0000-0000-000000000001',
    'test-score'
  ) >= 5,
  'scoring must process stage, overall, draft, and dummy tips'
);

select pg_temp.assert_true(
  (select score.top5_score = 30 and score.jersey_score = 20 and score.total_score = 50
   from public.grandtour_stage_scores score
   join public.grandtour_tips tip on tip.id = score.tip_id
   where tip.user_id = '10000000-0000-0000-0000-000000000001'
     and tip.tip_mode = 'daily'),
  'exact top five and daily jerseys must score 50'
);

select pg_temp.assert_true(
  (select score.top5_score = 5 and score.jersey_score = 20 and score.total_score = 25
   from public.grandtour_stage_scores score
   join public.grandtour_tips tip on tip.id = score.tip_id
   where tip.user_id = '10000000-0000-0000-0000-000000000002'
     and tip.tip_mode = 'preselection'),
  'wrong-position top five must score one point per rider'
);

select pg_temp.assert_true(
  (select score.total_score = 0 and tip.status = 'draft'
   from public.grandtour_stage_scores score
   join public.grandtour_tips tip on tip.id = score.tip_id
   where tip.user_id = '10000000-0000-0000-0000-000000000002'
     and tip.tip_mode = 'daily'),
  'an unsubmitted draft must score zero and remain a draft'
);

select pg_temp.assert_true(
  (select score.jersey_score = 100 and score.total_score = 100
   from public.grandtour_stage_scores score
   join public.grandtour_tips tip on tip.id = score.tip_id
   where tip.user_id = '10000000-0000-0000-0000-000000000001'
     and tip.tip_scope = 'overall_jerseys'),
  'overall jersey winners must score 25 points each'
);

select pg_temp.assert_true(
  (select not is_prize_eligible
   from public.grandtour_stage_scores score
   join public.grandtour_tips tip on tip.id = score.tip_id
   where tip.user_id = '10000000-0000-0000-0000-000000000004'),
  'dummy users must be excluded from prize eligibility'
);

select pg_temp.authenticate('10000000-0000-0000-0000-000000000001');

select pg_temp.assert_true(
  (select count(*) = 2
     and count(*) = count(distinct user_id)
     and max(total_score) = 50
   from public.get_grandtour_leaderboard(
     '40000000-0000-0000-0000-000000000001',
     'daily'
   )),
  'live daily leaderboard must exclude drafts and return one row per scored user'
);

select pg_temp.assert_true(
  (select total_score = 100 and stages_tipped = 0 and rank = 1
   from public.get_grandtour_leaderboard(
     '40000000-0000-0000-0000-000000000001',
     'preselection'
   )
   where user_id = '10000000-0000-0000-0000-000000000001'),
  'preselection leaderboard must include overall jersey winner points'
);

select pg_temp.assert_true(
  (select total_score = 150 and stages_tipped = 1 and rank = 1
   from public.get_grandtour_leaderboard(
     '40000000-0000-0000-0000-000000000001',
     'overall'
   )
   where user_id = '10000000-0000-0000-0000-000000000001'),
  'overall leaderboard must equal daily plus preselection scores'
);

select pg_temp.assert_true(
  (select is_dummy and not is_prize_eligible
   from public.get_grandtour_leaderboard(
     '40000000-0000-0000-0000-000000000001',
     'daily'
   )
   where user_id = '10000000-0000-0000-0000-000000000004'),
  'live leaderboard must label dummy users and exclude them from prizes'
);

select pg_temp.assert_true(
  (select first_run.rows = second_run.rows
   from (
     select jsonb_agg(to_jsonb(row_data) order by row_data.rank, row_data.user_id) as rows
     from public.get_grandtour_leaderboard(
       '40000000-0000-0000-0000-000000000001',
       'overall'
     ) row_data
   ) first_run
   cross join (
     select jsonb_agg(to_jsonb(row_data) order by row_data.rank, row_data.user_id) as rows
     from public.get_grandtour_leaderboard(
       '40000000-0000-0000-0000-000000000001',
       'overall'
     ) row_data
   ) second_run),
  'repeated live leaderboard reads must be deterministic and idempotent'
);

select pg_temp.authenticate('10000000-0000-0000-0000-000000000003');
do $$
begin
  begin
    perform *
    from public.get_grandtour_leaderboard(
      '40000000-0000-0000-0000-000000000001',
      'overall'
    );
    raise exception 'private league outsider unexpectedly read leaderboard';
  exception when others then
    if sqlerrm = 'private league outsider unexpectedly read leaderboard' then raise; end if;
  end;
end;
$$;

select pg_temp.authenticate('10000000-0000-0000-0000-000000000005');

insert into public.grandtour_leaderboard_snapshots (
  competition_id,
  leaderboard_type,
  user_id,
  rank,
  total_score,
  is_dummy,
  is_prize_eligible
)
values (
  '40000000-0000-0000-0000-000000000001',
  'daily',
  '10000000-0000-0000-0000-000000000004',
  1,
  50,
  false,
  true
);

select pg_temp.assert_true(
  (select is_dummy and not is_prize_eligible
   from public.grandtour_leaderboard_snapshots
   where user_id = '10000000-0000-0000-0000-000000000004'
     and competition_id = '40000000-0000-0000-0000-000000000001'),
  'dummy leaderboard rows must be labelled and never prize eligible'
);

select public.recalculate_grandtour_stage_scores(
  '70000000-0000-0000-0000-000000000001',
  'idempotency test',
  'test-rescore'
);

select pg_temp.assert_true(
  (select count(*) = count(distinct tip_id)
   from public.grandtour_stage_scores
   where stage_id = '70000000-0000-0000-0000-000000000001'),
  'recalculation must remain idempotent'
);

select pg_temp.assert_true(
  (select count(*) > 0 from public.grandtour_game_audit
   where action in ('draft_saved', 'tip_submitted', 'tip_cleared', 'score_recalculated')),
  'workflow actions must be audited'
);

reset role;
select set_config('grandtour.audit_action', '', true);
select set_config('grandtour.admin_override', 'on', true);

update public.grandtour_tips set status = 'corrected'
where user_id = '10000000-0000-0000-0000-000000000001'
  and tip_mode = 'daily' and tip_scope = 'stage';
update public.grandtour_tips set status = 'voided'
where user_id = '10000000-0000-0000-0000-000000000002'
  and tip_mode = 'preselection' and tip_scope = 'stage';
update public.grandtour_tips set status = 'missed'
where user_id = '10000000-0000-0000-0000-000000000002'
  and tip_mode = 'daily' and tip_scope = 'stage';
update public.grandtour_tips set status = 'deleted'
where user_id = '10000000-0000-0000-0000-000000000004'
  and tip_mode = 'daily' and tip_scope = 'stage';

set local role authenticated;
select pg_temp.authenticate('10000000-0000-0000-0000-000000000005');
select public.recalculate_grandtour_stage_scores(
  '70000000-0000-0000-0000-000000000001',
  'lifecycle status test',
  'test-status-rescore'
);

select pg_temp.assert_true(
  (select status = 'corrected' and total_score = 50
   from public.grandtour_tips
   where user_id = '10000000-0000-0000-0000-000000000001'
     and tip_mode = 'daily' and tip_scope = 'stage'),
  'corrected tips must remain corrected and be deterministically rescored'
);

select pg_temp.assert_true(
  (select count(*) = 3
   from public.grandtour_tips
   where status in ('voided', 'missed', 'deleted') and total_score = 0),
  'voided, missed, and deleted tips must remain non-scoring lifecycle records'
);

select pg_temp.assert_true(
  (select count(*) = 3
   from public.grandtour_stage_scores score
   join public.grandtour_tips tip on tip.id = score.tip_id
   where tip.status in ('voided', 'missed', 'deleted')
     and score.total_score = 0
     and not score.is_prize_eligible),
  'non-scoring lifecycle statuses must not be prize eligible'
);

select pg_temp.authenticate('10000000-0000-0000-0000-000000000001');
select pg_temp.assert_true(
  (select count(*) = 1
     and count(*) filter (
       where user_id = '10000000-0000-0000-0000-000000000001'
     ) = 1
     and min(total_score) = 150
   from public.get_grandtour_leaderboard(
     '40000000-0000-0000-0000-000000000001',
     'overall'
   )),
  'live leaderboard must retain corrected scores and exclude voided, missed, and deleted tips'
);

select pg_temp.assert_true(
  (select count(*) = 4
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname in (
        'save_grandtour_tip_draft',
        'submit_grandtour_tip',
        'clear_grandtour_tip_draft',
        'get_grandtour_leaderboard'
      )),
  'all four canonical frontend RPCs must exist'
);

reset role;
update public.apps
set grandtour_tipping_enabled = true
where code = 'cycling';
select pg_temp.assert_true(
  (select grandtour_tipping_enabled from public.apps where code = 'cycling'),
  'kill switch must be safely re-enabled after verification'
);
select 'canonical GrandTour tipping SQL tests passed' as result;
rollback;
