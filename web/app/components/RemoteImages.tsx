"use client";

import { useState } from "react";
import { ImageOff } from "lucide-react";

/*
 * "Load images" for a rendered newsletter. The server emits every remote
 * image as data-src with no src, so nothing loads until this is pressed;
 * then the browser fetches them directly. See SanitizeOptions.deferImages
 * for why this is the only model that both respects privacy and actually
 * renders senders behind bot protection.
 */
export default function RemoteImages({ count }: { count: number }) {
  const [loaded, setLoaded] = useState(false);
  if (count === 0 || loaded) return null;

  function load() {
    for (const img of document.querySelectorAll<HTMLImageElement>(".newsletter-body img[data-src]")) {
      const src = img.getAttribute("data-src");
      if (src) {
        img.src = src;
        img.removeAttribute("data-src");
      }
    }
    setLoaded(true);
  }

  return (
    <div className="mt-5 flex items-start gap-3 rounded-lg bg-surface-3 p-4">
      <ImageOff className="mt-0.5 h-4 w-4 shrink-0 text-muted" strokeWidth={2} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="t-meta text-ink-2 text-pretty">
          {count} {count === 1 ? "image" : "images"} not loaded. Loading them fetches from the sender&apos;s servers,
          which tells them you opened this.
        </p>
        <button
          type="button"
          onClick={load}
          className="tap -ml-2 mt-1 inline-flex h-11 items-center rounded-sm px-2 t-meta font-semibold text-accent lg:h-8"
        >
          Load images
        </button>
      </div>
    </div>
  );
}
