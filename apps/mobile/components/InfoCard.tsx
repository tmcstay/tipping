import { Link } from "expo-router";
import type { PropsWithChildren } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { ui } from "./theme";

type InfoCardProps = PropsWithChildren<{
  accent?: boolean;
  meta?: string;
  title: string;
  /**
   * Makes the entire card a single navigable element - the shared,
   * reusable "clickable dashboard card" pattern, rather than duplicating
   * Pressable/navigation wiring per screen. Prefer `href` (renders via
   * expo-router's Link with `asChild`, giving a real `<a href>` on web -
   * keyboard-focusable, cmd/ctrl-clickable, screen-reader "link" semantics)
   * over `onPress` (a plain callback, for cases with no static route).
   */
  href?: string;
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  /** Defaults to true whenever the card is interactive (href/onPress set). Pass false to suppress it even so. */
  chevron?: boolean;
}>;

export function InfoCard({
  accent,
  accessibilityHint,
  accessibilityLabel,
  chevron,
  children,
  href,
  meta,
  onPress,
  title
}: InfoCardProps) {
  const interactive = Boolean(href || onPress);
  const showChevron = chevron ?? interactive;

  const content = (
    <>
      <View style={styles.headerRow}>
        <View style={styles.headerText}>
          {meta ? <Text style={[styles.meta, accent && styles.accentMeta]}>{meta}</Text> : null}
          <Text style={[styles.title, accent && styles.accentTitle]}>{title}</Text>
        </View>
        {showChevron ? (
          <Text style={[styles.chevron, accent && styles.accentChevron]} accessibilityElementsHidden>
            ›
          </Text>
        ) : null}
      </View>
      {children ? <View style={styles.body}>{children}</View> : null}
    </>
  );

  if (!interactive) {
    return <View style={[styles.card, accent && styles.accentCard]}>{content}</View>;
  }

  const cardStyle = ({ pressed }: { pressed: boolean }) => [
    styles.card,
    accent && styles.accentCard,
    pressed && styles.cardPressed
  ];

  const pressable = (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityRole="button"
      onPress={onPress}
      style={cardStyle}
    >
      {content}
    </Pressable>
  );

  if (href) {
    return (
      <Link asChild href={href}>
        {pressable}
      </Link>
    );
  }

  return pressable;
}

export const styles = StyleSheet.create({
  accentCard: {
    backgroundColor: ui.colors.primary,
    borderColor: ui.colors.primary
  },
  accentChevron: {
    color: "rgba(255,255,255,0.6)"
  },
  accentMeta: {
    color: "rgba(255,255,255,0.68)"
  },
  accentTitle: {
    color: "#FFFFFF"
  },
  body: {
    gap: 10,
    marginTop: 14
  },
  card: {
    backgroundColor: ui.colors.surface,
    borderColor: ui.colors.border,
    borderRadius: ui.radius.large,
    borderWidth: 1,
    padding: 18,
    shadowColor: ui.shadow.shadowColor,
    shadowOffset: ui.shadow.shadowOffset,
    shadowOpacity: ui.shadow.shadowOpacity,
    shadowRadius: ui.shadow.shadowRadius
  },
  cardPressed: {
    opacity: 0.85
  },
  chevron: {
    color: ui.colors.faint,
    fontSize: 20,
    fontWeight: "600",
    marginLeft: 8
  },
  headerRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    justifyContent: "space-between"
  },
  headerText: {
    flex: 1
  },
  meta: {
    color: ui.colors.faint,
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.3,
    textTransform: "uppercase"
  },
  title: {
    color: ui.colors.ink,
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 21,
    marginTop: 3
  }
});
