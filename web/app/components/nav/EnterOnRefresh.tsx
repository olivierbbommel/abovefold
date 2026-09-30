"use client";

import { useEffect, useRef, type ReactNode } from "react";

/*
 * Rows entering on refresh (spec 3.2). Only stories that were not in the
 * list before animate: the row's height grows from 0 over 220ms, so rows
 * below ride down with it (no FLIP), while its content fades and rises 6px
 * over 240ms. Staggered 30ms, at most 8 staggered. Plain navigation never
 * animates (audit A22); the first scan only records what is there.
 *
 * Rows are found the way KeyboardNav finds them, by their /article/<id>
 * link, so this never needs a prop threaded through StoryRow. Rows that
 * ShowMore is revealing are skipped: they have their own entrance.
 * Reduced motion: new rows appear in place.
 */
const ID_RE = /^\/article\/(\d+)/;

function idsIn(root: HTMLElement): Map<string, HTMLElement> {
  const out = new Map<string, HTMLElement>();
  for (const a of root.querySelectorAll<HTMLAnchorElement>('article a[href^="/article/"]')) {
    const m = ID_RE.exec(a.getAttribute("href") ?? "");
    const article = a.closest("article");
    if (m && article && !out.has(m[1])) out.set(m[1], article as HTMLElement);
  }
  return out;
}

export default function EnterOnRefresh({ children, className }: { children: ReactNode; className?: string }) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const known = new Set(idsIn(el).keys());
    const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const mo = new MutationObserver(() => {
      const fresh: HTMLElement[] = [];
      for (const [id, article] of idsIn(el)) {
        if (known.has(id)) continue;
        known.add(id);
        if (article.closest("[data-revealing]")) continue;
        fresh.push(article);
      }
      if (fresh.length === 0 || reduced()) return;
      fresh.forEach((article, i) => {
        // The swipe wrapper's parent is the row's outermost box (no padding),
        // so its height can go to 0 cleanly.
        const box = (article.closest("[data-swipe-row]")?.parentElement as HTMLElement | null) ?? article;
        const delay = Math.min(i, 8) * 30;
        const h = box.getBoundingClientRect().height;
        box.style.overflow = "hidden";
        box
          .animate([{ height: "0px" }, { height: `${h}px` }], {
            duration: 220,
            delay,
            easing: "cubic-bezier(0.2, 0, 0, 1)",
            fill: "backwards",
          })
          .finished.catch(() => {})
          .finally(() => {
            box.style.overflow = "";
          });
        article.animate(
          [
            { opacity: 0, transform: "translateY(6px)" },
            { opacity: 1, transform: "none" },
          ],
          { duration: 240, delay, easing: "cubic-bezier(0.16, 1, 0.3, 1)", fill: "backwards" }
        );
      });
    });
    mo.observe(el, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, []);

  return (
    <div ref={root} className={className}>
      {children}
    </div>
  );
}
