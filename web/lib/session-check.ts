/*
 * Is an access proxy session gone? If the instance sits behind something like
 * Cloudflare Access, an expired session redirects every same-origin fetch to
 * the proxy's sign-in page on another origin, which fetch() reports as a bare
 * network error.
 * A manual-redirect probe tells the two apart: an expired session answers
 * with an opaque redirect instead of the app's JSON.
 */
export async function accessSessionExpired(): Promise<boolean> {
  try {
    const r = await fetch("/api/add/context", { redirect: "manual", cache: "no-store" });
    return r.type === "opaqueredirect";
  } catch {
    return false; // genuinely offline: not a session problem
  }
}
