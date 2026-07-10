import { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { CyclingStartlistRider } from "@tipping-suite/supabase-client";

import { formatRiderDisplayName, preferStageBibNumber } from "../lib/formatters";
import {
  isSelectableRiderStatus,
  RIDER_SELECTION_TABS,
  RIDER_SPECIALITY_FILTERS,
  selectRidersForTab,
  type RiderSelectionTab,
  type RiderSpecialityFilter
} from "../lib/riderSelectionExperience";

type Props = {
  excludedRiderIds?: string[];
  favouriteRiderIds?: ReadonlySet<string>;
  riders: CyclingStartlistRider[];
  stageContext?: string;
  title: string;
  visible?: boolean;
  onClose?: () => void;
  onSelect: (riderId: string) => void;
};

function statusLabel(status: string) {
  const value = status.toLocaleLowerCase();
  if (value === "provisional" || value === "confirmed") return null;
  return value.toUpperCase();
}

export function RiderSelectionPanel({
  excludedRiderIds = [],
  favouriteRiderIds = new Set(),
  riders,
  stageContext,
  title,
  visible = true,
  onClose,
  onSelect
}: Props) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<RiderSpecialityFilter>("all");
  const [tab, setTab] = useState<RiderSelectionTab>("teams");
  const result = useMemo(
    () => selectRidersForTab(riders, tab, search, filter, favouriteRiderIds),
    [favouriteRiderIds, filter, riders, search, tab]
  );
  const noFavourites = tab === "favourites" && favouriteRiderIds.size === 0;

  function renderRider(entry: CyclingStartlistRider) {
    const excluded = excludedRiderIds.includes(entry.rider.id);
    const inactive = !isSelectableRiderStatus(entry.status);
    const disabled = excluded || inactive;
    const bib = preferStageBibNumber(entry.bib_number, entry.rider.bib_number);
    const badges = [
      ...(entry.rider.specialities ?? []),
      entry.rider_role && entry.rider_role !== "unknown" ? entry.rider_role : null
    ].filter((value): value is string => Boolean(value));
    const currentStatus = statusLabel(entry.status);
    const isFavourite = favouriteRiderIds.has(entry.rider.id);
    return (
      <Pressable
        disabled={disabled}
        key={entry.id}
        onPress={() => onSelect(entry.rider.id)}
        style={[styles.rider, disabled && styles.disabled, excluded && styles.excluded]}
      >
        <View style={styles.bibBadge}><Text style={styles.bibText}>{bib ? `#${bib}` : "—"}</Text></View>
        <View style={styles.copy}>
          <Text style={styles.name}>{isFavourite ? "★ " : ""}{formatRiderDisplayName(entry.rider.display_name, bib)}</Text>
          <Text style={styles.team}>{entry.team?.code ?? entry.team?.name ?? "Team TBC"}</Text>
          {badges.length ? (
            <View style={styles.badges}>
              {badges.slice(0, 3).map((badge) => <Text key={badge} style={styles.badge}>{badge.replaceAll("_", " ")}</Text>)}
            </View>
          ) : null}
        </View>
        <Text style={[styles.action, inactive && styles.statusAction]}>
          {excluded ? "Already selected" : currentStatus ?? "Select"}
        </Text>
      </Pressable>
    );
  }

  return (
    <Modal animationType="slide" presentationStyle="fullScreen" visible={visible} onRequestClose={onClose}>
      <View style={styles.screen}>
        <View style={styles.header}>
          <View>
            <Text style={styles.kicker}>{stageContext ?? "Stage tips"}</Text>
            <Text style={styles.title}>{title}</Text>
          </View>
          <Pressable accessibilityLabel="Close rider selector" onPress={onClose} style={styles.closeButton}>
            <Text style={styles.closeText}>Close</Text>
          </Pressable>
        </View>

        <View style={styles.tabs}>
          {RIDER_SELECTION_TABS.map((option) => (
            <Pressable
              key={option.key}
              onPress={() => setTab(option.key)}
              style={[styles.tab, tab === option.key && styles.tabActive]}
            >
              <Text style={[styles.tabText, tab === option.key && styles.tabTextActive]}>{option.label}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.controls}>
          <TextInput
            accessibilityLabel="Search riders"
            onChangeText={setSearch}
            placeholder="Search rider, team, code or bib"
            style={styles.search}
            value={search}
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
            {RIDER_SPECIALITY_FILTERS.map((option) => (
              <Pressable
                key={option.key}
                onPress={() => setFilter(option.key)}
                style={[styles.filter, filter === option.key && styles.filterActive]}
              >
                <Text style={[styles.filterText, filter === option.key && styles.filterTextActive]}>{option.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        <ScrollView contentContainerStyle={styles.list}>
          {noFavourites ? (
            <Text style={styles.empty}>No favourite riders yet. Add favourites from the rider list.</Text>
          ) : result.mode === "grouped" ? (
            result.groups.length === 0 ? (
              <Text style={styles.empty}>No riders match your search or filters.</Text>
            ) : result.groups.map((group) => (
              <View key={group.teamName} style={styles.group}>
                <Text style={styles.groupTitle}>{group.teamName}</Text>
                {group.entries.map((entry) => renderRider(entry))}
              </View>
            ))
          ) : (
            result.riders.length === 0 ? (
              <Text style={styles.empty}>No riders match your search or filters.</Text>
            ) : result.riders.map((entry) => renderRider(entry))
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  action: { color: "#12372A", fontSize: 11, fontWeight: "900", textAlign: "right", textTransform: "uppercase" },
  badge: { backgroundColor: "#EAF2ED", borderRadius: 999, color: "#12372A", fontSize: 10, fontWeight: "900", overflow: "hidden", paddingHorizontal: 7, paddingVertical: 3, textTransform: "capitalize" },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 6 },
  bibBadge: { alignItems: "center", backgroundColor: "#12372A", borderRadius: 14, justifyContent: "center", minHeight: 44, width: 52 },
  bibText: { color: "#FFFFFF", fontSize: 13, fontWeight: "900" },
  closeButton: { alignItems: "center", borderColor: "#C9D1CB", borderRadius: 999, borderWidth: 1, justifyContent: "center", minHeight: 40, paddingHorizontal: 14 },
  closeText: { color: "#12372A", fontWeight: "900" },
  controls: { backgroundColor: "#F7FAF8", borderBottomColor: "#DDE7E0", borderBottomWidth: 1, gap: 10, padding: 14 },
  copy: { flex: 1 },
  disabled: { opacity: 0.48 },
  empty: { color: "#68746D", fontSize: 15, fontWeight: "800", padding: 18, textAlign: "center" },
  excluded: { borderColor: "#F1C9C3" },
  filter: { backgroundColor: "#FFFFFF", borderColor: "#D7E1DA", borderRadius: 999, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8 },
  filterActive: { backgroundColor: "#12372A", borderColor: "#12372A" },
  filterText: { color: "#536159", fontSize: 12, fontWeight: "900" },
  filterTextActive: { color: "#FFFFFF" },
  filters: { gap: 8 },
  group: { gap: 8 },
  groupTitle: { color: "#536159", fontSize: 12, fontWeight: "900", letterSpacing: 0.4, textTransform: "uppercase" },
  header: { alignItems: "center", backgroundColor: "#FFFFFF", borderBottomColor: "#E0E8E2", borderBottomWidth: 1, flexDirection: "row", justifyContent: "space-between", padding: 16, paddingTop: 22 },
  kicker: { color: "#68746D", fontSize: 12, fontWeight: "800", marginBottom: 2 },
  list: { gap: 18, padding: 14, paddingBottom: 32 },
  name: { color: "#17231C", fontSize: 15, fontWeight: "900" },
  rider: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: "#E0E8E2", borderRadius: 16, borderWidth: 1, flexDirection: "row", gap: 10, minHeight: 72, padding: 10 },
  screen: { backgroundColor: "#EEF2EF", flex: 1 },
  search: { backgroundColor: "#FFFFFF", borderColor: "#C9D1CB", borderRadius: 14, borderWidth: 1, minHeight: 48, paddingHorizontal: 12 },
  statusAction: { color: "#A12622" },
  tab: { alignItems: "center", borderRadius: 12, flex: 1, padding: 11 },
  tabActive: { backgroundColor: "#12372A" },
  tabText: { color: "#536159", fontSize: 13, fontWeight: "900" },
  tabTextActive: { color: "#FFFFFF" },
  tabs: { backgroundColor: "#EEF2EF", borderRadius: 14, flexDirection: "row", gap: 4, margin: 14, marginBottom: 0, padding: 4 },
  team: { color: "#68746D", fontSize: 12, marginTop: 2 },
  title: { color: "#17231C", fontSize: 20, fontWeight: "900" }
});
