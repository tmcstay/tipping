create extension if not exists pgcrypto;

create table public.apps (
  id uuid primary key default gen_random_uuid(),
  app_key text unique not null,
  name text not null,
  sport_type text not null,
  theme jsonb,
  ads_enabled boolean not null default true,
  subscriptions_enabled boolean not null default true,
  dummy_activity_enabled boolean not null default false,
  prizes_enabled boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  is_admin boolean not null default false,
  is_dummy boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create table public.competitions (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references public.apps(id) on delete cascade,
  competition_key text not null,
  name text not null,
  sport_type text not null,
  created_at timestamptz not null default now(),
  unique (app_id, competition_key)
);

create table public.seasons (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions(id) on delete cascade,
  season_year int not null,
  name text not null,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  unique (competition_id, season_year)
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  event_key text not null,
  name text not null,
  venue text,
  country text,
  starts_at timestamptz,
  lock_at timestamptz,
  status text not null default 'scheduled',
  created_at timestamptz not null default now(),
  unique (season_id, event_key)
);

create table public.competitors (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions(id) on delete cascade,
  competitor_key text not null,
  name text not null,
  competitor_type text not null,
  team_name text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (competition_id, competitor_key)
);

create table public.markets (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  market_key text not null,
  market_type text not null,
  name text not null,
  lock_at timestamptz,
  points_rule jsonb not null,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  unique (event_id, market_key)
);

create table public.tips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  market_id uuid not null references public.markets(id) on delete cascade,
  competitor_id uuid not null references public.competitors(id) on delete restrict,
  submitted_at timestamptz not null default now(),
  is_dummy boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, market_id)
);

create table public.results (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references public.markets(id) on delete cascade,
  competitor_id uuid not null references public.competitors(id) on delete restrict,
  position int,
  points_awarded int,
  result_status text not null default 'official',
  created_at timestamptz not null default now(),
  unique (market_id, competitor_id)
);

create table public.leaderboards (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references public.apps(id) on delete cascade,
  season_id uuid not null references public.seasons(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  total_points int not null default 0,
  rank int,
  tips_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (app_id, season_id, user_id)
);

create table public.chat_zones (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references public.apps(id) on delete cascade,
  competition_id uuid references public.competitions(id) on delete cascade,
  season_id uuid references public.seasons(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  chat_zone_id uuid not null references public.chat_zones(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  is_system boolean not null default false,
  is_sponsored boolean not null default false,
  is_dummy boolean not null default false,
  moderation_status text not null default 'visible',
  created_at timestamptz not null default now()
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null,
  provider_customer_id text,
  entitlement text not null,
  status text not null,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  unique (user_id, provider, entitlement)
);

create table public.ad_placements (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references public.apps(id) on delete cascade,
  placement_key text not null,
  provider text not null,
  active boolean not null default true,
  config jsonb,
  created_at timestamptz not null default now(),
  unique (app_id, placement_key)
);

create table public.system_posts (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references public.apps(id) on delete cascade,
  chat_zone_id uuid references public.chat_zones(id) on delete set null,
  post_type text not null,
  title text,
  body text not null,
  is_sponsored boolean not null default false,
  scheduled_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now()
);

create index profiles_is_dummy_idx on public.profiles (is_dummy);
create index competitions_app_id_idx on public.competitions (app_id);
create index seasons_competition_id_idx on public.seasons (competition_id);
create index events_season_id_idx on public.events (season_id);
create index competitors_competition_id_idx on public.competitors (competition_id);
create index markets_event_id_idx on public.markets (event_id);
create index tips_user_id_idx on public.tips (user_id);
create index tips_market_id_idx on public.tips (market_id);
create index results_market_id_idx on public.results (market_id);
create index leaderboards_app_season_rank_idx on public.leaderboards (app_id, season_id, rank);
create index chat_messages_chat_zone_created_at_idx on public.chat_messages (chat_zone_id, created_at desc);
create index subscriptions_user_id_idx on public.subscriptions (user_id);

alter table public.apps enable row level security;
alter table public.profiles enable row level security;
alter table public.competitions enable row level security;
alter table public.seasons enable row level security;
alter table public.events enable row level security;
alter table public.competitors enable row level security;
alter table public.markets enable row level security;
alter table public.tips enable row level security;
alter table public.results enable row level security;
alter table public.leaderboards enable row level security;
alter table public.chat_zones enable row level security;
alter table public.chat_messages enable row level security;
alter table public.subscriptions enable row level security;
alter table public.ad_placements enable row level security;
alter table public.system_posts enable row level security;

create policy "Public can read apps"
on public.apps for select
to anon, authenticated
using (true);

create policy "Public can read competitions"
on public.competitions for select
to anon, authenticated
using (true);

create policy "Public can read seasons"
on public.seasons for select
to anon, authenticated
using (true);

create policy "Public can read events"
on public.events for select
to anon, authenticated
using (true);

create policy "Public can read competitors"
on public.competitors for select
to anon, authenticated
using (true);

create policy "Public can read markets"
on public.markets for select
to anon, authenticated
using (true);

create policy "Public can read leaderboards"
on public.leaderboards for select
to anon, authenticated
using (true);

create policy "Users can read their own profile"
on public.profiles for select
to authenticated
using ((select auth.uid()) = id);

-- UPDATE needs both USING and WITH CHECK so users cannot reassign ownership or edit another profile row.
-- Column-level grants below restrict client updates to editable profile fields.
create policy "Users can update their own profile"
on public.profiles for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy "Users can read their own tips"
on public.tips for select
to authenticated
using ((select auth.uid()) = user_id);

-- Tip writes are allowed only while the market is open and before the market lock time.
-- If a market-specific lock is absent, the parent event lock time is used as the fallback.
create policy "Users can insert their own unlocked tips"
on public.tips for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and is_dummy = false
  and exists (
    select 1
    from public.markets
    join public.events on events.id = markets.event_id
    where markets.id = tips.market_id
      and markets.status = 'open'
      and now() < coalesce(markets.lock_at, events.lock_at)
  )
);

-- UPDATE repeats the lock check in USING and WITH CHECK so locked tips are not targetable
-- and the resulting row remains owned by the signed-in user.
create policy "Users can update their own unlocked tips"
on public.tips for update
to authenticated
using (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.markets
    join public.events on events.id = markets.event_id
    where markets.id = tips.market_id
      and markets.status = 'open'
      and now() < coalesce(markets.lock_at, events.lock_at)
  )
)
with check (
  (select auth.uid()) = user_id
  and is_dummy = false
  and exists (
    select 1
    from public.markets
    join public.events on events.id = markets.event_id
    where markets.id = tips.market_id
      and markets.status = 'open'
      and now() < coalesce(markets.lock_at, events.lock_at)
  )
);

create policy "Authenticated users can read visible chat messages"
on public.chat_messages for select
to authenticated
using (moderation_status = 'visible');

-- User-created chat messages must belong to the signed-in user and start visible.
-- System and sponsored posts are reserved for future admin/server-side flows.
create policy "Authenticated users can insert their own chat messages"
on public.chat_messages for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and moderation_status = 'visible'
  and is_system = false
  and is_sponsored = false
  and is_dummy = false
);

grant select on
  public.apps,
  public.competitions,
  public.seasons,
  public.events,
  public.competitors,
  public.markets,
  public.leaderboards
to anon, authenticated;

grant select on public.profiles to authenticated;
grant update (display_name, avatar_url, updated_at) on public.profiles to authenticated;

grant select, insert on public.tips to authenticated;
grant update (competitor_id, submitted_at) on public.tips to authenticated;

grant select, insert on public.chat_messages to authenticated;
