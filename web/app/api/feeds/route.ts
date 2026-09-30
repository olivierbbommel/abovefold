import { NextRequest, NextResponse } from "next/server";
import { retireNewsletterFeeds } from "@/lib/newsletter";
import { hideArticlesOfFeeds } from "@/lib/queries";
import { deleteFeed, updateFeed } from "@/lib/miniflux";

// Feed = Miniflux feed (a "source" in the UI). This route exists so the
// folder page's SOURCES list can rename a source, move it to another
// folder, or unsubscribe, none of which had any UI before.

const MAX_TITLE_LENGTH = 120;

function parsePositiveInt(value: unknown): number | null {
  const num = Number(value);
  return Number.isInteger(num) && num > 0 ? num : null;
}

/** Renames a feed and/or moves it to another folder. Body: { id, title?, categoryId? }. */
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

  const { id, title, categoryId } = body as Record<string, unknown>;
  const idNum = parsePositiveInt(id);
  if (idNum === null) {
    return NextResponse.json({ error: "id must be a positive integer" }, { status: 400 });
  }

  const patch: { title?: string; categoryId?: number } = {};

  if (title !== undefined) {
    if (typeof title !== "string" || title.trim().length === 0) {
      return NextResponse.json({ error: "title must be a non-empty string" }, { status: 400 });
    }
    const trimmed = title.trim();
    if (trimmed.length > MAX_TITLE_LENGTH) {
      return NextResponse.json({ error: `title must be under ${MAX_TITLE_LENGTH} characters` }, { status: 400 });
    }
    patch.title = trimmed;
  }

  if (categoryId !== undefined) {
    const categoryIdNum = parsePositiveInt(categoryId);
    if (categoryIdNum === null) {
      return NextResponse.json({ error: "categoryId must be a positive integer" }, { status: 400 });
    }
    patch.categoryId = categoryIdNum;
  }

  if (patch.title === undefined && patch.categoryId === undefined) {
    return NextResponse.json({ error: "nothing to update: pass title and/or categoryId" }, { status: 400 });
  }

  try {
    await updateFeed(idNum, patch);
    return NextResponse.json({ ok: true });
  } catch (err) {
    // Surface Miniflux's own error text rather than a generic message.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Couldn't update that source." },
      { status: 502 }
    );
  }
}

/** Unsubscribes from a feed. Body: { id }. */
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
  const idNum = parsePositiveInt(id);
  if (idNum === null) {
    return NextResponse.json({ error: "id must be a positive integer" }, { status: 400 });
  }

  try {
    await deleteFeed(idNum);
    // Its stored articles would otherwise stay in Today and Search, pointing
    // at entries Miniflux no longer has. Best-effort: the unsubscribe stands.
    await hideArticlesOfFeeds([idNum]).catch((err) => console.error("hide articles after unsubscribe failed", err));
    await retireNewsletterFeeds([idNum]).catch((err) => console.error("retire newsletter address failed", err));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Couldn't unsubscribe from that source." },
      { status: 502 }
    );
  }
}
