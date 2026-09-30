import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { markRead } from "@/lib/miniflux";

/**
 * Marks an article's underlying Miniflux entry read, so native clients
 * (Reeder, NetNewsWire) stay in sync with the PWA. Goes through Miniflux's
 * REST API only, this route must never touch Miniflux's `public` schema
 * directly. Body: { articleId: number }.
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

  const { articleId } = body as Record<string, unknown>;
  const articleIdNum = Number(articleId);
  if (!Number.isInteger(articleIdNum) || articleIdNum <= 0) {
    return NextResponse.json({ error: "articleId must be a positive integer" }, { status: 400 });
  }

  const { rows } = await pool.query<{ miniflux_id: string }>(
    `select miniflux_id from app.article where id = $1`,
    [articleIdNum]
  );
  const row = rows[0];
  if (!row) {
    return NextResponse.json({ error: "article not found" }, { status: 404 });
  }

  try {
    await markRead([Number(row.miniflux_id)]);
  } catch (err) {
    // The interaction row (the actual training signal) is written separately
    // and is unaffected by Miniflux being unreachable, this failure only
    // means Reeder will see the entry as unread until the next sync.
    console.error("failed to mark entry read in Miniflux", err);
    return NextResponse.json({ error: "failed to mark read in Miniflux" }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
