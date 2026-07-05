alter table public.grandtour_riders
  add column bib_number integer;

alter table public.grandtour_riders
  add constraint grandtour_riders_bib_number_check
  check (bib_number is null or bib_number > 0);

comment on column public.grandtour_riders.bib_number is
  'Canonical/current race bib for general rider display and imports. Stage-specific bibs remain on grandtour_stage_startlists.';

create index grandtour_riders_grand_tour_id_bib_number_idx
on public.grandtour_riders (grand_tour_id, bib_number)
where bib_number is not null;
