"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { useToast } from "./Toast";
import RenameDialog from "./RenameDialog";
import ConfirmDialog from "./ConfirmDialog";
import RowMenu from "./reader/RowMenu";

const MAX_TITLE_LENGTH = 60;

/**
 * Rename and delete for a folder (spec 5.6): one 44px ellipsis in the folder
 * page's title row, with "Rename" and "Delete folder" in the danger colour.
 *
 * Deleting a folder in Miniflux cascades: it deletes every feed inside it,
 * and every stored article those feeds ever had, too (verified against the
 * live instance and the Postgres schema, not assumed, see
 * lib/miniflux.ts's deleteCategory). The confirm dialog always names the
 * source count and the article loss so neither is a surprise.
 */
export default function FolderActions({
  folder,
  feedCount,
  afterDelete,
}: {
  folder: { id: number; title: string };
  feedCount: number;
  /** "redirect", this folder page is about to stop existing, leave it. "refresh", stay put (the /folders grid). */
  afterDelete: "redirect" | "refresh";
}) {
  const icon = "h-[18px] w-[18px]";
  const router = useRouter();
  const { push } = useToast();
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleRename(title: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/folders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: folder.id, title }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        push({ message: data.error ?? "Couldn't rename that folder." });
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
      const res = await fetch("/api/folders", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: folder.id }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        push({ message: data.error ?? "Couldn't delete that folder." });
        return;
      }
      setDeleting(false);
      push({ message: `Deleted ${folder.title}` });
      if (afterDelete === "redirect") {
        router.push("/folders");
      } else {
        router.refresh();
      }
    } catch {
      push({ message: "Couldn't reach the server." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <RowMenu
        label={`${folder.title} options`}
        edge=""
        items={[
          { label: "Rename", icon: <Pencil className={icon} strokeWidth={1.75} />, onSelect: () => setRenaming(true) },
          {
            label: "Delete folder",
            icon: <Trash2 className={icon} strokeWidth={1.75} />,
            onSelect: () => setDeleting(true),
            danger: true,
          },
        ]}
      />

      <RenameDialog
        open={renaming}
        heading="Rename folder"
        label="Folder name"
        initialValue={folder.title}
        maxLength={MAX_TITLE_LENGTH}
        busy={busy}
        onSave={handleRename}
        onCancel={() => setRenaming(false)}
      />

      <ConfirmDialog
        open={deleting}
        title="Delete folder"
        message={
          feedCount > 0
            ? `Delete ${folder.title} and its ${feedCount} ${feedCount === 1 ? "source" : "sources"}? This also unsubscribes from ${feedCount === 1 ? "it" : "all of them"} and removes every stored article from ${feedCount === 1 ? "it" : "them"}. This can't be undone.`
            : `Delete ${folder.title}? This can't be undone.`
        }
        confirmLabel="Delete"
        busy={busy}
        onConfirm={handleDelete}
        onCancel={() => setDeleting(false)}
      />
    </>
  );
}
