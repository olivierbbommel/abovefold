import { NextRequest, NextResponse } from "next/server";
import { STARTER_PACKS } from "@/lib/starter-packs";

// Same rationale as app/api/opml/route.ts for the duplicated fetch helper:
// this needs Miniflux's categories/feeds write endpoints, which aren't part
// of lib/miniflux.ts's (read-mostly) surface.

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
    throw new Error(body || `${res.status} ${res.statusText}`);
  }
  return res;
}

type MinifluxCategory = { id: number; title: string };

async function getOrCreateCategory(
  title: string,
  cache: Map<string, MinifluxCategory>
): Promise<MinifluxCategory> {
  const key = title.toLowerCase();
  const cached = cache.get(key);
  if (cached) return cached;
  const res = await minifluxFetch("/v1/categories", {
    method: "POST",
    body: JSON.stringify({ title }),
  });
  const category = (await res.json()) as MinifluxCategory;
  cache.set(key, category);
  return category;
}

type SubscribeFailure = { title: string; error: string };

/**
 * Subscribes every feed in the chosen starter packs. Body: { packIds: string[] }.
 * Sequential writes, same reasoning as the OPML route, reports added /
 * already-present / failed rather than assuming every feed subscribes cleanly.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const packIds = (body as { packIds?: unknown } | null)?.packIds;

  if (!Array.isArray(packIds) || packIds.length === 0 || !packIds.every((id) => typeof id === "string")) {
    return NextResponse.json({ error: "packIds must be a non-empty array of strings" }, { status: 400 });
  }

  const packs = STARTER_PACKS.filter((pack) => packIds.includes(pack.id));
  if (packs.length === 0) {
    return NextResponse.json({ error: "no matching starter packs" }, { status: 400 });
  }

  let categoriesRes: Response;
  try {
    categoriesRes = await minifluxFetch("/v1/categories");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Couldn't reach Miniflux: ${message}` }, { status: 502 });
  }
  const existingCategories = (await categoriesRes.json()) as MinifluxCategory[];
  const categoryCache = new Map<string, MinifluxCategory>(
    existingCategories.map((c) => [c.title.toLowerCase(), c])
  );

  let added = 0;
  let existing = 0;
  const failed: SubscribeFailure[] = [];

  for (const pack of packs) {
    let categoryId: number;
    try {
      categoryId = (await getOrCreateCategory(pack.category, categoryCache)).id;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      for (const feed of pack.feeds) {
        failed.push({ title: feed.title, error: `couldn't create folder "${pack.category}": ${message}` });
      }
      continue;
    }

    for (const feed of pack.feeds) {
      try {
        await minifluxFetch("/v1/feeds", {
          method: "POST",
          body: JSON.stringify({ feed_url: feed.url, category_id: categoryId }),
        });
        added++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (/already exists/i.test(message)) {
          existing++;
        } else {
          failed.push({ title: feed.title, error: message });
        }
      }
    }
  }

  return NextResponse.json({ added, existing, failed: failed.length, failedDetails: failed });
}
