"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check } from "lucide-react";
import type { Folder } from "@/lib/types";
import Sheet from "./Sheet";

const MAX_TITLE_LENGTH = 120;

/*
 * Edit source (spec 4.4, 5.6): a sheet on the phone, a centred dialog on
 * desktop. "Shown as" renames the source (Miniflux's feed title, which the
 * display-name rule then shortens), and the folder list moves it. Rename and
 * Move to folder open the same sheet; `focus` says which part is the point.
 */
export default function EditSourceDialog({
  open,
  feedTitle,
  currentCategoryId,
  folders,
  busy = false,
  focus = "name",
  onSave,
  onCancel,
}: {
  open: boolean;
  feedTitle: string;
  currentCategoryId: number;
  folders: Folder[];
  busy?: boolean;
  focus?: "name" | "folder";
  onSave: (patch: { title: string; categoryId: number }) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(feedTitle);
  const [categoryId, setCategoryId] = useState(currentCategoryId);
  const inputRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(feedTitle);
    setCategoryId(currentCategoryId);
    requestAnimationFrame(() => {
      if (focus === "name") inputRef.current?.select();
      else folderRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    });
    // Reseed only when the sheet opens, so typing is never overwritten by a refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const trimmed = title.trim();
  const valid = trimmed.length > 0 && trimmed.length <= MAX_TITLE_LENGTH;

  function handleSubmit(e?: FormEvent) {
    e?.preventDefault();
    if (!valid || busy) return;
    onSave({ title: trimmed, categoryId });
  }

  return (
    <Sheet
      open={open}
      onClose={onCancel}
      title="Edit source"
      trailing={
        <button
          type="button"
          onClick={() => handleSubmit()}
          disabled={!valid || busy}
          className="tap -mr-2 rounded-sm px-2 py-2 t-button text-accent disabled:text-faint"
        >
          {busy ? "Saving" : "Save"}
        </button>
      }
    >
      <form onSubmit={handleSubmit} className="pt-2">
        <label className="t-caption font-semibold text-muted" htmlFor="edit-source-name">
          Shown as
        </label>
        <input
          ref={inputRef}
          id="edit-source-name"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={MAX_TITLE_LENGTH}
          className="mt-1.5 h-12 w-full rounded-md border border-line bg-surface px-3.5 t-body text-ink placeholder:text-faint focus:border-accent focus:outline-2 focus:outline-accent lg:h-10"
        />

        <p className="mt-6 t-caption font-semibold text-muted" id="edit-source-folder">
          Folder
        </p>
        <div
          ref={folderRef}
          role="radiogroup"
          aria-labelledby="edit-source-folder"
          className="mt-1.5 overflow-hidden rounded-lg border border-hairline bg-surface"
        >
          {folders.map((folder, i) => {
            const selected = folder.id === categoryId;
            return (
              <button
                key={folder.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setCategoryId(folder.id)}
                className={`flex h-12 w-full items-center justify-between px-4 text-left t-body text-ink hover:bg-surface-2 lg:h-10 ${i > 0 ? "border-t border-hairline" : ""}`}
              >
                <span className="truncate">{folder.title}</span>
                {selected && <Check className="h-[18px] w-[18px] shrink-0 text-accent" strokeWidth={2} aria-hidden="true" />}
              </button>
            );
          })}
        </div>
        {/* Enter in the field submits. */}
        <button type="submit" className="sr-only" tabIndex={-1}>
          Save
        </button>
      </form>
    </Sheet>
  );
}
