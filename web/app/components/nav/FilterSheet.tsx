"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, SlidersHorizontal } from "lucide-react";
import { todayHref, type TodaySort } from "@/lib/url";
import type { MixEntry } from "@/lib/nav-queries";
import type { Folder } from "@/lib/types";
import Sheet from "../Sheet";
import SortControl from "./SortControl";
import MarkAllRead from "../MarkAllRead";

/*
 * Phone: the one control in Today's top bar besides Add (spec 5.1). Opens a
 * medium sheet titled "Show": Ranked / Newest, the folder list with Today's
 * mix counts next to each folder (spec 6.2), and Mark all read pinned to the
 * bottom in danger text, where it is deliberate rather than one stray tap
 * away, and visible at the medium detent however many folders there are.
 */
export default function FilterSheet({
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
  const countOf = new Map(mix.map((m) => [m.folderId, m.count]));
  const close = () => setOpen(false);
  const filtered = activeFolderId !== null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={filtered ? "Show: filtered by folder" : "Show"}
        title="Sort and filter"
        className={`tap relative flex h-11 w-11 items-center justify-center rounded-sm hover:bg-surface-2 ${
          filtered ? "text-accent" : "text-ink-2"
        }`}
      >
        <SlidersHorizontal className="h-[22px] w-[22px]" strokeWidth={1.75} aria-hidden="true" />
        {filtered && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-accent" aria-hidden="true" />}
      </button>

      <Sheet open={open} onClose={close} title="Show" detent="medium">
        <div className="flex flex-col gap-5 pt-1">
          <SortControl sort={sort} folderId={activeFolderId} size="large" onNavigate={close} />

          <ul className="overflow-hidden rounded-lg border border-line bg-surface">
            <FolderOption href={todayHref({ sort, folderId: null })} label="All folders" on={!filtered} onPick={close} />
            {folders.map((f) => (
              <FolderOption
                key={f.id}
                href={todayHref({ sort, folderId: f.id })}
                label={f.title}
                count={countOf.get(f.id)}
                on={f.id === activeFolderId}
                onPick={close}
              />
            ))}
          </ul>

          <div className="sheet-footer">
            <MarkAllRead
              variant="row"
              categoryId={activeFolderId ?? undefined}
              scopeName={folders.find((f) => f.id === activeFolderId)?.title}
              onDone={close}
            />
          </div>
        </div>
      </Sheet>
    </>
  );
}

function FolderOption({
  href,
  label,
  count,
  on,
  onPick,
}: {
  href: string;
  label: string;
  count?: number;
  on: boolean;
  onPick: () => void;
}) {
  return (
    <li className="border-b border-hairline last:border-b-0">
      <Link
        href={href}
        onClick={onPick}
        aria-current={on ? "true" : undefined}
        className="flex h-[52px] items-center gap-3 px-4 t-body text-ink active:bg-surface-2"
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {count ? <span className="t-meta text-faint">{count}</span> : null}
        <Check className={`h-5 w-5 shrink-0 text-accent ${on ? "" : "invisible"}`} strokeWidth={2} aria-hidden="true" />
      </Link>
    </li>
  );
}
