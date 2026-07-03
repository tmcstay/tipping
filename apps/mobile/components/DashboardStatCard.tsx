import { StyleSheet, Text, View } from "react-native";

type Props = {
  label: string;
  value: string;
  helper?: string;
};

export function DashboardStatCard({ helper, label, value }: Props) {
  return (
    <View style={styles.card}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
      {helper ? <Text style={styles.helper}>{helper}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#FFFFFF",
    borderColor: "#E0E8E2",
    borderRadius: 16,
    borderWidth: 1,
    flex: 1,
    minWidth: 136,
    padding: 14
  },
  helper: { color: "#68746D", fontSize: 12, fontWeight: "700", marginTop: 4 },
  label: { color: "#68746D", fontSize: 11, fontWeight: "900", textTransform: "uppercase" },
  value: { color: "#12372A", fontSize: 24, fontWeight: "900", marginTop: 4 }
});
