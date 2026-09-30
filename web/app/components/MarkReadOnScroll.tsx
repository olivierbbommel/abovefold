"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { archive } from "@/app/actions";
import { noteRead } from "@/lib/read-ledger";

/**
 * Feedly-style "mark read as you scroll past it". Opt-in and OFF by
 * default; silently marking things read is destructive and irreversible
 * in Miniflux (there's no bulk-unread), so this only runs once the reader
 * has explicitly turned it on via AutoMarkReadToggle below, and the choice
 * is remembered per-browser in localStorage.
 *
 * A story only counts as "read" once it has scrolled fully past the top of
 * the viewport AND stayed there for ~1.5s; a fast flick down the page
 * must not mark everything read. Rows are found the same way KeyboardNav
 * finds them (`main article`, articleId off the row's own `/article/<id>`
 * link) rather than through a prop, so this never touches ItemRow/LeadItem.
 */

const STORAGE_KEY = "abovefold:auto-mark-read";
const CHANGE_EVENT = "abovefold:auto-mark-read-changed";
const SETTLE_MS = 1500;
// A row must have been on screen at least this long to count as read at all.
const MIN_VISIBLE_MS = 1200;
// Debounce the follow-up router.refresh() so a fast scroll that marks
// several rows read in a row doesn't re-render the list once per row;
// just once, shortly after the reader stops.
const REFRESH_DEBOUNCE_MS = 2000;

const ARTICLE_HREF_RE = /^\/article\/(\d+)/;

