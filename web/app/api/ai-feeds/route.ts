import { NextRequest, NextResponse } from "next/server";
import { embedQuery } from "@/lib/embed";
import { createAiFeed, deleteAiFeed, listAiFeeds, renameAiFeed } from "@/lib/ai-feeds";

// GET list / POST create / PATCH rename / DELETE, one route file, same
// shape as app/api/folders/route.ts. Sits behind the same session-cookie
// auth as every other route (middleware.ts's matcher doesn't exempt this).

const MIN_NAME_LENGTH = 1;
const MAX_NAME_LENGTH = 60;
const MIN_QUERY_LENGTH = 3; // matches lib/search.ts's MIN_QUERY_LENGTH
const MAX_QUERY_LENGTH = 200; // matches performSearch's own cap

export async function GET() {
  const feeds = await listAiFeeds();
  return NextResponse.json(feeds);
}

/**
 * Embeds `query` exactly ONCE and stores the vector, see lib/ai-feeds.ts's
 * module note on why this must never happen again for this feed. This is
 * the only place in the AI Feeds feature that calls embedQuery().
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

  const { name, query } = body as Record<string, unknown>;
  if (typeof name !== "string" || name.trim().length < MIN_NAME_LENGTH) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const trimmedName = name.trim();
  if (trimmedName.length > MAX_NAME_LENGTH) {
    return NextResponse.json({ error: `name must be under ${MAX_NAME_LENGTH} characters` }, { status: 400 });
  }
  if (typeof query !== "string") {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }
  const trimmedQuery = query.trim();
  if (trimmedQuery.length < MIN_QUERY_LENGTH) {
    return NextResponse.json({ error: `query must be at least ${MIN_QUERY_LENGTH} characters` }, { status: 400 });
  }
  if (trimmedQuery.length > MAX_QUERY_LENGTH) {
    return NextResponse.json({ error: `query must be under ${MAX_QUERY_LENGTH} characters` }, { status: 400 });
  }

  try {
    const { vector, costUsd } = await embedQuery(trimmedQuery, "ai_feed");
    const feed = await createAiFeed(trimmedName, trimmedQuery, vector);
    // embedCostUsd isn't persisted (the migration has no column for it , 
    // an AI Feed's whole point is that it's a one-off, not an ongoing
    // line item) but it's surfaced here so the caller can report it.
    return NextResponse.json({ ...feed, embedCostUsd: costUsd }, { status: 201 });
  } catch (err) {
    // OpenRouter outage / rate limit / missing key, there is no
    // keyword-only fallback here the way search has one: an AI Feed with
    // no vector isn't a degraded feed, it's not a feed at all.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Couldn't create that AI Feed." },
      { status: 502 }
    );
  }
}

/** Renames an AI Feed. Body: { id, name }. */
export async function PATCH(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "body must be valid JSON" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "body must be a JSON object" }, { status: 400 });
  }

  const { id, name } = body as Record<string, unknown>;
  const idNum = Number(id);
  if (!Number.isInteger(idNum) || idNum <= 0) {
    return NextResponse.json({ error: "id must be a positive integer" }, { status: 400 });
  }
  if (typeof name !== "string" || name.trim().length < MIN_NAME_LENGTH) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const trimmed = name.trim();
  if (trimmed.length > MAX_NAME_LENGTH) {
    return NextResponse.json({ error: `name must be under ${MAX_NAME_LENGTH} characters` }, { status: 400 });
  }

  const feed = await renameAiFeed(idNum, trimmed);
  if (!feed) {
    return NextResponse.json({ error: "AI Feed not found" }, { status: 404 });
  }
  return NextResponse.json(feed);
}

export async function DELETE(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "body must be valid JSON" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "body must be a JSON object" }, { status: 400 });
  }

  const { id } = body as Record<string, unknown>;
  const idNum = Number(id);
  if (!Number.isInteger(idNum) || idNum <= 0) {
    return NextResponse.json({ error: "id must be a positive integer" }, { status: 400 });
  }

  const ok = await deleteAiFeed(idNum);
  if (!ok) {
    return NextResponse.json({ error: "AI Feed not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
