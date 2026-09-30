import { pool } from "./db";

/**
 * Spend for API calls made from the web app itself, search and AI Feed
 * query embeddings. Lives in its own table (app.api_spend) rather than
 * app.article_ai because those rows are one-per-article and owned by the
 * worker; a search query has no article_id. worker/abovefold_worker/store.py's
 * month_to_date_spend() sums this table alongside app.article_ai so the
 * monthly cost cap sees ONE true total, previously the worker's own doc
 * comment on that function already recorded this exact mistake being fixed
 * once (embeddings invisible to the cap); this closes the same gap on the
 * web app's read AND write side.
 */

// Mirrors worker/abovefold_worker/config.py's DEFAULT_COST_CAP_USD, same cap,
// same $/month budget, whichever service is spending it.
const DEFAULT_MONTHLY_CAP_USD = 5.0;

export type ApiSpendKind = "search" | "ai_feed";

/** Records one embed call's cost. Never throws, logging spend must not be able to break the feature that incurred it. */
export async function recordApiSpend(kind: ApiSpendKind, costUsd: number): Promise<void> {
  if (costUsd <= 0) return; // cache hits cost $0 and aren't worth a row
  try {
    await pool.query(`insert into app.api_spend (kind, cost_usd) values ($1, $2)`, [kind, costUsd]);
  } catch (err) {
    console.error("[api-spend] failed to record spend:", err);
  }
}

/** ALL spend this month, matches worker/abovefold_worker/store.py's month_to_date_spend(). */
export async function monthToDateTotalSpend(): Promise<number> {
  const { rows } = await pool.query<{ total: string }>(
    `
      select
        coalesce((select sum(cost_usd + embed_cost_usd) from app.article_ai
                  where created_at >= date_trunc('month', now())), 0)
        + coalesce((select sum(cost_usd) from app.api_spend
                    where created_at >= date_trunc('month', now())), 0)
        as total
    `
  );
  return Number(rows[0]?.total ?? 0);
}

export function monthlyCapUsd(): number {
  const raw = process.env.ABOVEFOLD_MONTHLY_COST_CAP_USD;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MONTHLY_CAP_USD;
}

// --- in-process rate limit for search embeds --------------------------
//
// Burst protection independent of the monthly cap: a fast typist or a
// script hitting /api/search shouldn't be able to fire dozens of embeds in
// a few seconds even while comfortably under budget. Guarded behind
// globalThis so Next's dev-mode module reloads don't reset it every hot
// reload, same pattern as lib/embed.ts's cache.
const RATE_LIMIT_MAX = 30; // embeds per rolling minute
const RATE_LIMIT_WINDOW_MS = 60_000;
const globalForRateLimit = globalThis as unknown as { __abovefoldSearchEmbedTimestamps?: number[] };
const timestamps = globalForRateLimit.__abovefoldSearchEmbedTimestamps ?? [];
globalForRateLimit.__abovefoldSearchEmbedTimestamps = timestamps;

/** true if this call is allowed to embed (and records it as used); false if the rolling-minute budget is exhausted. */
export function allowSearchEmbed(): boolean {
  const now = Date.now();
  while (timestamps.length > 0 && now - timestamps[0] > RATE_LIMIT_WINDOW_MS) timestamps.shift();
  if (timestamps.length >= RATE_LIMIT_MAX) return false;
  timestamps.push(now);
  return true;
}
