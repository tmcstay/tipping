# Glossary

- **Grand tour** — a multi-week stage race (Tour de France, Giro d'Italia,
  Vuelta a España). Only the Tour de France 2026 is a real, seeded row in this
  app today.
- **Stage** — one day's race within a grand tour. Has a start time, an
  optional TTT timing rule, a lock time (daily mode) or falls under the
  tour-level preselection lock.
- **Daily mode** — tip-entry mode where a user tips one stage at a time,
  locking at that stage's own lock time.
- **Preselection mode** — tip-entry mode where a user tips every stage before
  the tour starts, all locking at one tour-level `preselection_locks_at`.
- **Overall** — a derived leaderboard (daily + preselection scores combined),
  never a tip-entry mode itself.
- **Top five** — a user's five ordered predicted stage finishers (or, for a
  TTT stage, five ordered predicted teams).
- **Jersey** — one of four post-stage classification leaders: yellow
  (general classification), green (points), KOM/polka-dot (climber), white
  (young rider). Tipped per-stage (daily) and, separately, as a final
  tour-winner pick (preselection/overall scope).
- **TTT (Team Time Trial)** — a stage where teams, not individuals, are timed.
  This app only supports the `individual_time` timing rule (first rider across
  the line sets the team's official time); any other rule is refused.
- **Lock** — the moment a tip becomes immutable. Priority order:
  `manual_locked_at` (admin override) > `locks_at` > legacy `start_time` >
  `stage_date + default_lock_time_utc`.
- **Apply** — writing a parsed-and-reconciled official result into
  `grandtour_stage_results` as a draft (`is_final: false`).
- **Admin-check** — a human confirms an applied draft is correct
  (`review_status: admin_checked`).
- **Finalise** — marks a checked result `is_final: true`. Required before
  scoring.
- **Score** — runs `recalculate_grandtour_stage_scores`, which requires
  `is_final = true` and a real authenticated cycling-admin session (not a
  service-role key).
- **Reconciliation** — matching parsed rider/team names from letour.fr against
  the existing `grandtour_riders`/`grandtour_teams`/startlist data, producing
  a `safeToApply` verdict and any blockers.
- **UCI registry / `uci_riders`** — a cross-race canonical rider identity
  table, sourced from UCI's own public rider API, linked to (not replacing)
  the tour-scoped `grandtour_riders` table via `master_rider_id`.
- **Master rider link** — the `grandtour_riders.master_rider_id` foreign key
  connecting a tour-scoped rider row to its canonical `uci_riders` identity.
- **Review queue (`uci_rider_review_queue`)** — holds anything the
  registry/matching pipeline can't resolve automatically (ambiguous
  candidates, DOB/nationality conflicts, unmatched startlist riders) for a
  human admin to resolve.
- **DNS / DNF / OTL** — did not start / did not finish / outside time limit —
  startlist/rider status values distinct from a normal finishing result.
- **Dry run** — the default mode for every write-capable script/RPC in this
  project: parses/reconciles/plans but never writes, and never requires
  service-role credentials.
- **Confirm-production** — an explicit CLI flag required, on top of every
  other safety flag, before any script will write against a known production
  Supabase URL.
