import { NextRequest, NextResponse } from "next/server";
import { vetPublicUrl } from "@/lib/safe-fetch";

// Server-side only, subscribes via Miniflux's REST API, never touches its
// `public` Postgres schema directly (same rule as lib/miniflux.ts; this
// route duplicates a minimal fetch helper rather than importing from there,
// since categories/feeds POST/DELETE aren't part of that module's surface).

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
    // One slow feed must not hold the whole import past the tunnel's timeout.
    signal: init?.signal ?? AbortSignal.timeout(20_000),
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

// --- OPML parsing ------------------------------------------------------------
//
// OPML is a shallow, well-known XML dialect, a hand-rolled walk over
// <outline> tags is enough and avoids adding an XML parser dependency.
// Feedly's export nests feed outlines (leaves, carrying xmlUrl, always
// self-closing) one level inside folder outlines (carrying no xmlUrl); a
// feed at the top level of <body> has no folder.

export type ParsedFeed = { title: string; xmlUrl: string; category: string | null };

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function parseAttrs(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z0-9_:-]+)\s*=\s*"([^"]*)"|([a-zA-Z0-9_:-]+)\s*=\s*'([^']*)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrString))) {
    const key = (m[1] ?? m[3]).toLowerCase();
    const value = decodeEntities(m[2] ?? m[4] ?? "");
    attrs[key] = value;
  }
  return attrs;
}

export function parseOpml(xml: string): ParsedFeed[] {
  const bodyMatch = /<body[^>]*>([\s\S]*)<\/body>/i.exec(xml);
  const body = bodyMatch ? bodyMatch[1] : xml;

  const feeds: ParsedFeed[] = [];
  const folderStack: string[] = [];
  // Matches a self-closing outline, an opening outline, or a closing tag.
  const tagRe = /<outline\b([^>]*?)(\/)?>|<\/outline\s*>/gi;
  let match: RegExpExecArray | null;

  while ((match = tagRe.exec(body))) {
    const isClose = match[1] === undefined;
    if (isClose) {
      folderStack.pop();
      continue;
    }

    const attrs = parseAttrs(match[1]);
    const selfClosing = Boolean(match[2]);
    const title = attrs.title || attrs.text || "";

    if (attrs.xmlurl) {
      feeds.push({
        title: title || attrs.xmlurl,
        xmlUrl: attrs.xmlurl,
        category: folderStack[folderStack.length - 1] ?? null,
      });
      // Feed outlines are leaves in every real-world export; don't push a
      // stack frame for them even if malformed XML leaves them unclosed.
    } else if (!selfClosing) {
      folderStack.push(title || "Imported");
    }
  }

  return feeds;
}

// --- route -------------------------------------------------------------------

type ImportFailure = { title: string; error: string };

/**
 * Accepts a single OPML file (`multipart/form-data`, field name "file"),
 * subscribes every feed it finds via Miniflux, and reports exactly what
 * happened, added / already-present / failed, rather than assuming
 * success. Writes are sequential: cheap here (a handful of feeds), and it
 * keeps category-creation races out of the picture.
 */
export async function POST(request: NextRequest) {
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required (field \"file\")" }, { status: 400 });
  }

  const xml = await file.text();
  const parsed = parseOpml(xml);
  if (parsed.length === 0) {
    return NextResponse.json(
      { error: "No feeds found in that OPML file." },
      { status: 400 }
    );
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
  const failed: ImportFailure[] = [];

  for (const feed of parsed) {
    let categoryId: number | undefined;

    const vetted = await vetPublicUrl(feed.xmlUrl);
    if ("error" in vetted) {
      failed.push({ title: feed.title, error: vetted.error });
      continue;
    }

    if (feed.category) {
      try {
        const category = await getOrCreateCategory(feed.category, categoryCache);
        categoryId = category.id;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failed.push({ title: feed.title, error: `couldn't create folder "${feed.category}": ${message}` });
        continue;
      }
    }

    try {
      await minifluxFetch("/v1/feeds", {
        method: "POST",
        body: JSON.stringify({
          feed_url: vetted.href,
          ...(categoryId ? { category_id: categoryId } : {}),
        }),
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

  return NextResponse.json({
    total: parsed.length,
    added,
    existing,
    failed: failed.length,
    failedDetails: failed,
  });
}
