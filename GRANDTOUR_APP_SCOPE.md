# GrandTour App Scope

> **Deprecated / historical.** This is the original MVP design brief and
> predates most of the implementation in this repository. It is kept for
> historical context only — it is **not** current documentation and should
> not be treated as authoritative. For current product rules, see
> [docs/project/PRODUCT.md](docs/project/PRODUCT.md); for what's actually
> implemented, see [docs/project/CURRENT_STATE.md](docs/project/CURRENT_STATE.md);
> for the decisions this brief drove, see
> [docs/project/DECISIONS.md](docs/project/DECISIONS.md). Where this file
> conflicts with those, they win.

## 1. Product Summary

GrandTour is a cycling tipping app for grand tour stage racing fans.

Users predict each stage's top five riders in finishing order, the holders of the yellow, green, KOM/polka-dot, and white jerseys after that stage, and the final winner of each jersey classification. Users may enter a Preselection competition, a Daily competition, or both. An Overall leaderboard combines their scores from those two modes.

GrandTour is an independent product. Do not use official Tour de France branding, protected logos, or wording that implies endorsement, affiliation, or official status.

The MVP focuses on the core game:

- Supabase data model and Row Level Security (RLS)
- Basic tours, stages, teams, and riders
- Stage top-five and jersey-holder tipping
- Shared locking and scoring logic
- Daily, Preselection, and Overall leaderboards
- Simple Expo/React Native screens
- Basic protected administration and result entry

Ads, subscriptions, chat, prizes, push notifications, and dummy activity are not part of the MVP UI. Their feature flags must remain disabled.

## 2. Current Repo Context

The repository is an npm-workspaces TypeScript monorepo. It currently contains:

- An Expo SDK 54 / React Native 0.81 mobile app using Expo Router
- Shared packages for types, UI, tipping logic, and Supabase access
- A Supabase/Postgres initial migration with RLS
- F1-specific app configuration, sample data, screen wording, query type names, and build configuration
- Basic event browsing, one-selection-per-market tip submission, leaderboard display, and market locking tests

The existing generic hierarchy remains useful:

```text
app -> competition -> season/tour -> event/stage -> market -> tip -> result -> score -> leaderboard
```

However, the current `unique(user_id, market_id)` tip shape cannot represent five ordered riders in two competition modes. The schema must be evolved before GrandTour tip entry is implemented. Historical migrations should not be rewritten until local and remote migration state is confirmed.

The current app does not yet contain the planned `admin-web` or `marketing-web` applications. Authentication is only a foundation, not a complete user flow.

## 3. MVP User Flow

1. A user signs up or logs in.
2. The user selects an active grand tour.
3. The app shows the tour's stages, dates, statuses, and lock state.
4. The user chooses Daily or Preselection mode.
5. The same stage tipping form is used in both modes.
6. For a stage, the user picks five distinct riders in predicted finishing order and four jersey holders.
7. The app validates completeness and duplicates before saving the stage entry atomically.
8. The user may edit an entry until its applicable lock time.
9. After official results are entered, the app shows the user's stage score and scoring breakdown.
10. The user can view Daily, Preselection, and Overall leaderboards.

The UI must clearly show whether a stage entry is incomplete, complete, saved, locked, or scored.

## 4. Competition Modes

### Preselection

- The user completes picks for every stage before the tour starts.
- Each stage contains the same nine selections as Daily mode.
- All Preselection entries use one tour-level lock time before Stage 1.
- After that lock, no Preselection stage entry may be inserted, changed, or deleted.

### Daily

- The user tips one stage at a time.
- Each stage locks independently before that stage starts.
- Future Daily stages remain editable until their own lock times.

### Overall

- Overall is the sum of a user's Daily and Preselection scores for the same tour.
- It is a derived leaderboard, not a third tip-entry mode.
- A user who enters only one mode may still appear Overall with the score earned in that mode, unless a later product rule explicitly changes eligibility.

Daily and Preselection must share the same form, validation, result representation, and scoring function. Only their lock resolution differs.

## 5. Stage Tip Categories

Every stage entry contains:

1. Predicted first-place rider
2. Predicted second-place rider
3. Predicted third-place rider
4. Predicted fourth-place rider
5. Predicted fifth-place rider
6. Yellow jersey holder after the stage
7. Green jersey holder after the stage
8. KOM/polka-dot jersey holder after the stage
9. White jersey holder after the stage

The five finishing-position riders must be distinct. The same rider may legitimately be selected for more than one jersey category, and a jersey pick may also be one of the predicted top five.

The app should store stable category keys such as:

```text
stage_top_5
yellow_jersey
green_jersey
kom_jersey
white_jersey
```

Ordered top-five selections require a position or slot from 1 through 5.

## 6. Scoring Rules

### Stage Top Five

- Correct first place: 10 points
- Correct second place: 8 points
- Correct third place: 6 points
- Correct fourth place: 4 points
- Correct fifth place: 2 points
- Rider in the actual top five but in a different position: 1 point
- Rider outside the actual top five: 0 points

