"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, Folder as FolderIcon } from "lucide-react";
import { todayHref, type TodaySort } from "@/lib/url";
import type { MixEntry } from "@/lib/nav-queries";
import type { Folder } from "@/lib/types";

/*
 * Desktop folder filter for Today (spec 5.1): a pull-down button labelled
 * with the current choice ("All folders" or the folder name). Each option is
 * a Link built by todayHref, so it keeps whatever sort is active. The counts
 * are Today's mix (spec 6.2), the one place besides the right rail where
 * folder balance is visible.
 */
export default function FolderPullDown({
  folders,
  activeFolderId,
  sort,
  mix,
}: {
  folders: Folder[];
  activeFolderId: number | null;
  sort: TodaySort;
  mix: MixEntry[];
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const first = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (!open) return;
    first.current?.focus();
    function onDown(e: PointerEvent) {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    }
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const active = folders.find((f) => f.id === activeFolderId) ?? null;
  const countOf = new Map(mix.map((m) => [m.folderId, m.count]));

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        className={`tap flex h-7 items-center gap-1.5 rounded-sm border px-2.5 text-[0.75rem] font-medium ${
          active ? "border-accent bg-accent-soft text-accent" : "border-line bg-surface text-ink-2 hover:bg-surface-2"
        }`}
      >
        <FolderIcon className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
        <span className="max-w-[140px] truncate">{active ? active.title : "All folders"}</span>
        <ChevronDown className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
      </button>

      {open && (
        <div className="popover absolute right-0 top-[calc(100%+6px)] z-40 w-[220px] rounded-lg border border-hairline bg-surface py-1.5 shadow-e2">
          <Option ref={first} href={todayHref({ sort, folderId: null })} label="All folders" on={!active} onPick={() => setOpen(false)} />
          {folders.length > 0 && <div className="mx-3 my-1 h-px bg-hairline" />}
          {folders.map((f) => (
            <Option
              key={f.id}
              href={todayHref({ sort, folderId: f.id })}
              label={f.title}
              count={countOf.get(f.id)}
              on={f.id === activeFolderId}
              onPick={() => setOpen(false)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Option({
  href,
  label,
  count,
  on,
  onPick,
  ref,
}: {
  href: string;
  label: string;
  count?: number;
  on: boolean;
  onPick: () => void;
  ref?: React.Ref<HTMLAnchorElement>;
}) {
  return (
    <Link
      ref={ref}
      href={href}
      onClick={onPick}
      aria-current={on ? "true" : undefined}
      className={`flex h-8 items-center gap-2 px-3 t-nav hover:bg-surface-2 ${on ? "font-semibold text-ink" : "text-ink-2"}`}
    >
      <Check className={`h-3.5 w-3.5 shrink-0 ${on ? "text-accent" : "invisible"}`} strokeWidth={2} aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count ? <span className="t-caption text-faint tabular-nums">{count}</span> : null}
    </Link>
  );
}
