/**
 * Converts an unknown thrown value into a string safe to render directly in
 * JSX. Never returns an object's default `[object Object]` stringification -
 * a plain object or a Supabase/PostgrestError-shaped object (which has a
 * `.message` string but isn't an `Error` instance) is read via `.message`
 * when available, falling back to a generic message otherwise.
 */
export function toSafeErrorMessage(error: unknown, fallback = "Something went wrong. Please try again."): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  return fallback;
}
