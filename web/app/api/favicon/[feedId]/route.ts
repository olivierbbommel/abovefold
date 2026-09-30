import { NextRequest, NextResponse } from "next/server";
import { feedIcon } from "@/lib/miniflux";

/*
 * Serves a feed's favicon, proxied from Miniflux (which fetches and caches
 * these itself when a feed is subscribed), never from a third-party
 * favicon service. Hitting e.g. google.com/s2/favicons per-source would leak
 * the user's whole subscription list to Google on every page load, which is
 * exactly what the /api/img proxy exists to avoid for article images.
 *
 * Answers 204 when the feed has no icon, so FeedIcon can fall back to the
 * colour swatch instead of rendering a broken image.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ feedId: string }> }
) {
  const { feedId } = await params;
  const id = Number(feedId);
  if (!Number.isInteger(id) || id <= 0) {
    return new Response("bad feed id", { status: 400 });
  }

  let icon;
  try {
    icon = await feedIcon(id);
  } catch {
    return new Response("upstream error", { status: 502 });
  }
  if (!icon) {
    // 204, not 404: a 404 logs a console error on every page that lists this
    // feed, while an empty 2xx still fails to decode, so FeedIcon's onError
    // shows the swatch all the same. Cached for a day so the rail does not ask
    // again on every navigation.
    return new Response(null, { status: 204, headers: { "Cache-Control": "private, max-age=86400" } });
  }

  const body = Buffer.from(icon.base64, "base64");
  return new NextResponse(new Uint8Array(body), {
    status: 200,
    headers: {
      "Content-Type": icon.mimeType || "image/x-icon",
      // Favicons rarely change; Miniflux itself only refreshes them on
      // refeed. A week is plenty, and cheap to correct by re-subscribing.
      "Cache-Control": "public, max-age=604800, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