The exact-position and wrong-position awards are mutually exclusive for each rider. There are no additional stage bonuses.

### Team Time Trial Stage Top Five

For a Team Time Trial, users predict five teams rather than five riders:

- Team in the exact position: 6 points
- Team in the official top five at a different position: 3 points
- Correct winning team: an additional 4 points

TTT jersey selections remain individual riders and use the official post-stage
classification holders. A jersey holder must never be inferred from the winning
team. If an official component is not yet available, that component remains
pending and is recalculated when the official result is completed.

### Jersey Holders

- Each correct active jersey holder after the stage: 5 points

### Overall Jersey Winners

- Each correct final active jersey winner: 25 points
- Overall jersey selections are tour-level Preselection tips and use the tour lock.

### Maximum Per Stage

```text
Top five maximum: 30
Jersey maximum:   20
Stage maximum:    50
Overall jerseys: 100
```

A perfect TTT scores 30 team-position points, a 4-point winning-team bonus,
and 20 jersey points, for a maximum of 54.

Scoring must be implemented as deterministic, pure TypeScript logic in `packages/tipping-core`. The function should return both the total and a category-level breakdown. Daily and Preselection must call exactly the same scoring function.

Only official results should contribute to leaderboards. Re-entering or correcting official results must allow deterministic recalculation without double-counting.

## 7. Locking Rules

- Preselection lock time belongs to the tour/season and must be before Stage 1 begins.
- Daily lock time belongs to each stage and must be before that stage begins.
- The server/database is authoritative for lock enforcement; client checks are for user experience only.
- Inserts, updates, and deletes must all be rejected after the relevant lock.
- A manually locked stage or tour is locked regardless of its timestamp.
- Missing, invalid, or ambiguous lock data must fail closed.
- Use database time rather than trusting a device clock.
- RLS or a narrowly scoped database write function must verify ownership and lock state.

Lock resolution can be expressed as:

```text
preselection -> tour.preselection_lock_at
daily       -> stage.lock_at
```

## 8. Supabase Data Model Direction

Keep the platform model generic while adding cycling-specific data where it belongs.

Expected direction:

- `apps`: GrandTour configuration with MVP feature flags disabled
- `competitions`: a cycling event family or grand-tour competition
- `seasons`: a specific tour edition, including `preselection_lock_at`
- `events`: stages, extended with stage number and optional route metadata
- `teams`: normalized cycling teams
- `competitors`: riders, linked to teams and marked with `competitor_type = 'rider'`
- `markets`: the top-five and four jersey categories for each stage
- `tip_entries`: one user entry for a stage and mode (`daily` or `preselection`)
- `tip_selections`: the ordered/category rider selections belonging to an entry
- `results` or equivalent result selections: official top five and post-stage jersey holders
- score records or reproducible score calculation inputs
- leaderboard records/views separated by `daily` and `preselection`, with `overall` derived from both

Important constraints:

- One entry per user, stage, and user-entered mode
- Five top-five slots numbered 1 through 5
- No duplicate rider in the five top-five slots
- One selection for each jersey category
- Overall is not accepted as a tip-entry mode
- Result and tip riders must belong to the relevant competition/tour roster
- All exposed tables use RLS and explicit grants

Users may read public tour, stage, rider, result, and leaderboard data. Authenticated users may read and write only their own entries, subject to locks. Administrative authorization must not depend on user-editable metadata. Never expose a Supabase service-role or secret key in the mobile app.

Before implementing the migration, verify the installed Supabase CLI and current official guidance, inspect local/remote migration state, and decide whether existing F1 records require a data migration or can be replaced as development-only data.

## 9. Mobile Screens

The GrandTour MVP requires simple, usable Expo screens:

- Authentication: sign up, log in, log out
- Profile: display name and current user state
- Home/tour overview
- Stage list with date, status, mode completion, and lock state
- Mode selector for Daily and Preselection
- Shared stage tipping form
- Review-all-stages screen for Preselection completeness
- Saved/locked stage tip view
- Stage result and score-breakdown view
- Leaderboards with Daily, Preselection, and Overall tabs

The form should provide ordered top-five slots, rider search/selection, duplicate prevention, four jersey selectors, save feedback, and clear lock messaging. It must remain practical on small mobile screens and work on Expo web.

No ad slots, paywalls, chat feeds, prize UI, push-notification prompts, or dummy-user labels are required in the MVP UI.

## 10. Admin / Result Entry Requirements

The MVP needs a protected, minimal administration path. It may begin as a simple internal screen or script before a full admin web console exists.

Administrators must be able to:

- Create and edit tours/seasons
- Set and manually enforce the Preselection lock
- Create and edit stages and Daily lock times
- Create and edit teams and riders
- Manage the tour roster
- Enter the official stage top five in order
- Enter all four official post-stage jersey holders
- Validate result completeness
- Mark results official
- Correct results with an audit trail
- Trigger or verify score and leaderboard recalculation

