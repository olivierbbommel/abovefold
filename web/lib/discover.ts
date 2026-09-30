import { pool } from "@/lib/db";
import { feedsByCategory, folders as minifluxFolders } from "@/lib/miniflux";
import { blockedTarget, fetchChecked, mapLimit, readCappedText, refused } from "@/lib/safe-fetch";
import {
  feedLinksIn,
  looksLikeFeed,
  parseFeed,
  titleOf,
  type FeedPreview,
  type SubscriptionCandidate,
} from "@/lib/feed-parse";

/*
 * Feed discovery + a one-fetch preview + a free (no-embeddings) folder guess.
 *
 * Lives in lib so both POST /api/discover (a URL) and POST /api/resolve (a
 * name like "The Atlantic", which becomes candidate URLs) share one
 * implementation rather than one calling the other over HTTP.
 *
 * Discovery runs here, through the shared fetch guard, and never through
 * Miniflux's /v1/discover. Miniflux runs with FETCHER_ALLOW_PRIVATE_NETWORKS
 * on (it has to, to poll the generated newsletter feeds) and follows
 * redirects itself, so handing it a typed or guessed address let any site
 * 302 it into the compose network. Miniflux now only ever sees a feed URL at
 * subscribe time, after that URL has been vetted.
 */

// Byte caps on everything read from a site. Without them a single huge or
// slow page was buffered whole before any parsing started.
// A page cap of 1 MB, not less: YouTube declares a channel's feed at byte
// 756 K, below a <head> full of inline script.
const PAGE_MAX_BYTES = 1024 * 1024;
const PREVIEW_MAX_BYTES = 1024 * 1024;
const PROBE_MAX_BYTES = 64 * 1024;

// --- folder suggestion: word overlap against existing folders' topics ------
//
// No embeddings call: this must cost nothing per keystroke, and it only
// runs once per "Find feed" click anyway. Compares tokenized words from the
// candidate's recent titles against the tokenized app.article_ai.topics of
// each existing folder's articles; picks the folder with the clear highest
// overlap, or no suggestion at all if the signal is too thin or ambiguous.

