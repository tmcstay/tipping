import type { PropsWithChildren } from "react";
import { StyleSheet, Text, View } from "react-native";

type InfoCardProps = PropsWithChildren<{
  meta?: string;
  title: string;
}>;

export function InfoCard({ children, meta, title }: InfoCardProps) {
  return (
    <View style={styles.card}>
      {meta ? <Text style={styles.meta}>{meta}</Text> : null}
      <Text style={styles.title}>{title}</Text>
      {children ? <View style={styles.body}>{children}</View> : null}
    </View>
  );
}

export const styles = StyleSheet.create({
  body: {
    gap: 6,
    marginTop: 10
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderColor: "#DDDDDD",
    borderRadius: 8,
    borderWidth: 1,
    padding: 16
  },
  meta: {
    color: "#777777",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase"
  },
  title: {
    color: "#111111",
    fontSize: 18,
    fontWeight: "800",
    marginTop: 4
  }
});
