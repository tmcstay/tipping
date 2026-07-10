# 2026-07-09 — Tour de France 2026 official startlist: production load record

> **Record of a completed production action.** This document is a
> post-hoc record of what was already done to production Supabase project
> `nsdpilmmrfobiapbwona`, not a plan or authorization for a future one.
> If this data ever needs to be reloaded or corrected in production, treat
> that as a new, separately reviewed operation — do not reuse this record
> as approval.

## Summary

`scripts/load-tdf-2026-startlist.mjs` was run against production Supabase
(`nsdpilmmrfobiapbwona`) to load the official Tour de France 2026 startlist
(23 teams, 184 riders, bib numbers) into `public.grandtour_teams`,
`public.grandtour_riders`, and `public.grandtour_stage_startlists`. The
script had already been built, safety-guarded, and rehearsed against local
Supabase only — see
[docs/grandtour-results-feed.md](grandtour-results-feed.md) and the
prior local rehearsal work for that history. This document covers only the
production run itself.

## What happened, in order

1. **First run used the wrong key.** The script was first invoked against
   production with a non-service-role key (anon-level permissions). Writes
   that require bypassing RLS (`INSERT`/`UPDATE` on `grandtour_riders` /
   `grandtour_stage_startlists` beyond what anon RLS policies allow) failed
   partway through, after some rows had already been written under
   whatever the anon policies did permit. This left production in a
   partially-updated, inconsistent state — not a clean pre-load state.
2. **Correct service-role key used; riders loaded.** The script was
   re-run with `SUPABASE_SERVICE_ROLE_KEY` set correctly. The 23 official
   teams and 184 official riders (with bibs) were written successfully at
   this point, and the 40 non-official/legacy riders present in production
   were marked inactive/DNS.
3. **Stage startlist writes were interrupted mid-run.** The
   per-stage `grandtour_stage_startlists` loop stopped partway through:
   stages 1–2 were fully populated, stage 3 was partially populated, and
   stages 4–21 had no confirmed official startlist rows yet.
4. **A production repair upsert completed the startlists.** A follow-up
   upsert (using the same rider/team/bib source data as the loader) wrote
   the missing confirmed `grandtour_stage_startlists` rows for all active
   official riders across all 21 stages, bringing stages 3–21 up to the
   same state stages 1–2 already had.
5. **Final verification confirmed a fully consistent end state** — see
   below.

## Final verified state

- 184 active riders
- 184 active riders with bib numbers
- 21 stages
- Every stage has exactly 184 confirmed startlist rows
- Every confirmed startlist row has a bib number
- `grandtour_stage_results` = 0
- `grandtour_stage_result_lines` = 0
- `grandtour_stage_jersey_holders` = 0
- `grandtour_stage_team_result_lines` = 0
- `grandtour_stage_scores` = 0

No result, scoring, or jersey-holder tables were touched at any point in
this sequence — only `grandtour_teams`, `grandtour_riders`, and
`grandtour_stage_startlists` were written.

## Final verification SQL

Run these against the production grand tour id for Tour de France 2026 (the
production `grand_tours.id`, referred to below as `<GRAND_TOUR_ID>`) to
reproduce the verification above:

