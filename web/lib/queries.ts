import { pool } from "./db";
import { feedsByCategory, folders as minifluxFolders, readEntryIds, readEntryIdsForFeeds, readEntryIdsSince, starredEntryIds } from "./miniflux";
import { balanceByFolder } from "./balance";
import type { Article, Item, SourceStats } from "./types";

// --- row shaping -----------------------------------------------------------
//
// Every "item" query selects the same shape: the article, its (optional) AI
// summary, its (optional) score, and its (optional) cluster membership. The
// cluster subquery also carries the cluster's canonical_article_id so callers
// that want "one row per cluster" can filter on it.

// Exported for lib/ai-feeds.ts: aiFeedItems() ranks app.article_ai.embedding
// against an AI Feed's stored vector and needs the exact same row shape and
// mapper as every other item list in the app.
export const ITEM_COLUMNS = `
  a.id,
  a.miniflux_id,
  a.title,
  a.url,
  a.feed_title,
  a.feed_id,
  a.published_at,
  a.lead_image,
  ai.summary,
  ai.bullets,
  ai.topics,
  coalesce(s.final_score, 0) as final_score,
  coalesce(s.reason, '') as reason,
  coalesce(cl.cluster_size, 1) as cluster_size,
  cl.cluster_id,
  cl.canonical_article_id
`;

export const ITEM_FROM = `
  from app.article a
  left join app.article_ai ai on ai.article_id = a.id
  left join app.score s on s.article_id = a.id
  left join (
    select
      ac.article_id,
      ac.cluster_id,
      c.canonical_article_id,
      count(*) over (partition by ac.cluster_id) as cluster_size
    from app.article_cluster ac
    join app.cluster c on c.id = ac.cluster_id
  ) cl on cl.article_id = a.id
`;

// Restricts a result set to one row per cluster (the canonical article),
// while still passing through articles that have no cluster row at all.
export const ONE_ROW_PER_CLUSTER = `(cl.cluster_id is null or a.id = cl.canonical_article_id)`;

/*
 * For lists scoped to a set of feeds (a folder, a source, Newsletters): one
 * row per cluster among THOSE feeds. ONE_ROW_PER_CLUSTER keeps only the
 * global canonical, which can sit in a feed outside the list, and then the
 * story showed on no page of its own source at all (49 articles did).
 * Prefer the canonical when it is in scope, else the newest member.
 */
function scopedClusterQuery(extraWhere: string): string {
  return `
    select * from (
      select distinct on (coalesce(cl.cluster_id, -a.id)) ${ITEM_COLUMNS}
      ${ITEM_FROM}
      where a.feed_id = any($1)
        and not a.hidden
        ${extraWhere}
      order by coalesce(cl.cluster_id, -a.id),
               (a.id = cl.canonical_article_id) desc nulls last,
               a.published_at desc
    ) one_per_cluster
    order by published_at desc
    limit $2
  `;
}

export type ItemRow = {
  id: string;
  miniflux_id: string;
  title: string;
  url: string;
  feed_title: string | null;
  feed_id: string;
  published_at: Date;
  lead_image: string | null;
  summary: string | null;
  bullets: string[] | null;
  topics: string[] | null;
  final_score: number;
  reason: string;
  cluster_size: string;
  cluster_id: string | null;
  canonical_article_id: string | null;
};

/**
 * List rows deliberately drop `bullets` and `topics`. No list component reads
 * them, but they were still being serialised into every page payload, 60
 * items' worth of unused arrays crossing the wire on a phone. The article page
 * gets them from articleById, which keeps them.
 */
export function mapRowToItem(row: ItemRow, opts: { lean?: boolean } = {}): Item {
  return {
    id: Number(row.id),
    title: row.title,
    url: row.url,
    feedTitle: row.feed_title ?? "",
    feedId: Number(row.feed_id),
    publishedAt: row.published_at.toISOString(),
    leadImage: row.lead_image ?? null,
    summary: row.summary ?? null,
    bullets: opts.lean ? null : (row.bullets ?? null),
    topics: opts.lean ? null : (row.topics ?? null),
    score: row.final_score,
    reason: row.reason,
    clusterSize: Number(row.cluster_size),
    clusterId: row.cluster_id === null ? null : Number(row.cluster_id),
  };
}

