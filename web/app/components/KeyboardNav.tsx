"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { X } from "lucide-react";
import { listDropsReadStories } from "@/lib/collapse";
import { enterOpensSelection } from "@/lib/keyboard";
import { SHORTCUTS } from "./nav/shortcuts";

/**
 * Feedly-style j/k list navigation, mounted once in app/(app)/layout.tsx so
 * it works on every list (Today, Later, folders, search results). It never
 * touches StoryRow's markup: rows are found by querying the DOM
 * (`main article`) and the
 * per-row article id is read back off the row's own `/article/<id>` link,
 * so this works against whatever those components render without needing
 * a shared prop or a data-attribute wired through them.
 *
 * Shortcuts:
 *   j / k   move selection down / up, scrolled into view
 *   o/Enter open the selected story (Enter only when focus is not on some
 *           other control; see lib/keyboard.ts)
 *   s       save for later; s and m press the row's own RowActions button,
 *   m       mark read       so the toast, Undo and collapse match a click
 *   r       router.refresh()
 *   ?       toggle this overlay
 *   /       focus the search box, if one exists on the page (no-op otherwise)
 *   Esc     close the overlay
 *
 * Never fires while the user is typing (input/textarea/select/
 * contenteditable, or a ⌘/Ctrl/Alt chord is held); see isTypingTarget.
 */

const ARTICLE_HREF_RE = /^\/article\/(\d+)/;

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return false;
}

// A row RowActions is collapsing out (data-leaving) is skipped: it is still
// in the DOM for the length of the animation.
function getRows(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("main article")).filter(
    (row) => !row.closest("[data-leaving]")
  );
}