```sql
-- Active riders, and active riders with bibs — both should read 184.
select
  count(*) filter (where is_active = true and status = 'active') as active_riders,
  count(*) filter (where is_active = true and status = 'active' and bib_number is not null) as active_riders_with_bib
from public.grandtour_riders
where grand_tour_id = '<GRAND_TOUR_ID>';

-- Stage count — should read 21.
select count(*) as stage_count
from public.grandtour_stages
where grand_tour_id = '<GRAND_TOUR_ID>';

-- Confirmed startlist rows per stage — every row should read 184 confirmed
-- and 184 confirmed_with_bib, for all 21 stages, with no gaps.
select
  s.stage_number,
  count(sl.id) filter (where sl.status = 'confirmed') as confirmed,
  count(sl.id) filter (where sl.status = 'confirmed' and sl.bib_number is not null) as confirmed_with_bib
from public.grandtour_stages s
left join public.grandtour_stage_startlists sl on sl.stage_id = s.id
where s.grand_tour_id = '<GRAND_TOUR_ID>'
group by s.stage_number
order by s.stage_number;

-- Per-team active-rider counts for the 23 official teams — every row
-- should read exactly 8 active_riders and 8 active_with_bib.
select
  t.name,
  count(r.id) filter (where r.is_active = true and r.status = 'active') as active_riders,
  count(r.id) filter (where r.is_active = true and r.status = 'active' and r.bib_number is not null) as active_with_bib
from public.grandtour_teams t
left join public.grandtour_riders r on r.team_id = t.id and r.grand_tour_id = t.grand_tour_id
where t.grand_tour_id = '<GRAND_TOUR_ID>'
group by t.name
order by t.name;

-- Confirm no result/scoring rows exist — every count below should read 0.
select
  (select count(*) from public.grandtour_stage_results sr
     join public.grandtour_stages s on s.id = sr.stage_id
     where s.grand_tour_id = '<GRAND_TOUR_ID>') as stage_results,
  (select count(*) from public.grandtour_stage_result_lines srl
     join public.grandtour_stage_results sr on sr.id = srl.stage_result_id
     join public.grandtour_stages s on s.id = sr.stage_id
     where s.grand_tour_id = '<GRAND_TOUR_ID>') as stage_result_lines,
  (select count(*) from public.grandtour_stage_jersey_holders jh
     join public.grandtour_stages s on s.id = jh.stage_id
     where s.grand_tour_id = '<GRAND_TOUR_ID>') as jersey_holders,
  (select count(*) from public.grandtour_stage_team_result_lines trl
     join public.grandtour_stage_results sr on sr.id = trl.stage_result_id
     join public.grandtour_stages s on s.id = sr.stage_id
     where s.grand_tour_id = '<GRAND_TOUR_ID>') as team_result_lines,
  (select count(*) from public.grandtour_stage_scores sc
     join public.grandtour_stages s on s.id = sc.stage_id
     where s.grand_tour_id = '<GRAND_TOUR_ID>') as stage_scores;
```

## Rollback note

There is **no clean single-statement rollback** for this load. Unlike the
apply-mode RPC's draft results (which can simply be deleted — see
[docs/GRANDTOUR_APPLY_MODE_PRODUCTION_READINESS_CHECKLIST.md](GRANDTOUR_APPLY_MODE_PRODUCTION_READINESS_CHECKLIST.md)
§11), this load **mutated existing rows in place**:

- `grandtour_riders.is_active` / `status` / `bib_number` were overwritten
  for both the 184 official riders (set active) and the 40 pre-existing
  legacy riders (set inactive/DNS) — the prior values were not recorded
  anywhere before the run.
- `grandtour_stage_startlists.status` / `bib_number` were similarly
  overwritten in place for every row across all 21 stages, first partially
  (by the interrupted run) and then completed (by the repair upsert).

Because prior values were overwritten rather than new rows inserted
alongside old ones, recovering the pre-load state requires one of:

1. **Restore from a pre-load backup** (Supabase Dashboard PITR restore
   point, or a logical dump taken before this run) — the only way to
   recover the *exact* prior state, including whatever the original
   values of the mutated columns were.
2. **A targeted reverse update**, only possible if the prior state is
   independently known (e.g. from a backup taken before the first script
   run, or from application/audit logs) — re-running `UPDATE` statements
   to set `grandtour_riders`/`grandtour_stage_startlists` columns back to
   their recorded prior values. This was not prepared in advance for this
   run, since no pre-load backup step preceded the first (failed) attempt
   — see "Known gaps" below.

If a rollback is ever needed, do not attempt to improvise one from the
current state alone — the pre-load values are not otherwise recoverable
from the data as it stands today.

## Known gaps versus the documented production-readiness process

This run did not follow the sequence in
[docs/GRANDTOUR_APPLY_MODE_PRODUCTION_READINESS_CHECKLIST.md](GRANDTOUR_APPLY_MODE_PRODUCTION_READINESS_CHECKLIST.md)
(which covers the apply-mode RPC, not this loader) or an equivalent
checklist for the startlist loader specifically — none existed for this
script at the time it was run against production. In particular:

- No fresh pre-load production backup is recorded as having been taken
  before the first run.
- The first run used the wrong key, which is exactly the kind of mistake
  a pre-flight "confirm SUPABASE_SERVICE_ROLE_KEY resolves to a real
  service-role JWT" check (as already exists in `scripts/grandtour-apply.mjs`
  via `decodeJwtRole`) would have caught before touching production —
  `scripts/load-tdf-2026-startlist.mjs` has no equivalent check.
- The interruption partway through the stage-startlist loop, followed by
  an ad hoc repair upsert outside the script itself, means the final state
  was reached through a manual recovery step rather than a single
  verified, idempotent run.

These gaps are noted here as follow-up candidates (e.g. a
production-readiness checklist for this loader, analogous to the apply-mode
one, and/or a `decodeJwtRole`-style guard added to the loader itself) but
fixing them is out of scope for this record, which documents what already
happened.
