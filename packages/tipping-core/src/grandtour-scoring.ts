export type GrandTourJerseyType = "yellow" | "green" | "kom" | "white";
export type GrandTourScorableStatus = "draft" | "submitted" | "locked" | "scored";
export type GrandTourTopFivePosition = 1 | 2 | 3 | 4 | 5;

export type GrandTourRankedRider = {
  riderId: string;
  position: GrandTourTopFivePosition;
};

export type GrandTourJerseySelections = Partial<Record<GrandTourJerseyType, string>>;

export type GrandTourStageScoreInput = {
  status: GrandTourScorableStatus;
  predictedTopFive: GrandTourRankedRider[];
  actualTopFive: GrandTourRankedRider[];
  predictedJerseys: GrandTourJerseySelections;
  actualJerseys: GrandTourJerseySelections;
  activeJerseys?: GrandTourJerseyType[];
};

export type GrandTourOverallJerseyScoreInput = {
  status: GrandTourScorableStatus;
  predictedJerseys: GrandTourJerseySelections;
  actualJerseys: GrandTourJerseySelections;
  activeJerseys?: GrandTourJerseyType[];
};

export const GRANDTOUR_JERSEYS: readonly GrandTourJerseyType[] = [
  "yellow",
  "green",
  "kom",
  "white"
];

const EXACT_POSITION_POINTS: Record<GrandTourTopFivePosition, number> = {
  1: 10,
  2: 8,
  3: 6,
  4: 4,
  5: 2
};

function isScorable(status: GrandTourScorableStatus): boolean {
  // `scored` remains eligible so result corrections can deterministically
  // recalculate a previously submitted or locked tip.
  return status === "submitted" || status === "locked" || status === "scored";
}

function validateTopFive(riders: GrandTourRankedRider[], label: string): void {
  if (riders.length !== 5) {
    throw new Error(`${label} must contain exactly five riders.`);
  }

  const positions = new Set(riders.map(({ position }) => position));
  const riderIds = new Set(riders.map(({ riderId }) => riderId));
  if (positions.size !== 5 || ![1, 2, 3, 4, 5].every((position) => positions.has(position as GrandTourTopFivePosition))) {
    throw new Error(`${label} must contain positions 1 through 5 exactly once.`);
  }
  if (riderIds.size !== 5) {
    throw new Error(`${label} cannot contain duplicate riders.`);
  }
}

function validateJerseys(
  selections: GrandTourJerseySelections,
  activeJerseys: readonly GrandTourJerseyType[],
  label: string
): void {
  for (const jersey of activeJerseys) {
    if (!selections[jersey]) {
      throw new Error(`${label} requires a ${jersey} jersey rider.`);
    }
  }
}

export function scoreGrandTourStageTip(input: GrandTourStageScoreInput) {
  const activeJerseys = input.activeJerseys ?? [...GRANDTOUR_JERSEYS];
  const eligible = isScorable(input.status);

  if (!eligible) {
    return {
      eligible: false,
      topFiveScore: 0,
      jerseyScore: 0,
      totalScore: 0,
      topFive: [],
      jerseys: []
    } as const;
  }

  validateTopFive(input.predictedTopFive, "Predicted top five");
  validateTopFive(input.actualTopFive, "Actual top five");
  validateJerseys(input.predictedJerseys, activeJerseys, "Stage tip");
  validateJerseys(input.actualJerseys, activeJerseys, "Stage result");

  const actualByRider = new Map(
    input.actualTopFive.map(({ riderId, position }) => [riderId, position])
  );
  const topFive = [...input.predictedTopFive]
    .sort((left, right) => left.position - right.position)
    .map(({ riderId, position }) => {
      const actualPosition = actualByRider.get(riderId) ?? null;
      const points = actualPosition === position
        ? EXACT_POSITION_POINTS[position]
        : actualPosition === null
          ? 0
          : 1;
      return { riderId, predictedPosition: position, actualPosition, points };
    });

  const jerseys = activeJerseys.map((jersey) => {
    const predictedRiderId = input.predictedJerseys[jersey] ?? null;
    const actualRiderId = input.actualJerseys[jersey] ?? null;
    return {
      jersey,
      predictedRiderId,
      actualRiderId,
      points: predictedRiderId === actualRiderId ? 5 : 0
    };
  });

  const topFiveScore = topFive.reduce((total, selection) => total + selection.points, 0);
  const jerseyScore = jerseys.reduce((total, selection) => total + selection.points, 0);
  return {
    eligible: true,
    topFiveScore,
    jerseyScore,
    totalScore: topFiveScore + jerseyScore,
    topFive,
    jerseys
  } as const;
}

export function scoreGrandTourOverallJerseys(input: GrandTourOverallJerseyScoreInput) {
  const activeJerseys = input.activeJerseys ?? [...GRANDTOUR_JERSEYS];
  const eligible = isScorable(input.status);

  if (!eligible) {
    return { eligible: false, jerseyScore: 0, totalScore: 0, jerseys: [] } as const;
  }

  validateJerseys(input.predictedJerseys, activeJerseys, "Overall jersey tip");
  validateJerseys(input.actualJerseys, activeJerseys, "Overall jersey result");

  const jerseys = activeJerseys.map((jersey) => {
    const predictedRiderId = input.predictedJerseys[jersey] ?? null;
    const actualRiderId = input.actualJerseys[jersey] ?? null;
    return {
      jersey,
      predictedRiderId,
      actualRiderId,
      points: predictedRiderId === actualRiderId ? 25 : 0
    };
  });
  const jerseyScore = jerseys.reduce((total, selection) => total + selection.points, 0);
  return { eligible: true, jerseyScore, totalScore: jerseyScore, jerseys } as const;
}
