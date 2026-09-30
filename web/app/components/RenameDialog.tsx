"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Sheet from "./Sheet";

/**
 * A single-field rename (folder titles, AI feeds). A medium-detent sheet on
 * the phone and a centred dialog on desktop (spec 4.4), with Cancel at the
 * leading edge and Save at the trailing edge of the header. Source rename
 * and move live in EditSourceDialog, which needs a second field.
 *
 * Sheet is a native <dialog> in the top layer, so a transformed ancestor
 * (PullToRefresh) can no longer pull it off screen the way it once did with
 * a position:fixed box.
 */
export default function RenameDialog({
  open,
  heading,
  label,
  initialValue,
  maxLength,
  busy = false,
  onSave,
  onCancel,
}: {
  open: boolean;
  heading: string;
  label: string;
  initialValue: string;
  maxLength: number;
  busy?: boolean;
  onSave: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setValue(initialValue);
      requestAnimationFrame(() => inputRef.current?.select());
    }
    // Reseed only when the sheet opens, not on every re-render while open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const trimmed = value.trim();
  const valid = trimmed.length > 0 && trimmed.length <= maxLength;

  function handleSubmit(e?: FormEvent) {
    e?.preventDefault();
    if (!valid || busy) return;
    onSave(trimmed);
  }

  return (
    <Sheet
      open={open}
      onClose={onCancel}
      title={heading}
      detent="medium"
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
        <label className="t-caption font-semibold text-muted" htmlFor="rename-dialog-input">
          {label}
        </label>
        <input
          ref={inputRef}
          id="rename-dialog-input"
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={maxLength}
          className="mt-1.5 h-12 w-full rounded-md border border-line bg-surface px-3.5 t-body text-ink placeholder:text-faint focus:border-accent focus:outline-2 focus:outline-accent lg:h-10"
        />
      </form>
    </Sheet>
  );
}
