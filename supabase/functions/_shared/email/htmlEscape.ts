/**
 * Escapes HTML-significant characters in user-generated text (display
 * names, etc.) before interpolating it into the stage-results email HTML.
 * Deliberately self-contained (no DOM/Deno APIs) so it's usable from both
 * the Edge Function runtime and plain `node --test`.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
