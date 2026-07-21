# Stage Tipping

## Purpose
Let a user predict a stage's top-five finishers (in order) and its four
jersey holders, in either daily or preselection mode, before the applicable
lock.

## Confirmed rules
- Two modes: `daily` (one stage at a time, locks at that stage's own lock
  time) and `preselection` (every stage tipped before the tour starts, locks
  at one tour-level `preselection_locks_at`).
- Entry = 5 distinct ordered riders (or, for a supported TTT stage, 5 ordered
  teams) + yellow/green/KOM/white jersey picks. A rider may be picked for
  multiple jersey categories and also appear in the top five.
- Lock priority: `manual_locked_at` (admin override) > `locks_at` >
  legacy `start_time` > `stage_date + default_lock_time_utc`.
- Database enforcement is authoritative; client checks are UX only.
- A future stage's tip is never exposed to anyone but its owner (RLS).

## User experience
- `apps/mobile/app/stages/index.tsx` — stage list, current-vs-future
  sections (`buildStageListSections`), badge + live countdown per stage.
- `apps/mobile/app/stages/[stageId].tsx` — the tip-entry form. `daily` mode
  locking goes through the shared closure resolver; `preselection` mode keeps
  its own simpler `race.preselection_locks_at` comparison (a genuinely
  different, race-level lock concept).
- `OrderedTopFivePicker` — numbered 1–5 rider/team picker.
- `apps/mobile/lib/tipEntryExperience.ts`'s `buildTopFiveValidationMessage`
  drives the single-line completeness message ("Select N more...").

## Data model
`grandtour_tips` (one row per user/stage/mode), `grandtour_tip_selections`
(ordered rider/team picks + jersey picks). See
[DATABASE.md](../development/DATABASE.md) for the wider schema map.

## Relevant source files
- `packages/tipping-core/src/cycling-stage-tip.ts` —
  `resolveCyclingStageClosureState`, the single source of truth for lock
  state.
- `apps/mobile/lib/stageClosureExperience.ts` — `buildClosureDisplay`,
  `formatLockCountdown`, `resolveCountdownTickIntervalMs`.
- `apps/mobile/components/StageLockCountdown.tsx` — the shared live-ticking
  countdown component.
- `apps/mobile/lib/stageListExperience.ts` — `buildStageListSections`.
- `apps/mobile/lib/tipEntryExperience.ts` — validation copy.

## Relevant migrations
- `20260702003948_harden_grandtour_tip_lifecycle.sql` — the RLS policy that
  hides another user's not-yet-locked tip; reused unmodified by every later
  feature that reads other users' tips.

## Current implementation
Fully built for both modes on the daily-lock path; the preselection lock path
uses its own comparison, deliberately not unified with the shared resolver
(see [DECISIONS.md](../project/DECISIONS.md) #1 for why the daily path was
unified and why preselection wasn't — it's a genuinely different lock
concept, not an oversight).

## Outstanding work
- Young-rider (white jersey) eligibility is not enforced in the tip-entry UI
  (see [ROADMAP.md](../project/ROADMAP.md)).
- DNS/DNF rider exclusion from the picker is not confirmed end-to-end.

## Edge cases
- A rider may be selected for multiple jersey categories and the top five
  simultaneously — this is intentional, not a validation gap.
- Missing/invalid lock data must fail closed (reject the write), never fail
  open.

## Acceptance criteria
- Exactly five distinct ordered top-five slots required for a complete entry.
- All four jersey categories required for a complete entry.
- Insert/update/delete succeeds before lock, fails at and after lock.
- Manual lock override always wins regardless of computed lock time.

## Tests
`packages/tipping-core` locking tests, `apps/mobile` `test:ui`
(`stageClosureExperience`, `stageListExperience`, `tipEntryExperience`), RLS
coverage in `supabase/tests/`.
