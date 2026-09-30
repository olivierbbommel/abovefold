/*
 * Words for the Add screen (spec 5.4, 5.5, 7). Pure, so the copy rules
 * (singulars, omitted clauses, "12 min ago" rather than "today") are tested
 * rather than eyeballed.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** The fixed 36px column next to a headline: "12m", "3h", "2d", "5w". */
export function shortAge(iso: string | null, now: number): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const d = Math.max(0, now - t);
  if (d < HOUR) return `${Math.max(1, Math.floor(d / MIN))}m`;
  if (d < DAY) return `${Math.floor(d / HOUR)}h`;
  if (d < 14 * DAY) return `${Math.floor(d / DAY)}d`;
  return `${Math.floor(d / (7 * DAY))}w`;
}

/** "12 min ago", "1 hour ago", "3 days ago". Never "today": under an hour is minutes. */
export function longAgo(iso: string | null, now: number): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const d = Math.max(0, now - t);
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"} ago`;
  if (d < HOUR) return `${Math.max(1, Math.floor(d / MIN))} min ago`;
  if (d < DAY) return plural(Math.floor(d / HOUR), "hour");
  if (d < 60 * DAY) return plural(Math.floor(d / DAY), "day");
  return plural(Math.floor(d / (30 * DAY)), "month");
}

export function postsPerWeekText(postsPerWeek: number): string {
  if (postsPerWeek <= 0) return "nothing in 30 days";
  if (postsPerWeek < 1) return "under 1 post a week";
  const n = Math.round(postsPerWeek);
  return `${n} post${n === 1 ? "" : "s"} a week`;
}

/** "reuters.com · 41 posts a week · last post 12 min ago · full text". */
export function cardMeta(
  host: string,
  preview: { postsPerWeek: number; lastPostAt: string | null; fullTextAvailable: boolean } | null,
  now: number
): string {
  const parts = [displayHost(host)];
  if (preview) {
    parts.push(postsPerWeekText(preview.postsPerWeek));
    const ago = longAgo(preview.lastPostAt, now);
    if (ago) parts.push(`last post ${ago}`);
    // Absence of full text is not a fault to announce (spec 5.4).
    if (preview.fullTextAvailable) parts.push("full text");
  }
  return parts.join(" · ");
}

function times(n: number): string {
  return n === 1 ? "once" : `${n} times`;
}

/** "Hacker News and TLDR", "Hacker News", or the first two of many. */
export function sourceList(via: readonly string[]): string {
  const names = [...new Set(via.filter(Boolean))];
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  return `${names[0]} and ${names[1]}`;
}

/**
 * The catalog row's second line. The window is the data's window, stated
 * plainly: the reading query looks back WINDOW_DAYS, not a calendar month.
 */
export function readingCaption(
  s: { appearances: number; opened: number; via: readonly string[] },
  windowPhrase: string
): string {
  const by = sourceList(s.via);
  let line = `Linked ${times(s.appearances)}${by ? ` by ${by}` : ""} ${windowPhrase}`;
  if (s.opened > 0) line += ` · you opened ${s.opened}`;
  return line;
}

/** "Hacker News has linked here 14 times in the last 60 days." */
export function linkedHereLine(
  s: { appearances: number; via: readonly string[] },
  windowPhrase: string
): string {
  const by = sourceList(s.via);
  const who = by || "Your sources";
  const verb = s.via.length > 1 || !by ? "have" : "has";
  return `${who} ${verb} linked here ${times(s.appearances)} ${windowPhrase}.`;
}

/** A host as shown to a person: lower case, no "www.", no trailing dot. */
export function displayHost(host: string): string {
  return host.trim().toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
}

/** The letter in a site tile: "Ars Technica" -> "A", "ft.com" -> "F". */
export function tileLetter(name: string): string {
  const m = name.replace(/^(?:the\s+|www\.)/i, "").match(/[\p{L}\p{N}]/u);
  return (m ? m[0] : "?").toUpperCase();
}
