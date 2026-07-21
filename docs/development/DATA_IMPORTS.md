# Data Imports

Three independent pipelines. See
[official-data-import.md](../features/official-data-import.md) for full detail
on each — this file is the quick operational index.

## 1. Official-letour results feed

Parse → reconcile → apply → admin-check → finalise → score → notify.
Dry-run by default everywhere.

```bash
npm run grandtour:feed:dry-run          # parse + reconcile one stage, no writes
npm run grandtour:auto-dry-run          # auto-resolves the latest eligible stage
npm run grandtour:feed:apply            # requires --confirm-provider/--confirm-stage/SERVICE_ROLE_KEY
npm run grandtour:reconcile:local-smoke # real local Supabase, read-only
npm run grandtour:apply:local-smoke     # real local Supabase, writes + cleans up
npm run grandtour:admin-stage:local-smoke
```

Admin-check/finalise/score: `scripts/grandtour-admin-stage.mjs
--mark-checked|--finalise|--score|--check-finalise-score`, or the
`/admin/grandtour-stages` UI.

Automated (unattended, production-live as of 2026-07-17): the daily 19:30 UTC
GitHub Actions run (`grandtour-auto-apply-and-score.yml`) does the whole
chain, falling back to manual review on any blocker.

## 2. UCI master rider registry

Cross-race rider identity, sourced from UCI's own public API.

```bash
node scripts/uci-rider-sync.mjs --seed-from-roster letour --apply   # roster-driven seed
node scripts/uci-rider-sync.mjs --dry-run --write-files             # listing-driven crawl
node scripts/tdf-2026-registry-match-report.mjs --apply             # link/queue a race's roster against the registry
npm run uci-rider-sync:local-smoke
```

Admin review of anything the matcher can't resolve automatically:
`/admin/uci-rider-review`, or `scripts/uci-rider-review.mjs --list|--resolve`
(the CLI cannot yet link `master_rider_id` — only the admin page and
`tdf-2026-registry-match-report.mjs --apply` do that, see
[ROADMAP.md](../project/ROADMAP.md)).

**Not calendar-scheduled.** Real workflow: run the roster-driven seed once
right before seeding a race's riders, then the match report to link/queue
that race's entries.

## 3. TDF 2026 rider importer

Standalone CLI enriching the 184-rider startlist with UCI DOB/nationality/team
history. Independent of both pipelines above.

```bash
npm run import:tdf:2026:riders:dry-run   # --write-csv, no DB writes
npm run import:tdf:2026:riders:apply     # requires SUPABASE_SERVICE_ROLE_KEY
```

Outputs land in `tmp/tdf-2026-riders*.{csv,json}` (git-tracked by convention,
except the download cache under `tmp/tdf-2026-rider-importer-cache/`, which is
gitignored).

## Circuit breaker (shared)

`createCircuitBreaker(threshold = 3)` in `scripts/source-fetch-utils.mjs` opens
after 3 consecutive 403/429s from a source and stays open for the rest of that
process's run. Wired into UCI client access; letour.fr fetches are never
gated by it (results and startlist data must never be blocked by UCI's
health).

## Safety

Every apply-mode command defaults to dry-run, requires explicit
`--confirm-*` flags, and refuses a known production Supabase URL without
`--confirm-production`. See [DECISIONS.md](../project/DECISIONS.md) #12 and
[docs/grandtour-results-feed.md](../grandtour-results-feed.md) for the
rehearsed, known-safe operator command sequences.
