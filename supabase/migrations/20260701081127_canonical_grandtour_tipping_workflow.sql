-- Enum additions are isolated because PostgreSQL requires ALTER TYPE ... ADD
-- VALUE to commit before later migrations can safely use the new values.

create type public.grandtour_tip_scope as enum (
  'stage',
  'overall_jerseys'
);

alter type public.grandtour_tip_selection_type
  add value if not exists 'overall_yellow_winner';
alter type public.grandtour_tip_selection_type
  add value if not exists 'overall_green_winner';
alter type public.grandtour_tip_selection_type
  add value if not exists 'overall_kom_winner';
alter type public.grandtour_tip_selection_type
  add value if not exists 'overall_white_winner';
