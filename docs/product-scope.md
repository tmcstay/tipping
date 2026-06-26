# F1Tips MVP Product Scope

F1Tips is the first branded app in the Tipping Suite platform. The MVP should prove the shared platform model for a Formula 1 tipping experience without hard-coding F1-specific behaviour into the core tipping engine.

## MVP Goals

- Support one configurable app variant: F1Tips.
- Let users sign up, log in, manage a display name, view the active F1 season, browse races, submit tips before lock time, view their tips, see results, and follow a leaderboard.
- Provide a basic fan chat zone with moderation-ready data structures.
- Give admins the foundations to manage competitions, seasons, events, markets, competitors, results, dummy data, chat, and leaderboard recalculation.
- Include placeholders for ads, subscriptions, and the RevenueCat `no_ads` entitlement.

## In Scope

- Expo React Native mobile app shell for iOS, Android, and web.
- Shared TypeScript packages for app configuration, tipping types, core tipping logic, UI components, and Supabase access.
- F1Tips configuration driven by app metadata, feature flags, theme values, and market types.
- Supabase-backed data model and RLS in later implementation work.
- Initial market types: race winner, podium, fastest lap, and qualifying winner.
- Dummy users and dummy tips for testing and demos, always clearly marked as dummy data.

## Out of Scope

- Full production UI.
- Real prizes, paid competitions, gambling, or real-money rewards.
- Complex live timing integrations.
- Multi-language support.
- External spam or deceptive growth automation.

## Architecture Principles

- Build one shared platform, not separate codebases per sport.
- Keep sport-specific behaviour in configuration and market definitions.
- Keep reusable scoring, locking, validation, and leaderboard logic in `packages/tipping-core`.
- Keep Supabase client code isolated in `packages/supabase-client`.
- Never expose service role keys in client code.
