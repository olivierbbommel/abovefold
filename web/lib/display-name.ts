/*
 * Short source names (spec 5.2, audit A8).
 *
 * Feed <title>s are SEO strings: "Engadget - Technology News & Expert
 * Reviews", "MacRumors: Mac News and Rumors - All Stories". They drove the
 * phone meta line to wrap into three rows. Cut at the first separator when
 * what precedes it is a real name, then cap the length. The full title stays
 * available for tooltips.
 */
const SEPARATORS = [" - ", " | ", ": ", " – ", ", ", " > "];
const MAX = 32;

// Leading boilerplate some feeds put before the publication's name.
const PREFIXES = [/^all content from\s+/i, /^latest (?:news|articles|stories) from\s+/i];

export function displayName(feedTitle: string | null | undefined): string {
  let t = (feedTitle ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  for (const re of PREFIXES) t = t.replace(re, "");
  let cut = t.length;
  for (const sep of SEPARATORS) {
    const i = t.indexOf(sep);
    if (i >= 3 && i < cut) cut = i;
  }
  t = t.slice(0, cut).trim();
  // Trailing boilerplate after the name.
  t = t.replace(/\s+(?:latest articles feed|latest articles|rss feed|feed|rss)$/i, "").trim();
  return t.length > MAX ? `${t.slice(0, MAX - 1).trimEnd()}…` : t;
}
