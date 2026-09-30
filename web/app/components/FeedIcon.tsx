"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { displayName } from "@/lib/display-name";
import { tileLetter } from "@/lib/add-format";

/*
 * Icons that have already failed in this tab. A remount (Show more, a
 * refresh, the next page) starts from the letter tile instead of trying the
 * image again and flashing a blank tile before falling back.
 */
const failedIcons = new Set<number>();

/**
 * A source's favicon, proxied server-side from Miniflux (see
 * app/api/favicon/[feedId]/route.ts). When the feed has no icon, the request
 * 404s, or the image fails to decode, it falls back to the tile the Add sheet
 * uses for sites not yet followed: the first letter of the name in muted on
 * surface-3. Never a broken-image glyph, and never a colour of its own: the
 * accent is the only colour in the chrome.
 *
 * Pass `radius` to match the call site's corner (rows, byline, source rows).
 */
export default function FeedIcon({
  feedId,
  title,
  size,
  radius,
}: {
  feedId: number;
  title: string;
  size: number;
  radius: number;
}) {
  // Must start false: the server always renders the <img>, and starting from
  // the module-level failed set made the client render a <span> instead,
  // which was a hydration error (#418) on every page with story rows.
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLImageElement>(null);

  // Known failures apply before paint, so remounts (Show more) never flash a
  // broken image.
  useLayoutEffect(() => {
    if (failedIcons.has(feedId)) setFailed(true);
  }, [feedId]);

  // An icon that failed before hydration fired its error event before React
  // was listening.
  useEffect(() => {
    const img = ref.current;
    if (img && img.complete && img.naturalWidth === 0) {
      failedIcons.add(feedId);
      setFailed(true);
    }
  }, [feedId]);

  if (failed) {
    return (
      <span
        className="flex shrink-0 items-center justify-center bg-surface-3 font-semibold leading-none text-muted"
        style={{ width: size, height: size, borderRadius: radius, fontSize: Math.round(size * 0.6) }}
        aria-hidden="true"
      >
        {tileLetter(displayName(title) || title)}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- tiny proxied icon, not worth next/image's overhead here
    <img
      ref={ref}
      src={`/api/favicon/${feedId}`}
      alt=""
      width={size}
      height={size}
      className="shrink-0 object-contain"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        // Many favicons have transparent backgrounds; the neutral tile keeps
        // them legible on either theme.
        background: "var(--surface-3)",
        padding: Math.max(1, Math.round(size * 0.1)),
      }}
      onError={() => {
        failedIcons.add(feedId);
        setFailed(true);
      }}
      aria-hidden="true"
    />
  );
}
