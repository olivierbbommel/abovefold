"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Sheet from "../Sheet";
import { useToast } from "../Toast";

const MAX_TITLE_LENGTH = 60;

/*
 * New folder (spec 4.4: a medium-detent sheet on the phone, a dialog on
 * desktop). Opened from Library's "New folder" row and the rail. Backed by
 * POST /api/folders, same as the inline control it replaces; router.refresh()
 * re-runs the layout so the folder appears in the rail and Library at once.
 */
export default function NewFolderSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { push } = useToast();
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setTitle("");
    // After the sheet's own focus handling, so the keyboard comes up with it.
    const id = window.setTimeout(() => input.current?.focus(), 60);
    return () => window.clearTimeout(id);
  }, [open]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || trimmed.length > MAX_TITLE_LENGTH || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmed }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        push({ message: data.error ?? "Couldn't create the folder. Try again." });
        return;
      }
      push({ message: `Created ${trimmed}` });
      onClose();
      router.refresh();
    } catch {
      push({ message: "Couldn't create the folder. Try again." });
    } finally {
      setBusy(false);
    }
  }

  const valid = title.trim().length > 0;

  return (
    <Sheet open={open} onClose={onClose} title="New folder" detent="medium">
      <form onSubmit={submit} className="flex flex-col gap-4 pt-2">
        <label className="flex flex-col gap-1.5">
          <span className="t-meta text-muted">Name</span>
          <input
            ref={input}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={MAX_TITLE_LENGTH}
            placeholder="Folder name"
            autoCapitalize="words"
            enterKeyHint="done"
            className="h-12 rounded-md border border-line bg-surface px-3.5 t-body text-ink placeholder:text-faint focus:border-accent focus:outline-none lg:h-10"
          />
        </label>
        <button
          type="submit"
          disabled={!valid || busy}
          className="tap h-12 rounded-md bg-accent t-button text-accent-ink disabled:bg-surface-3 disabled:text-faint lg:h-9 lg:self-end lg:px-4"
        >
          {busy ? "Creating" : "Create folder"}
        </button>
      </form>
    </Sheet>
  );
}
