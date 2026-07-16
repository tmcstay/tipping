import { Pressable, StyleSheet, Text, View } from "react-native";
import type { CyclingStage, CyclingStageResult } from "@tipping-suite/supabase-client";

import { formatShortDate } from "../lib/formatters";
import type { ResultRowScoreBadge } from "../lib/grandtourStageResultsExperience";
import { getStageTipExperience } from "../lib/stageExperience";
import { InfoCard } from "./InfoCard";
import { JerseyHolderCard, type JerseyKind } from "./JerseyHolderCard";
import { ScoreOutcomeBadge } from "./ScoreOutcomeBadge";
import { StageTypeBadge } from "./StageTypeBadge";
import { ui } from "./theme";

const jerseys: JerseyKind[] = ["yellow", "green", "kom", "white"];

export function StageResultCard({ result, stage, onOpen, scoreBadges }: {
  result: CyclingStageResult;
  stage: CyclingStage;
  onOpen?: () => void;
  /** Per-position scoring badges for the signed-in user (keyed by actual_position); omit to render without them. */
  scoreBadges?: ResultRowScoreBadge[] | null;
}) {
  const isTtt = getStageTipExperience(stage.stage_type).isTtt;
  const ranked = isTtt ? result.teamResults : result.riderResults;
  const winner = ranked.find((line) => line.actual_position === 1);
  const winnerName = winner && ("team" in winner ? winner.team.name : winner.rider.display_name);

  return (
    <InfoCard title={`Stage ${stage.stage_number}: ${stage.start_location ?? "TBC"} → ${stage.finish_location ?? "TBC"}`} meta={formatShortDate(stage.starts_at)}>
      <View style={styles.topRow}>
        <StageTypeBadge stageType={stage.stage_type} />
        <Text style={styles.winnerLabel}>{isTtt ? "Winning team" : "Stage winner"}</Text>
      </View>
      <Text style={styles.winner}>{winnerName ?? "Result pending"}</Text>
      <View style={styles.divider} />
      <Text style={styles.sectionTitle}>{isTtt ? "Team Time Trial Result" : "Stage Top 5"}</Text>
      {ranked.slice(0, 5).map((line) => {
        const badge = scoreBadges?.find((candidate) => candidate.position === line.actual_position) ?? null;
        return (
          <View key={line.actual_position} style={styles.resultRow}>
            <Text style={styles.position}>{line.actual_position}</Text>
            <Text style={styles.resultName}>{"team" in line ? line.team.name : line.rider.display_name}</Text>
            {badge ? <ScoreOutcomeBadge label={badge.label} tone={badge.tone} /> : null}
          </View>
        );
      })}
      {isTtt ? <Text style={styles.helper}>TTT stage result is team-based. Jersey results are individual.</Text> : null}
      <Text style={styles.sectionTitle}>Jersey Results</Text>
      <View style={styles.jerseys}>
        {jerseys.map((jersey) => {
          const holder = result.jerseyResults.find((entry) => entry.jersey_type === jersey)?.rider;
          return <JerseyHolderCard jersey={jersey} key={jersey} riderName={holder?.display_name} teamName={holder?.team?.name} />;
        })}
      </View>
      {onOpen ? <Pressable onPress={onOpen} style={styles.button}><Text style={styles.buttonText}>View stage and score</Text></Pressable> : null}
    </InfoCard>
  );
}

const styles = StyleSheet.create({
  button: { alignItems: "center", borderColor: ui.colors.primary, borderRadius: ui.radius.medium, borderWidth: 1, justifyContent: "center", minHeight: 48, marginTop: 4 },
  buttonText: { color: ui.colors.primary, fontWeight: "900" },
  divider: { backgroundColor: ui.colors.border, height: 1, marginVertical: 4 },
  helper: { backgroundColor: ui.colors.tttSoft, borderRadius: ui.radius.small, color: ui.colors.ttt, fontSize: 12, fontWeight: "800", lineHeight: 17, padding: 10 },
  jerseys: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  position: { color: ui.colors.primary, fontSize: 14, fontWeight: "900", width: 24 },
  resultName: { color: ui.colors.ink, flex: 1, fontSize: 14, fontWeight: "800" },
  resultRow: { alignItems: "center", backgroundColor: ui.colors.surfaceMuted, borderRadius: ui.radius.small, flexDirection: "row", gap: 8, minHeight: 42, paddingHorizontal: 12 },
  sectionTitle: { color: ui.colors.ink, fontSize: 14, fontWeight: "900", marginTop: 4 },
  topRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  winner: { color: ui.colors.primary, fontSize: 22, fontWeight: "900" },
  winnerLabel: { color: ui.colors.muted, fontSize: 11, fontWeight: "900", textTransform: "uppercase" }
});
