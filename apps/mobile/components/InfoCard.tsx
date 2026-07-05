import type { PropsWithChildren } from "react";
import { StyleSheet, Text, View } from "react-native";

import { ui } from "./theme";

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
    backgroundColor: ui.colors.primary,
    borderColor: ui.colors.primary
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
    backgroundColor: ui.colors.surface,
    borderColor: ui.colors.border,
    borderRadius: ui.radius.large,
    borderWidth: 1,
    padding: 16,
    ...ui.shadow
  },
  meta: {
    color: ui.colors.muted,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.5,
    textTransform: "uppercase"
  },
  title: {
    color: ui.colors.ink,
    fontSize: 19,
    fontWeight: "900",
    lineHeight: 24,
    marginTop: 4
  }
});
