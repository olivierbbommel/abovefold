"use client";

import { createPortal } from "react-dom";
import { useEffect, useRef } from "react";

/**
 * Confirmation for a destructive action (remove an address, unfollow a
 * source, delete a folder). Spec 4.4 calls it an action sheet, not a sheet:
 *
 * - Phone: anchored to the bottom, the question and the red action in one
 *   group, Cancel on its own below, both full width and 56 tall.
 * - Desktop (>= 64rem): a centred dialog, Cancel and the red action at the
 *   trailing edge.
 *
 * `message` must say exactly what is lost ("Issues already received are
 * deleted too"), never a bare "Are you sure?". Cancel, not the destructive
 * action, holds the initial focus, so a stray Enter never fires it.
 *
 * Portalled to <body>: PullToRefresh puts a `transform` on its wrapper, and
 * a transformed ancestor becomes the containing block for position:fixed,
 * which once rendered this box far down the page where nobody could see it.
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const cancelDesktopRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const desktop = window.matchMedia("(width >= 64rem)").matches;
    (desktop ? cancelDesktopRef : cancelRef).current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onCancel]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[60]">
      <div onClick={onCancel} aria-hidden="true" className="action-sheet-scrim absolute inset-0 bg-scrim" />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        className="pointer-events-none absolute inset-0 flex items-end justify-center px-2 pb-[calc(env(safe-area-inset-bottom)+8px)] lg:items-center lg:px-5 lg:pb-0"
      >
        <div className="action-sheet pointer-events-auto flex w-full max-w-[420px] flex-col gap-2 lg:max-w-[400px] lg:gap-0 lg:rounded-lg lg:border lg:border-hairline lg:bg-surface lg:p-5 lg:shadow-e2">
          <div className="overflow-hidden rounded-lg bg-surface lg:rounded-none lg:bg-transparent">
            <div className="px-5 pb-3.5 pt-4 text-center lg:p-0 lg:text-left">
              <h2 id="confirm-dialog-title" className="t-meta font-semibold text-muted lg:t-title lg:text-ink">
                {title}
              </h2>
              <p id="confirm-dialog-message" className="mt-1 t-meta text-muted text-pretty lg:mt-2 lg:t-body">
                {message}
              </p>
            </div>
            <button
              type="button"
              onClick={onConfirm}
              disabled={busy}
              className="flex h-14 w-full items-center justify-center border-t border-hairline t-title font-normal text-danger active:bg-surface-2 disabled:opacity-50 lg:hidden"
            >
              {busy ? "Working" : confirmLabel}
            </button>
          </div>
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="flex h-14 w-full items-center justify-center rounded-lg bg-surface t-title text-ink active:bg-surface-2 disabled:opacity-50 lg:hidden"
          >
            Cancel
          </button>

          <div className="mt-5 hidden justify-end gap-2 lg:flex">
            <button
              ref={cancelDesktopRef}
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="tap flex h-9 items-center rounded-md bg-surface-3 px-4 t-button text-ink-2 hover:bg-surface-2 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={busy}
              className="tap flex h-9 items-center rounded-md bg-danger px-4 t-button text-danger-ink hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Working" : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
