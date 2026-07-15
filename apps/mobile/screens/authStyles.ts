import { StyleSheet } from "react-native";

import { ui } from "../components/theme";

/**
 * Shared styling for every pre-auth screen (login, signup, forgot/reset
 * password, auth callback). These screens render outside AppShell, so they
 * carry their own page background - everything else comes from the same
 * GWFC theme tokens the rest of the app uses.
 */
export const authStyles = StyleSheet.create({
  button: {
    alignItems: "center",
    backgroundColor: ui.colors.primary,
    borderRadius: ui.radius.small,
    justifyContent: "center",
    minHeight: 50,
    paddingHorizontal: 16
  },
  buttonDisabled: { opacity: 0.55 },
  buttonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "800" },
  card: {
    backgroundColor: ui.colors.surface,
    borderColor: ui.colors.border,
    borderRadius: ui.radius.large,
    borderWidth: 1,
    gap: 14,
    maxWidth: 480,
    padding: 22,
    shadowColor: ui.shadow.shadowColor,
    shadowOffset: ui.shadow.shadowOffset,
    shadowOpacity: ui.shadow.shadowOpacity,
    shadowRadius: ui.shadow.shadowRadius,
    width: "100%"
  },
  copy: { color: ui.colors.muted, fontSize: 14, lineHeight: 20 },
  error: { color: ui.colors.danger, fontSize: 14, lineHeight: 20 },
  field: { gap: 6 },
  input: {
    borderColor: ui.colors.border,
    borderRadius: ui.radius.small,
    borderWidth: 1,
    color: ui.colors.ink,
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: 12
  },
  label: { color: ui.colors.muted, fontSize: 14, fontWeight: "700" },
  link: { color: ui.colors.accent, fontSize: 14, fontWeight: "700", textAlign: "center" },
  page: {
    alignItems: "center",
    backgroundColor: ui.colors.background,
    flexGrow: 1,
    justifyContent: "center",
    padding: 20
  },
  success: { color: ui.colors.positiveStrong, fontSize: 14, lineHeight: 20 },
  title: { color: ui.colors.primary, fontSize: 28, fontWeight: "900" }
});
