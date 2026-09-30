import { NextRequest, NextResponse } from "next/server";
import { retireNewsletterFeeds } from "@/lib/newsletter";
import { createCategory, deleteCategory, feedsByCategory, updateCategory } from "@/lib/miniflux";
import { hideArticlesOfFeeds } from "@/lib/queries";

// Folder = Miniflux category. This route exists because nothing in the app
// could create one before, /add could only file a new feed into a folder
// that already existed.

const MAX_TITLE_LENGTH = 60;

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

  const { title } = body as Record<string, unknown>;
  if (typeof title !== "string" || title.trim().length === 0) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  const trimmed = title.trim();
  if (trimmed.length > MAX_TITLE_LENGTH) {
    return NextResponse.json({ error: `title must be under ${MAX_TITLE_LENGTH} characters` }, { status: 400 });
  }

  try {
    const folder = await createCategory(trimmed);
    return NextResponse.json(folder, { status: 201 });
  } catch (err) {
    // Surface Miniflux's own error text (e.g. "This category already
    // exists.") rather than a generic message.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Couldn't create that folder." },
      { status: 502 }
    );
  }
}

/** Renames a folder (Miniflux category). Body: { id, title }. */
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

  const { id, title } = body as Record<string, unknown>;
  const idNum = Number(id);
  if (!Number.isInteger(idNum) || idNum <= 0) {
    return NextResponse.json({ error: "id must be a positive integer" }, { status: 400 });
  }
  if (typeof title !== "string" || title.trim().length === 0) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  const trimmed = title.trim();
  if (trimmed.length > MAX_TITLE_LENGTH) {
    return NextResponse.json({ error: `title must be under ${MAX_TITLE_LENGTH} characters` }, { status: 400 });
  }

  try {
    const folder = await updateCategory(idNum, trimmed);
    return NextResponse.json(folder);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Couldn't rename that folder." },
      { status: 502 }
    );
  }
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

  try {
    // Miniflux deletes the folder's feeds with it; collect them first so
    // their stored articles can be hidden too.
    const feedIds = ((await feedsByCategory().catch(() => ({}))) as Record<number, { id: number }[]>)[idNum]?.map((f) => f.id) ?? [];
    await deleteCategory(idNum);
    await hideArticlesOfFeeds(feedIds).catch((err) => console.error("hide articles after folder delete failed", err));
    await retireNewsletterFeeds(feedIds).catch((err) => console.error("retire newsletter addresses failed", err));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Couldn't delete that folder." },
      { status: 502 }
    );
  }
}
