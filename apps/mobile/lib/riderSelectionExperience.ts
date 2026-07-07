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

export function groupSelectableRiders(
  riders: CyclingStartlistRider[],
  search: string,
  filter: RiderSpecialityFilter
) {
  const filtered = riders
    .filter((entry) => searchRiderEntry(entry, search))
    .filter((entry) => riderMatchesSpeciality(entry, filter));
  const grouped = new Map<string, CyclingStartlistRider[]>();
  for (const entry of filtered) {
    const teamName = entry.team?.name ?? "Team TBC";
    grouped.set(teamName, [...(grouped.get(teamName) ?? []), entry]);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([teamName, entries]) => ({
      teamName,
      entries: entries.sort((left, right) => {
        const leftBib = preferStageBibNumber(left.bib_number, left.rider.bib_number) ?? Number.MAX_SAFE_INTEGER;
        const rightBib = preferStageBibNumber(right.bib_number, right.rider.bib_number) ?? Number.MAX_SAFE_INTEGER;
        return leftBib - rightBib || left.rider.display_name.localeCompare(right.rider.display_name);
      })
    }));
}
