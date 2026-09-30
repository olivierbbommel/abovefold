import { embedQuery } from "./embed";
import { allowSearchEmbed, monthlyCapUsd, monthToDateTotalSpend } from "./api-spend";
import { MIN_STRONG_MATCH_LENGTH, searchItems, type SearchMatch } from "./queries";
import type { Item } from "./types";

// Below this, embedding costs more (relatively) than it's worth and the
// signal is too thin anyway, "ai" or "eu" shouldn't trigger a vector call.
// Matches the client-side debounce threshold in SearchPageInput so the two
// never disagree about when a search "really" starts.
export const MIN_QUERY_LENGTH = 3;
export const RESULT_LIMIT = 20;

export type SearchResponse = {
  query: string;
  items: Item[];
  matchedBy: Record<number, SearchMatch>;
  similarity: Record<number, number>;
  /** False when nothing cleared the strong-match bar, the page should say so
   *  rather than presenting near-misses as answers. See queries.ts's
   *  SEMANTIC_FLOOR/SEMANTIC_RELATIVE_MARGIN and MIN_STRONG_KEYWORD_LENGTH
   *  for what "strong" means for each match type. */
  hasStrongMatch: boolean;
  embedded: boolean; // false when the query was too short, rate-limited, over the cost cap, or the embed call failed
  embedCostUsd: number;
};

/**
 * Runs one search: embeds the query (unless it's too short, rate-limited,
 * over the monthly cost cap, or the call fails) and merges semantic +
 * keyword results. Shared by the API route (client-side live search) and
 * the /search page (server-rendered initial load) so there is exactly one
 * place this logic lives.
 */
export async function performSearch(rawQuery: string): Promise<SearchResponse> {
  const query = rawQuery.trim().slice(0, 200);
  if (query.length === 0) {
    return { query, items: [], matchedBy: {}, similarity: {}, hasStrongMatch: false, embedded: false, embedCostUsd: 0 };
  }

  let embedding: number[] | null = null;
  let embedCostUsd = 0;
  let embedded = false;
  if (query.length >= MIN_QUERY_LENGTH) {
    if (!allowSearchEmbed()) {
      // Burst protection: a fast typist or a script hitting this endpoint
      // shouldn't be able to fire dozens of embeds in a few seconds. Fall
      // back to keyword-only rather than erroring, search still works.
      console.warn("[search] embed rate limit hit, falling back to keyword-only");
    } else {
      try {
        const spend = await monthToDateTotalSpend();
        const cap = monthlyCapUsd();
        if (spend >= cap) {
          console.warn(`[search] monthly cost cap reached ($${spend.toFixed(4)} >= $${cap.toFixed(2)}), falling back to keyword-only`);
        } else {
          const result = await embedQuery(query, "search");
          embedding = result.vector;
          embedCostUsd = result.costUsd;
          embedded = true;
        }
      } catch (err) {
        // OpenRouter outage / rate limit / missing key / DB unreachable , 
        // fall back to keyword-only rather than failing the whole search.
        console.error("[search] embed failed, falling back to keyword-only:", err);
      }
    }
  }

  const results = await searchItems(query, embedding, RESULT_LIMIT);
  const matchedBy: Record<number, SearchMatch> = {};
  const similarity: Record<number, number> = {};
  // Below MIN_STRONG_MATCH_LENGTH, cosine similarity stops separating a
  // real answer from a stopword's noise (see queries.ts's doc comment on
  // MIN_STRONG_MATCH_LENGTH, "the" and "ai regulation" score within 0.01
  // of each other despite one being noise and the other a genuine topic).
  // Below the length bar, nothing is trusted as strong regardless of score.
  const queryTrusted = query.length >= MIN_STRONG_MATCH_LENGTH;
  let hasStrongMatch = false;
  for (const r of results) {
    matchedBy[r.item.id] = r.matchedBy;
    if (r.similarity !== null) similarity[r.item.id] = r.similarity;
    // A semantic row already cleared both SEMANTIC_FLOOR and
    // SEMANTIC_RELATIVE_MARGIN in searchItems, anything present IS the
    // best available answer, so it counts as strong. A keyword hit counts
    // as strong only when queries.ts decided it's a real word match, not a
    // coincidental substring.
    if (queryTrusted && (r.similarity !== null || r.keywordStrong)) hasStrongMatch = true;
  }

  return { query, items: results.map((r) => r.item), matchedBy, similarity, hasStrongMatch, embedded, embedCostUsd };
}
