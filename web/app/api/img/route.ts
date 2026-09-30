import { NextRequest } from "next/server";
import sharp from "sharp";
import { fetchChecked, readCapped, refused } from "@/lib/safe-fetch";

/*
 * Image proxy.
 *
 * Rendering `item.leadImage` directly hotlinks the publisher: every thumbnail
 * tells them what you are reading, via referrer and your IP, and breaks
 * outright on sites that block hotlinking. Fetching server-side means the
 * publisher only ever sees this box.
 *
 * Miniflux has its own signed media proxy, but its signing key is randomly
 * generated at startup unless pinned, so we cannot reproduce the signature
 * from here. This is the same idea, under our own control.
 */

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = /^image\/(jpeg|png|gif|webp|avif|svg\+xml)$/;
export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("u");
  if (!raw) return new Response("missing u", { status: 400 });

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return new Response("bad url", { status: 400 });
  }

  try {
    const result = await fetchChecked(target, { headers: { Accept: "image/*" } });
    if (refused(result)) {
      return new Response(result.error, { status: result.status });
    }
    const upstream = result;
    if (!upstream.ok) return new Response("upstream error", { status: 502 });

    const type = upstream.headers.get("content-type") ?? "";
    if (!ALLOWED_TYPES.test(type.split(";")[0].trim())) {
      return new Response("not an image", { status: 415 });
    }
    const length = Number(upstream.headers.get("content-length") ?? 0);
    if (length > MAX_BYTES) return new Response("too large", { status: 413 });

    // content-length is optional and can lie, so the cap is enforced on the
    // bytes actually read, not on the header.
    const { bytes: body, truncated } = await readCapped(upstream, MAX_BYTES);
    if (truncated) return new Response("too large", { status: 413 });

    // Publishers ship full-size art: a 78px thumbnail was pulling 1.7 MB down
    // a phone connection. Resize here rather than making the browser do it.
    // SVG is passed through untouched: it is already small and rasterising
    // it would lose the point.
    const width = Math.min(Math.max(Number(request.nextUrl.searchParams.get("w")) || 0, 0), 2000);
    if (width > 0 && !type.includes("svg")) {
      try {
        const out = await sharp(body)
          .rotate()
          .resize({ width, withoutEnlargement: true })
          .webp({ quality: 76 })
          .toBuffer();
        return new Response(new Uint8Array(out), {
          status: 200,
          headers: {
            "Content-Type": "image/webp",
            "Cache-Control": "public, max-age=604800, immutable",
            "X-Content-Type-Options": "nosniff",
          },
        });
      } catch {
        // Fall through and serve the original rather than showing nothing.
      }
    }

    return new Response(new Uint8Array(body), {
      status: 200,
      headers: {
        "Content-Type": type,
        "Cache-Control": "public, max-age=604800, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("fetch failed", { status: 502 });
  }
}
