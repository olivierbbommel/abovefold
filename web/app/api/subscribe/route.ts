import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { vetPublicUrl } from "@/lib/safe-fetch";

// Same rationale as /api/discover: talks to Miniflux with fetch() directly
// rather than through lib/miniflux.ts, which doesn't (and shouldn't) wrap
// the subscribe endpoint.

function minifluxBaseUrl(): string {
  return process.env.MINIFLUX_URL ?? "http://miniflux:8080";
}

function minifluxToken(): string {
  const token = process.env.MINIFLUX_API_TOKEN;
  if (!token) throw new Error("MINIFLUX_API_TOKEN environment variable is not set");
  return token;
}

/**
 * Subscribes to a feed via Miniflux's REST API. Body:
 * { feedUrl: string, categoryId?: number, probation?: boolean }.
 *
 * When probation is true, the new feed's id is recorded in
 * app.feed_probation so the worker/scoring layer can rank it without
 * counting it toward "unread" the way an established source would, see
 * db/init/05-feed-probation.sql for the table.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "body must be valid JSON" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "body must be a JSON object" }, { status: 400 });
  }

  const { feedUrl, categoryId, probation } = body as Record<string, unknown>;

  if (typeof feedUrl !== "string" || feedUrl.trim().length === 0) {
    return NextResponse.json({ error: "feedUrl is required" }, { status: 400 });
  }

  let categoryIdNum: number | undefined;
  if (categoryId !== undefined && categoryId !== null) {
    categoryIdNum = Number(categoryId);
    if (!Number.isInteger(categoryIdNum) || categoryIdNum <= 0) {
      return NextResponse.json({ error: "categoryId must be a positive integer" }, { status: 400 });
    }
  }

  // Miniflux fetches with private networks allowed, so it must never be the
  // first thing to see an address.
  const vetted = await vetPublicUrl(feedUrl);
  if ("error" in vetted) return NextResponse.json({ error: vetted.error }, { status: vetted.status });

  const payload: Record<string, unknown> = { feed_url: vetted.href };
  if (categoryIdNum !== undefined) payload.category_id = categoryIdNum;

  let minifluxRes: Response;
  try {
    minifluxRes = await fetch(`${minifluxBaseUrl()}/v1/feeds`, {
      method: "POST",
      headers: { "X-Auth-Token": minifluxToken(), "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    return NextResponse.json({ error: "could not reach Miniflux to subscribe" }, { status: 502 });
  }

  if (!minifluxRes.ok) {
    const text = await minifluxRes.text().catch(() => "");
    let message = text || minifluxRes.statusText;
    try {
      const parsed = JSON.parse(text) as { error_message?: string };
      if (parsed.error_message) message = parsed.error_message;
    } catch {
      // not JSON, use the raw text as-is
    }
    return NextResponse.json(
      { error: `subscribe failed (${minifluxRes.status}): ${message}` },
      { status: minifluxRes.status >= 400 && minifluxRes.status < 500 ? minifluxRes.status : 502 }
    );
  }

  // Miniflux answers {"feed_id": N}. Reading `id` made feedId undefined, so
  // the Add card never offered "Open" and no probation row was ever written.
  const feed = { id: Number(((await minifluxRes.json()) as { feed_id: number }).feed_id) };

  if (probation === true) {
    try {
      await pool.query(
        `insert into app.feed_probation (feed_id) values ($1) on conflict (feed_id) do nothing`,
        [feed.id]
      );
    } catch (err) {
      // The Miniflux subscription is the source of truth here, a failure to
      // record probation shouldn't roll it back or fail the request.
      console.error("failed to record feed_probation row", err);
    }
  }

  return NextResponse.json({ ok: true, feedId: feed.id }, { status: 201 });
}
