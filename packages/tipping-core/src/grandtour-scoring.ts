export type GrandTourJerseyType = "yellow" | "green" | "kom" | "white";
export type GrandTourScorableStatus = "draft" | "submitted" | "locked" | "scored";
export type GrandTourTopFivePosition = 1 | 2 | 3 | 4 | 5;

export type GrandTourRankedRider = {
  riderId: string;
  position: GrandTourTopFivePosition;
};

export type GrandTourRankedTeam = {
  teamId: string;
  position: GrandTourTopFivePosition;
};

export type GrandTourTttTimingRule = "team_time" | "individual_time";

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

export type GrandTourTeamTimeTrialScoreInput = {
  status: GrandTourScorableStatus;
  predictedTopFive: GrandTourRankedTeam[];
  /** Null means the official team component has not been published yet. */
  actualTopFive: GrandTourRankedTeam[] | null;
  predictedJerseys: GrandTourJerseySelections;
  /** Missing keys remain pending; they are not treated as incorrect picks. */
  actualJerseys: GrandTourJerseySelections;
  tttTimingRule: GrandTourTttTimingRule;
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

export const GRANDTOUR_TTT_SCORING = {
  exactPosition: 6,
  wrongPositionTopFive: 3,
  winningTeamBonus: 4,
  jersey: 5
} as const;

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

function validateTeamTopFive(teams: GrandTourRankedTeam[], label: string): void {
  if (teams.length !== 5) {
    throw new Error(`${label} must contain exactly five teams.`);
  }

  const positions = new Set(teams.map(({ position }) => position));
  const teamIds = new Set(teams.map(({ teamId }) => teamId));
  if (positions.size !== 5 || ![1, 2, 3, 4, 5].every((position) => positions.has(position as GrandTourTopFivePosition))) {
    throw new Error(`${label} must contain positions 1 through 5 exactly once.`);
  }
  if (teamIds.size !== 5) {
    throw new Error(`${label} cannot contain duplicate teams.`);
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

function scoreJerseys(
  predictedJerseys: GrandTourJerseySelections,
  actualJerseys: GrandTourJerseySelections,
  activeJerseys: readonly GrandTourJerseyType[],
  pointsPerJersey: number
) {
  return activeJerseys.map((jersey) => {
    const predictedRiderId = predictedJerseys[jersey] ?? null;
    const actualRiderId = actualJerseys[jersey] ?? null;
    return {
      jersey,
      predictedRiderId,
      actualRiderId,
      points: predictedRiderId !== null && predictedRiderId === actualRiderId ? pointsPerJersey : 0
    };
  });
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

  const jerseys = scoreJerseys(input.predictedJerseys, input.actualJerseys, activeJerseys, 5);

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

export function scoreGrandTourTeamTimeTrialTip(input: GrandTourTeamTimeTrialScoreInput) {
  const activeJerseys = input.activeJerseys ?? [...GRANDTOUR_JERSEYS];
  const eligible = isScorable(input.status);

  if (!eligible) {
    return {
      eligible: false,
      stageResultType: "team",
      tttTimingRule: input.tttTimingRule,
      teamResultPending: input.actualTopFive === null,
      jerseyPending: activeJerseys.some((jersey) => !input.actualJerseys[jersey]),
      topFiveScore: 0,
      winningTeamBonus: 0,
      teamStageScore: 0,
      jerseyScore: 0,
      totalScore: 0,
      officialYellowHolderRiderId: input.actualJerseys.yellow ?? null,
      topFive: [],
      jerseys: []
    } as const;
  }

  validateTeamTopFive(input.predictedTopFive, "Predicted TTT top five");
  if (input.actualTopFive !== null) {
    validateTeamTopFive(input.actualTopFive, "Official TTT top five");
  }

  const actualByTeam = new Map(
    (input.actualTopFive ?? []).map(({ teamId, position }) => [teamId, position])
  );
  const topFive = [...input.predictedTopFive]
    .sort((left, right) => left.position - right.position)
    .map(({ teamId, position }) => {
      const actualPosition = actualByTeam.get(teamId) ?? null;
      const points = input.actualTopFive === null
        ? null
        : actualPosition === position
          ? GRANDTOUR_TTT_SCORING.exactPosition
          : actualPosition === null
            ? 0
            : GRANDTOUR_TTT_SCORING.wrongPositionTopFive;
      return { teamId, predictedPosition: position, actualPosition, points };
    });

  const predictedWinner = input.predictedTopFive.find(({ position }) => position === 1)?.teamId;
  const actualWinner = input.actualTopFive?.find(({ position }) => position === 1)?.teamId;
  const winningTeamBonus = predictedWinner && predictedWinner === actualWinner
    ? GRANDTOUR_TTT_SCORING.winningTeamBonus
    : 0;

  const jerseys = activeJerseys.map((jersey) => {
    const predictedRiderId = input.predictedJerseys[jersey] ?? null;
    const actualRiderId = input.actualJerseys[jersey] ?? null;
    return {
      jersey,
      predictedRiderId,
      actualRiderId,
      pending: actualRiderId === null,
      points: actualRiderId === null
        ? null
        : predictedRiderId === actualRiderId
          ? GRANDTOUR_TTT_SCORING.jersey
          : 0
    };
  });

  const topFiveScore = topFive.reduce(
    (total, selection) => total + (selection.points ?? 0),
    0
  );
  const jerseyScore = jerseys.reduce(
    (total, selection) => total + (selection.points ?? 0),
    0
  );
  const teamStageScore = topFiveScore + winningTeamBonus;

  return {
    eligible: true,
    stageResultType: "team",
    tttTimingRule: input.tttTimingRule,
    teamResultPending: input.actualTopFive === null,
    jerseyPending: jerseys.some(({ pending }) => pending),
    topFiveScore,
    winningTeamBonus,
    teamStageScore,
    jerseyScore,
    totalScore: teamStageScore + jerseyScore,
    officialYellowHolderRiderId: input.actualJerseys.yellow ?? null,
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
