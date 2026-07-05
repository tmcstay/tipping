-- Extend the existing stage-type enum in place. Existing values remain the
-- canonical values used by current data; the aliases support broader import
-- vocabularies without creating a second stage-type enum.
alter type public.grandtour_stage_type add value if not exists 'road';
alter type public.grandtour_stage_type add value if not exists 'itt';
alter type public.grandtour_stage_type add value if not exists 'ttt';
alter type public.grandtour_stage_type add value if not exists 'sprint';
