import { NextRequest, NextResponse } from "next/server";

const MINIFLUX = process.env.MINIFLUX_URL ?? "http://miniflux:8080";
const TOKEN = process.env.MINIFLUX_API_TOKEN ?? "";

/**
 * Mark everything read, the whole feed list, or one category.
 * Miniflux owns read state; we never write its schema directly.
 */
export async function POST(request: NextRequest) {
  let body: { categoryId?: number } = {};
  try {
    body = await request.json();
  } catch {
    /* no body means "everything" */
  }

  const path =
    typeof body.categoryId === "number" && Number.isInteger(body.categoryId) && body.categoryId > 0
      ? `/v1/categories/${body.categoryId}/mark-all-as-read`
      : `/v1/users/1/mark-all-as-read`;

  const res = await fetch(`${MINIFLUX}${path}`, {
    method: "PUT",
    headers: { "X-Auth-Token": TOKEN },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return NextResponse.json(
      { error: `mark-all-as-read failed (${res.status}): ${text.slice(0, 200)}` },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true });
}
