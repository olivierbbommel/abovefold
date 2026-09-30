import { NextRequest, NextResponse } from "next/server";
import { performSearch } from "@/lib/search";

/**
 * GET /api/search?q=..., semantic + keyword search over app.article.
 * Sits behind the same session-cookie auth as every other route (see
 * middleware.ts matcher, nothing exempts /api/search).
 *
 * This is the endpoint SearchPageInput debounces against for live search
 * as the user types on /search. The initial render of /search itself calls
 * performSearch() directly (no HTTP round trip), see
 * app/(app)/search/page.tsx.
 */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q") ?? "";
  const result = await performSearch(q);
  return NextResponse.json(result);
}
