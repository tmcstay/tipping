# GrandTour — Repository Instructions

## Product Direction

The active product is **GrandTour**, a cycling tipping app for grand tour stage racing fans.

Do not continue the former F1Tips product direction. Remove, rename, or generalize F1-specific configuration, sample data, markets, query type names, routes, UI wording, documentation, and build naming when the relevant implementation work is requested.

GrandTour is independent. Avoid official Tour de France branding, protected logos, and wording that implies endorsement or official affiliation. Safe wording:

> GrandTour is a cycling tipping app for grand tour stage racing fans.

The canonical product specification is [`GRANDTOUR_APP_SCOPE.md`](./GRANDTOUR_APP_SCOPE.md). Read it before making product, schema, scoring, locking, result, or leaderboard changes.

## Technology and Architecture

Use the existing stack unless a change is explicitly approved:

- Expo React Native for iOS, Android, and web
- TypeScript
- Expo Router
- Supabase for Postgres, authentication, RLS, and backend capabilities
- npm workspaces and shared packages

Keep one reusable platform and one shared tipping engine. Sport-specific behavior belongs in configuration and market/rule definitions, not duplicated screens or hard-coded branching.

The generic hierarchy is:

```text
app -> competition -> season/tour -> event/stage -> market -> tip -> result -> score -> leaderboard
```

For GrandTour:

- Events are stages.
- Competitors are riders, linked to cycling teams.
- User-entered modes are `daily` and `preselection`.
- `overall` is derived from the two score sets and is never a tip-entry mode.

## MVP Boundaries

Build only the core GrandTour game:

- Auth and profile basics
- Tour, stage, team, and rider data
- Ordered stage top-five tips
- Yellow, green, KOM/polka-dot, and white jersey tips
- Daily and Preselection locking
- Shared scoring
- Results and score breakdowns
- Daily, Preselection, and Overall leaderboards
- Simple Expo screens
- Minimal protected administration and result entry

Do not build ads, subscriptions, chat, prizes, push notifications, or dummy activity into the MVP UI. Keep flags for ads, subscriptions, chat, prizes, and dummy activity disabled.

## Competition Rules

### Preselection

- The user tips every stage before the tour begins.
- All entries lock at the tour/season-level Preselection lock before Stage 1.

### Daily

- The user tips one stage at a time.
- Each entry locks at that stage's lock time.

Both modes use the same stage form, validation, results, and scoring logic. Only lock resolution differs.

### Stage Entry

Each entry contains:

- Five distinct riders in predicted finishing order
- Yellow jersey holder after the stage
- Green jersey holder after the stage
- KOM/polka-dot jersey holder after the stage
- White jersey holder after the stage

A rider may be selected for multiple jersey categories and may also appear in the top five. Duplicate riders within the five finishing slots are invalid.

## Scoring Rules

For each predicted top-five rider:

- Exact position: 10 points
- Actual top five but wrong position: 5 points
- Outside actual top five: 0 points

Bonuses are cumulative:

- Correct stage winner: 5 points
- All five riders in the actual top five, any order: 10 points
- Perfect top five exact order: 25 points

Each correct yellow, green, KOM, or white jersey holder is worth 10 points.

Maximum:

```text
Top five: 90
Jerseys:  40
Stage:   130
```

Implement scoring as deterministic pure logic in `packages/tipping-core`. Return a breakdown as well as the total. Daily and Preselection must call the same function. Overall equals Daily plus Preselection.

## Locking and Security

- Preselection resolves to the tour/season lock.
- Daily resolves to the individual stage lock.
- Database enforcement is authoritative; client checks are only UX support.
- Reject inserts, updates, and deletes at or after lock.
- Missing or invalid lock data fails closed.
- Manual lock status overrides timestamps.
- Use database/server time, not a device clock, for enforcement.
- Users may only write their own entries.
- Do not use user-editable metadata for authorization.
- Never expose Supabase service-role or secret keys in client code.
- Enable RLS on all tables exposed through the Supabase Data API.
- UPDATE policies require ownership checks in both `USING` and `WITH CHECK` and an applicable SELECT policy.
- Prefer security-invoker behavior. Treat any security-definer function as a sensitive, explicitly reviewed API.

