import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { CyclingStageResult, GrandTourTipRecord } from "@tipping-suite/supabase-client";
import type { Json } from "@tipping-suite/shared-types";

import {
  buildJerseyRowDetails,
  buildOfficialTopTenRows,
  buildTopFiveRowDetails,
  sumJerseyPoints,
  sumTopFivePoints,
  type RiderLookupEntry
} from "../lib/grandtourStageResultsExperience";
import { formatShortDate, formatStageType } from "../lib/formatters";
import { GrandTourJerseyComparison } from "./GrandTourJerseyComparison";
import { GrandTourOfficialTopTen } from "./GrandTourOfficialTopTen";
import { GrandTourScoreExplanation } from "./GrandTourScoreExplanation";
import { GrandTourTopFiveComparison } from "./GrandTourTopFiveComparison";
import { InfoCard } from "./InfoCard";
import { TipStatusBadge, type TipDisplayStatus } from "./TipStatusBadge";
import { ui } from "./theme";

const JERSEY_SELECTION_TYPES: Record<string, "yellow" | "green" | "kom" | "white"> = {
  yellow_holder: "yellow",
  green_holder: "green",
  kom_holder: "kom",
  white_holder: "white"
};

function asRecord(value: Json | null | undefined): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function describeBonus(scoreDetails: Json | null | undefined): string {
  const details = asRecord(scoreDetails);
  if (typeof details.winning_team_bonus === "number" && details.winning_team_bonus > 0) {
    return "Winning team bonus (correct stage winner predicted)";
  }
  return "Bonus adjustment";
}

/**
 * Requirement #1/#2: one collapsible item per stage on the results/history
 * screen. Defaults CLOSED (plain useState(false), never auto-opened) -
 * React preserves this local state across in-page refetches as long as
 * the parent keeps using a stable `key={stage.id}` (see app/my-tips.tsx),
 * and it naturally resets on a full page reload/unmount, matching the
 * requirement exactly without any extra plumbing.
 */
