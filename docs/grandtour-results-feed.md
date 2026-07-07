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

### Daily feed automation

A GitHub Actions workflow is configured to run a dry-run every day at 5:00 AM Adelaide time (ACST) using the cron schedule `30 19 * * *` UTC.

The workflow also supports manual execution via the `workflow_dispatch` event with inputs:

- `provider` (default: `manual-json`)
- `source_file` (optional)
- `report_file` (default: `grandtour-feed-dry-run.json`)

This workflow:

- checks out the repository
- installs dependencies with `npm ci`
- runs the dry-run feed review
- uploads the JSON report artifact

### Manual workflow dispatch (GitHub UI)

To run the workflow manually via the GitHub UI:

1. Go to the GitHub repository.
2. Open the Actions tab.
3. Select `GrandTour Daily Feed Dry Run`.
4. Click `Run workflow`.
5. Choose the branch to run against, typically `main`.
6. Enter values for:
   - `provider`: `manual-json`
   - `source_file`: `data/feeds/tdf-2026/sample-stage-result.json`
   - `report_file`: `grandtour-feed-dry-run.json`
7. Click `Run workflow`.
8. After completion, download the `grandtour-feed-dry-run-report` artifact.

Example manual dispatch inputs:

- `provider: manual-json`
- `source_file: data/feeds/tdf-2026/sample-stage-result.json`
- `report_file: grandtour-feed-dry-run.json`

Example GitHub CLI command:

```bash
gh workflow run "GrandTour Daily Feed Dry Run" --repo tmcstay/tipping --field provider=manual-json --field source_file=data/feeds/tdf-2026/sample-stage-result.json --field report_file=grandtour-feed-dry-run.json
```

### Running a dry run locally with a source file

```bash
npm run grandtour:feed:dry-run -- --provider manual-json --source-file data/feeds/tdf-2026/sample-stage-result.json --report C:\tmp\grandtour-feed-sample.json
```

Sample feed files live in `data/feeds/tdf-2026/`.

Expected sample report summary for `data/feeds/tdf-2026/sample-stage-result.json`:

- `summary.stageResultCandidates: 1`
- `summary.tttResultCandidates: 1`
- `summary.changedRiderStatuses: 1`
- `validationErrors: []`
- `importStatus: validated`

### Safety notes

- Scheduled workflow runs remain dry-run only.
- Manual workflow dispatch remains dry-run only.
- `apply` mode remains disabled.
- No production mutation occurs during dry-run sample testing.
- Do not add service-role credentials for dry-run sample testing unless future apply mode is explicitly designed and approved.

### Inspecting the report

To inspect the generated report, download the `grandtour-feed-dry-run-report` artifact from the workflow run in GitHub Actions. The JSON file contains the review report and validation details.

The provider foundation supports these segments:

- stage metadata
- normal rider stage results
- TTT team results
- official jersey holders
- rider status
- startlist/rider details
- team data

Future providers can be manual JSON/CSV, official/static JSON, a paid API, or a legally appropriate adapter. Every provider should retain source name, source URL, fetched time, confidence, validation errors, and an import summary before any apply step.
