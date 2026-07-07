import { Text } from "react-native";

import { AppShell } from "../components/AppShell";
import { InfoCard } from "../components/InfoCard";

export default function OverallJerseyTipScreen() {
  return (
    <AppShell title="Jersey competition parked" subtitle="GrandTour stage-result tipping">
      <InfoCard title="Jersey tips are not open right now" meta="Temporary product setting">
        <Text style={{ color: "#536159", fontSize: 14, lineHeight: 20 }}>
          Official jersey holders may still appear in results and dashboards, but users are not entering jersey tips at this stage.
        </Text>
      </InfoCard>
    </AppShell>
  );
}
