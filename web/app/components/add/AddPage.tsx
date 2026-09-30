"use client";

import { ChevronLeft } from "lucide-react";
import AddPanel from "./AddPanel";
import type { Folder } from "./types";

/*
 * /add as a page (spec 5.4, desktop and deep links): the same flow as the
 * sheet in a 680 column, with the page title on top and Back above a step.
 */
export default function AddPage({ folders, folderId }: { folders: Folder[]; folderId: number | null }) {
  return (
    <AddPanel
      folderId={folderId}
      initialFolders={folders}
      frame={(header, body) => (
        <div className="mx-auto w-full max-w-[680px]">
          {header.onBack ? (
            <button
              type="button"
              onClick={header.onBack}
              className="tap -ml-2 mb-2 flex items-center gap-0.5 rounded-sm px-1.5 py-1 t-body text-accent"
            >
              <ChevronLeft className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
              Back
            </button>
          ) : null}
          <h1 className="t-display mb-6 text-ink">{header.step === "folder" ? header.title : "Add a source"}</h1>
          {body}
        </div>
      )}
    />
  );
}