// --- queries -----------------------------------------------------------

/**
 * Ranked Today feed: one row per cluster, published within the last 48h,
 * EXCLUDING anything already read.
 *
 * Today used to ignore read state entirely, which made two features lie:
 * "mark all read" re-rendered an identical list so it looked like nothing had
 * happened, and swiping "mark read" only hid the row in client state, reload
 * and every archived story was back. Read state lives in Miniflux (so it stays
 * in sync with Reeder), hence the join through miniflux_id.
 *
 * `feedIds` is an optional folder filter, pass the feed ids for a Miniflux
 * category (see `feedsByCategory()`) to restrict Today to that folder, same
 * as `folderItems` does for the standalone folder view. `undefined` means
 * "every feed" (the normal case); an empty array means "this folder has no
 * feeds", which correctly returns no items rather than silently falling
 * back to unfiltered.
 */
/**
 * Most stories per source in the ranked Today list.
 *
 * Volume alone decided the mix: an aggregator publishing 85 stories in 48h
 * next to a weekly essayist publishing 2 gets 42x the chances of appearing,
 * and took 27 of 30 slots in testing. Compounding it, during cold start
 * `relevance` and `source_affinity` are both exactly 0.5 for every article,
 * so two of the five ranking signals contribute an identical constant and the
 * order is effectively decided by recency and novelty alone, which is
 * precisely what favours whoever publishes most.
 *
 * A cap does not distort the ranking within a source; it just stops one
 * firehose crowding out everything else.
 */
export const MAX_PER_SOURCE = 3;

export async function todayItems(
  limit = 50,
  sort: "ranked" | "newest" = "ranked",
  feedIds?: number[],
  maxPerSource: number = MAX_PER_SOURCE
): Promise<Item[]> {
  if (feedIds && feedIds.length === 0) return [];

  const read = await readEntryIdsSince(48).catch(() => [] as number[]);
  const orderBy = sort === "newest" ? "a.published_at desc" : "final_score desc";

  const sql = `
    with ranked as (
      select ${ITEM_COLUMNS},
             row_number() over (partition by a.feed_id order by ${orderBy}) as per_source_rank
      ${ITEM_FROM}
      where a.published_at > now() - interval '48 hours'
        and not a.hidden
        and ${ONE_ROW_PER_CLUSTER}
        and not (a.miniflux_id = any($2::bigint[]))
        ${feedIds ? "and a.feed_id = any($4::bigint[])" : ""}
    )
    select * from ranked
    where per_source_rank <= $3
    order by ${sort === "newest" ? "published_at desc" : "final_score desc"}
    limit $1
  `;
  // Folder balance applies to the ranked, unfiltered view only. A folder
  // filter already chose one folder, and "newest" is chronological browsing
  // where hiding stories would be a lie about what arrived. The candidate pool
  // is several times the limit so the balancer has alternatives to promote.
  const balance = sort === "ranked" && !feedIds;
  const poolSize = balance ? limit * 4 : limit;
  const params: unknown[] = feedIds
    ? [poolSize, read, maxPerSource, feedIds]
    : [poolSize, read, maxPerSource];
  const { rows } = await pool.query<ItemRow>(sql, params);
  const items = rows.map((r) => mapRowToItem(r, { lean: true }));
  if (!balance) return items;

  const byCategory = await feedsByCategory().catch(() => ({} as Record<number, { id: number }[]>));
  const folderOfFeed = new Map<number, number>();
  for (const [catId, feeds] of Object.entries(byCategory)) {
    for (const feed of feeds) folderOfFeed.set(feed.id, Number(catId));
  }
  return balanceByFolder(items, (feedId) => folderOfFeed.get(feedId) ?? null, limit);
}

/** Hide every stored article of these feeds (they were unsubscribed). */
export async function hideArticlesOfFeeds(feedIds: number[]): Promise<void> {
  if (feedIds.length === 0) return;
  await pool.query(`update app.article set hidden = true where feed_id = any($1) and not hidden`, [feedIds]);
}

