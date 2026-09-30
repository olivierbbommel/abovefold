"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "./Toast";

/*
 * Mark everything read: every feed, or one folder when given a categoryId.
 *
 * Spec 5.1 moved it out of Today's header. On desktop it is a muted text
 * button at the end of the list ("you mark all read when you have seen the
 * list, not before"); on the phone it is the last row of the Filter sheet,
 * in danger text. Both go through the same confirm, because this is
 * irreversible: Miniflux has no bulk unread, and it applies to every client.
 */
export default function MarkAllRead({
  categoryId,
  label = "Mark all read",
  unreadCount,
  scopeName,
  variant = "text",
  onDone,
}: {
  categoryId?: number;
  label?: string;
  /** Shown in the confirm so the owner knows the size of what they are about to do. */
  unreadCount?: number;
  /** e.g. "Marketing". Omitted means every feed. */
  scopeName?: string;
  variant?: "text" | "row";
  onDone?: () => void;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [busy, setBusy] = useState(false);

  async function run() {
    const what = scopeName ? `everything in ${scopeName}` : "everything in every folder";
    const size = typeof unreadCount === "number" ? ` (${unreadCount} unread)` : "";
    if (!window.confirm(`Mark ${what} as read${size}?\n\nThis can't be undone, and applies to every app reading these feeds.`)) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/mark-all-read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Number.isInteger(categoryId) && categoryId! > 0 ? { categoryId } : {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        push({ message: data.error ?? "Couldn't mark all read. Try again." });
      } else {
        push({ message: categoryId ? "Folder marked read" : "All marked read" });
        onDone?.();
        router.refresh();
      }
    } catch {
      push({ message: "Couldn't mark all read. Try again." });
    } finally {
      setBusy(false);
    }
  }

  const className =
    variant === "row"
      ? "tap flex h-11 w-full items-center t-body text-danger disabled:opacity-50"
      : "tap -mx-2 rounded-sm px-2 py-1.5 t-meta text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-50";

  return (
    <button type="button" disabled={busy} onClick={run} className={className}>
      {label}
    </button>
  );
}
