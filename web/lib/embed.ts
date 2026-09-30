/**
 * OpenRouter embeddings client for search queries, the read-side twin of
 * worker/abovefold_worker/embed.py. Deliberately mirrors that file's request
 * shape (same model, same `/api/v1/embeddings` endpoint, same
 * `usage: { include: true }` so a real cost comes back instead of an
 * estimate) so search queries and article embeddings land in the exact same
 * vector space.
 *
 * This only ever embeds ONE short query string at a time (no batching , 
 * that's the worker's job for articles), so this file is intentionally much
 * smaller than embed.py.
 *
 * Every real (non-cached) call records its cost via lib/api-spend.ts so it
 * counts toward the monthly cost cap, see that module's doc comment.
 */
import { recordApiSpend, type ApiSpendKind } from "./api-spend";

const EMBEDDINGS_URL = "https://openrouter.ai/api/v1/embeddings";
const EMBED_MODEL = "openai/text-embedding-3-small";
const EMBED_DIM = 1536;
const EMBED_RATE_PER_M = 0.02; // openai/text-embedding-3-small list price, matches embed.py
const MAX_CHARS = 8000;
const REQUEST_TIMEOUT_MS = 10_000;

export class EmbedError extends Error {}

export type EmbedResult = { vector: number[]; costUsd: number };

// Cost discipline: identical repeated queries (retyping, navigating back,
// two tabs) don't re-pay for the same embedding. Keyed on the trimmed,
// whitespace-collapsed, lower-cased query text so "ai  regulation" (double
// space from fast typing) still hits the same entry as "ai regulation".
// Guarded behind globalThis so Next's dev-mode module reloads don't drop it
// every hot reload, same pattern as lib/db.ts.
const CACHE_TTL_MS = 5 * 60 * 1000;
type CacheEntry = { vector: number[]; expiresAt: number };
const globalForCache = globalThis as unknown as { __abovefoldEmbedCache?: Map<string, CacheEntry> };
const cache = globalForCache.__abovefoldEmbedCache ?? new Map<string, CacheEntry>();
globalForCache.__abovefoldEmbedCache = cache;

function cacheKey(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

// The cache never shrank on its own, every distinct query string typed
// over the process's lifetime stayed resident at ~12KB/vector even long
// after its 5-minute TTL passed. Sweeping expired entries on every call
// keeps it bounded to roughly what's been searched in the last TTL window.
function sweepExpired(now: number): void {
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
}

/** Embeds one query string. Cache hits cost $0 and skip the network entirely. `kind` labels the spend row for the caller (search vs. AI Feed creation). */
export async function embedQuery(text: string, kind: ApiSpendKind): Promise<EmbedResult> {
  const now = Date.now();
  sweepExpired(now);
  const key = cacheKey(text);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) {
    return { vector: cached.vector, costUsd: 0 };
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new EmbedError("OPENROUTER_API_KEY environment variable is not set");
  }

  const response = await fetch(EMBEDDINGS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: EMBED_MODEL,
      input: [text.slice(0, MAX_CHARS)],
      usage: { include: true },
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new EmbedError(`POST /embeddings failed: ${response.status} ${await response.text()}`);
  }

  const payload = await response.json();
  const data = payload?.data;
  if (!Array.isArray(data) || data.length !== 1) {
    throw new EmbedError(`expected 1 embedding, got ${Array.isArray(data) ? data.length : 0}`);
  }

  const vector = data[0]?.embedding;
  if (!Array.isArray(vector) || vector.length !== EMBED_DIM) {
    throw new EmbedError(`embedding has ${Array.isArray(vector) ? vector.length : 0} dims, expected ${EMBED_DIM}`);
  }

  const usage = payload?.usage ?? {};
  const reported = usage.cost;
  const costUsd =
    typeof reported === "number" && reported >= 0
      ? reported
      : ((usage.prompt_tokens ?? 0) / 1e6) * EMBED_RATE_PER_M;

  cache.set(key, { vector, expiresAt: Date.now() + CACHE_TTL_MS });
  await recordApiSpend(kind, costUsd);
  return { vector, costUsd };
}
