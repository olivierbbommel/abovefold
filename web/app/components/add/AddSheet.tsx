"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft } from "lucide-react";
import Sheet from "../Sheet";
import AddPanel from "./AddPanel";

/*
 * The Add sheet (spec 4.4, 5.4). Opened app-wide through useAddSheet(); the
 * props contract is fixed, other workstreams depend on nothing more.
 * Every open starts a fresh flow; the steps inside (Follow by email, Choose
 * a folder) swap the sheet's content and put Back in its header rather than
 * stacking a second sheet.
 */
export type AddSheetOptions = {
  step?: "search" | "email";
  folderId?: number | null;
  query?: string;
  /** Opened from Newsletters: a followed feed is marked as a newsletter. */
  asNewsletter?: boolean;
};

export default function AddSheet({
  open,
  onClose,
  options,
}: {
  open: boolean;
  onClose: () => void;
  options: AddSheetOptions;
}) {
  // A new flow per open. Closing keeps the old one mounted so the sheet can
  // animate out with its content intact.
  const [session, setSession] = useState(0);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) setSession((s) => s + 1);
    wasOpen.current = open;
  }, [open]);

  // Nothing mounts (and nothing is fetched) until the sheet is first opened.
  if (session === 0) return null;

  return (
    <AddPanel
      key={session}
      initialStep={options.step ?? "search"}
      initialQuery={options.query}
      folderId={options.folderId ?? null}
      asNewsletter={options.asNewsletter ?? false}
      onClose={onClose}
      frame={(header, body) => (
        <Sheet
          open={open}
          onClose={onClose}
          title={header.title}
          detent="large"
          leading={
            header.onBack ? (
              <button
                type="button"
                onClick={header.onBack}
                className="tap -ml-2 flex items-center gap-0.5 rounded-sm px-1.5 py-2 t-body text-accent"
              >
                <ChevronLeft className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
                Back
              </button>
            ) : undefined
          }
        >
          {open ? body : null}
        </Sheet>
      )}
    />
  );
}
