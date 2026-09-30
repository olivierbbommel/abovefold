"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FolderInput, Pencil, UserMinus } from "lucide-react";
import type { Folder } from "@/lib/types";
import { useToast } from "./Toast";
import EditSourceDialog from "./EditSourceDialog";
import ConfirmDialog from "./ConfirmDialog";
import RowMenu from "./reader/RowMenu";

/**
 * The `ellipsis` menu on a source row (spec 5.6): Rename, Move to folder,
 * Unfollow. Sits behind app/api/feeds (see that route for validation). A
 * rename or move refreshes the page so the row, or the whole list if the
 * source left this folder, reflects it; so does an unfollow, since the feed
 * simply drops out of feedsByCategory.
 */
export default function SourceActions({
  feedId,
  feedTitle,
  displayTitle,
  categoryId,
  folders,
}: {
  feedId: number;
  feedTitle: string;
  displayTitle: string;
  categoryId: number;
  folders: Folder[];
}) {
  const router = useRouter();
  const { push } = useToast();
  const [editing, setEditing] = useState<"name" | "folder" | null>(null);
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleSave(patch: { title: string; categoryId: number }) {
    setBusy(true);
    try {
      const body: Record<string, unknown> = { id: feedId };
      if (patch.title !== feedTitle) body.title = patch.title;
      if (patch.categoryId !== categoryId) body.categoryId = patch.categoryId;
      if (body.title === undefined && body.categoryId === undefined) {
        setEditing(null);
        return;
      }
      const res = await fetch("/api/feeds", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        push({ message: data.error ?? "Couldn't update that source. Try again." });
        return;
      }
      setEditing(null);
      router.refresh();
    } catch {
      push({ message: "Couldn't reach the server. Try again." });
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    setBusy(true);
    try {
      const res = await fetch("/api/feeds", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: feedId }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        push({ message: data.error ?? "Couldn't unfollow that source. Try again." });
        return;
      }
      setRemoving(false);
      push({ message: `Unfollowed ${displayTitle}` });
      router.refresh();
    } catch {
      push({ message: "Couldn't reach the server. Try again." });
    } finally {
      setBusy(false);
    }
  }

  const icon = "h-[18px] w-[18px]";
  return (
    <>
      <RowMenu
        label={`Options for ${displayTitle}`}
        items={[
          { label: "Rename", icon: <Pencil className={icon} strokeWidth={1.75} />, onSelect: () => setEditing("name") },
          {
            label: "Move to folder",
            icon: <FolderInput className={icon} strokeWidth={1.75} />,
            onSelect: () => setEditing("folder"),
          },
          {
            label: "Unfollow",
            icon: <UserMinus className={icon} strokeWidth={1.75} />,
            onSelect: () => setRemoving(true),
            danger: true,
          },
        ]}
      />

      <EditSourceDialog
        open={editing !== null}
        focus={editing ?? "name"}
        feedTitle={feedTitle}
        currentCategoryId={categoryId}
        folders={folders}
        busy={busy}
        onSave={handleSave}
        onCancel={() => setEditing(null)}
      />

      <ConfirmDialog
        open={removing}
        title={`Unfollow ${displayTitle}?`}
        // Not the spec's "Its stories stay in Recently read and Read Later":
        // Miniflux deletes a feed's entries with it, and both lists are read
        // from Miniflux, so they would not stay.
        message="You stop getting its stories, and the ones already here leave Later and Recently read. If it is a newsletter you get by email, its address stops working too."
        confirmLabel="Unfollow"
        busy={busy}
        onConfirm={handleRemove}
        onCancel={() => setRemoving(false)}
      />
    </>
  );
}
