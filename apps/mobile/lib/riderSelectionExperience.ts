import type { CyclingStartlistRider } from "@tipping-suite/supabase-client";

import { preferStageBibNumber } from "./formatters";

export type RiderSpecialityFilter =
  | "all"
  | "gc"
  | "sprint"
  | "mountain"
  | "time_trial"
  | "classics"
  | "all_rounder"
  | "domestique";

export const RIDER_SPECIALITY_FILTERS: { key: RiderSpecialityFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "gc", label: "GC" },
  { key: "sprint", label: "Sprint" },
  { key: "mountain", label: "Mountain" },
  { key: "time_trial", label: "Time Trial" },
  { key: "classics", label: "Classics / All-rounder" },
  { key: "domestique", label: "Domestique" }
];

const inactiveStatuses = new Set(["dns", "dnf", "otl", "withdrawn", "suspended", "excluded"]);

const specialityAliases: Record<string, RiderSpecialityFilter[]> = {
  all_rounder: ["all_rounder", "classics"],
  classics: ["classics", "all_rounder"],
  climber: ["mountain"],
  gc: ["gc"],
  leadout: ["sprint"],
  mountain: ["mountain"],
  puncheur: ["classics"],
  sprinter: ["sprint"],
  sprint: ["sprint"],
  time_trial: ["time_trial"],
  tt: ["time_trial"],
  domestique: ["domestique"]
};

export function isSelectableRiderStatus(status: string | null | undefined) {
  return !inactiveStatuses.has((status ?? "").toLocaleLowerCase());
}

export function riderMatchesSpeciality(
  entry: Pick<CyclingStartlistRider, "rider_role" | "rider">,
  filter: RiderSpecialityFilter
) {
  if (filter === "all") return true;
  const values = [
    entry.rider_role,
    entry.rider.rider_type,
    ...(entry.rider.specialities ?? [])
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLocaleLowerCase().replaceAll("-", "_").replaceAll(" ", "_"));
  return values.some((value) => (specialityAliases[value] ?? [value]).includes(filter));
}

export function searchRiderEntry(entry: CyclingStartlistRider, search: string) {
  const query = search.trim().toLocaleLowerCase();
  if (!query) return true;
  const bib = preferStageBibNumber(entry.bib_number, entry.rider.bib_number);
  return entry.rider.display_name.toLocaleLowerCase().includes(query)
    || (entry.team?.name ?? "").toLocaleLowerCase().includes(query)
    || (entry.team?.code ?? "").toLocaleLowerCase().includes(query)
    || (bib !== null && String(bib).includes(query));
}

/**
 * team_order_bib per team name: the minimum bib among *selectable*
 * (active) entries on that team. Computed from the full, unfiltered
 * `riders` list passed to groupSelectableRiders, so a search/speciality
 * filter never reshuffles team order - it only changes which
 * teams/riders are visible. A team with no selectable-active bib at all
 * gets no entry here (sorts last, by team name) - never alphabetical
 * ordering when bib data is available.
 */
function computeStartlistTeamOrderBib(riders: CyclingStartlistRider[]): Map<string, number> {
  const minByTeam = new Map<string, number>();
  for (const entry of riders) {
    if (!isSelectableRiderStatus(entry.status)) continue;
    const bib = preferStageBibNumber(entry.bib_number, entry.rider.bib_number);
    if (bib === null) continue;
    const teamName = entry.team?.name ?? "Team TBC";
    const current = minByTeam.get(teamName);
    if (current === undefined || bib < current) minByTeam.set(teamName, bib);
  }
  return minByTeam;
}

export function groupSelectableRiders(
  riders: CyclingStartlistRider[],
  search: string,
  filter: RiderSpecialityFilter
) {
  const teamOrderBib = computeStartlistTeamOrderBib(riders);
  const filtered = riders
    .filter((entry) => searchRiderEntry(entry, search))
    .filter((entry) => riderMatchesSpeciality(entry, filter));
  const grouped = new Map<string, CyclingStartlistRider[]>();
  for (const entry of filtered) {
    const teamName = entry.team?.name ?? "Team TBC";
    grouped.set(teamName, [...(grouped.get(teamName) ?? []), entry]);
  }
  return [...grouped.entries()]
    .sort(([leftName], [rightName]) => {
      const leftBib = teamOrderBib.get(leftName);
      const rightBib = teamOrderBib.get(rightName);
      if (leftBib === undefined && rightBib === undefined) return leftName.localeCompare(rightName);
      if (leftBib === undefined) return 1;
      if (rightBib === undefined) return -1;
      return leftBib - rightBib;
    })
    .map(([teamName, entries]) => ({
      teamName,
      entries: entries.sort((left, right) => {
        const leftBib = preferStageBibNumber(left.bib_number, left.rider.bib_number) ?? Number.MAX_SAFE_INTEGER;
        const rightBib = preferStageBibNumber(right.bib_number, right.rider.bib_number) ?? Number.MAX_SAFE_INTEGER;
        return leftBib - rightBib || left.rider.display_name.localeCompare(right.rider.display_name);
      })
    }));
}

export type RiderSelectionTab = "all" | "teams" | "favourites";

export const RIDER_SELECTION_TABS: { key: RiderSelectionTab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "teams", label: "Teams" },
  { key: "favourites", label: "Favourites" }
];

function sortRidersByBib(riders: CyclingStartlistRider[]): CyclingStartlistRider[] {
  return [...riders].sort((left, right) => {
    const leftBib = preferStageBibNumber(left.bib_number, left.rider.bib_number) ?? Number.MAX_SAFE_INTEGER;
    const rightBib = preferStageBibNumber(right.bib_number, right.rider.bib_number) ?? Number.MAX_SAFE_INTEGER;
    return leftBib - rightBib || left.rider.display_name.localeCompare(right.rider.display_name);
  });
}

export type RiderSelectionTabResult =
  | { mode: "flat"; riders: CyclingStartlistRider[] }
  | { mode: "grouped"; groups: ReturnType<typeof groupSelectableRiders> };

/**
 * Resolves what a rider-selection picker should render for the active tab:
 * "teams" groups by team (min-bib order, as above); "all" and
 * "favourites" are flat lists sorted by bib ascending - the fastest scan
 * for a well-known bib, and specifically requested for favourites ("fast
 * to select with minimal scrolling"). "favourites" is pre-filtered to only
 * the caller's favourite rider ids *before* search/speciality filtering,
 * so an empty result here means "no favourites match", not "no favourites
 * exist at all" (the caller distinguishes those two cases itself from the
 * favourite id set's own size).
 */
export function selectRidersForTab(
  riders: CyclingStartlistRider[],
  tab: RiderSelectionTab,
  search: string,
  filter: RiderSpecialityFilter,
  favouriteRiderIds: ReadonlySet<string>
): RiderSelectionTabResult {
  const base = tab === "favourites"
    ? riders.filter((entry) => favouriteRiderIds.has(entry.rider.id))
    : riders;

  if (tab === "teams") {
    return { mode: "grouped", groups: groupSelectableRiders(base, search, filter) };
  }

  const filtered = base
    .filter((entry) => searchRiderEntry(entry, search))
    .filter((entry) => riderMatchesSpeciality(entry, filter));
  return { mode: "flat", riders: sortRidersByBib(filtered) };
}
