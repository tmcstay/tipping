import type { GrandTourJerseyType } from "@tipping-suite/tipping-core";

/**
 * Pure view-model builders for the user-facing GrandTour results/history
 * screen: per-stage Top 5 comparison rows, jersey comparison rows, and
 * sort ordering. Never scores anything itself - points are read from the
 * already-computed public.grandtour_stage_scores.score_details (written by
 * public.recalculate_grandtour_stage_scores) whenever a score exists, so
 * this never duplicates or risks drifting from the real scoring function.
 *
 * `buildScoreExplanationLines` below takes the real scoring constants
 * (EXACT_POSITION_POINTS etc.) as parameters rather than importing them
 * from @tipping-suite/tipping-core directly - the caller (GrandTourScoreExplanation)
 * imports the real values and passes them in. This file only ever imports
 * *types* from workspace packages, matching every other apps/mobile/lib/*Experience.ts
 * file - the ad hoc `tsc ... && node --test` pipeline these files are
 * compiled/run through (see apps/mobile/package.json's test:ui) resolves
 * cross-package runtime `require`s incorrectly for a loose multi-entry
 * commonjs build like this one, so a real (non-type) cross-package import
 * would break at test time even though the real Metro-bundled app would
 * have resolved it fine.
 */

export type OfficialResultRiderRow = {
  position: number;
  riderId: string;
  riderName: string;
  bibNumber: number | null;
  teamName: string | null;
};

/**
 * Flattens a CyclingStageResult's riderResults into a plain, position-sorted
 * list for the "Official Top 10" section and for Top 5 comparison lookups.
 * Never more than the stored top-10 lines - no join multiplication risk,
 * since riderResults is already one row per (stage_result, rider).
 */
export function buildOfficialTopTenRows(
  officialResult: { riderResults: { actual_position: number; rider: { id: string; display_name: string; bib_number: number | null; team: { name: string } | null } }[] } | null
): OfficialResultRiderRow[] {
  if (!officialResult) return [];
  return [...officialResult.riderResults]
    .sort((a, b) => a.actual_position - b.actual_position)
    .map((row) => ({
      position: row.actual_position,
      riderId: row.rider.id,
      riderName: row.rider.display_name,
      bibNumber: row.rider.bib_number,
      teamName: row.rider.team?.name ?? null
    }));
}

export type TopFiveMatchType = "exact" | "top5-wrong-position" | "miss" | "not-picked";

export type TopFiveRowDetail = {
  predictedPosition: number;
  predictedRiderId: string | null;
  predictedRiderName: string | null;
  predictedBibNumber: number | null;
  predictedTeamName: string | null;
  /** The predicted rider's own actual finishing position, or null if not found in the stored top-10 result lines. */
  actualPosition: number | null;
  /** The rider who officially finished at the PREDICTED position (a different concept from actualPosition above). */
  officialRiderId: string | null;
  officialRiderName: string | null;
  /** null = not yet scored (pending), never a misleading 0. */
  points: number | null;
  matchType: TopFiveMatchType;
};

export type RiderLookupEntry = { name: string; bibNumber: number | null; teamName: string | null };

/**
 * Builds all 5 predicted-position rows (always exactly 5, positions 1-5,
 * even if the user only picked some of them) comparing the user's Top 5
 * pick against the official result. Prefers `scoreTopFive` (the tip's
 * already-computed grandtour_stage_scores.score_details.top_five, if the
 * tip has been scored) for `points`/`actualPosition`, since that's the
 * authoritative server-computed value; falls back to deriving actualPosition/
 * matchType from `officialRows` (with points left null/pending) when the
 * tip hasn't been scored yet.
 */
