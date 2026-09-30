"use client";

import { useState } from "react";
import { ChevronRight, Plus } from "lucide-react";
import NewFolderSheet from "./NewFolderSheet";

/* Library's last folder row (spec 5.6): "New folder" in accent, opening the
   New folder sheet. */
export default function NewFolderRow() {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="inset-row flex min-h-[52px] w-full items-center gap-3 px-4 text-left t-body text-accent"
      >
        <Plus className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden="true" />
        <span className="inset-row-label flex min-h-[52px] min-w-0 flex-1 items-center gap-3">
          <span className="flex-1">New folder</span>
          <ChevronRight className="h-4 w-4 shrink-0 text-faint" strokeWidth={2} aria-hidden="true" />
        </span>
      </button>
      <NewFolderSheet open={open} onClose={() => setOpen(false)} />
    </li>
  );
}
