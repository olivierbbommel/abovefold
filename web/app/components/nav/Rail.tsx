"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  Bookmark,
  ChevronRight,
  FolderPlus,
  History,
  Mail,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  Sun,
  type LucideIcon,
} from "lucide-react";
import type { Folder } from "@/lib/types";
import type { AiFeed } from "@/lib/ai-feeds";
import { displayName } from "@/lib/display-name";
import FeedIcon from "../FeedIcon";
import { AutoMarkReadToggle } from "../MarkReadOnScroll";
import { useAddSheet } from "../add/AddSheetProvider";
import NewFolderSheet from "./NewFolderSheet";
import { SHORTCUTS } from "./shortcuts";
import { sectionOf } from "./sections";

type FeedSummary = { id: number; title: string; unread: number };

/*
 * Desktop rail (spec 4.2), 264px on surface-2, shown from 64rem up. Replaces
 * the old Sidebar, which was a rail, a tab bar and a phone drawer in one
 * component; the drawer is gone and the tab bar is its own file.
 *
 * Top to bottom: wordmark, search, the four places, AI feeds, Sources (with
 * the one Add control in the rail), folders with disclosure, then the
 * reading preferences popover at the foot.
 */
export default function Rail({
  folders,
  feedsByCategory,
  newToday,
  todayCount,
  readLaterCount,
  newsletterCount,
  aiFeeds,
}: {
  folders: Folder[];
  feedsByCategory: Record<number, FeedSummary[]>;
  /** Stories in the last 24h per folder id (spec A9: not lifetime unread). */
  newToday: Record<number, number>;
  todayCount: number;
  readLaterCount: number;
  newsletterCount: number;
  aiFeeds: AiFeed[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { openAdd } = useAddSheet();
  const section = sectionOf(pathname);
  const idIn = (prefix: string) => (pathname.startsWith(prefix) ? Number(pathname.split("/")[2]) : null);
  const activeFolderId = idIn("/folder/");
  const activeFeedId = idIn("/feed/");
  const activeAiFeedId = idIn("/ai-feed/");

  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // Opening a feed page should show where it lives: expand its folder.
  useEffect(() => {
    if (activeFeedId === null) return;
    const owner = Object.entries(feedsByCategory).find(([, feeds]) => feeds.some((f) => f.id === activeFeedId));
    if (owner) setExpanded((cur) => (cur.has(Number(owner[0])) ? cur : new Set(cur).add(Number(owner[0]))));
  }, [activeFeedId, feedsByCategory]);

  // Cmd/Ctrl+K focuses the rail's search from anywhere (spec 4.2). "/" is
  // handled by KeyboardNav, which finds a field by type="search".
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        const el = searchRef.current;
        if (!el || el.offsetParent === null) return;
        e.preventDefault();
        el.focus();
        el.select();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  function toggle(id: number) {
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function onSearch(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const q = String(new FormData(e.currentTarget).get("q") ?? "").trim();
    router.push(q ? `/search?q=${encodeURIComponent(q)}` : "/search");
  }

  return (
    <aside className="rail sticky top-0 hidden h-dvh w-[264px] shrink-0 flex-col overflow-y-auto bg-surface-2 lg:flex">
      <div className="px-[22px] pb-3 pt-5">
        <Link href="/" className="font-serif text-[1.1875rem] font-semibold leading-6 text-ink">
          abovefold
        </Link>
      </div>

      <form role="search" onSubmit={onSearch} className="px-3 pb-3">
        <label className="flex h-8 items-center gap-2 rounded-sm border border-line bg-surface px-2.5 focus-within:border-accent">
          <Search className="h-4 w-4 shrink-0 text-faint" strokeWidth={2} aria-hidden="true" />
          <span className="sr-only">Search</span>
          <input
            ref={searchRef}
            type="search"
            name="q"
            placeholder="Search"
            className="rail-search min-w-0 flex-1 bg-transparent t-nav text-ink placeholder:text-faint focus:outline-none"
          />
          <kbd className="shrink-0 font-sans text-[0.6875rem] text-faint" aria-hidden="true">
            ⌘K
          </kbd>
        </label>
      </form>

      <nav aria-label="Places" className="flex flex-col gap-0.5 px-3">
        <RailLink href="/" Icon={Sun} label="Today" active={section === "today"}>
          <span className="t-nav font-semibold text-accent tabular-nums">{todayCount}</span>
        </RailLink>
        <RailLink href="/later" Icon={Bookmark} label="Later" active={section === "later"}>
          {readLaterCount > 0 && <span className="t-caption text-faint tabular-nums">{readLaterCount}</span>}
        </RailLink>
        <RailLink href="/recent" Icon={History} label="Recently read" active={section === "recent"} />
        <RailLink href="/newsletters" Icon={Mail} label="Newsletters" active={section === "newsletters"}>
          {newsletterCount > 0 && <span className="t-caption text-faint tabular-nums">{newsletterCount}</span>}
        </RailLink>
        {/* AI feeds are standing searches. Indigo glyph, never rust: the
            results are the AI's, not something the owner filed. */}
        {aiFeeds.map((feed) => (
          <RailLink
            key={feed.id}
            href={`/ai-feed/${feed.id}`}
            Icon={Sparkles}
            iconClass="text-ai"
            label={feed.name}
            active={activeAiFeedId === feed.id}
          />
        ))}
      </nav>

      <div className="flex items-center justify-between pb-1 pl-[22px] pr-3 pt-6">
        <h2 className="t-eyebrow text-faint">Sources</h2>
        <button
          type="button"
          onClick={() => openAdd()}
          aria-label="Add a source"
          title="Add a source"
          className="tap -my-0.5 flex h-8 w-8 items-center justify-center rounded-sm text-muted hover:bg-surface-3 hover:text-ink"
        >
          <Plus className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>

      <ul className="flex flex-col gap-0.5 px-3">
        {folders.map((folder) => {
          const feeds = feedsByCategory[folder.id] ?? [];
          const open = expanded.has(folder.id);
          const count = newToday[folder.id] ?? 0;
          const active = activeFolderId === folder.id;
          return (
            <li key={folder.id}>
              <div className="flex items-center">
                <button
                  type="button"
                  onClick={() => toggle(folder.id)}
                  aria-expanded={open}
                  aria-label={`${open ? "Collapse" : "Expand"} ${folder.title}`}
                  className="-my-px -ml-2 flex h-8 w-8 shrink-0 items-center justify-end rounded-sm pr-[5px] text-faint hover:text-ink"
                >
                  <ChevronRight className="disclosure-chevron h-3.5 w-3.5" strokeWidth={2} data-open={open} aria-hidden="true" />
                </button>
                <Link
                  href={`/folder/${folder.id}`}
                  aria-current={active ? "page" : undefined}
                  className={`rail-row flex h-[30px] min-w-0 flex-1 items-center gap-2 rounded-sm pl-1.5 pr-2.5 t-nav ${
                    active ? "bg-surface font-semibold text-ink shadow-e1" : "text-ink-2 hover:bg-surface-3"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">{folder.title}</span>
                  {count > 0 && (
                    <span className="t-caption text-faint tabular-nums" aria-label={`${count} new today`}>
                      {count}
                    </span>
                  )}
                </Link>
              </div>
              <div className="disclosure" data-open={open}>
                <ul className="disclosure-inner" inert={!open}>
                  {feeds.length === 0 ? (
                    <li className="py-1.5 pl-8 t-caption text-faint">No sources yet</li>
                  ) : (
                    feeds.map((feed) => (
                      <li key={feed.id}>
                        <Link
                          href={`/feed/${feed.id}`}
                          aria-current={activeFeedId === feed.id ? "page" : undefined}
                          title={feed.title}
                          className={`rail-row ml-6 flex h-7 items-center gap-2 rounded-sm px-2 t-nav ${
                            activeFeedId === feed.id ? "bg-surface font-semibold text-ink shadow-e1" : "text-muted hover:bg-surface-3"
                          }`}
                        >
                          <FeedIcon feedId={feed.id} title={feed.title} size={16} radius={4} />
                          <span className="min-w-0 flex-1 truncate">{displayName(feed.title)}</span>
                        </Link>
                      </li>
                    ))
                  )}
                </ul>
              </div>
            </li>
          );
        })}
      </ul>

      {/* Creating a folder is an action, not a place (spec 4.2), so it is a
          text button under the list rather than one more row in it. */}
      <div className="px-3 pt-1.5">
        <button
          type="button"
          onClick={() => setNewFolderOpen(true)}
          className="tap ml-4 inline-flex h-8 items-center gap-1.5 rounded-sm px-2 t-nav font-semibold text-accent hover:bg-surface-3"
        >
          <FolderPlus className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          New folder
        </button>
      </div>

      <div className="flex-1" />

      <div className="px-3 pb-4 pt-6">
        <PreferencesPopover />
      </div>

      <NewFolderSheet open={newFolderOpen} onClose={() => setNewFolderOpen(false)} />
    </aside>
  );
}

function RailLink({
  href,
  Icon,
  iconClass,
  label,
  active,
  children,
}: {
  href: string;
  Icon: LucideIcon;
  iconClass?: string;
  label: string;
  active: boolean;
  children?: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`rail-row flex h-8 items-center gap-2.5 rounded-sm px-2.5 t-nav ${
        active ? "bg-surface font-semibold text-ink shadow-e1" : "text-ink-2 hover:bg-surface-3"
      }`}
    >
      <Icon
        className={`h-[18px] w-[18px] shrink-0 ${iconClass ?? (active ? "text-accent" : "text-muted")}`}
        strokeWidth={1.75}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {children}
    </Link>
  );
}

/*
 * Reading preferences (spec 4.2 item 7). A preference is not a place, so it
 * sits at the foot of the rail behind one icon button instead of floating
 * between nav rows. Esc and an outside click close it; focus returns to the
 * button.
 */
function PreferencesPopover() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
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

  return (
    <div ref={root} className="relative">
      {open && (
        <div
          role="dialog"
          aria-label="Reading preferences"
          className="popover absolute bottom-[calc(100%+8px)] left-0 z-40 w-[240px] rounded-lg border border-hairline bg-surface p-4 shadow-e2"
        >
          <h2 className="t-eyebrow text-faint">Reading</h2>
          <AutoMarkReadToggle className="mt-2 min-h-8 t-nav text-ink" />
          <h3 className="mt-4 t-eyebrow text-faint">Keyboard shortcuts</h3>
          <dl className="mt-2 flex flex-col gap-1.5">
            {SHORTCUTS.map(([keys, label]) => (
              <div key={keys} className="flex items-center gap-3 t-nav">
                <dt className="w-12 shrink-0">
                  <kbd className="rounded-xs border border-line bg-surface-2 px-1.5 py-px font-sans text-[0.75rem] text-muted">
                    {keys}
                  </kbd>
                </dt>
                <dd className="text-ink-2">{label}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      <button
        ref={button}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Reading preferences"
        title="Reading preferences"
        className="tap flex h-8 w-8 items-center justify-center rounded-sm text-muted hover:bg-surface-3 hover:text-ink"
      >
        <SlidersHorizontal className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden="true" />
      </button>
    </div>
  );
}
