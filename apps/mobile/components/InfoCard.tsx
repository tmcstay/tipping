import { Link } from "expo-router";
import { useState } from "react";
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
  const [pressed, setPressed] = useState(false);

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

  // The actual card look (background/border/padding/shadow) lives on this
  // inner, plain View - never directly on a Link-wrapped Pressable's own
  // style. expo-router's <Link asChild> clones its child's props onto a
  // real <a> element on web; a *function*-valued style prop (which
  // Pressable normally calls with { pressed } during its own render) does
  // not survive that clone - the resulting <a> silently gets no style at
  // all, not just no pressed-state variant. This was invisible in every
  // previous manual check because they used a throwaway account with no
  // real "accent" hero-card data, so the one card that needs a real
  // background colour (not just layout) was never actually exercised.
  // Pressed-state is tracked here via onPressIn/onPressOut into local
  // state instead, so the Pressable/anchor's own `style` prop is always a
  // plain static value.
  const cardVisual = <View style={[styles.card, accent && styles.accentCard, pressed && styles.cardPressed]}>{content}</View>;

  if (!interactive) {
    return cardVisual;
  }

  const pressable = (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityRole="button"
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
    >
      {cardVisual}
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