/** Items for a set of feed ids (a folder), one row per cluster, newest first. */
export async function folderItems(feedIds: number[], limit = 100): Promise<Item[]> {
  if (feedIds.length === 0) return [];
  const sql = scopedClusterQuery("");
  const { rows } = await pool.query<ItemRow>(sql, [feedIds, limit]);
  return rows.map((r) => mapRowToItem(r, { lean: true }));
}

/*
 * Issues for the Newsletters section.
 *
 * Chronological and uncapped like a folder, but with two differences that
 * make it behave like an inbox:
 *
 *   hidden   admin mail that became an article before classification
 *            existed. A property of the article, not derived from whether
 *            the matching message still exists (see db/init/12).
 *   read     archiving an issue takes it out of the list. Without this,
 *            Archive marked the entry read in Miniflux and the row stayed
 *            on screen, so it read as a button that did nothing.
 *
 * The read window is long because newsletters are low volume: a weekly is
 * still one row a week, and an issue archived last month should stay gone.
 */
export async function newsletterItems(feedIds: number[], limit = 100): Promise<Item[]> {
  if (feedIds.length === 0) return [];
  const read = await readEntryIdsForFeeds(feedIds, 24 * 180).catch(() => [] as number[]);
  const sql = scopedClusterQuery("and not (a.miniflux_id = any($3::bigint[]))");
  const { rows } = await pool.query<ItemRow>(sql, [feedIds, limit, read]);
  return rows.map((r) => mapRowToItem(r, { lean: true }));
}

/** Articles currently starred in Miniflux, most-recently-starred first. */
export async function readLaterItems(): Promise<Item[]> {
  const entryIds = await starredEntryIds();
  return itemsByMinifluxIds(entryIds);
}

/** Articles currently marked read in Miniflux, most-recently-read first. */
export async function recentlyReadItems(): Promise<Item[]> {
  const entryIds = await readEntryIds();
  return itemsByMinifluxIds(entryIds);
}

// Looks up articles by Miniflux entry id and returns them in the same order
// the ids were given (Miniflux already orders by changed_at desc). Deliberately
// does NOT collapse clusters, a starred/read article is a specific article,
// not "whichever one is canonical for its cluster".
async function itemsByMinifluxIds(entryIds: number[]): Promise<Item[]> {
  if (entryIds.length === 0) return [];
  const sql = `
    select ${ITEM_COLUMNS}
    ${ITEM_FROM}
    where a.miniflux_id = any($1)
  `;
  const { rows } = await pool.query<ItemRow>(sql, [entryIds]);
  const byMinifluxId = new Map(rows.map((row) => [Number(row.miniflux_id), row] as const));
  const ordered: Item[] = [];
  for (const entryId of entryIds) {
    const row = byMinifluxId.get(entryId);
    if (row) ordered.push(mapRowToItem(row, { lean: true }));
  }
  return ordered;
}

/** Cluster members other than `excludeId`, oldest first (canonical is usually the exclude). */
export async function clusterSiblings(clusterId: number, excludeId: number): Promise<Item[]> {
  const sql = `
    select ${ITEM_COLUMNS}
    ${ITEM_FROM}
    where cl.cluster_id = $1 and a.id <> $2
    order by a.published_at asc
  `;
  const { rows } = await pool.query<ItemRow>(sql, [clusterId, excludeId]);
  return rows.map((r) => mapRowToItem(r, { lean: true }));
}

type ArticleRow = ItemRow & { extracted_text: string | null; author: string | null };

/** A single article with its full extracted text, or null if it doesn't exist. */
export async function articleById(id: number): Promise<Article | null> {
  const sql = `
    select ${ITEM_COLUMNS}, a.extracted_text, a.author
    ${ITEM_FROM}
    where a.id = $1
  `;
  const { rows } = await pool.query<ArticleRow>(sql, [id]);
  const row = rows[0];
  if (!row) return null;
  return {
    ...mapRowToItem(row),
    extractedText: row.extracted_text ?? "",
    author: row.author ?? null,
  };
}

