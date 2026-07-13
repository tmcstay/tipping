/**
 * Minimal, single-accent design system (Monzo/Revolut-style neutral palette
 * + one accent colour). Token *names* are kept stable even where their
 * meaning has narrowed (e.g. `warning`/`ttt` are now neutral greys, not
 * separate decorative hues) so every existing screen that references
 * `ui.colors.*` inherits the calmer palette automatically, without needing
 * a mechanical rename across the whole app for what is a visual-only
 * change. `primary` and `accent` are intentionally the same value - there
 * is exactly one accent colour in this system.
 */
export const ui = {
  colors: {
    background: "#F6F7F6",
    surface: "#FFFFFF",
    surfaceMuted: "#F1F2F0",
    ink: "#15181A",
    muted: "#767C79",
    faint: "#9BA19D",
    primary: "#0E5C42",
    primarySoft: "#E7F0EC",
    accent: "#0E5C42",
    accentSoft: "#E7F0EC",
    border: "#E9EAE7",
    success: "#0E5C42",
    warning: "#767C79",
    warningSoft: "#F1F2F0",
    danger: "#B3261E",
    ttt: "#767C79",
    tttSoft: "#F1F2F0"
  },
  radius: { small: 10, medium: 14, large: 16, pill: 999 },
  shadow: {
    shadowColor: "#15181A",
    shadowOffset: { height: 2, width: 0 },
    shadowOpacity: 0.05,
    shadowRadius: 10
  }
} as const;