export function buildTopFiveRowDetails({
  predictedSelections,
  officialRows,
  scoreTopFive,
  riderLookup
}: {
  predictedSelections: { position: number; riderId: string | null }[];
  officialRows: OfficialResultRiderRow[];
  scoreTopFive: { predicted_position: number; rider_id?: string | null; actual_position: number | null; points: number | null }[] | null;
  riderLookup: (riderId: string) => RiderLookupEntry | null;
}): TopFiveRowDetail[] {
  const officialByPosition = new Map(officialRows.map((row) => [row.position, row]));
  const officialByRiderId = new Map(officialRows.map((row) => [row.riderId, row.position]));
  const scoreByPosition = new Map((scoreTopFive ?? []).map((row) => [row.predicted_position, row]));

  const rows: TopFiveRowDetail[] = [];
  for (let position = 1; position <= 5; position += 1) {
    const predicted = predictedSelections.find((entry) => entry.position === position) ?? null;
    const predictedRiderId = predicted?.riderId ?? null;
    const predictedInfo = predictedRiderId ? riderLookup(predictedRiderId) : null;
    const officialAtPosition = officialByPosition.get(position) ?? null;
    const scoreRow = scoreByPosition.get(position) ?? null;

    if (!predictedRiderId) {
      rows.push({
        predictedPosition: position,
        predictedRiderId: null,
        predictedRiderName: null,
        predictedBibNumber: null,
        predictedTeamName: null,
        actualPosition: null,
        officialRiderId: officialAtPosition?.riderId ?? null,
        officialRiderName: officialAtPosition?.riderName ?? null,
        points: null,
        matchType: "not-picked"
      });
      continue;
    }

    const actualPosition = scoreRow ? scoreRow.actual_position : officialByRiderId.get(predictedRiderId) ?? null;
    const points = scoreRow ? scoreRow.points : null;

    let matchType: TopFiveMatchType;
    if (actualPosition === position) matchType = "exact";
    else if (actualPosition !== null && actualPosition <= 5) matchType = "top5-wrong-position";
    else matchType = "miss";

    rows.push({
      predictedPosition: position,
      predictedRiderId,
      predictedRiderName: predictedInfo?.name ?? "Unknown rider",
      predictedBibNumber: predictedInfo?.bibNumber ?? null,
      predictedTeamName: predictedInfo?.teamName ?? null,
      actualPosition,
      officialRiderId: officialAtPosition?.riderId ?? null,
      officialRiderName: officialAtPosition?.riderName ?? null,
      points,
      matchType
    });
  }
  return rows;
}

/** Sum of only the known (non-null) points across the 5 rows - never treats a pending row as zero. */
export function sumTopFivePoints(rows: TopFiveRowDetail[]): number | null {
  if (rows.some((row) => row.points === null && row.predictedRiderId !== null)) return null;
  return rows.reduce((total, row) => total + (row.points ?? 0), 0);
}

export type JerseyMatchType = "match" | "miss" | "not-picked" | "pending";

export type JerseyRowDetail = {
  jerseyType: GrandTourJerseyType;
  predictedRiderId: string | null;
  predictedRiderName: string | null;
  actualRiderId: string | null;
  actualRiderName: string | null;
  points: number | null;
  matchType: JerseyMatchType;
};

const JERSEY_ORDER: GrandTourJerseyType[] = ["yellow", "green", "kom", "white"];

/**
 * Builds all 4 jersey rows (yellow/green/kom/white, always in this order).
 * Same score_details-first preference as buildTopFiveRowDetails.
 */
export function buildJerseyRowDetails({
  predictedJerseys,
  officialJerseys,
  scoreJerseys,
  riderLookup
}: {
  predictedJerseys: { jerseyType: GrandTourJerseyType; riderId: string | null }[];
  officialJerseys: { jerseyType: GrandTourJerseyType; riderId: string }[];
  scoreJerseys: { selection_type?: string; predicted_rider_id?: string | null; actual_rider_id?: string | null; pending?: boolean; points: number | null }[] | null;
  riderLookup: (riderId: string) => RiderLookupEntry | null;
}): JerseyRowDetail[] {
  const predictedByType = new Map(predictedJerseys.map((entry) => [entry.jerseyType, entry.riderId]));
  const officialByType = new Map(officialJerseys.map((entry) => [entry.jerseyType, entry.riderId]));
  const scoreByType = new Map(
    (scoreJerseys ?? [])
      .map((row) => {
        const jerseyType = jerseySelectionToType(row.selection_type);
        return jerseyType ? ([jerseyType, row] as const) : null;
      })
      .filter((entry): entry is readonly [GrandTourJerseyType, NonNullable<typeof scoreJerseys>[number]] => entry !== null)
  );

  return JERSEY_ORDER.map((jerseyType) => {
    const predictedRiderId = predictedByType.get(jerseyType) ?? null;
    const actualRiderId = officialByType.get(jerseyType) ?? null;
    const scoreRow = scoreByType.get(jerseyType) ?? null;
    const predictedInfo = predictedRiderId ? riderLookup(predictedRiderId) : null;
    const actualInfo = actualRiderId ? riderLookup(actualRiderId) : null;

    const points = scoreRow ? scoreRow.points : null;
    let matchType: JerseyMatchType;
    if (!predictedRiderId) matchType = "not-picked";
    else if (scoreRow ? scoreRow.pending === true : !actualRiderId) matchType = "pending";
    else if (predictedRiderId === actualRiderId) matchType = "match";
    else matchType = "miss";

    return {
      jerseyType,
      predictedRiderId,
      predictedRiderName: predictedInfo?.name ?? null,
      actualRiderId,
      actualRiderName: actualInfo?.name ?? null,
      points,
      matchType
    };
  });
}

