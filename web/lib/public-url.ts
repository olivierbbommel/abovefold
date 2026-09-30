/*
 * The address this instance is served at, e.g. https://news.example.com.
 * Used for redirects, the Miniflux media proxy and newsletter issue links.
 * There is deliberately no fallback: a default pointing anywhere real would
 * send users to someone else's server.
 */
export function publicUrl(): string {
  const value = process.env.ABOVEFOLD_PUBLIC_URL;
  if (!value) throw new Error("ABOVEFOLD_PUBLIC_URL is not set (for example https://news.example.com)");
  return value.replace(/\/+$/, "");
}

export function publicHost(): string {
  return new URL(publicUrl()).host;
}
