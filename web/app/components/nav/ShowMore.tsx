"use client";

import { isValidElement, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/*
 * "Show 22 more" (spec 5.1). The rows are already fetched and server
 * rendered; this only decides when they mount. They are not mounted while
 * hidden, so j/k and mark-read-on-scroll (which find rows in the DOM) never
 * act on a story the owner cannot see. Revealing is in place, no navigation:
 * the old "More from today" link went to a second page also called Today.
 *
 * Once everything is showing, the button becomes the explicit end of the
 * list, with whatever `end` carries next to it (Mark all read on desktop).
 */
const STAGGER_MS = 30;
const RETURN_KEY = "abovefold:show-more:return";
const STAGGERED = 8;

/*
 * Put the list back where it was after a Back. The browser and the router
 * both restore scroll too, before the revealed rows exist, and clamp to the
 * short page; so re-apply for a moment until the position holds, and stop
 * the instant the reader scrolls on their own.
 */
function restoreScroll(y: number) {
  const until = performance.now() + 600;
  let userMoved = false;
  const stop = () => (userMoved = true);
  window.addEventListener("wheel", stop, { once: true, passive: true });
  window.addEventListener("touchstart", stop, { once: true, passive: true });
  window.addEventListener("keydown", stop, { once: true });
  const tick = () => {
    if (userMoved) return;
    if (Math.abs(window.scrollY - y) > 2) window.scrollTo(0, y);
    if (performance.now() < until) requestAnimationFrame(tick);
    else {
      window.removeEventListener("wheel", stop);
      window.removeEventListener("touchstart", stop);
      window.removeEventListener("keydown", stop);
    }
  };
  requestAnimationFrame(tick);
}

export default function ShowMore({ rows, end }: { rows: ReactNode[]; end?: ReactNode }) {
  const [open, setOpen] = useState(rows.length === 0);
  const [revealing, setRevealing] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  // Opening a story and coming Back remounted this closed: 9 rows again and
  // the scroll position gone. Remember it per list for the tab. The browser
  // restores scroll before these rows mount, so it clamps to the short page;
  // after a Back, put the remembered position back once the rows are in.
  const memoryKey = () => `abovefold:show-more:${window.location.pathname}${window.location.search}`;
  useLayoutEffect(() => {
    let saved: number | null = null;
    try {
      if (window.sessionStorage.getItem(memoryKey()) !== "1") return;
      saved = Number(window.sessionStorage.getItem(`${memoryKey()}:y`));
    } catch {
      return; // storage unavailable: start closed, as before
    }
    setOpen(true);
    // Came back from a story opened in this list (popstate never reaches us:
    // the router handles Back itself), so restore; a fresh visit does not.
    let cameBack = false;
    try {
      cameBack = window.sessionStorage.getItem(RETURN_KEY) === memoryKey();
      window.sessionStorage.removeItem(RETURN_KEY);
    } catch {
      // no restore
    }
    if (cameBack && saved && saved > 0) restoreScroll(saved);
  }, []);

  // While open, keep the position current (throttled to a frame), and note
  // which list a story was opened from.
  useEffect(() => {
    if (!open) return;
    const onOpenStory = (e: MouseEvent) => {
      if ((e.target as Element | null)?.closest?.('main a[href^="/article/"]')) {
        try {
          window.sessionStorage.setItem(RETURN_KEY, memoryKey());
        } catch {
          // no restore on Back
        }
      }
    };
    document.addEventListener("click", onOpenStory, true);
    let frame = 0;
    const key = `${memoryKey()}:y`;
    const here = window.location.pathname + window.location.search;
    const onScroll = () => {
      // Opening a story scrolls to the top after the URL has changed; that
      // scroll is the article's, not this list's, and must not be recorded.
      if (window.location.pathname + window.location.search !== here) return;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (window.location.pathname + window.location.search !== here) return;
        try {
          window.sessionStorage.setItem(key, String(Math.round(window.scrollY)));
        } catch {
          // position not remembered
        }
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      document.removeEventListener("click", onOpenStory, true);
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [open]);

  function reveal() {
    setOpen(true);
    try {
      window.sessionStorage.setItem(memoryKey(), "1");
    } catch {
      // not remembered; still opens
    }
    // Tells EnterOnRefresh these rows are revealed, not newly arrived.
    setRevealing(true);
    window.setTimeout(() => setRevealing(false), 600);
    // The button is about to unmount; keep keyboard focus in the list.
    requestAnimationFrame(() => {
      wrap.current?.querySelector<HTMLElement>('a[href^="/article/"]')?.focus({ preventScroll: true });
    });
  }

  return (
    <>
      <div ref={wrap} data-revealing={revealing || undefined}>
        {open &&
          rows.map((row, i) => (
            <div key={isValidElement(row) && row.key != null ? row.key : i} className="row-enter" style={{ animationDelay: `${Math.min(i, STAGGERED) * STAGGER_MS}ms` }}>
              {row}
            </div>
          ))}
      </div>
      {open ? (
        <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1 py-4">
          <p className="t-caption text-faint">That&rsquo;s everything from the last 48 hours</p>
          {end}
        </div>
      ) : (
        <button
          type="button"
          onClick={reveal}
          className="tap mt-4 h-11 w-full rounded-md bg-surface-3 t-button text-ink-2 hover:text-ink"
        >
          Show {rows.length} more
        </button>
      )}
    </>
  );
}
