"use client";

import { useRef, useState, useTransition, type MouseEvent } from "react";
import { forgetRead } from "@/lib/read-ledger";
import { usePathname, useRouter } from "next/navigation";
import { Bookmark, BookmarkCheck, Check } from "lucide-react";
import { archive, removeFromLater, saveForLater, undoAction, type ActionResult } from "@/app/actions";
import { collapseOut, growIn, listDropsReadStories } from "@/lib/collapse";
import { useToast } from "./Toast";

/*
 * Save / Mark read for one row (spec 5.2, 3.2). Rendered on every row; CSS
 * reveals it on hover or keyboard focus where a fine pointer exists, and keeps
 * it screen-reader-only on touch, where the row swipes instead.
 *
 * Mark read removes the row with a collapse, but only on lists that exclude
 * read stories. On Later a read story is still saved, so collapsing it would
 * be a lie that the next refresh undoes. On Later the bookmark is "Remove
 * from Later" instead, and that one does remove the row.
 *
 * KeyboardNav's s and m press these same buttons (found by data-row-action),
 * so the shortcut and the click cannot drift apart.
 */
type Status = "idle" | "done";

export default function RowActions({ articleId, className = "" }: { articleId: number; className?: string }) {
  return (
    <div className={`${className} flex items-center gap-1`}>
      <ActionButton articleId={articleId} kind="save" />
      <ActionButton articleId={articleId} kind="read" />
    </div>
  );
}

function ActionButton({ articleId, kind }: { articleId: number; kind: "save" | "read" }) {
  const [status, setStatus] = useState<Status>("idle");
  const [, startTransition] = useTransition();
  const { push } = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const ref = useRef<HTMLButtonElement>(null);
  const done = status === "done";

  // On Later every row is already saved, so the bookmark takes it out.
  const mode: "save" | "unsave" | "read" = kind === "read" ? "read" : pathname.startsWith("/later") ? "unsave" : "save";
  const labels = {
    save: { idle: "Save for later", done: "Saved for later", toast: "Saved for later", undone: "Removed from Later", same: "Already in Later", error: "Couldn't save. Try again." },
    unsave: { idle: "Remove from Later", done: "Removed from Later", toast: "Removed from Later", undone: "Back in Later", same: "", error: "Couldn't remove. Try again." },
    read: { idle: "Mark read", done: "Marked read", toast: "Marked read", undone: "Marked unread", same: "Already read", error: "Couldn't mark read. Try again." },
  }[mode];

  function handleClick(e: MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (done) return;
    setStatus("done"); // optimistic; reconciled below
    const row = ref.current?.closest<HTMLElement>("[data-swipe-row]") ?? ref.current?.closest<HTMLElement>("article");
    const removes = mode === "unsave" || (mode === "read" && listDropsReadStories(pathname));
    // Tells KeyboardNav's j/k to skip a row that is on its way out.
    if (removes) row?.setAttribute("data-leaving", "");

    startTransition(async () => {
      const run: (id: number) => Promise<ActionResult> =
        mode === "save" ? saveForLater : mode === "unsave" ? removeFromLater : archive;
      const result = await run(articleId).catch(() => ({ ok: false as const, error: "failed" }));
      if (!result.ok) {
        row?.removeAttribute("data-leaving");
        setStatus("idle");
        push({ message: labels.error });
        return;
      }
      const interactionId = result.interactionId;
      if (mode !== "unsave" && interactionId === 0) {
        // Already saved or already read: nothing changed, nothing to undo.
        push({ message: labels.same });
      } else {
        push({
          message: labels.toast,
          action: {
            label: "Undo",
            onClick: async () => {
              const undone =
                mode === "unsave"
                  ? await saveForLater(articleId).catch(() => ({ ok: false as const }))
                  : await undoAction(interactionId).catch(() => ({ ok: false as const }));
              if (!undone.ok) {
                push({ message: "Couldn't undo. Try again." });
                return;
              }
              if (mode === "read") forgetRead(articleId);
              setStatus("idle");
              row?.removeAttribute("data-leaving");
              push({ message: labels.undone });
              if (removes && row) await growIn(row);
              router.refresh();
            },
          },
        });
      }
      if (removes && row) await collapseOut(row, { fadeTo: 0.35, holdMs: 400 });
      // Rail counts (Later 8, Today 30) live in the layout, which only a
      // refresh re-renders.
      router.refresh();
    });
  }

  const Icon = mode === "read" ? Check : (mode === "save" ? done : !done) ? BookmarkCheck : Bookmark;
  const pressed = mode === "unsave" ? !done : done;
  return (
    <button
      ref={ref}
      type="button"
      data-row-action={kind}
      onClick={handleClick}
      aria-pressed={pressed}
      aria-label={done ? labels.done : labels.idle}
      title={done ? labels.done : labels.idle}
      className={`row-action flex h-9 w-9 items-center justify-center rounded-sm transition-colors duration-150 ${
        done ? (kind === "save" ? "text-accent" : "text-ok") : "text-muted hover:bg-surface-3 hover:text-ink"
      }`}
    >
      <Icon className={`h-[18px] w-[18px] ${done ? "row-action-pop" : ""}`} strokeWidth={1.75} aria-hidden="true" />
    </button>
  );
}
