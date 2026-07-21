# Product — GrandTour

## What this is

GrandTour is a cycling stage-tipping app for grand tour races. Users predict each
stage's top-five finishers (in order) and the four jersey holders (yellow/GC,
green/points, KOM/polka-dot, white/youth), then get scored against the official
result. There is one production race in the data model today: the **Tour de
France 2026** (`grand_tours` has never had a second row seeded — no Giro/Vuelta
support exists despite some cosmetic per-race color plumbing being pre-built,
see [ROADMAP.md](ROADMAP.md)).

GrandTour is an independent product. It must never use official Tour de France
branding, protected logos, or wording implying endorsement/affiliation. Safe
framing: *"GrandTour is a cycling tipping app for grand tour stage racing fans."*

## Confirmed product rules (implemented, verified in code)

- **Two tip-entry modes**: `daily` (tip one stage at a time, locks at that
  stage's own lock time) and `preselection` (tip every stage before the tour
  starts, locks at one tour-level `preselection_locks_at`). `overall` is a
  **derived** leaderboard (daily + preselection), never a tip-entry mode.
- **Stage entry** = 5 distinct ordered riders + 4 jersey picks (yellow, green,
  KOM, white). A rider may appear in multiple jersey slots and in the top five
  simultaneously; duplicate riders within the five finishing slots is invalid.
- **Team Time Trial (TTT) stages** use team picks instead of rider picks for the
  top five. Only stages tagged `ttt_timing_rule = 'individual_time'` (the
  "first rider across the line sets the team's time" rule) are actually
  supported end-to-end; any other TTT timing rule is refused at apply time. See
  [ttt-scoring.md](../features/ttt-scoring.md).
- **Scoring** (`packages/tipping-core`, shared, pure, deterministic):
  - Top five: exact position 10/8/6/4/2, right rider wrong position 1, miss 0.
  - TTT top five: exact position 6, right team wrong position 3, +4 winning-team
    bonus, 0 otherwise.
  - Jerseys: 5 points per correct post-stage holder, 25 per correct final
    (tour-level) winner.
  - Daily and preselection call the **same** scoring function — see
    [DECISIONS.md](DECISIONS.md) #1.
- **Locking**: server/database time is authoritative; client checks are UX only.
  A `manual_locked_at` admin override always wins over the computed lock time.
  See [stage-tipping.md](../features/stage-tipping.md).
- **Future tips are never exposed.** RLS hides another player's tip for a stage
  that hasn't locked yet — enforced at the database layer
  (`20260702003948_harden_grandtour_tip_lifecycle.sql`), not just in the UI.
- **Official results only ever come from one source of truth**: the letour.fr
  official-feed pipeline (parse → reconcile → apply → admin-check → finalise →
  score), now fully automatable end-to-end. See
  [official-data-import.md](../features/official-data-import.md).
- **Rider identity** is increasingly backed by a cross-race UCI rider registry
  (`uci_riders` + satellites), linked to but separate from the tour-scoped
  `grandtour_riders` table. See [official-data-import.md](../features/official-data-import.md).
- **No exposure of dummy/demo activity as real.** The dummy-user feature flag
  exists but stays disabled; nothing in the shipped UI shows fabricated
  engagement as if it were real players.
- **Admin result review is a first-class, gated workflow**, not just a raw SQL
  path — see [admin-stage-review.md](../features/admin-stage-review.md).

## Deliberately out of MVP scope (still disabled today)

Ads, subscriptions, in-app chat, prizes, and dummy/demo activity all have
feature flags in the data model, and all remain **disabled**. Do not enable or
build UI for these without an explicit product decision — see
[ROADMAP.md](ROADMAP.md) for anything under active consideration.

## Superseded / historical scope documents

The original MVP design brief, [`GRANDTOUR_APP_SCOPE.md`](../../GRANDTOUR_APP_SCOPE.md)
(repo root) and [`docs/product-scope.md`](../product-scope.md), predate almost
all of the implementation work described in this file and in
[CURRENT_STATE.md](CURRENT_STATE.md). They are kept for historical context
only — **do not treat them as current requirements**. Where they conflict with
this file or with the actual code, this file and the code win. Notably: the
original brief said "no push notifications" — the shipped feature is
transactional email (Resend), not push, and was treated as in-scope once
requested; it does not contradict the spirit of the original constraint but the
brief's literal text is stale.
