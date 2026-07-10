-- Part D: per-user favourite riders for the rider directory / tip
-- selection "Favourites" tab. Follows the GrandTour-specific tables'
-- existing convention of referencing auth.users(id) directly (not
-- public.profiles(id), which the base multi-sport platform tables use -
-- see grandtour_tips.user_id/grandtour_stage_scores.user_id in
-- 20260629080958_grandtour_mvp.sql for precedent).

create table public.grandtour_favourite_riders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  grand_tour_id uuid not null references public.grand_tours(id) on delete cascade,
  rider_id uuid not null references public.grandtour_riders(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, grand_tour_id, rider_id)
);

create index grandtour_favourite_riders_user_grand_tour_idx
on public.grandtour_favourite_riders (user_id, grand_tour_id);

alter table public.grandtour_favourite_riders enable row level security;

-- Users can read/write only their own favourites - no public exposure of
-- who has favourited which rider. Cycling admins can additionally read all
-- favourites (existing convention: grandtour_private.is_cycling_admin()),
-- matching how every other user-owned GrandTour table in this schema
-- (grandtour_tips, grandtour_tip_selections) grants admins a read-all
-- escape hatch without ever letting them write on a user's behalf.
create policy "Users can manage their own favourite riders"
on public.grandtour_favourite_riders for all
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "Cycling admins can read all favourite riders"
on public.grandtour_favourite_riders for select
to authenticated
using (grandtour_private.is_cycling_admin());

revoke all on table public.grandtour_favourite_riders from public, anon;
grant select, insert, update, delete on table public.grandtour_favourite_riders to authenticated;
