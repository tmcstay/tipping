/**
 * Pure view-model helpers for the UCI rider review admin page
 * (app/admin/uci-rider-review.tsx) - no React/Supabase imports, matching
 * this repo's lib/ convention (see grandtourAdminExperience.ts). Compiled by
 * apps/mobile's test:ui tsc invocation - keep this file's own imports
 * confined to plain data shapes, never components/, per the documented
 * rootDir gotcha (CLAUDE.md's "test:ui gotcha found this session").
 */

export type UciRiderReviewQueueItemLike = {
  id: string;
  queueType: string;
  status: string;
  riderId: string | null;
  grandtourRiderId: string | null;
  candidatePayload: unknown;
  reason: string | null;
};

const QUEUE_TYPE_LABELS: Record<string, string> = {
  unmatched_startlist_rider: "Unmatched rider",
  ambiguous_candidate: "Ambiguous candidate",
  dob_conflict: "Date-of-birth conflict",
  nationality_conflict: "Nationality conflict",
  team_mismatch: "Team mismatch",
  duplicate_uci_identity: "Duplicate UCI identity",
  suspected_duplicate_internal_rider: "Suspected duplicate rider",
  low_confidence_alias_match: "Low-confidence alias match"
};

/** Human label for a uci_rider_review_queue_type value - the collapsed accordion header's badge. Falls back to the raw value (never throws/blanks) for a value this list hasn't been kept in sync with. */
export function formatQueueTypeLabel(queueType: string | null | undefined): string {
  if (!queueType) return "Unknown";
  return QUEUE_TYPE_LABELS[queueType] ?? queueType;
}

const QUEUE_STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  matched: "Matched",
  new_rider_approved: "New rider approved",
  source_correction: "Source correction",
  ignored: "Ignored",
  resolved: "Resolved"
};

/** Human label for a uci_rider_review_queue_status value. */
export function formatQueueStatusLabel(status: string | null | undefined): string {
  if (!status) return "Unknown";
  return QUEUE_STATUS_LABELS[status] ?? status;
}

/**
 * Defensive jsonb parsing: pulls every candidate uci_riders id out of a
 * review-queue item, from both the item's own `riderId` column (set when
 * exactly one scored/alias candidate was found) and any
 * `candidatePayload.evidence.candidateIds` array (set for a genuinely
 * ambiguous/multi-candidate match) - deduplicated. Never throws on an
 * unexpected shape (a malformed/missing candidatePayload degrades to "no
 * candidates from the payload", not an error) - the whole point of this
 * helper existing separately from just reading the field directly.
 */
export function extractCandidateRiderIds(item: {
  riderId?: string | null;
  candidatePayload?: unknown;
} | null | undefined): string[] {
  const ids = new Set<string>();
  if (!item) return [];

  if (typeof item.riderId === "string" && item.riderId.length > 0) {
    ids.add(item.riderId);
  }

  const payload = item.candidatePayload;
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const evidence = (payload as Record<string, unknown>).evidence;
    if (evidence && typeof evidence === "object" && !Array.isArray(evidence)) {
      const candidateIds = (evidence as Record<string, unknown>).candidateIds;
      if (Array.isArray(candidateIds)) {
        for (const candidateId of candidateIds) {
          if (typeof candidateId === "string" && candidateId.length > 0) {
            ids.add(candidateId);
          }
        }
      }
    }
  }

  return [...ids];
}

/**
 * Confirm Match is only enabled when exactly one candidate uci_riders id is
 * present - per the admin brief's own gate ("enabled only when exactly one
 * candidate is present"). Zero candidates (nothing to confirm) or more than
 * one (genuinely ambiguous - a human must pick, this UI doesn't offer a
 * picker) both disable it.
 */
export function canConfirmMatch(item: {
  riderId?: string | null;
  candidatePayload?: unknown;
} | null | undefined): boolean {
  return extractCandidateRiderIds(item).length === 1;
}

/** The confirmation-modal copy shown before Confirm Match, including an ISO timestamp the admin is implicitly attesting to at the moment of confirming - mirrors buildMarkCheckedConfirmationMessage's shape in grandtourAdminExperience.ts. */
export function buildConfirmConfirmationMessage(
  item: { id: string } | null | undefined,
  now: Date = new Date()
): string {
  const itemId = item?.id ?? "this item";
  return `I have compared the Tour entry against the candidate UCI rider and confirm this is the same person (review item ${itemId}), at ${now.toISOString()}.`;
}

/** "12 pending · 5 ambiguous candidate, 4 unmatched rider, 3 dob conflict" - the admin page's at-a-glance queue summary line. Deterministic order: queue types sorted by descending count, then alphabetically for ties. */
export function buildQueueCountsLabel(items: { queueType: string }[]): string {
  if (items.length === 0) return "Nothing pending review.";
  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(item.queueType, (counts.get(item.queueType) ?? 0) + 1);
  }
  const breakdown = [...counts.entries()]
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .map(([queueType, count]) => `${count} ${formatQueueTypeLabel(queueType).toLowerCase()}`)
    .join(", ");
  return `${items.length} pending · ${breakdown}`;
}
