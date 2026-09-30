"use client";

import { Plus } from "lucide-react";
import { useAddSheet } from "../add/AddSheetProvider";

/* The plus in the Today and Library top bars (spec 4.3). Opens the one
   app-wide Add sheet; never navigates. */
export default function AddButton({ folderId, className = "" }: { folderId?: number; className?: string }) {
  const { openAdd } = useAddSheet();
  return (
    <button
      type="button"
      onClick={() => openAdd(folderId ? { folderId } : {})}
      aria-label="Add a source"
      title="Add a source"
      className={`tap flex h-11 w-11 items-center justify-center rounded-sm text-ink-2 hover:bg-surface-2 hover:text-ink lg:h-8 lg:w-8 ${className}`}
    >
      <Plus className="h-[22px] w-[22px] lg:h-[18px] lg:w-[18px]" strokeWidth={1.75} aria-hidden="true" />
    </button>
  );
}
