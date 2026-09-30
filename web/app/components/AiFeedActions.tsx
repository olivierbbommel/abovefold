"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AiFeed } from "@/lib/ai-feeds";
import { PencilIcon, TrashIcon } from "./Icons";
import { useToast } from "./Toast";
import RenameDialog from "./RenameDialog";
import ConfirmDialog from "./ConfirmDialog";

const MAX_NAME_LENGTH = 60;

/**
 * Rename / delete controls for a single AI Feed, same pencil + trash icon
 * pair as FolderActions, next to the feed's name on its page header.
 * Deleting only ever removes the app.ai_feed row (the query and its stored
 * vector); no articles are touched. There's no AI Feeds index page to land
 * on afterward, so delete always sends you to Today.
 */
export default function AiFeedActions({
  feed,
  iconClassName = "w-[15px] h-[15px]",
}: {
  feed: AiFeed;
  iconClassName?: string;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleRename(name: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/ai-feeds", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: feed.id, name }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        push({ message: data.error ?? "Couldn't rename that AI Feed." });
        return;
      }
      setRenaming(false);
      router.refresh();
    } catch {
      push({ message: "Couldn't reach the server." });
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    setBusy(true);
    try {
      const res = await fetch("/api/ai-feeds", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: feed.id }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        push({ message: data.error ?? "Couldn't delete that AI Feed." });
        return;
      }
      setDeleting(false);
      push({ message: `Deleted ${feed.name}` });
      router.push("/");
    } catch {
      push({ message: "Couldn't reach the server." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <span className="flex items-center gap-1">
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setRenaming(true);
          }}
          aria-label={`Rename ${feed.name}`}
          className="tap flex items-center justify-center text-muted hover:text-ink"
        >
          <PencilIcon className={iconClassName} />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDeleting(true);
          }}
          aria-label={`Delete ${feed.name}`}
          className="tap flex items-center justify-center text-muted hover:text-danger"
        >
          <TrashIcon className={iconClassName} />
        </button>
      </span>

      <RenameDialog
        open={renaming}
        heading="Rename AI Feed"
        label="Name"
        initialValue={feed.name}
        maxLength={MAX_NAME_LENGTH}
        busy={busy}
        onSave={handleRename}
        onCancel={() => setRenaming(false)}
      />

      <ConfirmDialog
        open={deleting}
        title="Delete AI Feed"
        message={`Delete "${feed.name}"? This can't be undone.`}
        confirmLabel="Delete"
        busy={busy}
        onConfirm={handleDelete}
        onCancel={() => setDeleting(false)}
      />
    </>
  );
}