Before implementing Supabase work, verify current official documentation and the installed CLI. Inspect local and remote migration state before deciding whether to alter, replace, or add to existing schema. Do not casually rewrite an applied migration.

## Data Model Direction

The current one-selection constraint `unique(user_id, market_id)` is insufficient. The GrandTour model must support:

- Teams and rider/team relationships
- Stage ordering and route metadata
- Tour-level Preselection lock
- Stage-level Daily lock
- Entry mode (`daily` or `preselection`)
- Ordered top-five selection slots 1 through 5
- Four jersey categories
- Matching official result data
- Atomic stage-entry saves
- Daily and Preselection score sets
- Derived Overall standings

Use database constraints to prevent duplicate top-five riders and invalid modes. Ensure selected riders belong to the relevant roster.

## Repository Responsibilities

- `apps/mobile`: Expo routes, screens, hooks, app config, and mobile composition
- `packages/tipping-core`: pure scoring, locking, validation, and leaderboard logic
- `packages/shared-types`: shared application and generated database types
- `packages/supabase-client`: client creation, auth helpers, and typed queries
- `packages/ui`: reusable presentation components
- `supabase/migrations`: reviewed schema, constraints, grants, RLS, functions, and indexes
- `supabase/seed.sql`: clearly identified development/sample data
- `docs`: supporting product, schema, deployment, and operating documentation

Keep business logic out of screens. Do not duplicate the stage form or scoring implementation between modes.

## Coding Standards

- Use strict TypeScript and clear domain names.
- Prefer generic names such as stage, rider, event, competitor, entry, and selection over inherited F1 terminology.
- Keep changes small and reviewable.
- Avoid broad refactors unless requested or required for correctness.
- Do not introduce major dependencies without explaining the need.
- Do not remove unrelated behavior.
- Never commit secrets; use environment variables for public client configuration and secure server configuration for privileged credentials.
- Add comments where locking, scoring, authorization, or recalculation behavior is non-obvious.
- Generate Supabase types rather than maintaining an empty or speculative database type by hand.

## Testing Requirements

Add or update tests with every relevant feature. Coverage must include:

- Exact and wrong-position top-five scoring
- Winner, all-five, and perfect-order bonuses
- All four jersey categories
- Maximum stage score of 130
- Duplicate-rider validation
- Daily locking before, at, and after stage lock
- Preselection locking before, at, and after tour lock
- Identical scoring across Daily and Preselection
- Atomic tip creation and update
- RLS ownership and post-lock rejection
- Result correction and idempotent recalculation
- Daily and Preselection standings
- Overall equals Daily plus Preselection

Run the most relevant package tests and TypeScript typecheck after changes. For schema work, also verify constraints, grants, RLS behavior, migrations, and database advisors where available.

## Codex Operating Instructions

Before changing code:

1. Inspect the existing structure and working tree.
2. Read the canonical GrandTour scope.
3. Identify the smallest safe change.
4. State assumptions that materially affect the design.
5. Implement one coherent feature at a time.
6. Add or update tests.
7. Run proportionate verification.
8. Report changed files, verification results, and remaining risks.

Do not rewrite the whole project unless explicitly asked. Preserve unrelated user changes in a dirty worktree.

## Current Build Priority

1. GrandTour documentation and configuration
2. Supabase model, constraints, RLS, and representative cycling seed data
3. Shared GrandTour types
4. Scoring, validation, and mode-aware locking with tests
5. Authentication and profile flow
6. Tour and stage browsing
7. Shared stage tipping form
8. Preselection completion flow
9. Result entry and score breakdown
10. Daily, Preselection, and Overall leaderboards

