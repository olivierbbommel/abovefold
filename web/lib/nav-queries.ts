import { cache } from "react";
import { readEntryIdsSince } from "@/lib/miniflux";
import { MAX_PER_SOURCE } from "@/lib/queries";
import { pool } from "./db";
import { feedsByCategory, folders } from "./miniflux";
import { ONE_ROW_PER_CLUSTER, readLaterItems, recentlyReadItems, todayItems } from "./queries";
import type { Folder, Item } from "./types";

/*
 * Reads for the navigation layer (rail, tab bar, Library) and Today's
 * presentation of folder balance. Nothing here changes what Today contains;
 * balance itself lives in lib/balance.ts and is applied inside todayItems().
 *
 * The layout and the Today page both need the unfiltered ranked list (the
 * rail shows its count, the page shows the stories and the mix). React's
 * cache() makes that one query per request instead of two.
 */

export const cachedTodayItems = cache((limit: number, sort: "ranked" | "newest", feedIds?: number[]) =>
  todayItems(limit, sort, feedIds)
);
export const cachedFolders = cache(() => folders());
export const cachedFeedsByCategory = cache(() => feedsByCategory());
export const cachedReadLaterItems = cache(() => readLaterItems());
export const cachedRecentlyReadItems = cache(() => recentlyReadItems());

/** How many stories Today loads with the page (spec 5.1: 30 come down at once). */
export const TODAY_LIMIT = 30;

/**
 * Stories published in the last 24 hours, per folder. This replaces the
 * unread totals the rail used to show (999+ on four of six folders, spec A9):
 * "new today" is information, a lifetime unread count is a guilt bar.
 * One row per cluster, same as every list, so the number matches what the
 * folder page will actually show.
 */
export const newTodayByFolder = cache(async (): Promise<Record<number, number>> => {
  const [byCategory, { rows }] = await Promise.all([
    cachedFeedsByCategory(),
    pool.query<{ feed_id: string; n: string }>(
      `
      select a.feed_id, count(*) as n
      from app.article a
      left join (
        select ac.article_id, ac.cluster_id, c.canonical_article_id
        from app.article_cluster ac
        join app.cluster c on c.id = ac.cluster_id
      ) cl on cl.article_id = a.id
      where a.published_at > now() - interval '24 hours'
        and not a.hidden
        and ${ONE_ROW_PER_CLUSTER}
      group by a.feed_id
      `
    ),
  ]);
  const perFeed = new Map(rows.map((r) => [Number(r.feed_id), Number(r.n)] as const));
  const result: Record<number, number> = {};
  for (const [catId, feeds] of Object.entries(byCategory)) {
    result[Number(catId)] = feeds.reduce((sum, f) => sum + (perFeed.get(f.id) ?? 0), 0);
  }
  return result;
});

export type MixEntry = { folderId: number; title: string; count: number };

/*
 * The number next to each folder in the Filter sheet: exactly how many
 * stories choosing that folder will show. The sheet used to print the
 * folder's share of the BALANCED Today mix ("Business 6"), and choosing it
 * showed the unbalanced folder view (7 stories). Same rules as todayItems
 * with a folder filter: 48h, not hidden, not read, one row per cluster, at
 * most MAX_PER_SOURCE per source, capped at the page size.
 */
export const folderFilterCounts = cache(async (): Promise<MixEntry[]> => {
  const [read, allFolders, byCategory] = await Promise.all([
    readEntryIdsSince(48).catch(() => [] as number[]),
    cachedFolders(),
    cachedFeedsByCategory(),
  ]);
  const { rows } = await pool.query<{ feed_id: string; n: string }>(
    `
    select a.feed_id, least(count(*), $2::int) as n
    from app.article a
    left join (
      select ac.article_id, ac.cluster_id, c.canonical_article_id
      from app.article_cluster ac
      join app.cluster c on c.id = ac.cluster_id
    ) cl on cl.article_id = a.id
    where a.published_at > now() - interval '48 hours'
      and not a.hidden
      and ${ONE_ROW_PER_CLUSTER}
      and not (a.miniflux_id = any($1::bigint[]))
    group by a.feed_id
    `,
    [read, MAX_PER_SOURCE]
  );
  const perFeed = new Map(rows.map((r) => [Number(r.feed_id), Number(r.n)] as const));
  return allFolders
    .map((f) => ({
      folderId: f.id,
      title: f.title,
      count: Math.min(
        TODAY_LIMIT,
        (byCategory[f.id] ?? []).reduce((sum, feed) => sum + (perFeed.get(feed.id) ?? 0), 0)
      ),
    }))
    .filter((e) => e.count > 0);
});

/**
 * "Today's mix" (spec 6.2): how many of the stories on Today come from each
 * folder, largest first. Text only, no bars; it answers "what is in the
 * list" without turning the list into a report card. Always computed from
 * the unfiltered ranked list, so the Filter sheet can show the same numbers
 * next to each folder while a filter is active.
 */
export const todayMix = cache(async (): Promise<MixEntry[]> => {
  const [items, allFolders, byCategory] = await Promise.all([
    cachedTodayItems(TODAY_LIMIT, "ranked"),
    cachedFolders(),
    cachedFeedsByCategory(),
  ]);
  return mixOf(items, allFolders, byCategory);
});

export function mixOf(
  items: Item[],
  allFolders: Folder[],
  byCategory: Record<number, { id: number }[]>
): MixEntry[] {
  const folderOfFeed = new Map<number, number>();
  for (const [catId, feeds] of Object.entries(byCategory)) {
    for (const feed of feeds) folderOfFeed.set(feed.id, Number(catId));
  }
  const counts = new Map<number, number>();
  for (const item of items) {
    const folderId = folderOfFeed.get(item.feedId);
    if (folderId === undefined) continue;
    counts.set(folderId, (counts.get(folderId) ?? 0) + 1);
  }
  return allFolders
    .map((f) => ({ folderId: f.id, title: f.title, count: counts.get(f.id) ?? 0 }))
    .filter((e) => e.count > 0)
    .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title));
}

/** Unread newsletter issues, summed from the feeds behind inbound addresses. */
export async function newsletterUnread(newsletterIds: number[]): Promise<number> {
  const byCategory = await cachedFeedsByCategory();
  const ids = new Set(newsletterIds);
  return Object.values(byCategory)
    .flat()
    .filter((feed) => ids.has(feed.id))
    .reduce((total, feed) => total + feed.unread, 0);
}