function readEnabled(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeEnabled(value: boolean) {
  try {
    window.localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
  } catch {
    // Storage can throw (private mode, quota, disabled); the toggle still
    // works for the rest of this session via the in-memory state below,
    // it just won't be remembered next visit.
  }
  window.dispatchEvent(new CustomEvent<boolean>(CHANGE_EVENT, { detail: value }));
}

function useAutoMarkReadEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    setEnabled(readEnabled());

    function onCustomChange(e: Event) {
      setEnabled((e as CustomEvent<boolean>).detail);
    }
    // Cross-tab sync (native storage event) plus same-tab sync (the
    // toggle and this hook can both be mounted at once and don't share
    // React state, so localStorage's own "storage" event never fires for
    // same-document writes; the CustomEvent covers that case).
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY) setEnabled(e.newValue === "1");
    }
    window.addEventListener(CHANGE_EVENT, onCustomChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(CHANGE_EVENT, onCustomChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return enabled;
}

function articleIdFor(row: Element): number | null {
  const link = row.querySelector<HTMLAnchorElement>('a[href^="/article/"]');
  if (!link) return null;
  const match = ARTICLE_HREF_RE.exec(new URL(link.href, window.location.href).pathname);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * "Mark read as I scroll" (spec 4.2, 5.6). A reading preference, so it lives
 * in the rail's preferences popover and Library's Reading section rather
 * than among the places in the nav. Purely a localStorage switch;
 * MarkReadOnScroll (mounted on the list pages) does the watching.
 *
 * The whole row is the control (label plus a 44px-tall switch), so the hit
 * area is the row, not the 30px pill.
 */
export function AutoMarkReadToggle({
  label = "Mark read as I scroll",
  icon,
  className = "",
}: {
  label?: string;
  icon?: React.ReactNode;
  className?: string;
}) {
  const enabled = useAutoMarkReadEnabled();

  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={() => writeEnabled(!enabled)}
      title="Mark stories read automatically as you scroll past them"
      className={`flex w-full items-center gap-3 text-left ${className}`}
    >
      {icon}
      <span className="min-w-0 flex-1">{label}</span>
      <span
        aria-hidden="true"
        className={`switch relative inline-flex h-[26px] w-[44px] shrink-0 items-center rounded-full ${
          enabled ? "bg-accent" : "bg-surface-3 shadow-[inset_0_0_0_1px_var(--border)]"
        }`}
      >
        <span
          className={`switch-knob inline-block h-[22px] w-[22px] rounded-full bg-surface shadow-e1 ${
            enabled ? "translate-x-[20px]" : "translate-x-[2px]"
          }`}
        />
      </span>
    </button>
  );
}

/** Renders nothing. Mount on a list page to enable scroll-driven mark-read,
 * gated by the toggle. */
export default function MarkReadOnScroll() {
  const enabled = useAutoMarkReadEnabled();
  const router = useRouter();

  useEffect(() => {
    if (!enabled) return;

    const timers = new Map<Element, number>();
    const observed = new WeakSet<Element>();
    let refreshTimer: number | null = null;

    function scheduleRefresh() {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        router.refresh();
      }, REFRESH_DEBOUNCE_MS);
    }

    function clearRow(row: Element) {
      const t = timers.get(row);
      if (t !== undefined) {
        window.clearTimeout(t);
        timers.delete(row);
      }
    }

    async function markRow(row: Element) {
      timers.delete(row);
      // A tab that went hidden mid-settle just skips this pass; no further
      // intersection event will arrive to retry it while hidden, and that's
      // fine: it's an opt-in convenience, not a guarantee every row gets
      // caught the instant it qualifies.
      if (document.visibilityState !== "visible") return;
      const articleId = articleIdFor(row);
      if (!articleId) return;
      try {
        const res = await archive(articleId);
        if (res.ok) {
          // So a Back from a story opened in the next two seconds, before
          // the debounced refresh, cannot bring these rows back.
          noteRead(articleId);
          scheduleRefresh();
        }
      } catch {
        // Best-effort; a failed auto mark-read just leaves the story
        // unread, same as if the reader had never scrolled past it.
      }
    }

    // How long a row was actually ON SCREEN before it left the top. The
    // settle timer alone never guarded against a fast flick: a flick leaves
    // every row past the top and they STAY there, so nothing cancelled
    // anything and one swipe marked the whole list read; irreversibly, since
    // Miniflux has no bulk unread. A row you actually read was visible for a
    // while; a row you flew past was visible for a few dozen milliseconds.
    const shownAt = new Map<Element, number>();

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const row = entry.target;
          if (entry.isIntersecting && !shownAt.has(row)) {
            shownAt.set(row, Date.now());
          }
          if (!entry.isIntersecting && entry.boundingClientRect.bottom <= 0) {
            const visibleMs = Date.now() - (shownAt.get(row) ?? Date.now());
            shownAt.delete(row);
            if (visibleMs < MIN_VISIBLE_MS) {
              // Flicked past, not read.
              clearRow(row);
              continue;
            }
            // Scrolled fully past the top edge; start (or restart) the
            // settle timer rather than marking it immediately.
            if (!timers.has(row)) {
              const id = window.setTimeout(() => markRow(row), SETTLE_MS);
              timers.set(row, id);
            }
          } else {
            // Back in view (scrolled up again) or hasn't reached the top
            // yet; cancel any pending mark.
            clearRow(row);
          }
        }
      },
      { threshold: 0 }
    );

    function scan() {
      for (const row of document.querySelectorAll<HTMLElement>("main article")) {
        if (!observed.has(row)) {
          observed.add(row);
          io.observe(row);
        }
      }
    }

    scan();
    // New rows stream in via Suspense and arrive after router.refresh();
    // watch for them so this doesn't only ever cover the rows present at
    // mount.
    const mo = new MutationObserver(scan);
    mo.observe(document.body, { childList: true, subtree: true });

    function onVisibilityChange() {
      // Don't let time spent away from the tab count toward the 1.5s
      // settle; a row that was mid-timer when the tab was backgrounded
      // shouldn't fire the instant it's foregrounded again.
      if (document.visibilityState === "hidden") {
        for (const row of Array.from(timers.keys())) clearRow(row);
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      mo.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      for (const t of timers.values()) window.clearTimeout(t);
      timers.clear();
      // Leaving with a refresh still pending (opening a story right after
      // rows were marked) used to drop it; run it now instead.
      if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer);
        router.refresh();
      }
    };
  }, [enabled, router]);

  return null;
}
