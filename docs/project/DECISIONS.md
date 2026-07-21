# Decisions

Numbered architecture/product decisions, recorded only where supported by
code, existing documentation, or an explicit project requirement — not
aspirational. Each entry states the decision, why, and where it's enforced.

1. **Scoring and locking logic is shared, pure, and centralized in
   `packages/tipping-core`.** Daily and preselection modes must call the same
   scoring function and the same lock-state resolver
   (`resolveCyclingStageClosureState`). *Why*: three independent hand-rolled
   lock-date-math implementations existed before this was enforced (dashboard,
   `LockCountdownCard`, stages list), each with different null-handling and
   none reading the admin's manual-lock override — a real, shipped bug class.
   *Enforced*: `packages/tipping-core/src/cycling-stage-tip.ts`.

2. **Supabase (Postgres + Auth + RLS + Edge Functions) is the only backend.**
   No other database or auth provider is in use or under consideration.

3. **Migrations are immutable once applied.** Never rewrite an applied
   migration; always add a new one, even to fix a mistake in a previous one.
   *Why*: local/remote migration state must stay reconstructible and
   diff-able; rewriting history breaks that for anyone who already applied the
   old version. *Consequence*: several bugs in this project were fixed by a
   second migration doing `drop function` + recreate, or a fresh `grant`,
   rather than editing the original file.

4. **Official race naming is derived from a `grand_tours` row's `name` +
   `year` columns via a keyword-matching display formatter
   (`formatGrandTourName`), never parsed from free text or hardcoded.** *Why*:
   raw `name` values are inconsistent across environments (local seed data
   says `"GrandTour France 2026"`, not `"Tour de France 2026"`). *Known gap*:
   three independent reimplementations of this classifier exist (mobile, Deno
   twin, `raceAccent.ts`) with no shared source — see
   [CURRENT_STATE.md](CURRENT_STATE.md).

5. **A future (not-yet-locked) stage's tip is never exposed to anyone but its
   owner**, enforced by RLS, not just UI hiding. *Why*: this is a core
   fairness guarantee of the tipping game. *Enforced*: the tip-lifecycle RLS
   policy from `20260702003948_harden_grandtour_tip_lifecycle.sql`, reused
   without modification by every later feature that reads another user's tips
   (league comparison, participant detail).

6. **Jersey competition selections are a distinct concept from the top-five
   picks**, sharing the same stage-entry form and lock, but scored
   independently (5 points per correct daily holder, 25 per correct final
   winner). A rider may be picked for a jersey and also be in the predicted
   top five simultaneously — not mutually exclusive.

7. **TTT (individual_time rule) scoring uses a different, flatter point scale
   than the rider top five** (6/3/0 + a separate 4-point winning-team bonus,
   vs. the rider path's 10/8/6/4/2/1/0) — not a bug, a deliberate, confirmed
   product rule, verified by a hand-checked end-to-end scoring rehearsal. Only
   `ttt_timing_rule = 'individual_time'` stages are supported; any other TTT
   timing rule is refused at every write-step (apply, admin-check, finalise).

8. **Official result data source hierarchy**: letour.fr official site is the
   only source for stage results/jersey holders/startlist. UCI's own public
   rider-details API is the only source for rider DOB/nationality/team
   history. Neither ProCyclingStats nor CyclingFantasy is used (both return
   HTTP 403 to every automated fetch; no bypass was attempted, consistent with
   this project's standing rule against circumventing access restrictions).
   Wikidata was evaluated and explicitly rejected as unnecessary once UCI
   proved reachable and richer.

9. **UCI rider identity uses a confidence-tiered, never-fuzzy-guessed merge
   rule.** A DOB conflict between a trusted existing value and a new,
   sufficiently-confident incoming value is never silently overwritten — the
   existing value wins and the conflict is surfaced for review. More than one
   plausible (high/medium-confidence) candidate match always degrades to a
   review-queue item rather than picking the first. *Why*: this project's
   standing "never guess" convention, applied specifically to identity
   matching where a wrong guess would corrupt data silently.

10. **DNS/DNF and other non-finishing rider states are modeled as an enum on
    `grandtour_riders.status` and `grandtour_stage_startlists.status`**
    (`dns`/`dnf`/`otl`/`suspended`/`excluded`/`withdrawn`/etc.), not inferred
    from absence in a result. *Status*: the data model exists; end-to-end UI
    enforcement (excluding a DNS/DNF rider from the tip picker) is not yet
    confirmed — see [ROADMAP.md](ROADMAP.md).

11. **Shared business logic lives in `packages/tipping-core` and
    `packages/supabase-client`, not duplicated per-screen.** The one
    documented, deliberate exception: `apps/mobile/lib/stageClosureExperience.ts`
    and a few other `lib/` files re-implement pure logic outside those
    packages specifically because `apps/mobile`'s `test:ui` script compiles a
    flat file list standalone via `tsc` and cannot resolve cross-package
    runtime imports. This is a build-tooling constraint, not a reversal of the
    "don't duplicate" rule — the re-implementation is still single-sourced
    within `apps/mobile`, just not shared with the Supabase Edge Function
    runtime (which has its own independent Deno reimplementation of a few of
    the same pure functions, e.g. `formatGrandTourName`'s Deno twin).

12. **Production safety takes priority over convenience in every pipeline that
    can write.** Every write path (apply, admin-check, finalise,
    `grandtour_result_audit_log`-scoped correction, UCI registry writes)
    defaults to dry-run, requires explicit multi-flag confirmation, refuses a
    known production URL without an extra confirmation flag, and decodes a
    service-role key's JWT `role` claim before trusting it. This project has
    caught itself trusting a stale "production migration boundary" claim in
    its own documentation more than once — always re-verify directly
    (`supabase migration list --linked`, a direct grant/RLS query) rather than
    trusting a prior session's note, including notes in this file.
