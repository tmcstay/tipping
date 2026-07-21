# Roadmap

Unimplemented, proposed, or partially implemented work. Anything here is
**not** current behavior — check [CURRENT_STATE.md](CURRENT_STATE.md) for what
actually exists before assuming an item below is done.

Status values: `proposed` (raised, not agreed), `accepted` (agreed, not
started), `in progress` (partially built), `blocked` (needs a decision or
external input), `deferred` (explicitly set aside by the product owner).

## Product / competition rules

| Item | Status | Notes |
|---|---|---|
| Three-period jersey competition (a rule variant beyond the current daily+final jersey scoring) | proposed | Not found anywhere in code or docs as a defined rule; raised only in this task's own brief. Needs a product decision before design. |
| Rest-day jersey deadlines | proposed | No rest-day concept exists in the schema (`grand_tours`/`grandtour_stages` have no rest-day flag). Needs a product decision. |
| Young-rider (white jersey) eligibility enforced in tip entry | in progress | The cutoff-date rule (`youngRiderEligibilityCutoffDate`) is implemented and tested in the TDF 2026 importer's specialty module, but nothing in the stage tip-entry UI stops a user picking an ineligible rider for white jersey. |
| DNS/DNF exclusion from tip-entry pickers | in progress | `grandtour_riders.status`/`grandtour_stage_startlists.status` already model `dns`/`dnf`/`otl`/`suspended`/`excluded`. No confirmed audit exists of whether the rider picker and results screens correctly filter/label these states end-to-end. |

## User experience

| Item | Status | Notes |
|---|---|---|
| User tip detail views | accepted (mostly done) | My Tips (`/my-tips`) already shows per-stage accordions with top-five and jersey comparisons, official top ten, and a score explanation. Verify this satisfies the brief's intent before treating it as a gap. |
| Stage result explanation | done | `GrandTourScoreExplanation` component, sourced from `tipping-core`'s exported point constants. |
| Admin stage review improvements | in progress | Core workflow (apply/check/finalise/score, correction, notification counts) is built; retry-from-UI for failed notification jobs and a UCI-sync trigger button are both explicitly deferred. |
| Profile and sign-up defects | mostly resolved | The `[object Object]` error-message bug and the `profiles` grant bug were both investigated and fixed/found-not-reproducible in past sessions. Re-verify current behavior before assuming closed. |
| Official naming consistency | in progress | `formatGrandTourName` (mobile) and its Deno twin are consistent; `raceAccent.ts`'s classifier is a third, independent implementation — disclosed drift risk, not yet unified. |
| Remaining mobile parity (native iOS/Android vs. web) | unknown | Most verification work documented in code history was done via headless-browser (web) testing. No equivalent native-device verification log exists for the recent UI passes. |
| Automated race and stage data updates | done | The full apply/check/finalise/score/notify chain now runs unattended daily; see [official-data-import.md](../features/official-data-import.md). |

## Data / integration

| Item | Status | Notes |
|---|---|---|
| UCI registry data sync to production | deferred | Schema is live; the actual `--seed-from-roster --apply --confirm-production` run has not been authorized yet. |
| UCI-sync trigger from the admin UI | deferred | Execution model (GitHub Actions dispatch vs. a new job queue) and race scope (TDF-only vs. also stubbing Giro/Vuelta) are both open questions, explicitly set aside by the product owner. |
| Manual result entry (admin hand-enters a result when the feed fails) | blocked | The enabling flag/RPC exist; no entry RPC or UI was ever built. Full contract documented in `docs/GRANDTOUR_APPLY_MODE_PRODUCTION_READINESS_CHECKLIST.md` §14.5. |
| "Unfinalise" RPC | blocked | No RPC exists to reopen a finalised result; `'unfinalised'` is reserved in the audit-log action enum but unused. |
| Persist automated dry-run findings into the app | proposed | Recommended fix (a `grandtour_stage_automated_checks` table) was scoped but explicitly not built — bigger change than was in scope for the session that raised it. |
| Prevent duplicate stage-results emails on a no-op rescore | proposed | Current behavior (documented in [CURRENT_STATE.md](CURRENT_STATE.md)) always re-notifies on any rescore. A "only bump generation when a participant's own score changed" refinement was suggested, not built. |
| CLI parity for UCI review resolution | proposed | `scripts/uci-rider-review.mjs --resolve` should gain a `confirm_grandtour_rider_master_link`-calling path to match the admin page. |
| SMTP/`ADMIN_EMAIL` secrets for dry-run notification workflow | blocked | Documented as required in `docs/GRANDTOUR_APPLY_MODE_PRODUCTION_READINESS_CHECKLIST.md` §17.9; not confirmed set as of the last review. |
| Systematic RLS/grant audit | proposed | The `authenticated`-grant gap has recurred on at least three unrelated tables. A one-time audit of every RLS-bearing table's grants (not just RLS policies) would likely surface more of the same class of bug before it recurs a fourth time. |

## Out of scope (feature-flagged, deliberately disabled)

Ads, subscriptions, chat, prizes, dummy/demo activity — flags exist, all
disabled. Do not enable without an explicit product decision.
