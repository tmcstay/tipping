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

select pg_temp.assert_true(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'grandtour_riders'
      and column_name = 'bib_number'
      and data_type = 'integer'
      and is_nullable = 'YES'
  ),
  'grandtour_riders.bib_number must be a nullable integer'
);

select pg_temp.assert_true(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'grandtour_stage_startlists'
      and column_name = 'bib_number'
      and data_type = 'integer'
  ),
  'grandtour_stage_startlists.bib_number must remain available'
);

insert into public.grand_tours (
  id, name, year, starts_at, ends_at, preselection_locks_at
)
values (
  'b1000000-0000-0000-0000-000000000001',
  'Rider Bib Test Tour',
  2097,
  now() + interval '2 days',
  now() + interval '4 days',
  now() + interval '1 day'
);

insert into public.grandtour_riders (
  id, grand_tour_id, display_name, normalized_name, bib_number
)
values
  (
    'b2000000-0000-0000-0000-000000000001',
    'b1000000-0000-0000-0000-000000000001',
    'Rider With Bib',
    'rider with bib',
    12
  ),
  (
    'b2000000-0000-0000-0000-000000000002',
    'b1000000-0000-0000-0000-000000000001',
    'Rider Without Bib',
    'rider without bib',
    null
  );

insert into public.grandtour_stages (
  id, grand_tour_id, stage_number, stage_name, stage_type, starts_at, locks_at
)
values (
  'b3000000-0000-0000-0000-000000000001',
  'b1000000-0000-0000-0000-000000000001',
  1,
  'Rider Bib Test Stage',
  'road',
  now() + interval '2 days',
  now() + interval '1 day'
);

insert into public.grandtour_stage_startlists (
  stage_id, rider_id, bib_number, status
)
values (
  'b3000000-0000-0000-0000-000000000001',
  'b2000000-0000-0000-0000-000000000001',
  34,
  'confirmed'
);

select pg_temp.assert_true(
  (select bib_number = 12 from public.grandtour_riders
   where id = 'b2000000-0000-0000-0000-000000000001'),
  'positive canonical rider bib must be stored'
);

select pg_temp.assert_true(
  (select bib_number is null from public.grandtour_riders
   where id = 'b2000000-0000-0000-0000-000000000002'),
  'canonical rider bib must remain optional'
);

select pg_temp.assert_true(
  (select bib_number = 34 from public.grandtour_stage_startlists
   where stage_id = 'b3000000-0000-0000-0000-000000000001'
     and rider_id = 'b2000000-0000-0000-0000-000000000001'),
  'stage-specific startlist bib must remain independent'
);

do $$
begin
  begin
    insert into public.grandtour_riders (
      grand_tour_id, display_name, normalized_name, bib_number
    ) values (
      'b1000000-0000-0000-0000-000000000001',
      'Invalid Negative Bib',
      'invalid negative bib',
      -1
    );
    raise exception 'negative rider bib unexpectedly accepted';
  exception when check_violation then null;
  end;
end;
$$;

select 'GrandTour rider bib-number SQL tests passed' as result;
rollback;
