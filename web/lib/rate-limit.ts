/*
 * In-memory login throttle.
 *
 * Single-user app, single container: a Map is the right size of solution.
 * There is no second instance to share state with, and Postgres is a heavy
 * dependency for something that must stay fast on the unauthenticated path
 * (a DB round trip there is exactly what an attacker would try to exhaust).
 *
 * State is deliberately lost on restart. The worst case is that an attacker
 * mid-lockout gets a fresh budget after a deploy, which is not a meaningful
 * win against a 16-character random password.
 */

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 8;
const MAX_TRACKED_CLIENTS = 10_000;

type Bucket = { failures: number; firstFailureAt: number };

const buckets = new Map<string, Bucket>();

/**
 * Which client a login attempt comes from, for throttling.
 *
 * Only a header your proxy sets and clients cannot forge may be trusted, so
 * it is opt-in: ABOVEFOLD_CLIENT_IP_HEADER=cf-connecting-ip behind a Cloudflare
 * tunnel, x-real-ip behind an nginx that sets it, and so on. Unset, every
 * attempt shares one bucket: coarse, but it cannot be bypassed by sending a
 * made-up header.
 */
export function clientKey(headers: Headers): string {
  const name = process.env.ABOVEFOLD_CLIENT_IP_HEADER?.trim().toLowerCase();
  if (!name) return "all";
  return headers.get(name)?.split(",")[0]?.trim() || "all";
}

function prune(now: number): void {
  for (const [key, bucket] of buckets) {
    if (now - bucket.firstFailureAt >= WINDOW_MS) buckets.delete(key);
  }
  // Pathological growth guard: if pruning expired entries was not enough,
  // drop the oldest insertions. Map iterates in insertion order.
  if (buckets.size > MAX_TRACKED_CLIENTS) {
    const excess = buckets.size - MAX_TRACKED_CLIENTS;
    let dropped = 0;
    for (const key of buckets.keys()) {
      buckets.delete(key);
      if (++dropped >= excess) break;
    }
  }
}

export type Throttle =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

/** Called before checking the password. Does not itself record a failure. */
export function checkLoginAllowed(key: string, now = Date.now()): Throttle {
  const bucket = buckets.get(key);
  if (!bucket) return { allowed: true };

  const elapsed = now - bucket.firstFailureAt;
  if (elapsed >= WINDOW_MS) {
    buckets.delete(key);
    return { allowed: true };
  }
  if (bucket.failures < MAX_FAILURES) return { allowed: true };

  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil((WINDOW_MS - elapsed) / 1000)),
  };
}

export function recordLoginFailure(key: string, now = Date.now()): void {
  prune(now);
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.firstFailureAt >= WINDOW_MS) {
    buckets.set(key, { failures: 1, firstFailureAt: now });
    return;
  }
  bucket.failures += 1;
}

/** A correct password clears the budget, a legitimate user is never locked out. */
export function clearLoginFailures(key: string): void {
  buckets.delete(key);
}

/** Test seam. */
export function __resetLoginThrottle(): void {
  buckets.clear();
}