function jerseySelectionToType(selectionType: string | undefined | null): GrandTourJerseyType | null {
  switch (selectionType) {
    case "yellow_holder": return "yellow";
    case "green_holder": return "green";
    case "kom_holder": return "kom";
    case "white_holder": return "white";
    default: return null;
  }
}

export function sumJerseyPoints(rows: JerseyRowDetail[]): number | null {
  if (rows.some((row) => row.matchType === "pending")) return null;
  return rows.reduce((total, row) => total + (row.points ?? 0), 0);
}

export type StageSortMode = "newest" | "oldest" | "highest-score";

export const STAGE_SORT_OPTIONS: { key: StageSortMode; label: string }[] = [
  { key: "newest", label: "Newest first" },
  { key: "oldest", label: "Oldest first" },
  { key: "highest-score", label: "Highest score" }
];

/**
 * Sorts stage rows for the history list. "newest" (the default) sorts by
 * stage number descending - the most recently completed/upcoming stage
 * first. Ties (e.g. equal scores) fall back to stage number so ordering
 * stays deterministic. Pure/stable - never mutates the input array, and
 * never changes which stages are expanded (that's local component state
 * keyed by stage id, untouched by reordering).
 */
export function sortStageRows<T extends { stageNumber: number; totalScore: number | null }>(
  rows: T[],
  mode: StageSortMode
): T[] {
  const sorted = [...rows];
  switch (mode) {
    case "oldest":
      return sorted.sort((a, b) => a.stageNumber - b.stageNumber);
    case "highest-score":
      return sorted.sort((a, b) => (b.totalScore ?? -Infinity) - (a.totalScore ?? -Infinity) || b.stageNumber - a.stageNumber);
    case "newest":
    default:
      return sorted.sort((a, b) => b.stageNumber - a.stageNumber);
  }
}

/**
 * Static reference text for "How this score was calculated". Takes the
 * real scoring constants as parameters (see the file-level doc comment
 * for why) - the caller passes in @tipping-suite/tipping-core's exported
 * EXACT_POSITION_POINTS/TOP_FIVE_WRONG_POSITION_POINTS/STAGE_JERSEY_POINTS
 * directly, so these lines can never drift from the real scoring function.
 */
export function buildScoreExplanationLines(constants: {
  exactPositionPoints: Record<1 | 2 | 3 | 4 | 5, number>;
  topFiveWrongPositionPoints: number;
  stageJerseyPoints: number;
}): string[] {
  const positions = ([1, 2, 3, 4, 5] as const)
    .map((position) => `${formatOrdinalShort(position)} = ${constants.exactPositionPoints[position]} pts`)
    .join(", ");
  return [
    `Exact position in the Top 5: ${positions}.`,
    `Rider finished in the actual Top 5 but at a different position: ${constants.topFiveWrongPositionPoints} pt.`,
    "Rider finished outside the actual Top 5 (or not in the result): 0 pts.",
    `Correct stage jersey holder: ${constants.stageJerseyPoints} pts per jersey.`
  ];
}

function formatOrdinalShort(value: number): string {
  const suffix = value === 1 ? "st" : value === 2 ? "nd" : value === 3 ? "rd" : "th";
  return `${value}${suffix}`;
}
