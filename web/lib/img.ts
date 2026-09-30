/**
 * Route a publisher image through our own proxy so it is never hotlinked.
 *
 * `lead_image` is scraped from feeds and arrives in three shapes, all of which
 * were breaking before this handled them:
 *  - an absolute publisher URL          -> proxy it
 *  - a RELATIVE path ("/img/x.jpg")     -> resolve against the ARTICLE's origin,
 *                                          not ours, or it 404s on our host
 *  - a Miniflux signed proxy URL        -> its signature does not survive, so
 *                                          decode the original out of the path
 *                                          (the last segment is base64url) and
 *                                          proxy that instead
 */
function ownHost(): string | null {
  try {
    return process.env.ABOVEFOLD_PUBLIC_URL ? new URL(process.env.ABOVEFOLD_PUBLIC_URL).host : null;
  } catch {
    return null;
  }
}

function decodeMinifluxProxy(u: URL): string | null {
  // /proxy/<signature>/<base64url(originalUrl)>
  const parts = u.pathname.split("/").filter(Boolean);
  if (parts[0] !== "proxy" || parts.length < 3) return null;
  try {
    const b64 = parts[parts.length - 1].replace(/-/g, "+").replace(/_/g, "/");
    const decoded = Buffer.from(b64, "base64").toString("utf8");
    return /^https?:\/\//.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

// Object replacement (U+FFFC), zero-width and BOM characters. Some feeds wrap
// the lead image URL in them (seen on Simon Willison's), and the proxy then
// asks the publisher for a URL that does not exist.
const INVISIBLE_RE = /[\uFFFC\u200B-\u200D\u2060\uFEFF]/g;

export function cleanImageUrl(url: string): string {
  return url.replace(INVISIBLE_RE, "").trim();
}

export function proxied(url: string | null | undefined, articleUrl?: string, width?: number): string | null {
  if (!url) return null;
  url = cleanImageUrl(url);
  if (!url) return null;

  let absolute: string;
  try {
    // Relative paths resolve against the article they came from.
    absolute = new URL(url, articleUrl || undefined).toString();
  } catch {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(absolute);
  } catch {
    return null;
  }

  // Miniflux's media proxy is served on this instance's own public host.
  if (ownHost() !== null && parsed.host === ownHost()) {
    const original = decodeMinifluxProxy(parsed);
    if (!original) return null;      // an unrecoverable local URL: render nothing
    absolute = original;
  }

  const w = width ? `&w=${width}` : "";
  return `/api/img?u=${encodeURIComponent(absolute)}${w}`;
}