const STOPWORDS = new Set([
  "this", "that", "with", "from", "have", "will", "your", "about", "into",
  "after", "over", "under", "more", "than", "what", "when", "where", "which",
  "while", "their", "there", "these", "those", "been", "being", "some",
  "such", "only", "just", "also", "says", "said", "how", "why", "who", "does",
  "could", "would", "should", "here", "were", "they", "them", "then",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
}

type FolderSuggestion = { categoryId: number; title: string; reason: string };

async function suggestFolder(candidateTitle: string, preview: FeedPreview | null): Promise<FolderSuggestion | null> {
  if (!preview) return null;

  const [byCategory, allFolders] = await Promise.all([feedsByCategory(), minifluxFolders()]);

  const feedToCategory = new Map<number, number>();
  const allFeedIds: number[] = [];
  for (const [catIdStr, feeds] of Object.entries(byCategory)) {
    const catId = Number(catIdStr);
    for (const feed of feeds) {
      feedToCategory.set(feed.id, catId);
      allFeedIds.push(feed.id);
    }
  }
  if (allFeedIds.length === 0) return null;

  const { rows } = await pool.query<{ feed_id: string; topics: string[] | null }>(
    `select a.feed_id, ai.topics
     from app.article a
     join app.article_ai ai on ai.article_id = a.id
     where a.feed_id = any($1) and ai.topics is not null
     order by a.published_at desc
     limit 2000`,
    [allFeedIds]
  );

  const folderWordFreq = new Map<number, Map<string, number>>();
  for (const row of rows) {
    const catId = feedToCategory.get(Number(row.feed_id));
    if (catId === undefined) continue;
    const freq = folderWordFreq.get(catId) ?? new Map<string, number>();
    for (const topic of row.topics ?? []) {
      for (const word of tokenize(topic)) {
        freq.set(word, (freq.get(word) ?? 0) + 1);
      }
    }
    folderWordFreq.set(catId, freq);
  }

  const candidateWords = new Set<string>();
  for (const text of [candidateTitle, ...preview.recentItems.map((i) => i.title)]) {
    for (const word of tokenize(text)) candidateWords.add(word);
  }
  if (candidateWords.size === 0) return null;

  let bestCatId: number | null = null;
  let bestScore = 0;
  let secondScore = 0;
  for (const [catId, freq] of folderWordFreq) {
    let score = 0;
    for (const word of candidateWords) {
      score += Math.min(freq.get(word) ?? 0, 5);
    }
    if (score > bestScore) {
      secondScore = bestScore;
      bestScore = score;
      bestCatId = catId;
    } else if (score > secondScore) {
      secondScore = score;
    }
  }

  const CONFIDENCE_THRESHOLD = 3;
  if (bestCatId === null || bestScore < CONFIDENCE_THRESHOLD || bestScore === secondScore) {
    return null; // not confident: no suggestion rather than a guess
  }

  const folder = allFolders.find((f) => f.id === bestCatId);
  if (!folder) return null;

  return {
    categoryId: folder.id,
    title: folder.title,
    reason: `reads closest to your ${folder.title} sources`,
  };
}

// --- fallback: probe the addresses feeds usually live at ----------------
//
// Discovery reads <link rel="alternate"> off the page. Plenty of sites
// publish a feed and never declare it. hbr.org is the case that prompted
// this: it serves a perfectly good Atom feed from feeds.harvardbusiness.org
// and advertises it nowhere, so the page alone says there is no feed.
//
// This cannot find a feed on a different domain (nothing could, without a
// directory), but it does catch the common case of an undeclared feed at a
// predictable path on the same site.

const COMMON_FEED_PATHS = [
  "/feed", "/rss", "/feed.xml", "/rss.xml", "/atom.xml", "/index.xml",
  "/feeds/posts/default", "/blog/feed", "/blog/rss", "/?feed=rss2",
  // theatlantic.com answers 403 on its homepage, /feed and /rss, and serves
  // its full feed here.
  "/feed/all/",
];

type PageRead =
  | { status: "feed"; candidates: SubscriptionCandidate[] }
  | { status: "page"; candidates: SubscriptionCandidate[] }
  | { status: "blocked" }       // the site answered 403: it refuses robots
  | { status: "http"; code: number }
  | { status: "unreachable" };  // DNS, TLS, timeout, or a refused private target

async function readPage(url: URL): Promise<PageRead> {
  let result;
  try {
    result = await fetchChecked(url, {
      headers: { Accept: "text/html,application/xhtml+xml,application/rss+xml,application/atom+xml;q=0.9,*/*;q=0.5" },
      timeoutMs: 10_000,
    });
  } catch {
    return { status: "unreachable" };
  }
  if (refused(result)) return { status: "unreachable" };
  if (result.status === 403 || result.status === 401) {
    await result.body?.cancel().catch(() => {});
    return { status: "blocked" };
  }
  if (!result.ok) {
    await result.body?.cancel().catch(() => {});
    return { status: "http", code: result.status };
  }
  // The final hop's URL, so relative hrefs resolve against where we landed.
  const landed = new URL(result.url || url.href);
  const body = await readCappedText(result, PAGE_MAX_BYTES);
  if (looksLikeFeed(body)) {
    return { status: "feed", candidates: [{ title: titleOf(body, landed.hostname), type: "rss", url: landed.href }] };
  }
  const pageTitle = titleOf(body, landed.hostname);
  return { status: "page", candidates: feedLinksIn(body, landed, pageTitle) };
}

async function probeCommonPaths(input: string): Promise<SubscriptionCandidate[]> {
  let origin: URL;
  try {
    origin = new URL(input.includes("://") ? input : `https://${input}`);
  } catch {
    return [];
  }

  const found: SubscriptionCandidate[] = [];
  // Four at a time: ten parallel fetches per site, times several sites per
  // name lookup, was a fan-out of eighty requests for one keystroke.
  await mapLimit(COMMON_FEED_PATHS, 4, async (path) => {
    const candidate = new URL(path, origin.origin);
    try {
      // Through the shared guard: the origin here is whatever the user typed,
      // so this is a fetcher pointed at a user-supplied address. Owner-only,
      // but an unguarded fetcher is the thing that rots into a hole later.
      const result = await fetchChecked(candidate, {
        headers: { "User-Agent": "abovefold/1.0 (feed discovery)" },
        timeoutMs: 6000,
      });
      if (refused(result)) return;
      if (!result.ok) {
        await result.body?.cancel().catch(() => {});
        return;
      }
      const body = await readCappedText(result, PROBE_MAX_BYTES);
      if (!looksLikeFeed(body)) return;
      found.push({ title: titleOf(body, origin.hostname), type: "rss", url: candidate.toString() });
    } catch {
      // Any failure just means this is not the path.
    }
  });

  // Stable order: the earlier a path appears in COMMON_FEED_PATHS, the more
  // likely it is the site's canonical one.
  found.sort(
    (a, b) =>
      COMMON_FEED_PATHS.findIndex((path) => a.url.endsWith(path)) -
      COMMON_FEED_PATHS.findIndex((path) => b.url.endsWith(path))
  );
  return found.slice(0, 3);
}


export type DiscoverKind = "found" | "none" | "blocked" | "unavailable";

export type DiscoverResult = {
  /** Machine-readable outcome, so the UI never has to parse the hint text. */
  kind: DiscoverKind;
  candidates: SubscriptionCandidate[];
  preview: FeedPreview | null;
  folderSuggestion: FolderSuggestion | null;
  hint?: string;
};

export type { SubscriptionCandidate, FeedPreview, FolderSuggestion };

export type DiscoverOutcome = { ok: true; result: DiscoverResult } | { ok: false; error: string };

/** Parse and guard a user-typed address. Null when it is not a usable public URL. */
export function parsePublicUrl(raw: string): URL | { error: string } {
  let requested: URL;
  try {
    const trimmed = raw.trim();
    requested = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
  } catch {
    return { error: "that does not look like a URL" };
  }
  // Refuse a visibly private target up front with a clear message. Names
  // that only resolve privately are caught by the fetch guard's own lookup.
  if (blockedTarget(requested)) {
    return { error: "that address is on a private network, so there is nothing to subscribe to" };
  }
  return requested;
}

const KIND_RANK: Record<DiscoverKind, number> = { found: 3, blocked: 2, none: 1, unavailable: 0 };

/*
 * Many sites only work on one of example.com / www.example.com. gatesnotes.com
 * is the case that surfaced it: the bare name serves a certificate that does
 * not verify, so it read as "no feed", hiding that the real site
 * (www.gatesnotes.com) exists and simply refuses robots, which is the signal
 * that sends the owner to the email route. So a bare domain that comes up
 * short gets one retry with www., and the more informative answer wins.
 */
export async function discoverFeeds(raw: string): Promise<DiscoverOutcome> {
  let first = await discoverOnce(raw);
  // Typed without a scheme, tried over HTTPS, and nothing answered: some feed
  // hosts still have no TLS at all (feeds.harvardbusiness.org is one).
  if (first.ok && first.result.kind === "unavailable" && !/^[a-z][a-z0-9+.-]*:\/\//i.test(raw.trim())) {
    const plain = await discoverOnce(`http://${raw.trim()}`);
    if (plain.ok && KIND_RANK[plain.result.kind] > KIND_RANK[first.result.kind]) first = plain;
  }
  if (!first.ok || first.result.kind === "found") return first;
  const parsed = parsePublicUrl(raw);
  if (!(parsed instanceof URL) || parsed.hostname.startsWith("www.") || parsed.pathname.length > 1) return first;
  const www = new URL(parsed.toString());
  www.hostname = `www.${parsed.hostname}`;
  const second = await discoverOnce(www.toString());
  if (!second.ok) return first;
  return KIND_RANK[second.result.kind] > KIND_RANK[first.result.kind] ? second : first;
}

async function discoverOnce(raw: string): Promise<DiscoverOutcome> {
  const parsed = parsePublicUrl(raw);
  if (!(parsed instanceof URL)) return { ok: false, error: parsed.error };
  const requested = parsed;

  /*
   * Reading the page is an OPTIMISATION, not a gate. A site whose page fails
   * may still serve its feed at /rss, so record why the page failed, carry
   * on to the probe, and only report anything once the probe has also come
   * up empty. gatesnotes.com is the case that shaped this: it sits behind
   * Akamai and answers 403 to any server-side fetch, which must read as
   * "refuses robots" (use email), not "no such site".
   */
  const page = await readPage(requested);
  let candidates: SubscriptionCandidate[] = page.status === "feed" || page.status === "page" ? page.candidates : [];

  if (candidates.length === 0 && page.status !== "unreachable") {
    candidates = await probeCommonPaths(requested.toString());
  }

  if (candidates.length === 0) {
    // A 429 or 5xx says nothing about whether a feed exists. Reporting it as
    // "none" was cached, which buried reuters.com and wsj.com for good and
    // told the owner r/programming had no feed while Reddit rate limited us.
    const transient = page.status === "unreachable" || (page.status === "http" && (page.code === 429 || page.code >= 500));
    const kind: DiscoverKind = page.status === "blocked" ? "blocked" : transient ? "unavailable" : "none";
    const hint =
      kind === "blocked"
        ? "That site refuses automated requests, so nothing running on a server can read its feed, including this one. If it has an email newsletter, Follow by email below works: they send to you, so there is nothing for them to block."
        : kind === "unavailable"
          ? "Could not reach that site. Check the address, or try again in a moment."
          : "No feed found at that address, and none at the usual paths. If you know the feed URL, paste it directly. Otherwise try Follow by email below.";
    return { ok: true, result: { kind, candidates: [], preview: null, folderSuggestion: null, hint } };
  }

  const top = candidates[0];

  let preview: FeedPreview | null = null;
  try {
    // Same guard. A page can declare any URL as its feed, and the user can
    // paste one directly, so this is not a trusted address either.
    const result = await fetchChecked(new URL(top.url), { timeoutMs: 10000 });
    if (!refused(result) && result.ok) {
      preview = parseFeed(await readCappedText(result, PREVIEW_MAX_BYTES));
    } else if (!refused(result)) {
      await result.body?.cancel().catch(() => {});
    }
  } catch {
    // Preview is best-effort; discovery already succeeded without it.
  }

  let folderSuggestion: FolderSuggestion | null = null;
  try {
    folderSuggestion = await suggestFolder(top.title, preview);
  } catch (err) {
    console.error("folder suggestion failed", err);
  }

  return { ok: true, result: { kind: "found", candidates, preview, folderSuggestion } };
}
