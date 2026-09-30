import { decodeEntities } from "./entities.ts";
import { blockedTarget } from "./safe-fetch.ts";

/*
 * Pure parsing for feed discovery: no network, no database, so it can be
 * tested directly (lib/feed-parse.test.ts). lib/discover.ts does the
 * fetching and hands the bytes here.
 */

export type SubscriptionCandidate = { title: string; type: string; url: string };

export type PreviewItem = { title: string; publishedAt: string | null };

export type FeedPreview = {
  volumeLast30Days: number;
  postsPerWeek: number;
  lastPostAt: string | null;
  fullTextAvailable: boolean;
  recentItems: PreviewItem[]; // up to 3, newest first
};

// --- tiny regex-based RSS/Atom parser --------------------------------------
//
// There's no XML library in this project's dependencies and this task adds
// none. Good enough for a preview: item count, dates, and rough content
// length per item, not a general-purpose feed reader.

// Entity decoding lives in lib/entities.ts (tested). The old local version
// knew five named entities and "&#39;", so "&#039;" reached the Add card raw.

/*
 * Every scan here is linear in its input. The first version used lazy
 * `[\s\S]*?` regexes, which retry from every opening tag when the closing
 * tag never comes: 280 KB of `<item>` with no `</item>` took 4.3 s, and any
 * site could serve that to a preview. Now an opening tag is found with a
 * regex that cannot run past the next `<`, and its close with indexOf.
 */
export function stripTags(s: string): string {
  return s.replace(/<[^<>]*>/g, " ").replace(/\s+/g, " ").trim();
}

// Feeds in the wild carry namespace prefixes: hbr.org serves Atom as
// <ns6:feed>/<ns6:entry>. Matching the bare tag name reported those feeds as
// empty, which made the preview claim a healthy source publishes nothing.
const NS = "(?:[a-zA-Z][\\w.-]*:)?";

type TagHit = { inner: string; end: number };

/** First <tag ...>...</tag> at or after `from`, with any namespace prefix. */
function findTag(src: string, lower: string, tag: string, from = 0): TagHit | null {
  const open = new RegExp(`<(${NS})${tag}(?=[\\s>/])`, "gi");
  open.lastIndex = from;
  const hit = open.exec(src);
  if (!hit) return null;
  const gt = src.indexOf(">", hit.index);
  if (gt === -1) return null;
  if (src[gt - 1] === "/") return { inner: "", end: gt + 1 }; // <tag/>
  const close = `</${hit[1].toLowerCase()}${tag.toLowerCase()}>`;
  const closeAt = lower.indexOf(close, gt + 1);
  if (closeAt === -1) return null;
  return { inner: src.slice(gt + 1, closeAt), end: closeAt + close.length };
}

function extractTag(block: string, tag: string): string | null {
  const hit = findTag(block, block.toLowerCase(), tag);
  if (!hit) return null;
  let value = hit.inner.trim();
  if (value.startsWith("<![CDATA[") && value.endsWith("]]>")) value = value.slice(9, -3);
  return value;
}

const MAX_PREVIEW_ITEMS = 50;

