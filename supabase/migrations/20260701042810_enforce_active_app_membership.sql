-- Suspension and bans must affect the game itself, not only membership screens.
-- Restrictive policies are ANDed with every existing ownership/admin policy.

create policy "Active cycling membership required for GrandTour tips"
on public.grandtour_tips
as restrictive
for all
to authenticated
using (
  (select app_private.has_app_code_role(
    'cycling',
    array['user', 'moderator', 'admin', 'system']
  ))
)
with check (
  (select app_private.has_app_code_role(
    'cycling',
    array['user', 'moderator', 'admin', 'system']
  ))
);

create policy "Active cycling membership required for GrandTour selections"
on public.grandtour_tip_selections
as restrictive
for all
to authenticated
using (
  (select app_private.has_app_code_role(
    'cycling',
    array['user', 'moderator', 'admin', 'system']
  ))
)
with check (
  (select app_private.has_app_code_role(
    'cycling',
    array['user', 'moderator', 'admin', 'system']
  ))
);
