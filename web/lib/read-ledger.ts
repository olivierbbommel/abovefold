/*
 * Stories this tab has seen marked read, so a list restored from the
 * router cache can drop them without a round trip.
 *
 * Opening an article marks it read on the server (DwellTracker), and Today's
 * query already excludes read stories. But going Back restores the cached
 * list, so the story you just read was still sitting in Today. Lists that
 * drop read stories check this ledger per row (SwipeableItem) and hide the
 * ones in it; the next server render agrees with them anyway.
 *
 * Per tab (sessionStorage), capped, and every access is guarded: storage can
 * throw, and without it the ledger still works in memory for this page.
 */

const KEY = "abovefold:read-ledger";
const EVENT = "abovefold:read-ledger-changed";
export const MAX_LEDGER = 300;

let ids: Set<number> | null = null;

function load(): Set<number> {
  if (ids) return ids;
  ids = new Set();
  try {
    const raw = globalThis.sessionStorage?.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) {
      for (const n of parsed) if (Number.isInteger(n) && n > 0) ids.add(n);
    }
  } catch {
    // Unreadable or corrupt storage: start empty.
  }
  return ids;
}

function persist(set: Set<number>) {
  try {
    globalThis.sessionStorage?.setItem(KEY, JSON.stringify([...set]));
  } catch {
    // In-memory only for this page.
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
}

export function noteRead(articleId: number): void {
  if (!Number.isInteger(articleId) || articleId <= 0) return;
  const set = load();
  set.delete(articleId); // re-insert so it counts as newest
  set.add(articleId);
  // Oldest first in insertion order; drop from the front.
  while (set.size > MAX_LEDGER) set.delete(set.values().next().value as number);
  persist(set);
}

export function forgetRead(articleId: number): void {
  const set = load();
  if (set.delete(articleId)) persist(set);
}

export function wasRead(articleId: number): boolean {
  return load().has(articleId);
}

/** For useSyncExternalStore. Also re-checks when a page comes back from the
 * browser's back-forward cache, where React state is restored as it was. */
export function subscribeReadLedger(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      ids = null;
      onChange();
    }
  };
  window.addEventListener(EVENT, onChange);
  window.addEventListener("pageshow", onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("pageshow", onChange);
    window.removeEventListener("storage", onStorage);
  };
}
