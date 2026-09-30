"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { forgetRead } from "@/lib/read-ledger";
import { useRouter } from "next/navigation";
import {
  Bookmark,
  BookmarkCheck,
  Check,
  Copy,
  Ellipsis,
  Share,
  SquareArrowOutUpRight,
} from "lucide-react";
import { archive, removeFromLater, saveForLater, undoAction } from "@/app/actions";
import { useToast } from "./Toast";
import { goBack } from "./ArticleBackButton";

/*
 * Save / Mark read on the reader (spec 5.3).
 *
 * The same server actions the swipe rows use, with the same toast and a
 * real Undo, and then back to the list you came from. Finishing an article
 * is a decision about what to do with it; once made, the list is where you
 * want to be. (These were once plain <form action>s: no feedback, and a
 * second Save silently un-saved because Miniflux stars are a toggle.)
 *
 * Two placements. "toolbar" is the top bar: monochrome glyphs in 44px hit
 * areas, no boxes, and an ellipsis menu (Open original, Copy link, Share).
 * It also owns the reader's shortcuts s, m and o, so they are registered
 * once. "end" is the pair of labelled buttons under the last paragraph,
 * where your thumb already is.
 */

type Props = {
  articleId: number;
  minifluxId?: number;
  saved: boolean;
  url: string;
  title: string;
};

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

const readerLock = { held: false };

function useArticleActions({ articleId, minifluxId, saved: initiallySaved }: Props) {
  const router = useRouter();
  const { push } = useToast();
  const [busy, setBusy] = useState<"save" | "read" | null>(null);
  const [saved, setSaved] = useState(initiallySaved);
  const [, startTransition] = useTransition();

  function run(kind: "save" | "read") {
    // The toolbar and the end-of-article actions each hold this hook, so a
    // local busy flag let both fire: two archive calls and router.back()
    // twice, landing on /login. One lock for the whole reader.
    if (busy || readerLock.held) return;
    readerLock.held = true;
    setBusy(kind);
    startTransition(async () => {
      try {
        if (kind === "save" && saved) {
          // Already in Later: the bookmark takes it out (there was no way to).
          const removed = await removeFromLater(articleId, minifluxId).catch(() => ({ ok: false as const }));
          setBusy(null);
          if (!removed.ok) {
            push({ message: "Couldn't remove. Try again." });
            return;
          }
          setSaved(false);
          push({
            message: "Removed from Later",
            action: {
              label: "Undo",
              onClick: async () => {
                const again = await saveForLater(articleId, minifluxId).catch(() => ({ ok: false as const }));
                if (again.ok) setSaved(true);
                push({ message: again.ok ? "Back in Later" : "Couldn't undo. Try again." });
                router.refresh();
              },
            },
          });
          router.refresh();
          return;
        }

        const action = kind === "save" ? saveForLater : archive;
        const result = await action(articleId, minifluxId).catch(() => ({ ok: false as const, error: "failed" }));
        if (!result.ok) {
          setBusy(null);
          push({ message: kind === "save" ? "Couldn't save. Try again." : "Couldn't mark read. Try again." });
          return;
        }
        if (kind === "save") setSaved(true);
        const interactionId = result.interactionId;
        if (interactionId === 0) {
          // Nothing changed (already saved, or already read): no Undo that
          // would reverse the earlier action instead.
          push({ message: kind === "save" ? "Already in Later" : "Already read" });
        } else {
          push({
            message: kind === "save" ? "Saved for later" : "Marked read",
            action: {
              label: "Undo",
              onClick: async () => {
                const undone = await undoAction(interactionId);
                if (undone.ok && kind === "read") forgetRead(articleId);
                push({
                  message: undone.ok
                    ? kind === "save"
                      ? "Removed from Later"
                      : "Marked unread"
                    : "Couldn't undo. Try again.",
                });
              },
            },
          });
        }
        // Refresh before navigating: router.back() can restore a cached payload
        // of the list, which would still show the story you just dealt with.
        router.refresh();
        goBack(router, articleId);
      } finally {
        readerLock.held = false;
      }
    });
  }

  return { busy, saved, run };
}

const glyph = "h-5 w-5";