Normal users must not access result-entry or administrative operations. Administrative writes should be server-side or protected by robust database authorization.

## 11. Dummy User Strategy for Later

Dummy users and activity are out of scope for the MVP and the feature flag must remain disabled.

If added later:

- Dummy profiles, entries, and related activity must be explicitly marked
- Dummy activity must never be represented as real users or organic engagement
- Production display must hide it or clearly label it as demo/sample data
- Generation and cleanup must be admin-only and reversible
- Dummy generation must obey the same selection validation and scoring rules

## 12. Future Features

Possible later work includes:

- Ads and a paid no-ads entitlement
- Private tipping groups
- Chat and moderation
- Clearly governed prizes, subject to separate legal review
- Push notifications for upcoming locks and results
- Additional grand tours and cycling competitions
- Public web leaderboards and stage pages
- Rich rider/team statistics
- Imports from licensed cycling data providers
- Social sharing
- Accessibility and localization improvements

These features must not complicate the first implementation of tips, locks, results, scoring, and leaderboards.

## 13. MVP Build Order

1. Replace F1 product documentation and define GrandTour configuration.
2. Confirm migration history and existing data status.
3. Design and review the GrandTour schema, constraints, RLS, and atomic save path.
4. Add representative tour, team, rider, stage, market, and result seed data.
5. Implement shared types and generated Supabase database types.
6. Implement and test pure scoring, validation, and mode-aware locking.
7. Implement authentication and profile completion.
8. Implement typed tour, stage, rider, tip, result, and leaderboard queries.
9. Build the shared stage tipping form.
10. Build Preselection completion/review flow.
11. Build results and score breakdown.
12. Build Daily, Preselection, and Overall leaderboards.
13. Add protected administration and result entry.
14. Run database, unit, type, and Expo platform verification.

## 14. Testing Checklist

### Scoring

- Exact positions award 10, 8, 6, 4, and 2 points respectively
- Actual top-five rider in the wrong position awards 1 point
- Rider outside the actual top five awards 0 points
- Perfect top five totals 30 points
- Each correct daily jersey awards 5 points
- Perfect stage totals 50 points
- Each correct overall jersey winner awards 25 points
- Perfect overall jersey tips total 100 points
- Partial and mixed predictions produce the expected breakdown
- TTT exact team positions award 6 points each
- TTT wrong-position teams in the official top five award 3 points each
- A correct TTT winning team awards a 4-point bonus
- TTT jerseys use only official individual rider holders
- Missing TTT result components remain pending and recalculate idempotently
- Daily and Preselection return identical scores for identical picks/results

### Validation and Locking

- Exactly five ordered top-five slots are required for a complete entry
- Duplicate top-five riders are rejected
- All four jersey categories are required for a complete entry
- A rider may hold multiple jersey selections
- Daily insert/update/delete succeeds before stage lock
- Daily insert/update/delete fails at and after stage lock
- Preselection entries for every stage succeed before tour lock
- All Preselection changes fail at and after tour lock
- Missing or invalid lock timestamps fail closed
- Overall cannot be used as an entry mode

### Data and Security

- Users can read public game data
- Users can read and write only their own entries
- RLS cannot be bypassed by changing ownership fields
- Normal users cannot enter results or recalculate scores
- Atomic saves never leave a partially written stage entry
- Corrected results recalculate without duplicate points
- Leaderboard totals and ranks are correct for all three views
- Overall equals Daily plus Preselection

### Application

- TypeScript typecheck passes
- Existing and new unit tests pass
- Stage form works on iOS, Android, and web layouts
- Loading, empty, error, saved, incomplete, and locked states are visible
- MVP UI contains no ads, subscriptions, chat, prizes, push prompts, or dummy activity

## 15. Known Repo Changes Required

Documentation-only changes are covered by this scope update. Later implementation will require:

- Replace `apps/mobile/config/f1tips.ts` with a GrandTour configuration
- Update `apps/mobile/lib/appConfig.ts`
- Update Expo name, slug, scheme, and Android package in `apps/mobile/app.json`
- Review the iOS bundle identifier before changing app identity
- Replace F1 Xcode workspace/scheme references in `codemagic.yaml`
- Rename `apps/mobile/app/races` routes and race wording to stages
- Replace F1 home, profile, navigation, and leaderboard copy
- Generalize `RaceMarket` and `RaceCompetitor` query types
- Replace single-selection tip queries with atomic stage-entry operations
- Replace F1 market types and expand shared tip/result/score types
- Replace the empty database type placeholder with generated Supabase types
- Extend `packages/tipping-core` with scoring, validation, leaderboard, and mode-aware locking logic
- Add comprehensive tests for the GrandTour rules
- Add a new Supabase migration after checking migration state; do not casually rewrite applied history
- Replace F1 sample data with clearly identified GrandTour development data
- Keep ads, subscriptions, chat, prizes, and dummy activity disabled and absent from the MVP UI