/** 2-4 short sentences summarising today, derived from SQL only (no LLM call). */
export async function briefForToday(): Promise<string[]> {
  const sql = `
    select
      a.id,
      a.feed_id,
      a.title,
      ai.topics,
      coalesce(cl.cluster_size, 1) as cluster_size,
      cl.cluster_id,
      cl.canonical_article_id
    from app.article a
    left join app.article_ai ai on ai.article_id = a.id
    left join (
      select
        ac.article_id,
        ac.cluster_id,
        c.canonical_article_id,
        count(*) over (partition by ac.cluster_id) as cluster_size
      from app.article_cluster ac
      join app.cluster c on c.id = ac.cluster_id
    ) cl on cl.article_id = a.id
    where a.published_at > now() - interval '24 hours'
  `;
  type BriefRow = {
    id: string;
    feed_id: string;
    title: string;
    topics: string[] | null;
    cluster_size: string;
    cluster_id: string | null;
    canonical_article_id: string | null;
  };
  const { rows } = await pool.query<BriefRow>(sql);

  const lines: string[] = [];

  if (rows.length === 0) {
    return ["No new stories in the last 24 hours."];
  }

  lines.push(`${rows.length} new ${rows.length === 1 ? "story" : "stories"} in the last 24 hours.`);

  // One row per cluster (the canonical), to avoid counting near-duplicates twice.
  const collapsed = rows.filter(
    (row) => row.cluster_id === null || row.id === row.canonical_article_id
  );

  const largest = collapsed.reduce<BriefRow | null>((best, row) => {
    if (!best || Number(row.cluster_size) > Number(best.cluster_size)) return row;
    return best;
  }, null);
  if (largest && Number(largest.cluster_size) > 1) {
    lines.push(`Biggest story: "${largest.title}", covered by ${largest.cluster_size} sources.`);
  }

  const topicCounts = new Map<string, number>();
  for (const row of collapsed) {
    for (const topic of row.topics ?? []) {
      topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + 1);
    }
  }
  let busiestTopic: string | null = null;
  let busiestCount = 0;
  for (const [topic, count] of topicCounts) {
    if (count > busiestCount) {
      busiestTopic = topic;
      busiestCount = count;
    }
  }
  if (busiestTopic && busiestCount > 1) {
    lines.push(`${busiestTopic} is the most-covered topic today, with ${busiestCount} stories.`);
  }

  // A folder with nothing new today.
  const coveredFeedIds = new Set(collapsed.map((row) => Number(row.feed_id)));
  try {
    const [byCategory, allFolders] = await Promise.all([feedsByCategory(), minifluxFolders()]);
    for (const folder of allFolders) {
      const feeds = byCategory[folder.id] ?? [];
      if (feeds.length === 0) continue;
      const hasNewToday = feeds.some((feed) => coveredFeedIds.has(feed.id));
      if (!hasNewToday) {
        lines.push(`Nothing new in ${folder.title} today.`);
        break;
      }
    }
  } catch {
    // Miniflux unreachable, the brief still works with the SQL-only lines above.
  }

  return lines.slice(0, 4);
}

export type SearchMatch = "semantic" | "keyword" | "both";

// ILIKE treats %, _, and \ as special, a query containing them (e.g. "50%
// off", "foo_bar") must not silently turn into a wildcard pattern.
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Semantic + keyword search, merged into one ranked list of up to `limit`
 * items. Semantic ranks by cosine distance on ai.embedding (pgvector, HNSW
 * index) so the query doesn't need to share words with the article, "that
 * thing about ad attribution" can find it. The keyword branch (title /
 * extracted_text ILIKE) guarantees an exact-title search always works even
 * when the embedding disagrees, and always runs regardless of `embedding`.
 *
 * `embedding` is null when the query was too short to embed or the
 * OpenRouter call failed (see lib/embed.ts / lib/search.ts), in that case
 * this degrades to keyword-only rather than returning nothing.
 */
