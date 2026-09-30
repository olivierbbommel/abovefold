import { NextRequest, NextResponse } from "next/server";
import { discoverFeeds } from "@/lib/discover";

/* Feed discovery for a URL. The implementation lives in lib/discover.ts. */
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
  const { url } = body as Record<string, unknown>;
  if (typeof url !== "string" || url.trim().length === 0) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }
  const outcome = await discoverFeeds(url);
  if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: 400 });
  return NextResponse.json(outcome.result);
}
