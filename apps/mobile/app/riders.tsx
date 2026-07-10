import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { AppShell } from "../components/AppShell";
import { ErrorState, LoadingState } from "../components/DataState";
import { InfoCard } from "../components/InfoCard";
import { ui } from "../components/theme";
import { useAllGrandTourRiders, useTdfTeams } from "../hooks/useCyclingData";
import { useFavouriteRiderIds } from "../hooks/useGrandTourFavourites";
import { buildRiderDirectory, filterRiderDirectory, type RiderDirectoryFilter } from "../lib/riderDirectoryExperience";

const FILTERS: { key: RiderDirectoryFilter; label: string }[] = [
  { key: "all", label: "All riders" },
  { key: "favourites", label: "Favourites" }
];

export default function RiderDirectoryScreen() {
  const { race, teams } = useTdfTeams();
  const riders = useAllGrandTourRiders(race.data?.id);
  const favourites = useFavouriteRiderIds(race.data?.id);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<RiderDirectoryFilter>("all");

  const directory = useMemo(
    () => buildRiderDirectory(
      (riders.data ?? []).map((rider) => ({
        id: rider.id,
        teamId: rider.teamId,
        bibNumber: rider.bibNumber,
        displayName: rider.displayName,
        isActive: rider.isActive,
        status: rider.status
      })),
      teams.data ?? [],
      favourites.favouriteRiderIds
    ),
    [riders.data, teams.data, favourites.favouriteRiderIds]
  );
  const filtered = useMemo(
    () => filterRiderDirectory(directory, search, filter),
    [directory, search, filter]
  );

  const loading = race.loading || teams.loading || riders.loading;
  const error = race.error ?? teams.error ?? riders.error;

  return (
    <AppShell title="Rider directory" subtitle="Every rider in the race, grouped by team.">
      {loading ? <LoadingState /> : null}
      {error ? <ErrorState error={error} onRetry={riders.reload} /> : null}

      <View style={styles.controls}>
        <TextInput
          accessibilityLabel="Search riders"
          onChangeText={setSearch}
          placeholder="Search rider, team or bib"
          style={styles.search}
          value={search}
        />
        <View style={styles.filterRow}>
          {FILTERS.map((option) => (
            <Pressable
              key={option.key}
              onPress={() => setFilter(option.key)}
              style={[styles.filter, filter === option.key && styles.filterActive]}
            >
              <Text style={[styles.filterText, filter === option.key && styles.filterTextActive]}>{option.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {!loading && !error && filter === "favourites" && favourites.favouriteRiderIds.size === 0 ? (
        <InfoCard title="No favourites yet" meta="Favourites">
          <Text style={styles.copy}>No favourite riders yet. Add favourites from the rider list.</Text>
        </InfoCard>
      ) : null}

      {favourites.error ? <Text style={styles.error}>{favourites.error}</Text> : null}

      {!loading && !error && filtered.length === 0 && filter === "all" ? (
        <InfoCard title="No riders match" meta="Search">
          <Text style={styles.copy}>No riders match your search.</Text>
        </InfoCard>
      ) : null}

      {filtered.map((group) => (
        <InfoCard key={group.teamId ?? "unassigned"} title={group.teamName} meta={group.teamOrderBib ? `Team order · bib ${group.teamOrderBib}` : "Team order · unranked"}>
          {group.riders.map((rider) => (
            <View key={rider.riderId} style={styles.riderRow}>
              <View style={styles.bibBadge}>
                <Text style={styles.bibText}>{rider.bibNumber ? `#${rider.bibNumber}` : "—"}</Text>
              </View>
              <View style={styles.copyColumn}>
                <Text style={styles.riderName}>{rider.displayName}</Text>
                {!rider.isActive ? <Text style={styles.inactiveLabel}>Inactive{rider.status ? ` · ${rider.status}` : ""}</Text> : null}
              </View>
              <Pressable
                accessibilityLabel={rider.isFavourite ? `Remove ${rider.displayName} from favourites` : `Add ${rider.displayName} to favourites`}
                onPress={() => void favourites.toggle(rider.riderId)}
                style={styles.starButton}
              >
                <Text style={[styles.star, rider.isFavourite && styles.starActive]}>{rider.isFavourite ? "★" : "☆"}</Text>
              </Pressable>
            </View>
          ))}
        </InfoCard>
      ))}
    </AppShell>
  );
}

const styles = StyleSheet.create({
  bibBadge: { alignItems: "center", backgroundColor: ui.colors.primary, borderRadius: 14, justifyContent: "center", minHeight: 40, width: 48 },
  bibText: { color: "#FFFFFF", fontSize: 12, fontWeight: "900" },
  controls: { gap: 10 },
  copy: { color: ui.colors.muted, fontSize: 14, lineHeight: 20 },
  copyColumn: { flex: 1 },
  error: { color: "#A12622", fontSize: 13, fontWeight: "800" },
  filter: { backgroundColor: ui.colors.surface, borderColor: ui.colors.border, borderRadius: 999, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 9 },
  filterActive: { backgroundColor: ui.colors.primary, borderColor: ui.colors.primary },
  filterRow: { flexDirection: "row", gap: 8 },
  filterText: { color: ui.colors.muted, fontSize: 12, fontWeight: "900" },
  filterTextActive: { color: "#FFFFFF" },
  inactiveLabel: { color: "#A12622", fontSize: 11, fontWeight: "800", marginTop: 2, textTransform: "uppercase" },
  riderName: { color: ui.colors.ink, fontSize: 15, fontWeight: "900" },
  riderRow: { alignItems: "center", borderBottomColor: ui.colors.border, borderBottomWidth: 1, flexDirection: "row", gap: 10, minHeight: 56, paddingVertical: 8 },
  search: { backgroundColor: ui.colors.surface, borderColor: ui.colors.border, borderRadius: 14, borderWidth: 1, minHeight: 48, paddingHorizontal: 12 },
  star: { color: "#C9D1CB", fontSize: 26 },
  starActive: { color: "#F4C430" },
  starButton: { alignItems: "center", justifyContent: "center", minHeight: 44, minWidth: 44 }
});