export function parseFeed(xml: string): FeedPreview {
  const isAtom =
    new RegExp(`<${NS}feed[\\s>]`, "i").test(xml) && new RegExp(`<${NS}entry[\\s>]`, "i").test(xml);
  const itemTag = isAtom ? "entry" : "item";
  const lower = xml.toLowerCase();
  const items: string[] = [];
  for (let at = 0; items.length < MAX_PREVIEW_ITEMS; ) {
    const hit = findTag(xml, lower, itemTag, at);
    if (!hit) break;
    items.push(hit.inner);
    at = hit.end;
  }

  const now = Date.now();
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

  type Parsed = { title: string; dateMs: number | null; contentLen: number };
  const parsed: Parsed[] = items.map((block) => {
    const title = decodeEntities(stripTags(extractTag(block, "title") ?? ""));
    const dateRaw =
      extractTag(block, "pubDate") ??
      extractTag(block, "published") ??
      extractTag(block, "updated") ??
      extractTag(block, "dc:date");
    const dateMs = dateRaw ? Date.parse(dateRaw) : NaN;

    const bestContent =
      extractTag(block, "content:encoded") ?? extractTag(block, "content") ?? extractTag(block, "description") ?? extractTag(block, "summary") ?? "";
    const contentLen = stripTags(decodeEntities(bestContent)).length;

    return { title, dateMs: Number.isFinite(dateMs) ? dateMs : null, contentLen };
  });

  parsed.sort((a, b) => (b.dateMs ?? 0) - (a.dateMs ?? 0));

  let volumeLast30Days = 0;
  let lastPostMs: number | null = null;
  let fullTextHits = 0;
  const recentItems: PreviewItem[] = [];

  for (const p of parsed) {
    if (p.dateMs !== null) {
      if (lastPostMs === null || p.dateMs > lastPostMs) lastPostMs = p.dateMs;
      if (p.dateMs >= thirtyDaysAgo) volumeLast30Days++;
    }
    if (p.contentLen > 600) fullTextHits++;
    if (recentItems.length < 3 && p.title) {
      recentItems.push({ title: p.title, publishedAt: p.dateMs ? new Date(p.dateMs).toISOString() : null });
    }
  }

  return {
    volumeLast30Days,
    postsPerWeek: Math.round(((volumeLast30Days / 30) * 7) * 10) / 10,
    lastPostAt: lastPostMs ? new Date(lastPostMs).toISOString() : null,
    fullTextAvailable: parsed.length > 0 && fullTextHits / parsed.length >= 0.5,
    recentItems,
  };
}

export function looksLikeFeed(body: string): boolean {
  const head = body.slice(0, 2000);
  if (!new RegExp(`<(\\?xml|${NS}rss|${NS}feed|${NS}RDF)[\\s>]`, "i").test(head)) return false;
  return new RegExp(`<${NS}(item|entry)[\\s>]`, "i").test(body);
}

export function titleOf(body: string, fallback: string): string {
  const value = extractTag(body, "title");
  if (!value) return fallback;
  return decodeEntities(stripTags(value)) || fallback;
}

// --- HTML discovery: <link rel="alternate" type="application/rss+xml"> ---

const FEED_TYPES = /^application\/(rss|atom|rdf|feed)\+(xml|json)$|^application\/(rss|atom)$|^text\/xml$/i;

function attrsOf(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  // Each alternative stops at a quote, space or `>`, so this is linear too.
  for (const m of tag.matchAll(/([a-zA-Z_:][-\w:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>=`]+))/g)) {
    out[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return out;
}

/** Feeds a page declares in its <head>, resolved against the page's own URL. */
const GENERIC_TITLE = /^(rss|atom|feed|rss feed|atom feed|rss 2\.0|subscribe)$/i;

export function feedLinksIn(html: string, pageUrl: URL, fallbackTitle: string): SubscriptionCandidate[] {
  const found: SubscriptionCandidate[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/<link\b[^<>]*>/gi)) {
    const a = attrsOf(m[0]);
    const rels = (a.rel ?? "").toLowerCase().split(/\s+/);
    if (!rels.includes("alternate") || !FEED_TYPES.test((a.type ?? "").trim()) || !a.href) continue;
    let url: URL;
    try {
      url = new URL(a.href, pageUrl);
    } catch {
      continue;
    }
    if (blockedTarget(url) || seen.has(url.href)) continue;
    // Comment feeds are declared the same way and are never what anyone means.
    if (/comments?/i.test(a.title ?? "") || /\/comments\/feed/i.test(url.pathname)) continue;
    seen.add(url.href);
    // "RSS" and "Atom" name the format, not the site (YouTube, simonwillison.net).
    const declared = a.title?.trim() ?? "";
    const title = !declared || GENERIC_TITLE.test(declared) ? fallbackTitle : declared;
    found.push({ title, type: /json/i.test(a.type) ? "json" : "rss", url: url.href });
    if (found.length >= 5) break;
  }
  return found;
}
