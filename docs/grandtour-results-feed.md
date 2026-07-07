# GrandTour results and feed operations

Jersey competition is parked for user entry for now. Official jersey holders may still be imported, entered, displayed on dashboards/results, and used by historical scoring data, but normal users only tip the stage-result top five.

## Tip entry

- Normal and ITT stages: users pick the top 5 riders for the stage result.
- TTT stages: users pick the top 5 teams for the stage result.
- Jersey pick UI and validation are hidden from normal user tip entry.
- Missing user jersey picks are not backfilled or inferred; they score zero/skipped.

## Rider picker

The rider selector is a fullscreen mobile-first modal. It supports:

- search by rider name, team name/code, or bib number;
- filtering by rider speciality;
- team-grouped display;
- bib-number ordering within each team;
- disabled rows for inactive statuses such as DNS, DNF, OTL, withdrawn, suspended, and excluded.

## Rider withdrawals/status

Supported rider/startlist statuses include active/provisional/confirmed plus DNS, DNF, OTL, withdrawn, suspended, excluded, reserve, and unknown where applicable.

Inactive statuses should disable future-stage selection. Already locked historical tips are not automatically changed; replacement rules require a separate visible product rule.

## Manual feed workflow

No production cron is configured.

Initial commands:

```bash
npm run grandtour:feed:dry-run
npm run grandtour:feed:apply
```

`dry-run` writes a review report and does not mutate database tables. `apply` is currently guarded: it validates and writes the review report, then stops before mutation until an approved provider/source is selected.

The provider foundation supports these segments:

- stage metadata
- normal rider stage results
- TTT team results
- official jersey holders
- rider status
- startlist/rider details
- team data

Future providers can be manual JSON/CSV, official/static JSON, a paid API, or a legally appropriate adapter. Every provider should retain source name, source URL, fetched time, confidence, validation errors, and an import summary before any apply step.