/**
 * Absolute sanity floor for semantic retrieval, cosine similarity below
 * this is noise for ANY query, not worth returning at all. Kept low
 * deliberately: similarity scales with how specific a query is (a broad,
 * saturated topic like "ai regulation" tops out around 0.25 on this corpus;
 * a narrow one like "openai" tops out around 0.5), so a floor high enough
 * to filter noise for narrow queries was filtering out the BEST available
 * answer for broad ones, measured: "ai regulation" topped at 0.2535 and
 * got zero results back at the old floor of 0.3.
 */
export const SEMANTIC_FLOOR = 0.15;

/**
 * A semantic row only counts as part of the "real" result set if it's
 * within this margin of the BEST score this particular query produced , 
 * relative, not absolute, for the same reason as SEMANTIC_FLOOR. The
 * top-scoring row always qualifies against itself, so once SEMANTIC_FLOOR
 * lets anything through at all, that top row IS a strong match: the best
 * available answer for this corpus and this query, whatever its raw score.
 */
export const SEMANTIC_RELATIVE_MARGIN = 0.15;

// A hit only counts as "strong", worth an "Exact matches" label, or
// tripping hasStrongMatch for a semantic result, once the query itself is
// long enough that the match is unlikely to be a coincidence. Below this,
// scores stop being a useful signal at all: measured on this corpus, "the"
// (3 chars) tops out at 0.246 cosine similarity, right next to "ai
// regulation" (13 chars) at 0.2535, a gap far too thin for any score-based
// cutoff to tell a real answer from a stopword's noise. Query length is the
// signal that actually separates them. Used for both branches: a keyword
// hit also needs a real word-boundary match (see strong_keyword below) , 
// "the" and "ing" match almost every article as a bare substring at 3
// characters. Below this length, or without a word-boundary hit, a keyword
// row still shows (recall matters) but isn't presented as an exact answer.
export const MIN_STRONG_MATCH_LENGTH = 4;

// Below this, a keyword scan isn't worth running at all, mirrors
// lib/search.ts's MIN_QUERY_LENGTH.
const MIN_KEYWORD_LENGTH = 3;

