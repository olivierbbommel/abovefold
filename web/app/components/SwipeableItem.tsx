"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Bookmark, Check } from "lucide-react";
import SwipeRow from "./SwipeRow";
import { archive, removeFromLater, saveForLater, undoAction } from "@/app/actions";
import { collapseOut, growIn, listDropsReadStories } from "@/lib/collapse";
import { forgetRead, subscribeReadLedger, wasRead } from "@/lib/read-ledger";
import { useToast } from "./Toast";

/*
 * Swipe actions for a server-rendered row (spec 3.2).
 *
 * Swipe right, save for later: the row springs back and stays. It used to
 * vanish from Today exactly like mark-read, which made "save" feel like
 * "delete".
 * Swipe left, mark read: the row slides away, its height collapses so the
 * rows below ride up, then it is removed. Undo grows it back in place. On
 * lists that keep read stories (Read Later, Recently read) it springs back.
 */
export default function SwipeableItem({ articleId, children }: { articleId: number; children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { push } = useToast();
  const outer = useRef<HTMLDivElement>(null);
  const [gone, setGone] = useState(false);
  // Read in the reader, then Back: the list comes from the router cache and
  // still has this row. The server would drop it; so do we.
  const readElsewhere = useSyncExternalStore(subscribeReadLedger, () => wasRead(articleId), () => false);

  const removes = listDropsReadStories(pathname);
  if (gone || (removes && readElsewhere)) return null;

  const onLater = pathname.startsWith("/later");

  async function save() {
    if (onLater) return unsave();
    const res = await saveForLater(articleId).catch(() => ({ ok: false as const, error: "That didn't work" }));
    if (!res.ok) {
      push({ message: "Couldn't save. Try again." });
      throw new Error("save failed"); // SwipeRow springs back
    }
    router.refresh(); // the rail's Later count
    if (res.interactionId === 0) {
      push({ message: "Already in Later" }); // nothing changed, nothing to undo
      return;
    }
    const id = res.interactionId;
    push({
      message: "Saved for later",
      action: {
        label: "Undo",
        onClick: async () => {
          const u = await undoAction(id).catch(() => ({ ok: false as const }));
          push({ message: u.ok ? "Removed from Later" : "Couldn't undo. Try again." });
          if (u.ok) router.refresh();
        },
      },
    });
  }

  // On Later the save swipe takes the story out, since every row is saved.
  async function unsave() {
    const res = await removeFromLater(articleId).catch(() => ({ ok: false as const, error: "That didn't work" }));
    if (!res.ok) {
      push({ message: "Couldn't remove. Try again." });
      throw new Error("remove failed");
    }
    push({
      message: "Removed from Later",
      action: {
        label: "Undo",
        onClick: async () => {
          const u = await saveForLater(articleId).catch(() => ({ ok: false as const }));
          if (!u.ok) {
            push({ message: "Couldn't undo. Try again." });
            return;
          }
          push({ message: "Back in Later" });
          setGone(false);
          requestAnimationFrame(() => outer.current && growIn(outer.current));
          router.refresh();
        },
      },
    });
    if (outer.current) await collapseOut(outer.current);
    setGone(true);
    router.refresh();
  }

  async function markRead() {
    const res = await archive(articleId).catch(() => ({ ok: false as const, error: "That didn't work" }));
    if (!res.ok) {
      push({ message: "Couldn't mark read. Try again." });
      throw new Error("mark read failed");
    }
    if (res.interactionId === 0) {
      push({ message: "Already read" }); // nothing changed, nothing to undo
      return;
    }
    const id = res.interactionId;
    push({
      message: "Marked read",
      action: {
        label: "Undo",
        onClick: async () => {
          const u = await undoAction(id);
          if (!u.ok) {
            push({ message: "Couldn't undo. Try again." });
            return;
          }
          forgetRead(articleId);
          push({ message: "Marked unread" });
          if (removes) {
            setGone(false);
            requestAnimationFrame(() => outer.current && growIn(outer.current));
            router.refresh();
          }
        },
      },
    });
    if (removes && outer.current) {
      await collapseOut(outer.current);
      setGone(true);
      router.refresh();
    }
  }

  return (
    <div ref={outer}>
      <SwipeRow
        leftAction={{
          label: onLater ? "Remove from Later" : "Read later",
          icon: <Bookmark className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />,
          color: "var(--accent)",
          onAction: save,
          keepRow: !onLater,
        }}
        rightAction={{
          label: "Mark read",
          icon: <Check className="h-5 w-5" strokeWidth={2} aria-hidden="true" />,
          color: "var(--ok)",
          onAction: markRead,
          keepRow: !removes,
        }}
      >
        {children}
      </SwipeRow>
    </div>
  );
}
