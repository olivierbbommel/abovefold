import { NextRequest, NextResponse } from "next/server";
import { allFeeds } from "@/lib/miniflux";
import { vetPublicUrl } from "@/lib/safe-fetch";
import { markFeedAsNewsletter, unmarkFeedAsNewsletter } from "@/lib/newsletter";
import { updateFeed } from "@/lib/miniflux";
import { positiveIntParam } from "@/lib/route-params";

/*
 * Add a newsletter that publishes RSS.
 *
 * Most newsletters do, and a feed beats an email address every time: no
 * signup, no verification, no forwarding, and it back-fills past issues.
 * Email stays the fallback for publishers with no feed.
 */
export const dynamic = "force-dynamic";

function minifluxBaseUrl(): string {
  return process.env.MINIFLUX_URL ?? "http://miniflux:8080";
}
function minifluxToken(): string {
  const token = process.env.MINIFLUX_API_TOKEN;
  if (!token) throw new Error("MINIFLUX_API_TOKEN environment variable is not set");
  return token;
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (typeof parsed !== "object" || parsed === null) throw new Error("not an object");
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "body must be a JSON object" }, { status: 400 });
  }

  const feedUrl = typeof body.feedUrl === "string" ? body.feedUrl.trim() : "";
  const label = typeof body.label === "string" ? body.label.trim() : "";
  if (feedUrl.length === 0) {
    return NextResponse.json({ error: "feedUrl is required" }, { status: 400 });
  }

  let categoryId: number | undefined;
  if (body.categoryId !== undefined && body.categoryId !== null) {
    categoryId = Number(body.categoryId);
    if (!Number.isInteger(categoryId) || categoryId <= 0) {
      return NextResponse.json({ error: "categoryId must be a positive integer" }, { status: 400 });
    }
  }

  // Same rule as /api/subscribe: Miniflux must never be the first to see an
  // address (see SECURITY.md).
  const vetted = await vetPublicUrl(feedUrl);
  if ("error" in vetted) return NextResponse.json({ error: vetted.error }, { status: vetted.status });

  let response: Response;
  try {
    response = await fetch(`${minifluxBaseUrl()}/v1/feeds`, {
      method: "POST",
      headers: { "X-Auth-Token": minifluxToken(), "Content-Type": "application/json" },
      body: JSON.stringify({ feed_url: vetted.href, ...(categoryId !== undefined ? { category_id: categoryId } : {}) }),
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    return NextResponse.json({ error: "could not reach the feed service" }, { status: 502 });
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    // Miniflux says "This feed already exists" for a duplicate, which is not
    // an error worth blocking on: mark whatever is already there instead.
    const already = /already exists/i.test(text);
    if (already) {
      // What the comment above promised: list the feed you already follow
      // under Newsletters instead of stopping at "already subscribed".
      const want = vetted.href.replace(/\/+$/, "").toLowerCase();
      const existing = (await allFeeds().catch(() => [])).find((f) => f.feed_url.replace(/\/+$/, "").toLowerCase() === want);
      if (existing) {
        await markFeedAsNewsletter(existing.id);
        return NextResponse.json({ ok: true, feedId: existing.id, alreadyFollowed: true });
      }
    }
    return NextResponse.json(
      { error: already ? "You are already subscribed to that feed." : "That does not look like a feed we can read." },
      { status: already ? 409 : 400 }
    );
  }

  const feedId = Number(((await response.json()) as { feed_id: number }).feed_id);
  await markFeedAsNewsletter(feedId);
  if (label) {
    await updateFeed(feedId, { title: label }).catch(() => {});
  }
  return NextResponse.json({ feedId, label: label || null });
}

export async function DELETE(request: NextRequest) {
  const feedId = positiveIntParam(new URL(request.url).searchParams.get("feedId") ?? "");
  if (feedId === null) return NextResponse.json({ error: "feedId is required" }, { status: 400 });
  // Only stops treating it as a newsletter. The feed itself stays subscribed,
  // in its folder, because removing a source is a different decision.
  const removed = await unmarkFeedAsNewsletter(feedId);
  return NextResponse.json({ removed }, { status: removed ? 200 : 404 });
}
