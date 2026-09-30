import { pool } from "./db";
import { allCategories, feedUrlsByCategory } from "./miniflux";
import { STARTER_PACKS, type StarterPack } from "./starter-packs";

export type Suggestion = { title: string; feedUrl: string };

const MAX_SUGGESTIONS = 3;

/**
 * Normalises a feed URL for comparison only, never for display or storage.
 * Strips scheme and a trailing slash so "https://x.com/feed" and
 * "http://x.com/feed/" are recognised as the same source.
 */
function normalizeUrl(raw: string): string {
  return raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

/**
 * Picks the starter pack that fits a folder, or null if none does
 * confidently enough to show. An irrelevant suggestion is worse than none
 * (see the caller), so this never guesses.
 *
 * 1. Name match: the folder's title against a pack's `category` (the field
 *    the packs were deliberately named to line up with, see
 *    starter-packs.ts) or its `name`.
 * 2. Fallback: the pack whose feeds overlap the folder's EXISTING feeds the
 *    most, by normalised URL. Zero overlap across every pack = no match.
 */
function resolvePack(folderTitle: string, folderFeedUrls: Set<string>): StarterPack | null {
  const norm = folderTitle.trim().toLowerCase();
  const byName = STARTER_PACKS.find(
    (p) => p.category.toLowerCase() === norm || p.name.toLowerCase() === norm
  );
  if (byName) return byName;

  let best: StarterPack | null = null;
  let bestOverlap = 0;
  for (const pack of STARTER_PACKS) {
    const overlap = pack.feeds.filter((f) => folderFeedUrls.has(normalizeUrl(f.url))).length;
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = pack;
    }
  }
  return bestOverlap > 0 ? best : null;
}

async function dismissedUrls(): Promise<Set<string>> {
  const res = await pool.query<{ feed_url: string }>(`select feed_url from app.dismissed_suggestion`);
  return new Set(res.rows.map((r) => normalizeUrl(r.feed_url)));
}

/**
 * At most 3 starter-pack sources that fit `categoryId`'s folder, excluding
 * anything already subscribed (in any folder) or previously dismissed.
 * Costs one Miniflux read and one cheap Postgres read, no LLM, no
 * embeddings call, safe to run on every folder page render.
 */
export async function suggestionsForFolder(categoryId: number): Promise<Suggestion[]> {
  const [categories, feeds, dismissed] = await Promise.all([
    allCategories(),
    feedUrlsByCategory(),
    dismissedUrls(),
  ]);

  const folder = categories.find((c) => c.id === categoryId);
  if (!folder) return [];

  const subscribed = new Set(feeds.map((f) => normalizeUrl(f.url)));
  const folderFeedUrls = new Set(
    feeds.filter((f) => f.categoryId === categoryId).map((f) => normalizeUrl(f.url))
  );

  const pack = resolvePack(folder.title, folderFeedUrls);
  if (!pack) return [];

  const suggestions: Suggestion[] = [];
  for (const feed of pack.feeds) {
    const norm = normalizeUrl(feed.url);
    if (subscribed.has(norm) || dismissed.has(norm)) continue;
    suggestions.push({ title: feed.title, feedUrl: feed.url });
    if (suggestions.length >= MAX_SUGGESTIONS) break;
  }
  return suggestions;
}
