-- Enum values must be committed before later migrations can safely reference
-- them in functions, policies, or data changes.
alter type public.grandtour_tip_status add value if not exists 'voided';
alter type public.grandtour_tip_status add value if not exists 'corrected';
alter type public.grandtour_tip_status add value if not exists 'missed';
alter type public.grandtour_tip_status add value if not exists 'deleted';
