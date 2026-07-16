/**
 * Race-specific heading accent. There is only one real race in this app's
 * data model today (Tour de France) - no `grand_tours` row for a Giro or
 * Vuelta has ever been seeded, and no race-type enum exists. This is kept
 * as a single small pure lookup (not a themed "system") so a real second
 * race can be recognised later without new plumbing, while everything else
 * (body text, most headings, buttons) stays GWFC Blue regardless.
 *
 * This colour is used for the heading underline bar ONLY (components/
 * AppShell.tsx) - never for the heading/eyebrow text itself. A genuinely
 * bright race colour (the real Tour de France maillot jaune yellow,
 * #F4C430) fails WCAG text-contrast rules against this app's light
 * background (~1.6:1, versus the ~4.5:1 normal text needs), so this
 * function is free to return the real, undiluted race colour - the
 * underline bar has no text-contrast requirement to satisfy. An earlier
 * version of this function returned a dark, desaturated "accessible gold"
 * (#8A6D1A) instead, because at the time this value was also applied to
 * the heading text itself; that dual use was removed from AppShell.tsx,
 * so this can now be the real colour.
 *
 * Lives in lib/ (not components/theme.ts, which re-exports it) purely so
 * apps/mobile's test:ui script - which compiles a flat list of lib/*.ts
 * files standalone via tsc, sharing one inferred common rootDir - can keep
 * that rootDir as lib/ and its existing flat dist/mobile-tests/*.js output
 * layout, rather than pulling in components/ and nesting every output path.
 */
const DEFAULT_HEADING_ACCENT = "#425197"; // GWFC Blue - components/theme.ts's ui.colors.primary

export function getRaceHeadingAccent(raceName?: string | null): string {
  const normalized = (raceName ?? "").toLowerCase();
  if (normalized.includes("tour de france")) return "#F4C430"; // real maillot jaune yellow
  if (normalized.includes("giro")) return "#D6336C";
  if (normalized.includes("vuelta")) return "#C1121F";
  return DEFAULT_HEADING_ACCENT;
}
