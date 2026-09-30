"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";

/*
 * Sheet (spec 4.4, 3.2). A native <dialog> opened with showModal(), so focus
 * trapping, Esc, and an inert page behind come from the platform rather than
 * from code that can get them wrong.
 *
 * Phone: slides up from the bottom with the gentle spring, grabber on top,
 * Cancel at the leading edge of the header. Drag the header down to dismiss:
 * past 30% of the height, or a flick faster than 0.6 px/ms. Two detents:
 * "medium" (52% of the visual viewport, so the keyboard does not cover the
 * first results) and "large"; dragging up from medium goes large.
 * Desktop (>= 64rem): a centred dialog, 560 wide, scale 0.98 to 1.
 * Reduced motion: opacity only.
 */
type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  detent?: "medium" | "large";
  /** Optional leading control replacing Cancel (e.g. a Back button inside a flow). */
  leading?: ReactNode;
  trailing?: ReactNode;
};

const DISMISS_RATIO = 0.3;
const DISMISS_VELOCITY = 0.6; // px per ms
const REDUCED_FADE_MS = 120; // spec 3.2: reduced motion keeps a short opacity fade

export default function Sheet({ open, onClose, title, children, detent = "large", leading, trailing }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<"medium" | "large">(detent);
  const [dragY, setDragY] = useState(0);
  const drag = useRef<{ y: number; t: number; active: boolean }>({ y: 0, t: 0, active: false });
  const closing = useRef(false);

  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const desktop = () => window.matchMedia("(width >= 64rem)").matches;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setSize(detent);
      setDragY(0);
      closing.current = false;
      d.showModal();
      const p = panel.current;
      if (p && reduced()) {
        p.animate([{ opacity: 0 }, { opacity: 1 }], { duration: REDUCED_FADE_MS, easing: "linear" });
      } else if (p) {
        const kf = desktop()
          ? [{ opacity: 0, transform: "scale(0.98)" }, { opacity: 1, transform: "none" }]
          : [{ transform: "translateY(100%)" }, { transform: "none" }];
        p.animate(kf, {
          duration: desktop() ? 260 : 530,
          easing: desktop() ? "cubic-bezier(0.16,1,0.3,1)" : getComputedStyle(document.documentElement).getPropertyValue("--spring-gentle").trim() || "cubic-bezier(0.16,1,0.3,1)",
        });
      }
    } else if (!open && d.open) {
      d.close();
    }
  }, [open, detent]);

  const dismiss = useCallback(async () => {
    if (closing.current) return;
    closing.current = true;
    const p = panel.current;
    if (p && reduced()) {
      await p.animate([{ opacity: 1 }, { opacity: 0 }], { duration: REDUCED_FADE_MS, easing: "linear", fill: "forwards" }).finished.catch(() => {});
    } else if (p) {
      const kf = desktop()
        ? [{ opacity: 1 }, { opacity: 0 }]
        : [{ transform: `translateY(${dragY}px)` }, { transform: "translateY(100%)" }];
      await p.animate(kf, { duration: desktop() ? 160 : 200, easing: "cubic-bezier(0.4,0,1,1)", fill: "forwards" }).finished.catch(() => {});
    }
    onClose();
  }, [dragY, onClose]);

  function onPointerDown(e: React.PointerEvent) {
    if (desktop()) return;
    drag.current = { y: e.clientY, t: performance.now(), active: true };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current.active) return;
    const dy = e.clientY - drag.current.y;
    setDragY(dy > 0 ? dy : dy / 4); // resistance upward
  }
  function onPointerUp(e: React.PointerEvent) {
    if (!drag.current.active) return;
    drag.current.active = false;
    const dy = e.clientY - drag.current.y;
    const v = dy / Math.max(1, performance.now() - drag.current.t);
    const h = panel.current?.getBoundingClientRect().height ?? 1;
    if (dy < -40 && size === "medium") {
      setSize("large");
      setDragY(0);
    } else if (dy > h * DISMISS_RATIO || v > DISMISS_VELOCITY) {
      void dismiss();
    } else {
      setDragY(0);
    }
  }

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        void dismiss();
      }}
      onClick={(e) => {
        if (e.target === ref.current) void dismiss(); // backdrop click
      }}
      aria-label={title}
      className="sheet m-0 max-h-none max-w-none bg-transparent p-0 backdrop:bg-scrim"
    >
      <div
        ref={panel}
        data-size={size}
        className="sheet-panel flex flex-col bg-surface text-ink shadow-e3"
        style={{
          transform: dragY ? `translateY(${dragY}px)` : undefined,
          transition: drag.current.active ? "none" : "transform var(--spring-gentle-dur) var(--spring-gentle), height var(--dur-base) var(--ease-standard)",
        }}
      >
        <div
          className="sheet-header shrink-0 touch-none select-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            drag.current.active = false;
            setDragY(0);
          }}
        >
          <div className="sheet-grabber mx-auto mt-2 h-[5px] w-9 rounded-full bg-line" aria-hidden="true" />
          <div className="grid grid-cols-[1fr_auto_1fr] items-center px-4 pb-2 pt-2 lg:px-5 lg:pt-4">
            <div className="justify-self-start">
              {leading ?? (
                <button type="button" onClick={() => void dismiss()} className="tap sheet-cancel -ml-2 rounded-sm px-2 py-2 t-body text-accent">
                  Cancel
                </button>
              )}
            </div>
            <h2 className="t-title text-ink">{title}</h2>
            <div className="justify-self-end">
              {trailing ?? (
                <button
                  type="button"
                  onClick={() => void dismiss()}
                  aria-label="Close"
                  className="sheet-close tap hidden h-8 w-8 items-center justify-center rounded-sm text-muted hover:bg-surface-2 hover:text-ink lg:flex"
                >
                  <X className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="sheet-body min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-[calc(env(safe-area-inset-bottom)+24px)] lg:px-6 lg:pb-6">
          {children}
        </div>
      </div>
    </dialog>
  );
}
