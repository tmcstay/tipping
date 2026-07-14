/** first_name -> display_name (first token) -> neutral fallback. Pure, unit-tested. */
export function resolveDashboardFirstName(
  firstNameValue: string | null | undefined,
  displayName: string | null | undefined
): string {
  if (firstNameValue?.trim()) return firstNameValue.trim();
  if (displayName?.trim()) return displayName.trim().split(/\s+/)[0] ?? "there";
  return "there";
}
