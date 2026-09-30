"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Ellipsis } from "lucide-react";

/*
 * The per-row `ellipsis` menu on source and newsletter rows (spec 5.6,
 * 5.7): one 44px trigger, an e2 popover anchored to its trailing edge.
 * Closes on selection, outside press, and Esc, and returns focus to the
 * trigger on Esc.
 */
export type RowMenuItem = {
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  href?: string;
};

export default function RowMenu({
  label,
  items,
  edge = "-mr-2 lg:mr-0",
}: {
  label: string;
  items: RowMenuItem[];
  /** The trigger's outset. A page header's trailing slot already applies its own. */
  edge?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(e: PointerEvent) {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative shrink-0">
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`tap ${edge} flex h-11 w-11 items-center justify-center rounded-sm text-muted hover:bg-surface-2 hover:text-ink lg:h-8 lg:w-8`}
      >
        <Ellipsis className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
      </button>
      {open && (
        <div
          role="menu"
          className="row-menu absolute right-0 top-full z-30 mt-1 w-52 overflow-hidden rounded-lg border border-hairline bg-surface py-1 shadow-e2"
        >
          {items.map((item) => {
            const className = `reader-menu-item ${item.danger ? "text-danger" : ""}`;
            const content = (
              <>
                <span className={item.danger ? "text-danger" : "text-muted"}>{item.icon}</span>
                <span className="flex-1" style={item.danger ? { color: "var(--danger)" } : undefined}>
                  {item.label}
                </span>
              </>
            );
            return item.href ? (
              <a key={item.label} role="menuitem" href={item.href} className={className} onClick={() => setOpen(false)}>
                {content}
              </a>
            ) : (
              <button
                key={item.label}
                role="menuitem"
                type="button"
                className={className}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
              >
                {content}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