function articleIdFor(row: HTMLElement): number | null {
  const link = row.querySelector<HTMLAnchorElement>('a[href^="/article/"]');
  if (!link) return null;
  const match = ARTICLE_HREF_RE.exec(new URL(link.href, window.location.href).pathname);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function articleHrefFor(row: HTMLElement): string | null {
  const link = row.querySelector<HTMLAnchorElement>('a[href^="/article/"]');
  return link ? link.getAttribute("href") : null;
}

// Clears the outline this component draws on rows itself; it never asks
// ItemRow/LeadItem to render a "selected" prop, so nothing else needs to
// know this state exists.
function paintSelection(row: HTMLElement | null) {
  if (!row) return;
  row.style.outline = `2px solid var(--accent)`;
  row.style.outlineOffset = "-2px";
  row.style.borderRadius = "10px";
}

function clearSelection(row: HTMLElement | null) {
  if (!row) return;
  row.style.outline = "";
  row.style.outlineOffset = "";
  row.style.borderRadius = "";
}


export default function KeyboardNav() {
  const router = useRouter();
  const selectedRowRef = useRef<HTMLElement | null>(null);
  const selectedIndexRef = useRef(-1);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  // The overlay is a native <dialog> opened with showModal(): focus is
  // trapped and the page behind is inert. Close gets focus on open, and
  // focus goes back to where it was (usually the selected row) on close.
  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (overlayOpen && !d.open) {
      returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      d.showModal();
      closeRef.current?.focus();
    } else if (!overlayOpen && d.open) {
      d.close();
      returnFocusRef.current?.focus({ preventScroll: true });
      returnFocusRef.current = null;
    }
  }, [overlayOpen]);

  // Mounted once for the whole app, so a selection must not survive a
  // navigation: j on the next page starts from its first row.
  useEffect(() => {
    clearSelection(selectedRowRef.current);
    selectedRowRef.current = null;
    selectedIndexRef.current = -1;
  }, [pathname]);

  useEffect(() => {
    // Cheap on mobile, and j/k/etc have no meaning on a touch keyboard
    // anyway; don't even attach the listener on coarse-pointer devices.
    if (typeof window !== "undefined" && !window.matchMedia("(pointer: fine)").matches) {
      return;
    }

    function reducedMotion() {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    }

    function isMobileLayout() {
      // Matches the `lg:hidden` breakpoint of the fixed tab bar
      // (nav/TabBar.tsx). Below it the bar covers the bottom of the
      // viewport and rows need extra scroll-margin-bottom to clear it.
      return window.matchMedia("(max-width: 1023.98px)").matches;
    }

    function select(index: number, rows: HTMLElement[]) {
      if (rows.length === 0) return;
      const clamped = Math.max(0, Math.min(index, rows.length - 1));
      clearSelection(selectedRowRef.current);
      const row = rows[clamped];
      selectedRowRef.current = row;
      selectedIndexRef.current = clamped;
      paintSelection(row);

      // scroll-margin (not a hand-computed pixel offset) is what keeps the
      // row clear of the header above and the fixed mobile tab bar below;
      // scrollIntoView respects it automatically.
      row.style.scrollMarginTop = "16px";
      row.style.scrollMarginBottom = isMobileLayout() ? "84px" : "16px";

      row.tabIndex = -1;
      row.focus({ preventScroll: true });
      row.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
    }

    function currentIndex(rows: HTMLElement[]): number {
      const current = selectedRowRef.current;
      if (current) {
        const idx = rows.indexOf(current);
        if (idx !== -1) return idx;
      }
      return selectedIndexRef.current;
    }

    // Holding `m` once fired against the SAME selected row on every repeat,
    // each inserting another `archived` row into app.interaction, which is
    // the ranker's training data. Repeats are ignored, and the button itself
    // refuses a second press while it shows "done".
    function pressRowAction(kind: "save" | "read", e: KeyboardEvent) {
      const row = selectedRowRef.current;
      if (!row || e.repeat) return;
      if (!articleIdFor(row)) return;
      const button = row.querySelector<HTMLButtonElement>(`[data-row-action="${kind}"]`);
      if (!button) return;
      e.preventDefault();
      if (kind === "read" && listDropsReadStories(pathnameRef.current)) {
        // The row is about to collapse out of the list. Drop the selection
        // but keep its place, so the next j lands on the story that moves
        // up into it.
        clearSelection(row);
        selectedIndexRef.current = getRows().indexOf(row) - 1;
        selectedRowRef.current = null;
      }
      button.click();
    }

    // Focus moving anywhere outside the list (Tab to the rail, a click in the
    // header) ends the keyboard selection, so its outline and Enter stop
    // pointing at a story the user has left. The overlay does not count.
    function onFocusIn(e: FocusEvent) {
      const row = selectedRowRef.current;
      if (!row) return;
      const target = e.target as Node | null;
      if (!target || dialogRef.current?.contains(target)) return;
      if (getRows().some((r) => r.contains(target))) return;
      clearSelection(row);
      selectedRowRef.current = null;
      selectedIndexRef.current = -1;
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
      if (isTypingTarget(e.target)) return;

      if (e.key === "Escape") {
        if (overlayOpen) setOverlayOpen(false);
        return;
      }

      if (e.key === "?") {
        e.preventDefault();
        setOverlayOpen((v) => !v);
        return;
      }

      // Overlay eats every other shortcut while it's up, so j/k don't move
      // the selection underneath it.
      if (overlayOpen) return;

      switch (e.key) {
        case "j": {
          e.preventDefault();
          const rows = getRows();
          select(currentIndex(rows) + 1, rows);
          break;
        }
        case "k": {
          e.preventDefault();
          const rows = getRows();
          const idx = currentIndex(rows);
          select(idx === -1 ? 0 : idx - 1, rows);
          break;
        }
        case "o":
        case "Enter": {
          const row = selectedRowRef.current;
          if (!row) break;
          if (e.key === "Enter") {
            const focused = document.activeElement;
            const info =
              focused instanceof HTMLElement ? { tag: focused.tagName, role: focused.getAttribute("role") } : null;
            if (!enterOpensSelection(info, !!focused && row.contains(focused))) break;
          }
          const href = articleHrefFor(row);
          if (!href) break;
          e.preventDefault();
          router.push(href);
          break;
        }
        case "s": {
          pressRowAction("save", e);
          break;
        }
        case "m": {
          pressRowAction("read", e);
          break;
        }
        case "r": {
          e.preventDefault();
          router.refresh();
          break;
        }
        case "/": {
          // The first VISIBLE field: on /search that is the rail's on
          // desktop, and the page's own when the rail is hidden.
          const searchInput = Array.from(
            document.querySelectorAll<HTMLInputElement>('input[type="search"], [data-search-input]')
          ).find((el) => el.offsetParent !== null);
          if (searchInput) {
            e.preventDefault();
            searchInput.focus();
            searchInput.select?.();
          }
          // No search box on the page yet; silently no-op rather than error.
          break;
        }
        default:
          break;
      }
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocusIn);
      clearSelection(selectedRowRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlayOpen, router]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="keyboard-shortcuts-title"
      onCancel={(e) => {
        e.preventDefault();
        setOverlayOpen(false);
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) setOverlayOpen(false); // backdrop click
      }}
      className="m-auto w-[calc(100%-2.5rem)] max-w-[340px] bg-transparent p-0 text-ink backdrop:bg-scrim"
    >
      {overlayOpen && (
        <div className="popover rounded-lg border border-hairline bg-surface p-5 shadow-e2">
          <div className="flex items-center justify-between gap-3">
            <h2 id="keyboard-shortcuts-title" className="t-title text-ink">
              Keyboard shortcuts
            </h2>
            <button
              ref={closeRef}
              type="button"
              onClick={() => setOverlayOpen(false)}
              aria-label="Close"
              className="tap flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-muted hover:bg-surface-2 hover:text-ink"
            >
              <X className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>
          <dl className="mt-4 flex flex-col gap-2">
            {SHORTCUTS.map(([key, label]) => (
              <div key={key} className="flex items-center gap-3 t-nav">
                <dt className="w-12 shrink-0">
                  <kbd className="rounded-xs border border-line bg-surface-2 px-1.5 py-px font-sans text-[0.75rem] text-muted">{key}</kbd>
                </dt>
                <dd className="text-ink-2">{label}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </dialog>
  );
}
