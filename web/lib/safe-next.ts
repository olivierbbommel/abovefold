/*
 * Where to go after login. A link opened while signed out (an article, a
 * search) used to land on Today; now it comes back to where it was going.
 * Only same-site paths are accepted, so this can never become an open
 * redirect: no scheme, no "//host", no backslash tricks, no control
 * characters, and never back to /login or into /api.
 */
export function safeNext(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 512) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return "/";
  let parsed: URL;
  try {
    parsed = new URL(raw, "https://abovefold.invalid");
  } catch {
    return "/";
  }
  if (parsed.origin !== "https://abovefold.invalid") return "/";
  if (parsed.pathname === "/login" || parsed.pathname.startsWith("/api/")) return "/";
  return `${parsed.pathname}${parsed.search}`;
}
