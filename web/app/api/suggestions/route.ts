import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

const MAX_URL_LENGTH = 500;

function isPlausibleHttpUrl(value: string): boolean {
  if (value.length === 0 || value.length > MAX_URL_LENGTH) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Permanently dismisses a suggested source (see lib/suggestions.ts) so it
 * stops being offered anywhere, not just on the folder page it was
 * dismissed from. Body: { feedUrl: string }.
 */
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

  const { feedUrl } = body as Record<string, unknown>;
  if (typeof feedUrl !== "string" || !isPlausibleHttpUrl(feedUrl.trim())) {
    return NextResponse.json(
      { error: "feedUrl must be a valid http(s) URL under 500 characters" },
      { status: 400 }
    );
  }

  await pool.query(
    `insert into app.dismissed_suggestion (feed_url) values ($1) on conflict (feed_url) do nothing`,
    [feedUrl.trim()]
  );

  return NextResponse.json({ ok: true });
}
