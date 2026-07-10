import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { CyclingStageResult, GrandTourTipRecord } from "@tipping-suite/supabase-client";

import { compareJerseyPicks, compareTopFiveWithResult, type JerseyType } from "../lib/grandtourHistoryExperience";
import { formatDateTime, formatShortDate } from "../lib/formatters";
import { InfoCard } from "./InfoCard";
import { ScoreBreakdown } from "./ScoreBreakdown";
import { StageResultComparison } from "./StageResultComparison";
import { TipStatusBadge, type TipDisplayStatus } from "./TipStatusBadge";

const JERSEY_SELECTION_TYPES: Record<string, JerseyType> = {
  yellow_holder: "yellow",
  green_holder: "green",
  kom_holder: "kom",
  white_holder: "white"
};

export function MyTipsStageCard({
  cumulativeTotal,
  isTtt,
  itemName,
  officialResult,
  stageDate,
  stageNumber,
  tip
}: {
  cumulativeTotal: number;
  isTtt: boolean;
  itemName: (id: string) => string;
  officialResult: CyclingStageResult | null;
  stageDate: string | null;
  stageNumber: number;
  tip: GrandTourTipRecord | null;
}) {
  const [expanded, setExpanded] = useState(false);

  const status: TipDisplayStatus = tip?.status ?? "missed";
  const topFive = (tip?.selections ?? [])
    .filter((selection) => selection.selection_type === "stage_top_5")
    .sort((a, b) => (a.predicted_position ?? 0) - (b.predicted_position ?? 0));
  const jerseyPicks = (tip?.selections ?? []).flatMap((selection) => {
    const jerseyType = JERSEY_SELECTION_TYPES[selection.selection_type];
    return jerseyType && selection.rider_id ? [{ jerseyType, riderId: selection.rider_id }] : [];
  });

  const canCompare = tip?.status === "scored" && officialResult !== null;
  const topFiveComparison = canCompare
    ? compareTopFiveWithResult(
      topFive.map((selection) => ({ position: selection.predicted_position ?? 0, riderId: selection.rider_id ?? selection.team_id })),
      officialResult!.riderResults.map((row) => ({ position: row.actual_position, riderId: row.rider.id }))
    )
    : [];
  const jerseyComparison = canCompare
    ? compareJerseyPicks(
      jerseyPicks,
      officialResult!.jerseyResults.map((row) => ({ jerseyType: row.jersey_type, riderId: row.rider.id }))
    )
    : [];

  return (
    <InfoCard
      meta={`Cumulative: ${cumulativeTotal} pts`}
      title={`Stage ${stageNumber} · ${formatShortDate(stageDate)}`}
    >
      <View style={styles.statusRow}>
        <TipStatusBadge status={status} />
        {tip?.status === "scored" ? (
          <Text style={styles.stageScore}>{tip.total_score} pts</Text>
        ) : null}
      </View>

      {!tip ? (
        <Text style={styles.emptyCopy}>No tip was submitted for this stage.</Text>
      ) : (
        <>
          {topFive.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionHeading}>{isTtt ? "Team Time Trial Top 5" : "Ordered Top 5"}</Text>
              {topFive.map((selection) => (
                <Text key={selection.id} style={styles.pickRow}>
                  {selection.predicted_position}. {selection.team_id
                    ? itemName(selection.team_id)
                    : selection.rider_id
                      ? itemName(selection.rider_id)
                      : "Unknown"}
                </Text>
              ))}
            </View>
          ) : null}

          {jerseyPicks.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionHeading}>Jersey picks</Text>
              {jerseyPicks.map((pick) => (
                <Text key={pick.jerseyType} style={styles.pickRow}>
                  {pick.jerseyType[0].toUpperCase()}{pick.jerseyType.slice(1)}: {itemName(pick.riderId)}
                </Text>
              ))}
            </View>
          ) : null}

          <Text style={styles.timestamps}>
            {tip.submitted_at ? `Submitted ${formatDateTime(tip.submitted_at)}` : "Not submitted"}
            {tip.locked_at ? ` · Locked ${formatDateTime(tip.locked_at)}` : ""}
          </Text>

          {tip.score ? (
            <Pressable accessibilityRole="button" onPress={() => setExpanded((value) => !value)} style={styles.expandToggle}>
              <Text style={styles.expandToggleText}>{expanded ? "Hide score details ▲" : "Show score details ▼"}</Text>
            </Pressable>
          ) : null}

          {expanded && tip.score ? (
            <>
              <ScoreBreakdown score={tip.score} />
              {canCompare ? (
                <StageResultComparison itemName={itemName} jerseys={jerseyComparison} topFive={topFiveComparison} />
              ) : null}
            </>
          ) : null}
        </>
      )}
    </InfoCard>
  );
}

const styles = StyleSheet.create({
  emptyCopy: {
    color: "#68746D",
    fontSize: 13,
    fontStyle: "italic"
  },
  expandToggle: {
    marginTop: 10
  },
  expandToggleText: {
    color: "#12372A",
    fontSize: 13,
    fontWeight: "800"
  },
  pickRow: {
    color: "#17231C",
    fontSize: 13,
    fontWeight: "700"
  },
  section: {
    gap: 2,
    marginTop: 6
  },
  sectionHeading: {
    color: "#68746D",
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase"
  },
  stageScore: {
    color: "#12372A",
    fontSize: 16,
    fontWeight: "900"
  },
  statusRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between"
  },
  timestamps: {
    color: "#68746D",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 8
  }
});
