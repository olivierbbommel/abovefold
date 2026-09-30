"use client";

import { useState } from "react";
import { Check, Plus } from "lucide-react";
import { Spinner } from "./parts";
import type { Folder } from "./types";

/*
 * Choose a folder (spec 4.4, 7). A step inside the Add sheet, not a second
 * sheet: the header swaps to "Choose a folder" with Back, and picking a row
 * returns to where the person came from.
 */
export default function FolderPicker({
  folders,
  value,
  onPick,
  onCreated,
}: {
  folders: Folder[];
  value: number | null;
  onPick: (id: number | null) => void;
  onCreated: (folder: Folder) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    const t = title.trim();
    if (!t || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: t }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data?.error === "string" ? data.error : "");
      onCreated({ id: Number(data.id), title: String(data.title) });
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "Couldn't create the folder. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const rows: { id: number | null; title: string }[] = [{ id: null, title: "No folder" }, ...folders];

  return (
    <div>
      <ul role="listbox" aria-label="Folders" className="add-group overflow-hidden rounded-lg border border-line bg-surface">
        {rows.map((f) => {
          const selected = f.id === value;
          return (
            <li key={f.id ?? "none"} className="border-b border-hairline last:border-b-0">
              <button
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => onPick(f.id)}
                className={`flex min-h-[3.25rem] w-full items-center gap-3 px-4 text-left hover:bg-surface-2 lg:min-h-10 ${
                  f.id === null ? "text-muted" : "text-ink"
                }`}
              >
                <span className="t-body min-w-0 flex-1 truncate">{f.title}</span>
                {selected ? <Check className="h-[18px] w-[18px] shrink-0 text-accent" strokeWidth={2} aria-hidden="true" /> : null}
              </button>
            </li>
          );
        })}
        <li>
          {creating ? (
            <form
              className="flex items-center gap-2 px-3 py-2"
              onSubmit={(e) => {
                e.preventDefault();
                void create();
              }}
            >
              <input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={60}
                placeholder="Folder name"
                aria-label="New folder name"
                className="t-body h-11 min-w-0 flex-1 rounded-md border border-line bg-surface px-3 text-ink outline-none placeholder:text-faint focus:border-accent lg:h-9"
              />
              <button
                type="submit"
                disabled={!title.trim() || busy}
                className="tap t-button flex h-11 min-w-[4.5rem] items-center justify-center rounded-md bg-ink px-3 text-bg disabled:bg-surface-3 disabled:text-faint lg:h-9"
              >
                {busy ? <Spinner /> : "Create"}
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="flex min-h-[3.25rem] w-full items-center gap-3 px-4 text-left text-accent hover:bg-surface-2 lg:min-h-10"
            >
              <Plus className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden="true" />
              <span className="t-body">New folder</span>
            </button>
          )}
        </li>
      </ul>
      {error ? (
        <p className="t-caption mt-2 text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
