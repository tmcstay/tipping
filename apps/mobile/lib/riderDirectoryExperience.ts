/**
 * Pure grouping/sorting/filtering logic for the standalone Rider Directory
 * screen (Part D). Team ordering rule: team_order_bib is the minimum
 * bib_number among ACTIVE riders on that team; teams sort by
 * team_order_bib ascending; a team with no active-rider bibs at all sorts
 * last, by team name. Riders within a team sort by bib_number ascending
 * (riders with no bib sort last within their team, by name).
 */

export type DirectoryRiderInput = {
  id: string;
  teamId: string | null;
  bibNumber: number | null;
  displayName: string;
  isActive: boolean;
  status: string | null;
};

export type DirectoryTeamInput = {
  id: string;
  name: string;
};

export type RiderDirectoryEntry = {
  riderId: string;
  displayName: string;
  bibNumber: number | null;
  teamId: string | null;
  teamName: string;
  isActive: boolean;
  status: string | null;
  isFavourite: boolean;
};

export type RiderDirectoryTeamGroup = {
  teamId: string | null;
  teamName: string;
  teamOrderBib: number | null;
  riders: RiderDirectoryEntry[];
};

const UNASSIGNED_TEAM_NAME = "Unassigned";

/**
 * team_order_bib per team id (or the synthetic "no team" bucket) - the
 * minimum bib_number among riders with isActive=true on that team. A team
 * with zero active, bibbed riders gets `null` (sorts last).
 */
export function computeTeamOrderBib(riders: DirectoryRiderInput[]): Map<string, number> {
  const minByTeam = new Map<string, number>();
  for (const rider of riders) {
    if (!rider.isActive || rider.bibNumber === null) continue;
    const teamKey = rider.teamId ?? "";
    const current = minByTeam.get(teamKey);
    if (current === undefined || rider.bibNumber < current) {
      minByTeam.set(teamKey, rider.bibNumber);
    }
  }
  return minByTeam;
}

function compareTeams(a: RiderDirectoryTeamGroup, b: RiderDirectoryTeamGroup): number {
  if (a.teamOrderBib === null && b.teamOrderBib === null) return a.teamName.localeCompare(b.teamName);
  if (a.teamOrderBib === null) return 1;
  if (b.teamOrderBib === null) return -1;
  return a.teamOrderBib - b.teamOrderBib;
}

function compareRiders(a: RiderDirectoryEntry, b: RiderDirectoryEntry): number {
  if (a.bibNumber === null && b.bibNumber === null) return a.displayName.localeCompare(b.displayName);
  if (a.bibNumber === null) return 1;
  if (b.bibNumber === null) return -1;
  return a.bibNumber - b.bibNumber;
}

/**
 * Groups riders by team, computes team_order_bib per team, and sorts both
 * teams (by team_order_bib ascending, no-bib teams last by name) and
 * riders within each team (by bib_number ascending, no-bib riders last by
 * name) - never alphabetical team order when bib data is available.
 */
export function buildRiderDirectory(
  riders: DirectoryRiderInput[],
  teams: DirectoryTeamInput[],
  favouriteRiderIds: ReadonlySet<string>
): RiderDirectoryTeamGroup[] {
  const teamOrderBib = computeTeamOrderBib(riders);
  const teamNameById = new Map(teams.map((team) => [team.id, team.name]));

  const groups = new Map<string, RiderDirectoryTeamGroup>();
  for (const rider of riders) {
    const teamKey = rider.teamId ?? "";
    const teamName = rider.teamId ? teamNameById.get(rider.teamId) ?? "Unknown team" : UNASSIGNED_TEAM_NAME;
    let group = groups.get(teamKey);
    if (!group) {
      group = { teamId: rider.teamId, teamName, teamOrderBib: teamOrderBib.get(teamKey) ?? null, riders: [] };
      groups.set(teamKey, group);
    }
    group.riders.push({
      riderId: rider.id,
      displayName: rider.displayName,
      bibNumber: rider.bibNumber,
      teamId: rider.teamId,
      teamName,
      isActive: rider.isActive,
      status: rider.status,
      isFavourite: favouriteRiderIds.has(rider.id)
    });
  }

  for (const group of groups.values()) {
    group.riders.sort(compareRiders);
  }

  return [...groups.values()].sort(compareTeams);
}

export type RiderDirectoryFilter = "all" | "favourites";

function riderMatchesSearch(rider: RiderDirectoryEntry, search: string): boolean {
  const query = search.trim().toLocaleLowerCase();
  if (!query) return true;
  return rider.displayName.toLocaleLowerCase().includes(query)
    || rider.teamName.toLocaleLowerCase().includes(query)
    || (rider.bibNumber !== null && String(rider.bibNumber).includes(query));
}

/**
 * Applies search text and the all/favourites filter to an already-built,
 * already-sorted directory, dropping any team group left with zero
 * matching riders. Team/rider order from buildRiderDirectory is preserved.
 */
export function filterRiderDirectory(
  groups: RiderDirectoryTeamGroup[],
  search: string,
  filter: RiderDirectoryFilter
): RiderDirectoryTeamGroup[] {
  return groups
    .map((group) => ({
      ...group,
      riders: group.riders.filter(
        (rider) => riderMatchesSearch(rider, search) && (filter === "all" || rider.isFavourite)
      )
    }))
    .filter((group) => group.riders.length > 0);
}
