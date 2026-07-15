# letour.fr fixture HTML

These fixtures drive `scripts/grandtour-feed-provider.test.mjs`'s coverage of the
`official-letour` provider's HTML parser. They exercise the parser's markup-drift
detection without hitting the network in CI.

## Files

- `stage-successful.html` — a well-formed rankings table with three riders.
  Representative of the current known letour.fr rankings markup
  (`table.rankingTable` → `tr.rankingTables__row` → position/name/team/time
  cells). Used to assert the happy path still parses.
- `stage-changed-markup.html` — no `rankingTable`-classed element anywhere on
  the page (simulates a full redesign). Parser must report `table_not_found`.
- `stage-empty-table.html` — the table shell is present with the expected
  classes but has zero `<tr>` rows. Parser must report `empty_table`.
- `stage-row-drift.html` — the table and row wrapper classes are present and
  matched, but the inner cell classes the parser looks for
  (`rankingTables__row__position`, `rankingTables__row__profile--name`, …)
  have changed, so no fields can be extracted from a matched row. Parser must
  report `parse_empty`.
- `stage-pending-placeholder.html` — no rankings table, but a placeholder
  message consistent with "stage not finished yet". Parser must report
  `pending`, not `table_not_found` — this case is expected/benign, not drift.

`stage-successful.html` is a representative reconstruction built from the
documented letour.fr markup structure the parser targets
(`scripts/grandtour-feed-provider.mjs`), not a byte-for-byte capture of a
specific live page. Refresh it periodically against the real site so drift is
caught before it reaches the scheduled workflow.

## Refreshing `stage-successful.html` against the real site

1. Pick a stage number that has already finished (check
   `data/cycling/tdf/2026/stages_2026_tdf.csv` for a past `stage_date`).
2. Fetch the live page with the same User-Agent the provider sends
   (see `LETOUR_FETCH_USER_AGENT` in `scripts/grandtour-feed-provider.mjs`):

   ```bash
   curl -s -A "GrandTourTippingBot/1.0 (+https://github.com/tmcstay/tipping; dry-run fixture refresh)" \
     "https://www.letour.fr/en/rankings/stage-<N>" -o test/fixtures/letour/stage-successful.html
   ```

3. Trim the saved page down to the `<table class="rankingTable ...">…</table>`
   element (plus a minimal `<html>/<body>` wrapper) so the fixture stays small
   and diffable — keep at least 3 rider rows.
4. Run `node --test scripts/grandtour-feed-provider.test.mjs` and confirm the
   "successful fixture parse" test still passes with the expected rider names
   updated if they changed.
5. If the table/row/cell class names differ from what's in
   `findLetourRankingTable` / `parseLetourRankingStageRows`, that's real drift
   — update the parser (and add/update a drift fixture reproducing the old
   shape) rather than only updating the fixture.

Do not commit fixtures containing anything beyond public race-ranking data
(no cookies, tracking scripts, or session-specific markup from the captured
response).