export function GrandTourStageResultAccordion({
  isTtt,
  officialResult,
  riderLookup,
  stageDate,
  stageName,
  stageNumber,
  stageType,
  tip
}: {
  isTtt: boolean;
  officialResult: CyclingStageResult | null;
  riderLookup: (id: string) => RiderLookupEntry | null;
  stageDate: string | null;
  stageName: string | null;
  stageNumber: number;
  stageType: string;
  tip: GrandTourTipRecord | null;
}) {
  const [expanded, setExpanded] = useState(false);

  const status: TipDisplayStatus = tip?.status ?? "missed";
  const isScored = tip?.status === "scored" && tip.score !== null;
  const isPendingScore = tip !== null && ["submitted", "locked"].includes(tip.status) && !isScored;
  const isDraft = tip?.status === "draft";
  const resultFinalised = officialResult !== null;

  const topFivePicks = useMemo(() => (tip?.selections ?? [])
    .filter((selection) => selection.selection_type === "stage_top_5" && !isTtt)
    .map((selection) => ({ position: selection.predicted_position ?? 0, riderId: selection.rider_id ?? null }))
    .filter((entry) => entry.position >= 1 && entry.position <= 5), [tip, isTtt]);

  const jerseyPicks = useMemo(() => (tip?.selections ?? []).flatMap((selection) => {
    const jerseyType = JERSEY_SELECTION_TYPES[selection.selection_type];
    return jerseyType ? [{ jerseyType, riderId: selection.rider_id ?? null }] : [];
  }), [tip]);

  const officialTopTenRows = useMemo(() => buildOfficialTopTenRows(officialResult), [officialResult]);

  const scoreDetails = tip?.score ? asRecord(tip.score.score_details) : {};
  const scoreTopFive = Array.isArray(scoreDetails.top_five) ? (scoreDetails.top_five as never[]) : null;
  const scoreJerseys = Array.isArray(scoreDetails.jerseys) ? (scoreDetails.jerseys as never[]) : null;

  const topFiveRows = useMemo(() => buildTopFiveRowDetails({
    predictedSelections: topFivePicks,
    officialRows: officialTopTenRows,
    scoreTopFive: isScored ? scoreTopFive : null,
    riderLookup
  }), [topFivePicks, officialTopTenRows, isScored, scoreTopFive, riderLookup]);

  const jerseyRows = useMemo(() => buildJerseyRowDetails({
    predictedJerseys: jerseyPicks,
    officialJerseys: (officialResult?.jerseyResults ?? []).map((row) => ({ jerseyType: row.jersey_type, riderId: row.rider.id })),
    scoreJerseys: isScored ? scoreJerseys : null,
    riderLookup
  }), [jerseyPicks, officialResult, isScored, scoreJerseys, riderLookup]);

  const top5Subtotal = isScored ? tip!.score!.top5_score : sumTopFivePoints(topFiveRows);
  const jerseySubtotal = isScored ? tip!.score!.jersey_score : sumJerseyPoints(jerseyRows);
  const bonusScore = isScored ? tip!.score!.bonus_score : 0;

  return (
    <View style={styles.card}>
      <Pressable
        accessibilityLabel={`Stage ${stageNumber}${expanded ? ", collapse" : ", expand"} — ${status.replace("_", " ")}${isScored ? `, ${tip!.total_score} points` : ""}`}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        aria-expanded={expanded}
        onPress={() => setExpanded((value) => !value)}
        style={styles.header}
      >
        <View style={styles.headerMain}>
          <View style={styles.headerTopRow}>
            <Text style={styles.stageTitle}>Stage {stageNumber}{stageName ? ` · ${stageName}` : ` · ${formatStageType(stageType)}`}</Text>
            <Text style={styles.chevron}>{expanded ? "▲" : "▼"}</Text>
          </View>
          <Text style={styles.stageDate}>{formatShortDate(stageDate)}</Text>
          <View style={styles.badgeRow}>
            <TipStatusBadge status={status} />
            <View style={[styles.finalBadge, resultFinalised ? styles.finalBadgeDone : styles.finalBadgePending]}>
              <Text style={[styles.finalBadgeText, resultFinalised ? styles.finalBadgeTextDone : styles.finalBadgeTextPending]}>
                {resultFinalised ? "Result finalised" : "Result pending"}
              </Text>
            </View>
          </View>
          {isScored ? (
            <>
              <Text style={styles.totalScore}>{tip!.total_score} pts</Text>
              <Text style={styles.scoreLine}>
                Top 5: {tip!.score!.top5_score} · Jerseys: {tip!.score!.jersey_score} · Bonus: {tip!.score!.bonus_score}
              </Text>
            </>
          ) : null}
        </View>
      </Pressable>

      {expanded ? (
        <View style={styles.body}>
          {!tip ? (
            <Text style={styles.emptyCopy}>No tip submitted.</Text>
          ) : isDraft ? (
            <Text style={styles.emptyCopy}>Draft — not submitted.</Text>
          ) : (
            <>
              {isPendingScore ? <Text style={styles.pendingBanner}>Awaiting official scoring.</Text> : null}
              {isTtt ? (
                <Text style={styles.emptyCopy}>Team Time Trial picks aren&apos;t shown in the detailed comparison yet — see the score summary above.</Text>
              ) : (
                <>
                  <GrandTourTopFiveComparison pending={!isScored} rows={topFiveRows} subtotal={top5Subtotal} />
                  <GrandTourJerseyComparison rows={jerseyRows} subtotal={isScored ? jerseySubtotal : null} />
                </>
              )}

              {isScored && bonusScore > 0 ? (
                <View style={styles.bonusBox}>
                  <Text style={styles.bonusHeading}>Bonus</Text>
                  <View style={styles.bonusRow}>
                    <Text style={styles.bonusDescription}>{describeBonus(tip!.score!.score_details)}</Text>
                    <Text style={styles.bonusPoints}>+{bonusScore} pts</Text>
                  </View>
                </View>
              ) : isScored ? (
                <Text style={styles.noBonusLine}>No bonus points</Text>
              ) : null}
            </>
          )}

          <GrandTourOfficialTopTen rows={officialTopTenRows} />
          <GrandTourScoreExplanation />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  badgeRow: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  body: { borderTopColor: ui.colors.border, borderTopWidth: 1, marginTop: 12, paddingTop: 12 },
  bonusBox: { backgroundColor: ui.colors.warningSoft, borderRadius: ui.radius.small, marginTop: 10, padding: 10 },
  bonusDescription: { color: ui.colors.warning, flex: 1, fontSize: 12, fontWeight: "800" },
  bonusHeading: { color: ui.colors.warning, fontSize: 11, fontWeight: "900", marginBottom: 4, textTransform: "uppercase" },
  bonusPoints: { color: ui.colors.warning, fontSize: 13, fontWeight: "900" },
  bonusRow: { alignItems: "center", flexDirection: "row", gap: 8, justifyContent: "space-between" },
  card: { backgroundColor: ui.colors.surface, borderColor: ui.colors.border, borderRadius: ui.radius.large, borderWidth: 1, padding: 16, ...ui.shadow },
  chevron: { color: ui.colors.primary, fontSize: 14, fontWeight: "900", marginLeft: 8 },
  emptyCopy: { color: ui.colors.muted, fontSize: 13, fontStyle: "italic" },
  finalBadge: { borderRadius: ui.radius.pill, paddingHorizontal: 10, paddingVertical: 5 },
  finalBadgeDone: { backgroundColor: "#D7F0DE" },
  finalBadgePending: { backgroundColor: ui.colors.border },
  finalBadgeText: { fontSize: 11, fontWeight: "900", textTransform: "uppercase" },
  finalBadgeTextDone: { color: ui.colors.success },
  finalBadgeTextPending: { color: ui.colors.muted },
  header: { minHeight: 44 },
  headerMain: { gap: 2 },
  headerTopRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  noBonusLine: { color: ui.colors.muted, fontSize: 12, fontStyle: "italic", marginTop: 8 },
  pendingBanner: { color: ui.colors.warning, fontSize: 13, fontWeight: "800", marginBottom: 8 },
  scoreLine: { color: ui.colors.muted, fontSize: 12, fontWeight: "800", marginTop: 4 },
  stageDate: { color: ui.colors.muted, fontSize: 12, fontWeight: "700" },
  stageTitle: { color: ui.colors.ink, flex: 1, fontSize: 16, fontWeight: "900" },
  totalScore: { color: ui.colors.primary, fontSize: 22, fontWeight: "900", marginTop: 6 }
});