export function ReaderToolbar(props: Props) {
  const { busy, saved, run } = useArticleActions(props);
  const { push } = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const [canShare, setCanShare] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const runRef = useRef(run);
  runRef.current = run;

  useEffect(() => setCanShare(typeof navigator.share === "function"), []);

  // s save, m mark read, o open original (spec 5.3 desktop tooltips).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      // Any open dialog or modal (the ? shortcuts sheet included) owns the
      // keyboard; s and m must not act on the article behind it.
      if (document.querySelector('dialog[open], [aria-modal="true"]')) return;
      if (e.key === "s") runRef.current("save");
      else if (e.key === "m") runRef.current("read");
      else if (e.key === "o") window.open(props.url, "_blank", "noopener,noreferrer");
      else return;
      e.preventDefault();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [props.url]);

  // A real menu (WAI-ARIA menu button): focus moves to the first item on
  // open, arrows and Home/End move between items, Esc returns focus to the
  // trigger, and Tab or a click elsewhere closes it. Items are found by role,
  // so a new one needs no change here.
  useEffect(() => {
    if (!menuOpen) return;
    const items = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    items()[0]?.focus();
    function onPointer(e: PointerEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        closeMenu();
        return;
      }
      const list = items();
      const at = list.indexOf(document.activeElement as HTMLElement);
      if (at === -1 || list.length === 0) return;
      let next: number;
      if (e.key === "ArrowDown") next = (at + 1) % list.length;
      else if (e.key === "ArrowUp") next = (at - 1 + list.length) % list.length;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = list.length - 1;
      else return;
      e.preventDefault();
      list[next].focus();
    }
    function onFocusOut(e: FocusEvent) {
      if (e.relatedTarget && !menuRef.current?.contains(e.relatedTarget as Node)) setMenuOpen(false);
    }
    const root = menuRef.current;
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    root?.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
      root?.removeEventListener("focusout", onFocusOut);
    };
  }, [menuOpen]);

  // Activating an item unmounts it; hand focus back to the trigger rather
  // than dropping it on <body>.
  function closeMenu() {
    setMenuOpen(false);
    triggerRef.current?.focus();
  }

  async function copyLink() {
    closeMenu();
    try {
      await navigator.clipboard.writeText(props.url);
      push({ message: "Link copied" });
    } catch {
      push({ message: "Couldn't copy the link." });
    }
  }

  async function share() {
    closeMenu();
    try {
      await navigator.share({ title: props.title, url: props.url });
    } catch {
      // Dismissing the share sheet rejects; that is not an error to show.
    }
  }

  const button =
    "tap reader-tool flex h-11 w-11 items-center justify-center rounded-sm text-ink-2 hover:bg-surface-2 hover:text-ink disabled:opacity-40 lg:h-9 lg:w-9";

  return (
    <div className="flex shrink-0 items-center gap-0.5 lg:gap-1">
      <button
        type="button"
        onClick={() => run("save")}
        disabled={busy !== null}
        aria-pressed={saved}
        aria-label={saved ? "Remove from Later" : "Save for later"}
        title={saved ? "Remove from Later (s)" : "Save for later (s)"}
        className={`${button} ${saved ? "text-accent hover:text-accent" : ""}`}
      >
        {saved ? (
          <BookmarkCheck className={`${glyph} row-action-pop`} strokeWidth={1.75} aria-hidden="true" />
        ) : (
          <Bookmark className={glyph} strokeWidth={1.75} aria-hidden="true" />
        )}
      </button>
      <button
        type="button"
        onClick={() => run("read")}
        disabled={busy !== null}
        aria-label="Mark read"
        title="Mark read (m)"
        className={button}
      >
        <Check className={glyph} strokeWidth={1.75} aria-hidden="true" />
      </button>
      <div ref={menuRef} className="relative">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          aria-label="More"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title="More"
          className={`${button} -mr-2 lg:mr-0`}
        >
          <Ellipsis className={glyph} strokeWidth={1.75} aria-hidden="true" />
        </button>
        {menuOpen && (
          <div
            role="menu"
            aria-label="More"
            className="reader-menu absolute right-0 top-full z-30 mt-1 w-56 overflow-hidden rounded-lg border border-hairline bg-surface py-1 shadow-e2"
          >
            <a
              role="menuitem"
              tabIndex={-1}
              href={props.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={closeMenu}
              className="reader-menu-item"
            >
              <SquareArrowOutUpRight className="h-[18px] w-[18px] text-muted" strokeWidth={1.75} aria-hidden="true" />
              <span className="flex-1">Open original</span>
              <kbd className="hidden t-caption text-faint lg:inline">o</kbd>
            </a>
            <button role="menuitem" tabIndex={-1} type="button" onClick={copyLink} className="reader-menu-item">
              <Copy className="h-[18px] w-[18px] text-muted" strokeWidth={1.75} aria-hidden="true" />
              <span className="flex-1">Copy link</span>
            </button>
            {canShare && (
              <button role="menuitem" tabIndex={-1} type="button" onClick={share} className="reader-menu-item">
                <Share className="h-[18px] w-[18px] text-muted" strokeWidth={1.75} aria-hidden="true" />
                <span className="flex-1">Share</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function ReaderEndActions(props: Props) {
  const { busy, saved, run } = useArticleActions(props);
  return (
    <div className="reader-end mt-12 border-t border-hairline pt-6">
      <div className="grid grid-cols-2 gap-3 lg:flex lg:gap-3">
        <button
          type="button"
          onClick={() => run("read")}
          disabled={busy !== null}
          className="tap flex h-12 items-center justify-center gap-2 rounded-md border border-transparent bg-accent px-5 t-button text-accent-ink hover:opacity-90 disabled:opacity-60"
        >
          <Check className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" />
          {busy === "read" ? "Marking read" : "Mark as read"}
        </button>
        <button
          type="button"
          onClick={() => run("save")}
          disabled={busy !== null}
          aria-pressed={saved}
          className="tap flex h-12 items-center justify-center gap-2 rounded-md border border-transparent bg-surface-3 px-5 t-button text-ink-2 hover:bg-surface-2 disabled:cursor-default aria-pressed:text-accent disabled:[&:not([aria-pressed=true])]:opacity-60"
        >
          {saved ? (
            <BookmarkCheck className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" />
          ) : (
            <Bookmark className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" />
          )}
          {saved ? "Remove from Later" : busy === "save" ? "Saving" : "Save for later"}
        </button>
      </div>
      <a
        href={props.url}
        target="_blank"
        rel="noopener noreferrer"
        className="tap mt-4 inline-flex h-11 items-center gap-2 t-button text-accent hover:underline"
      >
        <SquareArrowOutUpRight className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden="true" />
        Open original
      </a>
    </div>
  );
}
