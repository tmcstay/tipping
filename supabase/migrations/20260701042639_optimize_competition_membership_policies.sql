-- Keep one permissive policy per role/action so Postgres does not evaluate
-- overlapping user and staff policies for every competition membership row.

drop policy "Users can join public active competitions"
on public.competition_memberships;

drop policy "App staff can manage competition memberships"
on public.competition_memberships;

create policy "Users or app staff can create competition memberships"
on public.competition_memberships for insert
to authenticated
with check (
  (
    user_id = (select auth.uid())
    and role = 'player'
    and exists (
      select 1
      from public.competitions competition
      join public.user_app_memberships app_membership
        on app_membership.app_id = competition.app_id
       and app_membership.user_id = (select auth.uid())
       and app_membership.status = 'active'
      where competition.id = competition_memberships.competition_id
        and competition.is_active
        and competition.is_public
    )
  )
  or exists (
    select 1
    from public.competitions competition
    where competition.id = competition_memberships.competition_id
      and (select app_private.has_app_role(
        competition.app_id,
        array['admin', 'moderator']
      ))
  )
);

create policy "App staff can update competition memberships"
on public.competition_memberships for update
to authenticated
using (
  exists (
    select 1
    from public.competitions competition
    where competition.id = competition_memberships.competition_id
      and (select app_private.has_app_role(
        competition.app_id,
        array['admin', 'moderator']
      ))
  )
)
with check (
  exists (
    select 1
    from public.competitions competition
    where competition.id = competition_memberships.competition_id
      and (select app_private.has_app_role(
        competition.app_id,
        array['admin', 'moderator']
      ))
  )
);

create policy "App staff can delete competition memberships"
on public.competition_memberships for delete
to authenticated
using (
  exists (
    select 1
    from public.competitions competition
    where competition.id = competition_memberships.competition_id
      and (select app_private.has_app_role(
        competition.app_id,
        array['admin', 'moderator']
      ))
  )
);
