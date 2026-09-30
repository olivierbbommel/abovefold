import { pool } from "./db";
import {
  ITEM_COLUMNS,
  ITEM_FROM,
  mapRowToItem,
  ONE_ROW_PER_CLUSTER,
  SEMANTIC_FLOOR,
  type ItemRow,
} from "./queries";
import type { Item } from "./types";

/**
 * The bar for CLAIMING an AI Feed match, deliberately higher than the
 * retrieval floor. Search can use query length to separate a noisy query
 * from a specific one; an AI Feed's query is always deliberate, so that
 * signal does not exist here.
 */
export const AI_FEED_STRONG_MATCH = 0.4;

/**
 * AI Feeds: a natural-language query saved once and re-evaluated against
 * new articles forever (Feedly Pro+'s headline feature). The single most
 * important rule in this file, and the reason it exists at all instead of
 * just calling lib/search.ts on every view, is that the query is embedded
 * EXACTLY ONCE, at creation time (see the POST handler in
 * app/api/ai-feeds/route.ts), and the resulting vector is stored in
 * app.ai_feed.embedding. A feed is viewed repeatedly; embedding on every
 * page view would turn a fixed one-off cost into a recurring one, which
 * defeats this project's whole ~$1/month economics. aiFeedItems() below
 * NEVER calls embedQuery, it only ever ranks against the stored vector.
 */

export type AiFeed = {
  id: number;
  name: string;
  query: string;
  createdAt: string; // ISO 8601
};

type AiFeedRow = {
  id: string;
  name: string;
  query: string;
  created_at: Date;
};

function mapRow(row: AiFeedRow): AiFeed {
  return {
    id: Number(row.id),
    name: row.name,
    query: row.query,
    createdAt: row.created_at.toISOString(),
  };
}

const AI_FEED_COLUMNS = `id, name, query, created_at`;

export async function listAiFeeds(): Promise<AiFeed[]> {
  const { rows } = await pool.query<AiFeedRow>(
    `select ${AI_FEED_COLUMNS} from app.ai_feed order by created_at desc`
  );
  return rows.map(mapRow);
}

export async function aiFeedById(id: number): Promise<AiFeed | null> {
  const { rows } = await pool.query<AiFeedRow>(
    `select ${AI_FEED_COLUMNS} from app.ai_feed where id = $1`,
    [id]
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

/** `embedding` is the vector from a ONE-TIME embedQuery() call, see the module note above. */
export async function createAiFeed(name: string, query: string, embedding: number[]): Promise<AiFeed> {
  const { rows } = await pool.query<AiFeedRow>(
    `insert into app.ai_feed (name, query, embedding)
     values ($1, $2, $3::vector)
     returning ${AI_FEED_COLUMNS}`,
    [name, query, `[${embedding.join(",")}]`]
  );
  return mapRow(rows[0]);
}

export async function renameAiFeed(id: number, name: string): Promise<AiFeed | null> {
  const { rows } = await pool.query<AiFeedRow>(
    `update app.ai_feed set name = $2 where id = $1 returning ${AI_FEED_COLUMNS}`,
    [id, name]
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function deleteAiFeed(id: number): Promise<boolean> {
  const { rowCount } = await pool.query(`delete from app.ai_feed where id = $1`, [id]);
  return (rowCount ?? 0) > 0;
}

/**
 * Ranks app.article_ai.embedding against this feed's STORED vector , 
 * `embedding::text` reads back pgvector's own bracketed literal
 * ("[0.01,-0.02,...]"), which is passed straight through as `$1::vector` in
 * the ranking query below with no parse/rejoin round trip. No embedding call
 * happens anywhere in this function; that is the entire point of storing
 * the vector at save time (see the module note above).
 *
 * Reuses queries.ts's ITEM_COLUMNS/ITEM_FROM/mapRowToItem so a result row
 * here is byte-for-byte the same Item shape as Today, a folder, or search , 
 * and the same SEMANTIC_FLOOR sanity bar as search's semantic branch, so
 * "nothing matched closely" means the same thing everywhere in the app. An
 * AI Feed has no keyword branch (it only ever ranks the stored vector), so
 * "strong" here is simply "cleared the floor at all", same as search's own
 * simplified rule once a row survives SEMANTIC_FLOOR (see lib/search.ts).
 *
 * Returns null when the feed itself doesn't exist (distinct from "matched
 * nothing", which is `{ items: [], hasStrongMatch: false }`).
 */
export async function aiFeedItems(
  id: number,
  limit = 50
): Promise<{ items: Item[]; hasStrongMatch: boolean } | null> {
  const { rows: feedRows } = await pool.query<{ embedding: string }>(
    `select embedding::text as embedding from app.ai_feed where id = $1`,
    [id]
  );
  const embeddingLiteral = feedRows[0]?.embedding;
  if (embeddingLiteral === undefined) return null;

  const sql = `
    select ${ITEM_COLUMNS},
           1 - (ai.embedding <=> $1::vector) as similarity
    ${ITEM_FROM}
    where ai.embedding is not null
      and ${ONE_ROW_PER_CLUSTER}
      and 1 - (ai.embedding <=> $1::vector) >= ${SEMANTIC_FLOOR}
    order by ai.embedding <=> $1::vector
    limit $2
  `;
  const { rows } = await pool.query<ItemRow & { similarity: string }>(sql, [embeddingLiteral, limit]);

  const items = rows.map((r) => mapRowToItem(r, { lean: true }));
  // NOT "anything cleared the floor". Search can lean on query length to
  // separate a noisy query from a specific one, but an AI Feed's query is
  // always deliberate, so that signal does not exist here, and an absolute
  // floor cannot tell "relevant but low-scoring" from "irrelevant near-miss":
  // measured, "ai regulation" tops at 0.2535 and IS relevant while "medieval
  // falconry" tops at 0.305 and is not. So the honest bar for CLAIMING a match
  // stays conservative; below it the page still lists the nearest stories, it
  // just does not present them as answers.
  const topSimilarity = rows.length > 0 ? Number((rows[0] as { similarity?: string }).similarity ?? 0) : 0;
  const hasStrongMatch = topSimilarity >= AI_FEED_STRONG_MATCH;
  return { items, hasStrongMatch };
}
