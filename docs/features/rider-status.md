# Rider Status (DNS / DNF / withdrawals)

## Purpose
Represent a rider's non-finishing or non-participating state (did not start,
did not finish, outside time limit, suspended, excluded) so tip entry and
results screens can react to it correctly.

## Confirmed rules
- `grandtour_riders.status`/`status_changed_at`/`status_reason` — rider-level
  status, independent of any one stage.
- `grandtour_stage_startlists.status` enum: `provisional`, `confirmed`,
  `withdrawn`, `reserve`, `dns`, `dnf`, `otl`, `suspended`, `excluded`,
  `unknown` — per-stage, per-rider status.
- letour.fr's public rider list page has **no rider-status field at all**
  (confirmed by inspecting a real cached fetch) — the TDF 2026 importer
  always writes `status: null` from that source; merge rules never let that
  overwrite an existing status.

## User experience
Not confirmed end-to-end — see Outstanding work.

## Data model
See rules above. Status lives on both the rider (tour-wide) and the
per-stage startlist row (per-stage) — a rider can be `confirmed` overall but
`dnf` from a specific stage onward.

## Relevant source files
- `scripts/tdf-2026-rider-importer.mjs` / `scripts/tdf-2026-rider-match.mjs` —
  status merge rules on import.

## Relevant migrations
Startlist/rider status enums are part of the original GrandTour schema
migrations.

## Current implementation
The data model fully supports rider status at both levels. No dedicated
audit exists confirming the rider tip picker actually filters out or labels
`dns`/`dnf`/`withdrawn`/`excluded` riders, or that results screens present a
DNF rider distinctly from a rider who simply wasn't in the top ten.

## Outstanding work
- **End-to-end UX audit**: does the tip picker exclude or clearly label a
  DNS/DNF rider? Does the results screen distinguish "rider DNF'd this
  stage" from "rider finished outside the top ten"? Not confirmed either way
  — treat as unverified, not as broken. See [ROADMAP.md](../project/ROADMAP.md).

## Edge cases
- A rider can transition status mid-tour (e.g. `confirmed` → `dnf` after a
  crash) — `status_changed_at`/`status_reason` exist to record this, but
  whether the tip picker reacts live to a status change made mid-stage
  hasn't been audited.

## Acceptance criteria
Not yet defined pending the outstanding audit above.

## Tests
None specific to end-to-end rider-status UX found; import-time merge-rule
tests exist in `scripts/tdf-2026-rider-match.test.mjs`.
