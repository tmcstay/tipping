/**
 * GWFC brand design system: three core brand colours used semantically
 * (not all three stacked onto every screen) - GWFC Blue as the primary
 * ink/heading/selected-nav/primary-button colour, GWFC Light Blue reserved
 * for links and interactive highlights, GWFC Green/teal as a secondary
 * positive accent (e.g. the "live" status dot). Token *names* are kept
 * stable so every existing screen that references `ui.colors.*` inherits
 * this palette automatically, without a mechanical rename across the whole
 * app for what is a visual-only change.
 *
 * `primary` and `accent` are DIFFERENT values here (they were the same
 * single accent colour in the previous minimal palette) - primary is the
 * brand-identity blue (headings, selected nav, primary buttons), accent is
 * the lighter interactive blue (links, loading indicators, "open"/emphasis
 * highlights). Body/long-form text uses `ink`, which is the brand blue too
 * (per brand guidance) - never the lighter `accent` blue, which doesn't
 * have enough contrast for dense paragraph text.
 */
export const ui = {
  colors: {
    // Pale blue-grey page background, white cards - never a coloured or
    // gradient page background.
    background: "#F5F7FA",
    surface: "#FFFFFF",
    surfaceMuted: "#EEF1F6",

    // Primary/default text and headings. GWFC Blue, not black - passes
    // WCAG AA on white (~7:1). `muted`/`faint` are darker accessible
    // blue-greys derived from the brand palette for secondary/meta text,
    // never the lighter brand blue (too low-contrast for small text).
    ink: "#425197",
    muted: "#4A5568",
    faint: "#7B8698",

    // GWFC Blue - brand identity, headings, selected navigation, primary
    // buttons.
    primary: "#425197",
    primarySoft: "#E7EAF3",

    // GWFC Light Blue - links and interactive highlights only. Never used
    // for long-form body text.
    accent: "#1079BF",
    accentSoft: "#DCEEF8",

    // GWFC Green - secondary positive accent (e.g. a small "live" dot),
    // never the dominant colour of a whole card. `positiveStrong` is a
    // darker shade of the same hue for text on `positiveSoft` - the base
    // `positive` value doesn't have enough contrast for small text on its
    // own pale background.
    positive: "#1CAEBB",
    positiveSoft: "#DDF3F1",
    positiveStrong: "#0F6B73",

    border: "#DDE3EE",

    // success reuses the GWFC Green positive accent; warning/ttt stay
    // neutral blue-grey (no amber/purple) - only danger keeps a real red,
    // reserved for genuine errors.
    success: "#1CAEBB",
    warning: "#5B6472",
    warningSoft: "#EEF1F6",
    danger: "#B3261E",
    ttt: "#5B6472",
    tttSoft: "#EEF1F6"
  },
  radius: { small: 10, medium: 14, large: 16, pill: 999 },
  shadow: {
    shadowColor: "#1B2A4A",
    shadowOffset: { height: 2, width: 0 },
    shadowOpacity: 0.05,
    shadowRadius: 10
  }
} as const;

// Re-exported for convenience so every existing `from "./theme"` import
// keeps working - the implementation lives in lib/raceAccent.ts (see that
// file for why).
export { getRaceHeadingAccent } from "../lib/raceAccent";
