import type { Folder } from "./types";

// Server-side only client for Miniflux's REST API. The web app reads read/star
// state and folder (category) structure from here, it must NEVER read or
// write Miniflux's `public` Postgres schema directly.

function baseUrl(): string {
  const url = process.env.MINIFLUX_URL;
  if (!url) throw new Error("MINIFLUX_URL environment variable is not set");
  return url;
}

function authHeaders(): Record<string, string> {
  const token = process.env.MINIFLUX_API_TOKEN;
  if (!token) throw new Error("MINIFLUX_API_TOKEN environment variable is not set");
  return { "X-Auth-Token": token };
}

async function minifluxFetch(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Miniflux ${init?.method ?? "GET"} ${path} failed: ${res.status} ${res.statusText} ${body}`
    );
  }
  return res;
}

type MinifluxCategory = { id: number; title: string };
type MinifluxFeed = {
  id: number;
  title: string;
  feed_url: string;
  site_url: string;
  category: MinifluxCategory;
  parsing_error_count?: number;
  parsing_error_message?: string;
};
type MinifluxFeedCounters = { reads: Record<string, number>; unreads: Record<string, number> };
type MinifluxEntry = { id: number };
type MinifluxEntriesResponse = { total: number; entries: MinifluxEntry[] };

async function listFeeds(): Promise<MinifluxFeed[]> {
  const res = await minifluxFetch("/v1/feeds");
  return (await res.json()) as MinifluxFeed[];
}

/**
 * Every subscribed feed's URL alongside the folder it lives in, used by
 * suggestionsForFolder (lib/suggestions.ts) to (a) never suggest a feed the
 * user already has, in ANY folder, and (b) fall back to matching a folder
 * to a starter pack by comparing its existing feeds against pack contents.
 */
/** Every subscribed feed with its site and feed URLs. */
export async function allFeeds(): Promise<MinifluxFeed[]> {
  return listFeeds();
}

export async function feedUrlsByCategory(): Promise<{ id: number; url: string; categoryId: number }[]> {
  const feeds = await listFeeds();
  return feeds.map((f) => ({ id: f.id, url: f.feed_url, categoryId: f.category.id }));
}

/** Folders (Miniflux categories) with unread counts, summed across their feeds. */
export async function folders(): Promise<Folder[]> {
  const [categoriesRes, countersRes, feeds] = await Promise.all([
    minifluxFetch("/v1/categories"),
    minifluxFetch("/v1/feeds/counters"),
    listFeeds(),
  ]);
  const categories = (await categoriesRes.json()) as MinifluxCategory[];
  const counters = (await countersRes.json()) as MinifluxFeedCounters;

  const unreadByCategory = new Map<number, number>();
  for (const feed of feeds) {
    const unread = counters.unreads[String(feed.id)] ?? 0;
    unreadByCategory.set(feed.category.id, (unreadByCategory.get(feed.category.id) ?? 0) + unread);
  }

  // Miniflux always ships a default "All" category. When it holds no feeds
  // it's pure noise in the sidebar, an always-empty folder that renders
  // ", ", so THAT one specific category is hidden while it's empty.
  //
  // This must NOT drop every empty category, only that one: a folder the
  // user just created (via POST /api/folders) starts with zero feeds too,
  // and until a feed is filed into it, it has to keep showing up here , 
  // in the rail, the drawer, /folders, and the /add folder picker, or
  // there is no way to ever put a feed into it. That was a real bug: the
  // filter used to be "any category with 0 feeds", which made "New folder"
  // appear to silently do nothing.
  const feedCountByCategory = new Map<number, number>();
  for (const feed of feeds) {
    feedCountByCategory.set(feed.category.id, (feedCountByCategory.get(feed.category.id) ?? 0) + 1);
  }

  return categories
    .filter((category) => category.title !== "All" || (feedCountByCategory.get(category.id) ?? 0) > 0)
    .map((category) => ({
      id: category.id,
      title: category.title,
      unread: unreadByCategory.get(category.id) ?? 0,
    }));
}

/**
 * Every Miniflux category, unfiltered (unlike `folders()`, which hides the
 * default "All" category once it's empty). Used to populate a "move to
 * folder" picker, where the always-present "All" bucket is a legitimate
 * destination even though it's never shown as a folder in the nav.
 */
export async function allCategories(): Promise<Folder[]> {
  const res = await minifluxFetch("/v1/categories");
  const categories = (await res.json()) as MinifluxCategory[];
  return categories.map((c) => ({ id: c.id, title: c.title, unread: 0 }));
}

/** Feeds grouped by their category (folder) id, each carrying its own unread count. */
export type CategoryFeed = { id: number; title: string; unread: number; problem: string | null };

/*
 * Why a feed has stopped updating, or null. Miniflux stops polling a feed
 * after a few consecutive errors and says so only in its own UI; here that
 * was invisible, so dead sources went unnoticed for weeks.
 */
export function feedProblem(feed: Pick<MinifluxFeed, "parsing_error_count" | "parsing_error_message">): string | null {
  if (!feed.parsing_error_count) return null;
  const why = (feed.parsing_error_message ?? "").replace(/\s+/g, " ").trim();
  return why ? `Not updating: ${why}` : "Not updating";
}

export async function feedsByCategory(): Promise<Record<number, CategoryFeed[]>> {
  const [feeds, countersRes] = await Promise.all([listFeeds(), minifluxFetch("/v1/feeds/counters")]);
  const counters = (await countersRes.json()) as MinifluxFeedCounters;
  const result: Record<number, CategoryFeed[]> = {};
  for (const feed of feeds) {
    const list = result[feed.category.id] ?? (result[feed.category.id] = []);
    list.push({
      id: feed.id,
      title: feed.title,
      unread: counters.unreads[String(feed.id)] ?? 0,
      problem: feedProblem(feed),
    });
  }
  return result;
}

/** Creates a folder (Miniflux category). Title must already be validated by the caller. */
export async function createCategory(title: string): Promise<Folder> {
  const res = await fetch(`${baseUrl()}/v1/categories`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(await minifluxErrorText(res));
  const category = (await res.json()) as MinifluxCategory;
  return { id: category.id, title: category.title, unread: 0 };
}

/** Renames a folder (Miniflux category). Title must already be validated by the caller. */
export async function updateCategory(id: number, title: string): Promise<Folder> {
  const res = await fetch(`${baseUrl()}/v1/categories/${id}`, {
    method: "PUT",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(await minifluxErrorText(res));
  const category = (await res.json()) as MinifluxCategory;
  return { id: category.id, title: category.title, unread: 0 };
}

/**
 * Deletes a folder (Miniflux category), verified against both a live
 * instance and the running Postgres schema (2026-08-26): Miniflux does NOT
 * reject deleting a category that still holds feeds. `feeds.category_id`
 * and `entries.feed_id` are both `ON DELETE CASCADE`, so this deletes the
 * category, every feed in it, AND every entry (article) those feeds ever
 * had, read/star state included, gone with it. `app.article` in our own
 * Postgres has no FK to Miniflux and is never cleaned up as part of this,
 * so a story from a deleted feed can keep rendering with read/star state
 * that can never be resolved again. Callers MUST confirm with the user,
 * naming exactly what's being lost (folder + source count, and that their
 * articles go too), before calling this, never a bare "Are you sure?".
 */
export async function deleteCategory(id: number): Promise<void> {
  const res = await fetch(`${baseUrl()}/v1/categories/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(await minifluxErrorText(res));
}

