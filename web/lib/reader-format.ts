/*
 * Small display helpers for the reader, Newsletters and source pages.
 * Pure and dependency free, so both server and client components use them.
 */

/** Compact relative time: "now", "5m", "2h", "3d". */
export function shortAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/*
 * Dates are the reader's calendar (ABOVEFOLD_TIMEZONE, default UTC), not the
 * server's: the same zone as Today's header. The variable is server-only, so
 * client components fall back to NEXT_PUBLIC_ABOVEFOLD_TIMEZONE if set at build
 * time, else UTC.
 */
const TIME_ZONE =
  (typeof process !== "undefined" && (process.env.ABOVEFOLD_TIMEZONE || process.env.NEXT_PUBLIC_ABOVEFOLD_TIMEZONE)) || "UTC";

function zonedDayMonth(iso: string): { day: number; month: number } {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, day: "numeric", month: "numeric" }).formatToParts(new Date(iso));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { day: get("day"), month: get("month") - 1 };
}

/** "23 Sep". Built by hand: en-GB in current ICU says "Sept". */
export function shortDate(iso: string): string {
  const { day, month } = zonedDayMonth(iso);
  return `${day} ${MONTHS[month]}`;
}

/** "23 September 2026". */
export function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { timeZone: TIME_ZONE, day: "numeric", month: "long", year: "numeric" });
}

export function readingMinutes(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 225));
}

/*
 * Bylines leak addresses: feeds put "staff@engadget.com (Will Shanklin)" in
 * the author field (audit A11). A parenthesised name wins; otherwise every
 * token that looks like an address is dropped. Nothing left means no author.
 */
export function cleanAuthor(raw: string | null | undefined, sourceName?: string): string | null {
  if (!raw) return null;
  let s = raw.trim();
  const paren = /\(([^()]+)\)/.exec(s);
  if (paren && !/\S+@\S+/.test(paren[1])) s = paren[1];
  s = s
    .replace(/\S+@\S+/g, "")
    .replace(/[()]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s,;:|/-]+|[\s,;:|/-]+$/g, "")
    .trim();
  if (!s) return null;
  if (sourceName && s.toLowerCase() === sourceName.toLowerCase()) return null;
  return s;
}
