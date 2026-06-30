# GrandTour MVP Product Scope

GrandTour is a cycling tipping app for grand tour stage racing fans. It is an independent product and must not use official Tour de France branding or imply official affiliation.

The canonical detailed scope is [`GRANDTOUR_APP_SCOPE.md`](../GRANDTOUR_APP_SCOPE.md).

The audited 2026 cycling dataset, import workflow, provisional-startlist rules,
and refresh procedure are documented in
[`docs/tdf-2026-data.md`](./tdf-2026-data.md).

## MVP Goal

Deliver a simple Expo/React Native game backed by Supabase where authenticated users predict each stage's ordered top five and the yellow, green, KOM/polka-dot, and white jersey holders after the stage.

Users may play:

- **Preselection:** complete every stage before the tour-level lock preceding Stage 1.
- **Daily:** complete each stage before that stage's lock.
- **Overall:** a derived leaderboard equal to Daily plus Preselection; it is not a third tip mode.

Daily and Preselection use the same form, validation, results, and scoring implementation. Only lock resolution differs.

## Scoring

For each predicted top-five rider:

- Exact position: 10 points
- Actual top five, wrong position: 5 points
- Outside the actual top five: 0 points

Cumulative bonuses:

- Correct stage winner: 5 points
- All five riders in the actual top five, any order: 10 points
- Perfect exact-order top five: 25 points

Each correct post-stage jersey holder is worth 10 points. A perfect stage scores 90 top-five points plus 40 jersey points, for a maximum of 130.

## In Scope

- Supabase/Postgres data model, constraints, RLS, and typed access
- Basic tour, stage, team, rider, market, tip, result, and score data
- Authentication and profile foundation
- Shared stage tipping form for Daily and Preselection
- Tour-level Preselection locking and stage-level Daily locking
- Pure shared scoring logic with a score breakdown
- Daily, Preselection, and derived Overall leaderboards
- Simple mobile/web screens through Expo
- Protected tour setup and result-entry capability
- Tests for scoring, validation, locking, RLS, and leaderboard aggregation

## Out of Scope

- Ads and subscriptions
- Chat
- Prizes or paid competitions
- Push notifications
- Dummy activity in the MVP UI
- Live timing integrations
- Official cycling-event branding or licensed data feeds
- Full public marketing site

Feature flags for ads, subscriptions, chat, prizes, and dummy activity must remain disabled.

## Architecture Principles

- Keep the platform reusable and configuration-driven.
- Treat stages as generic events and riders as typed competitors where practical.
- Represent ordered top-five selections explicitly; the current one-tip-per-market shape is insufficient.
- Store user-entered modes as `daily` or `preselection` only.
- Derive Overall from the two score sets.
- Enforce ownership and lock timing in Supabase, not only in the client.
- Use RLS on every exposed table and never expose service-role credentials to the app.
- Keep scoring, validation, locking, and leaderboard rules in `packages/tipping-core`.
- Keep Supabase access isolated in `packages/supabase-client`.
- Do not rewrite an applied migration until migration history and data state are known.
