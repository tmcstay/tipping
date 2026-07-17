/**
 * Deliberately kept in its own file with zero local imports (unlike
 * uciRiderAdmin.ts, which imports ./client and therefore can't be loaded
 * directly by plain `node --test` -- Node's ESM resolver requires an
 * explicit extension on relative specifiers, but every other production
 * file in this package (client.ts, auth.ts, grandtourAdmin.ts, ...)
 * deliberately omits it for tsc/bundler compatibility across the apps that
 * consume this package via "@tipping-suite/supabase-client". A file with no
 * local imports at all sidesteps that conflict entirely, so its logic stays
 * directly unit-testable via `node --test src/*.test.ts` the same way
 * authRedirect.ts already is.
 */

/**
 * Removes duplicate ids while preserving first-seen order, dropping any
 * null/undefined/empty entries. Pure - no I/O. Guards
 * getUciRidersByIds/getGrandTourRidersByIds (uciRiderAdmin.ts) against
 * issuing a `.in(...)` filter with repeated values (harmless to Postgres,
 * but a needless inflation of the query when several review-queue items
 * reference the same candidate/source rider).
 */
export function dedupeIds(ids: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}