// Postgres regex (`~*`) special characters, escaped so user input is never
// interpreted as a pattern, distinct from escapeLike's LIKE-specific set.
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function searchItems(
  queryText: string,
  embedding: number[] | null,
  limit = 20
): Promise<{ item: Item; matchedBy: SearchMatch; similarity: number | null; keywordStrong: boolean }[]> {
  const trimmed = queryText.trim();
  if (trimmed.length === 0) return [];
  const like = `%${escapeLike(trimmed)}%`;
  // Postgres word-boundary regex, used only to grade a keyword hit as
  // strong or not; the ILIKE below still does the actual matching/recall.
  const boundary = `\\y${escapeRegex(trimmed)}\\y`;

  const keywordPromise =
    trimmed.length >= MIN_KEYWORD_LENGTH
      ? pool.query<ItemRow & { strong_keyword: boolean }>(
          `
            select ${ITEM_COLUMNS},
                   (a.title ~* $3 or a.extracted_text ~* $3) as strong_keyword
            ${ITEM_FROM}
            where ${ONE_ROW_PER_CLUSTER}
              and not a.hidden
              and (a.title ilike $1 escape '\\' or a.extracted_text ilike $1 escape '\\')
            order by (a.title ilike $1 escape '\\') desc, a.published_at desc
            limit $2
          `,
          [like, limit, boundary]
        )
      : Promise.resolve({ rows: [] as (ItemRow & { strong_keyword: boolean })[] });

  const semanticPromise = embedding
    ? pool.query<ItemRow & { similarity: string }>(
        `
          select ${ITEM_COLUMNS},
                 1 - (ai.embedding <=> $1::vector) as similarity
          ${ITEM_FROM}
          where ai.embedding is not null
            and not a.hidden
            and ${ONE_ROW_PER_CLUSTER}
            and 1 - (ai.embedding <=> $1::vector) >= ${SEMANTIC_FLOOR}
          order by ai.embedding <=> $1::vector
          limit $2
        `,
        [`[${embedding.join(",")}]`, limit]
      )
    : Promise.resolve({ rows: [] as (ItemRow & { similarity: string })[] });

  const [{ rows: keywordRows }, { rows: semanticRowsRaw }] = await Promise.all([keywordPromise, semanticPromise]);

  // Relative floor: keep only rows within SEMANTIC_RELATIVE_MARGIN of this
  // query's own best score. Rows already come back nearest-first, so the
  // first row (if any) IS the top.
  const topSimilarity = semanticRowsRaw.length > 0 ? Number(semanticRowsRaw[0].similarity) : 0;
  const semanticRows = semanticRowsRaw.filter(
    (row) => Number(row.similarity) >= topSimilarity - SEMANTIC_RELATIVE_MARGIN
  );

  const matchedBy = new Map<number, SearchMatch>();
  const byId = new Map<number, ItemRow>();
  for (const row of semanticRows) {
    const id = Number(row.id);
    byId.set(id, row);
    matchedBy.set(id, "semantic");
  }
  const strongKeyword = new Set<number>();
  for (const row of keywordRows) {
    const id = Number(row.id);
    // Don't clobber a row that carries `similarity` with one that doesn't , 
    // a "both" match must keep its semantic score.
    if (!byId.has(id)) byId.set(id, row);
    matchedBy.set(id, matchedBy.has(id) ? "both" : "keyword");
    if (trimmed.length >= MIN_STRONG_MATCH_LENGTH && row.strong_keyword) strongKeyword.add(id);
  }

  // Keyword hits are listed first, an exact-title search must always
  // surface that article, even if the embedding ranked it lower (or the
  // embedding call failed entirely). Semantic-only hits fill the rest.
  const orderedIds = [...keywordRows.map((r) => Number(r.id)), ...semanticRows.map((r) => Number(r.id))];
  const seen = new Set<number>();
  const result: { item: Item; matchedBy: SearchMatch; similarity: number | null; keywordStrong: boolean }[] = [];
  for (const id of orderedIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const row = byId.get(id);
    if (!row) continue;
    const sim = (row as ItemRow & { similarity?: string | number }).similarity;
    result.push({
      item: mapRowToItem(row, { lean: true }),
      matchedBy: matchedBy.get(id) ?? "keyword",
      similarity: sim === undefined || sim === null ? null : Number(sim),
      keywordStrong: strongKeyword.has(id),
    });
    if (result.length >= limit) break;
  }
  return result;
}

/**
 * Per-feed engagement stats. openRate is opened / (opened + skipped) and is
 * null when there are fewer than 10 such interactions, not enough signal
 * for a percentage. volumePerDay is over the last 30 days.
 */
export async function sourceStats(feedIds: number[]): Promise<Record<number, SourceStats>> {
  const result: Record<number, SourceStats> = {};
  for (const feedId of feedIds) {
    result[feedId] = { openRate: null, volumePerDay: 0, lastPost: null };
  }
  if (feedIds.length === 0) return result;

  const sql = `
    with counts as (
      select
        feed_id,
        count(*) filter (where published_at > now() - interval '30 days') as vol30,
        max(published_at) as last_post
      from app.article
      where feed_id = any($1)
      group by feed_id
    ),
    interactions as (
      select
        a.feed_id,
        count(*) filter (where i.action = 'opened') as opened,
        count(*) filter (where i.action in ('opened', 'skipped')) as total
      from app.interaction i
      join app.article a on a.id = i.article_id
      where a.feed_id = any($1)
      group by a.feed_id
    )
    select
      c.feed_id,
      c.vol30,
      c.last_post,
      coalesce(i.opened, 0) as opened,
      coalesce(i.total, 0) as total
    from counts c
    left join interactions i on i.feed_id = c.feed_id
  `;
  type StatsRow = {
    feed_id: string;
    vol30: string;
    last_post: Date | null;
    opened: string;
    total: string;
  };
  const { rows } = await pool.query<StatsRow>(sql, [feedIds]);
  for (const row of rows) {
    const total = Number(row.total);
    const opened = Number(row.opened);
    result[Number(row.feed_id)] = {
      openRate: total >= 10 ? opened / total : null,
      volumePerDay: Number(row.vol30) / 30,
      lastPost: row.last_post ? row.last_post.toISOString() : null,
    };
  }
  return result;
}
