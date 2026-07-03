import type { PropsWithChildren } from "react";
import { StyleSheet, Text, View } from "react-native";

type InfoCardProps = PropsWithChildren<{
  accent?: boolean;
  meta?: string;
  title: string;
}>;

export function InfoCard({ accent, children, meta, title }: InfoCardProps) {
  return (
    <View style={[styles.card, accent && styles.accentCard]}>
      {meta ? <Text style={[styles.meta, accent && styles.accentMeta]}>{meta}</Text> : null}
      <Text style={[styles.title, accent && styles.accentTitle]}>{title}</Text>
      {children ? <View style={styles.body}>{children}</View> : null}
    </View>
  );
}

export const styles = StyleSheet.create({
  accentCard: {
    backgroundColor: "#12372A",
    borderColor: "#12372A"
  },
  accentMeta: {
    color: "#F4C430"
  },
  accentTitle: {
    color: "#FFFFFF"
  },
  body: {
    gap: 8,
    marginTop: 12
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderColor: "#E0E8E2",
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
    shadowColor: "#0F241A",
    shadowOffset: { height: 6, width: 0 },
    shadowOpacity: 0.08,
    shadowRadius: 14
  },
  meta: {
    color: "#6A756E",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.5,
    textTransform: "uppercase"
  },
  title: {
    color: "#111111",
    fontSize: 19,
    fontWeight: "900",
    lineHeight: 24,
    marginTop: 4
  }
});