/**
 * Updates a feed (Miniflux), rename, and/or move to a different folder by
 * passing `category_id`. Only the provided fields are sent, so a rename
 * doesn't accidentally touch the feed's folder and vice versa.
 */
export async function updateFeed(
  id: number,
  patch: { title?: string; categoryId?: number }
): Promise<void> {
  const body: Record<string, unknown> = {};
  if (patch.title !== undefined) body.title = patch.title;
  if (patch.categoryId !== undefined) body.category_id = patch.categoryId;
  const res = await fetch(`${baseUrl()}/v1/feeds/${id}`, {
    method: "PUT",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(await minifluxErrorText(res));
}

/** Unsubscribes from a feed (Miniflux), deletes it and its stored entries. */
export async function deleteFeed(id: number): Promise<void> {
  const res = await fetch(`${baseUrl()}/v1/feeds/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(await minifluxErrorText(res));
}

/** Miniflux error bodies are `{"error_message": "..."}`, surface that text, not a generic message. */
async function minifluxErrorText(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const parsed = JSON.parse(text) as { error_message?: string };
    if (parsed.error_message) return parsed.error_message;
  } catch {
    // not JSON, fall through to the raw text
  }
  return text || res.statusText;
}

/** A feed's favicon, straight from Miniflux (it fetches and caches these on subscribe). */
export type MinifluxIcon = { mimeType: string; base64: string };

/** Returns `null` when the feed has no icon (Miniflux 404s that case) rather than throwing. */
export async function feedIcon(id: number): Promise<MinifluxIcon | null> {
  const res = await fetch(`${baseUrl()}/v1/feeds/${id}/icon`, {
    headers: authHeaders(),
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(await minifluxErrorText(res));
  const data = (await res.json()) as { mime_type: string; data: string };
  // `data` arrives as "<mime>;base64,<payload>", the mime prefix duplicates
  // `mime_type`, so split it off rather than trust either alone.
  const comma = data.data.indexOf(",");
  const base64 = comma === -1 ? data.data : data.data.slice(comma + 1);
  return { mimeType: data.mime_type, base64 };
}

/** Marks entries read through Miniflux so native clients (Reeder) stay in sync. */
export async function markRead(entryIds: number[]): Promise<void> {
  if (entryIds.length === 0) return;
  await minifluxFetch("/v1/entries", {
    method: "PUT",
    body: JSON.stringify({ entry_ids: entryIds, status: "read" }),
  });
}

/** Toggles the starred (bookmark) state of a single entry. */
/**
 * Whether one entry is starred. Miniflux only exposes a TOGGLE for stars, so
 * "save for later" has to look before it flips, or a second tap silently
 * un-saves the article the user just asked to keep.
 */
export async function entryStarred(entryId: number): Promise<boolean> {
  const res = await minifluxFetch(`/v1/entries/${entryId}`);
  const entry = (await res.json()) as { starred?: boolean };
  return entry.starred === true;
}

/** Read entry ids of the given feeds published in the last `hours`, newest first. */
export async function readEntryIdsForFeeds(feedIds: number[], hours: number): Promise<number[]> {
  const after = Math.floor(Date.now() / 1000) - hours * 3600;
  const PAGE = 250;
  const MAX_PAGES = 8;
  const perFeed = await Promise.all(
    feedIds.map(async (feedId) => {
      const ids: number[] = [];
      for (let page = 0; page < MAX_PAGES; page++) {
        const res = await minifluxFetch(
          `/v1/feeds/${feedId}/entries?status=read&published_after=${after}&order=published_at&direction=desc&limit=${PAGE}&offset=${page * PAGE}`
        );
        const data = (await res.json()) as MinifluxEntriesResponse;
        for (const e of data.entries) ids.push(e.id);
        if (data.entries.length < PAGE || ids.length >= data.total) break;
      }
      return ids;
    })
  );
  return perFeed.flat();
}

/** Starred and read state of one entry, for actions that must not repeat. */
export async function entryState(entryId: number): Promise<{ starred: boolean; read: boolean }> {
  const res = await minifluxFetch(`/v1/entries/${entryId}`);
  const entry = (await res.json()) as { starred?: boolean; status?: string };
  return { starred: entry.starred === true, read: entry.status === "read" };
}

export async function toggleStar(entryId: number): Promise<void> {
  await minifluxFetch(`/v1/entries/${entryId}/bookmark`, { method: "PUT" });
}

/** Miniflux entry ids currently starred, most-recently-changed first. */
export async function starredEntryIds(): Promise<number[]> {
  const res = await minifluxFetch(
    "/v1/entries?starred=true&limit=200&order=changed_at&direction=desc"
  );
  const data = (await res.json()) as MinifluxEntriesResponse;
  return data.entries.map((e) => e.id);
}

/** Miniflux entry ids currently read, most-recently-changed first. */
export async function readEntryIds(limit = 100): Promise<number[]> {
  const res = await minifluxFetch(
    `/v1/entries?status=read&limit=${limit}&order=changed_at&direction=desc`
  );
  const data = (await res.json()) as MinifluxEntriesResponse;
  return data.entries.map((e) => e.id);
}

/**
 * Read entry ids published within the last `hours`, bounded by publish
 * time, not by `readEntryIds`'s flat `limit`. Today needs "read AND
 * published inside the window it can actually show" (48h, ~a handful of
 * items); `readEntryIds`'s most-recent-500-read-globally isn't narrow
 * enough, Miniflux holds 1,000+ read entries, so that flat limit was
 * silently missing older-but-still-in-window reads.
 */
export async function readEntryIdsSince(hours: number): Promise<number[]> {
  const after = Math.floor(Date.now() / 1000) - hours * 3600;
  // Newest first and paged. Miniflux's default order is published_at
  // ASCENDING, so a single limit=500 page returned the oldest reads in the
  // window: after one "mark all read" the newest read stories (the top of
  // Today) fell outside it and came back.
  const PAGE = 500;
  const MAX_PAGES = 20;
  const ids: number[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await minifluxFetch(
      `/v1/entries?status=read&published_after=${after}&order=published_at&direction=desc&limit=${PAGE}&offset=${page * PAGE}`
    );
    const data = (await res.json()) as MinifluxEntriesResponse;
    for (const e of data.entries) ids.push(e.id);
    if (data.entries.length < PAGE || ids.length >= data.total) break;
  }
  return ids;
}
