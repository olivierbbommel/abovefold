"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, EyeOff, Link as LinkIcon, SlidersHorizontal } from "lucide-react";
import SwipeRow from "../SwipeRow";
import { useToast } from "../Toast";
import { displayHost, readingCaption } from "@/lib/add-format";
import { decodeEntities } from "@/lib/entities";
import { displayName } from "@/lib/display-name";
import { collapseOut } from "@/lib/collapse";
import { LetterTile, Spinner } from "./parts";
import { READING_WINDOW, type ReadingSite, type ResolveResponse } from "./types";

/*
 * From your reading (spec 5.5). Sites the owner's own sources point at,
 * ranked only by counts of the owner's own data. Nothing here is picked.
 *
 * The rows come from GET /api/reading-discovery straight away; whether each
 * site has a feed is filled in afterwards, a few at a time, through
 * /check. A site with no feed leaves the list; one that refuses robots goes
 * to the email step when followed.
 *
 * Reusable outside the Add screen (the Library catalog): every hook back
 * into the Add flow is an optional callback.
 */

const FIRST_PAGE = 12;
const PAGE = 20;
const CHECK_BATCH = 6;

type Sort = "linked" | "opened";
type RowState = "idle" | "busy" | "followed";

export function siteName(s: ReadingSite): string {
  const host = displayHost(s.host);
  // Some feeds are titled with their own URL; the host reads better.
  if (!s.feedTitle || /^https?:\/\//i.test(s.feedTitle.trim())) return host;
  const name = displayName(decodeEntities(s.feedTitle));
  // "www.theregister.com" as a title is the host again, said worse.
  if (!name || displayHost(name) === host) return host;
  return name;
}

/**
 * The backend already keys hosts without www. (lib/reading-discovery.ts), so
 * this is a guard: if two rows ever differ only by www., keep one, adding
 * their counts and sources together.
 */
export function dedupeSites(sites: ReadingSite[]): ReadingSite[] {
  const byHost = new Map<string, ReadingSite>();
  for (const s of sites) {
    const host = displayHost(s.host);
    const prev = byHost.get(host);
    if (!prev) {
      byHost.set(host, { ...s, host });
      continue;
    }
    byHost.set(host, {
      ...prev,
      appearances: prev.appearances + s.appearances,
      opened: prev.opened + s.opened,
      via: [...new Set([...prev.via, ...s.via])],
      status: prev.status ?? s.status,
      feedUrl: prev.feedUrl ?? s.feedUrl,
      feedTitle: prev.feedTitle ?? s.feedTitle,
    });
  }
  return [...byHost.values()];
}

/** "Hacker News: Front Page" linked here: the source is "Hacker News". */
const shortVia = (s: ReadingSite) => ({ ...s, via: s.via.map((v) => displayName(decodeEntities(v)) || v) });

export default function FromYourReading({
  folderId = null,
  onSites,
  onShowInBox,
  onEmail,
}: {
  /** A folder the person arrived with; direct follows go there. */
  folderId?: number | null;
  onSites?: (sites: ReadingSite[]) => void;
  /** The site needs a look before following: put it in the Add box with this answer. */
  onShowInBox?: (host: string, res: ResolveResponse | null) => void;
  /** The site refuses robots: go to Follow by email with this name. */
  onEmail?: (name: string) => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [sites, setSites] = useState<ReadingSite[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [shown, setShown] = useState(FIRST_PAGE);
  const [sort, setSort] = useState<Sort>("linked");
  const [menu, setMenu] = useState(false);
  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const everHad = useRef(false);
  const checking = useRef(new Set<string>());
  const rowRefs = useRef(new Map<string, HTMLLIElement>());

  useEffect(() => {
    let live = true;
    fetch("/api/reading-discovery")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { sites: ReadingSite[] }) => {
        if (!live) return;
        const list = dedupeSites(d.sites).filter((s) => s.status !== "none");
        if (list.length) everHad.current = true;
        setSites(list);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (sites) onSites?.(sites.map(shortVia));
  }, [sites, onSites]);

  const sorted = useMemo(() => {
    if (!sites) return [];
    const list = [...sites];
    list.sort((a, b) =>
      sort === "linked"
        ? b.appearances - a.appearances || b.opened - a.opened
        : b.opened - a.opened || b.appearances - a.appearances
    );
    return list;
  }, [sites, sort]);
  const visible = sorted.slice(0, shown);

  // Fill in feed status for the rows on screen, one small batch at a time.
  const pending = visible.filter((s) => s.status === null && !checking.current.has(s.host)).map((s) => s.host);
  const pendingKey = pending.join(",");
  useEffect(() => {
    if (!pendingKey) return;
    const batch = pendingKey.split(",").slice(0, CHECK_BATCH);
    batch.forEach((h) => checking.current.add(h));
    let live = true;
    fetch("/api/reading-discovery/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hosts: batch }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { results: { host: string; status: ReadingSite["status"]; feedUrl: string | null; feedTitle: string | null }[] }) => {
        if (!live) return;
        const byHost = new Map(d.results.map((r) => [r.host, r]));
        setSites((cur) =>
          (cur ?? [])
            .map((s) => {
              const r = byHost.get(s.host);
              return r ? { ...s, status: r.status, feedUrl: r.feedUrl, feedTitle: r.feedTitle ?? s.feedTitle } : s;
            })
            .filter((s) => s.status !== "none")
        );
      })
      .catch(() => {
        // Leave them unchecked; Follow still resolves them properly.
        if (live) setSites((cur) => (cur ?? []).map((s) => (batch.includes(s.host) && s.status === null ? { ...s, status: "unavailable" } : s)));
      });
    return () => {
      live = false;
    };
  }, [pendingKey]);

  const removeRow = useCallback(async (host: string) => {
    const el = rowRefs.current.get(host);
    if (el) await collapseOut(el).catch(() => {});
    setSites((cur) => (cur ?? []).filter((s) => s.host !== host));
  }, []);

  async function hide(site: ReadingSite) {
    void fetch("/api/reading-discovery/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: site.host }),
    }).catch(() => {});
    await removeRow(site.host);
  }

  async function follow(site: ReadingSite) {
    const name = siteName(site);
    if (site.status === "blocked") {
      onEmail?.(name);
      return;
    }
    setRowState((s) => ({ ...s, [site.host]: "busy" }));
    let res: ResolveResponse | null = null;
    try {
      const r = await fetch("/api/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: site.host }),
      });
      res = r.ok ? ((await r.json()) as ResolveResponse) : null;
      const m = res?.matches[0];
      const feedUrl = m?.result.kind === "found" ? m.result.candidates[0]?.url : undefined;
      const target = folderId ?? m?.result.folderSuggestion?.categoryId ?? null;
      const folderTitle = folderId === null ? m?.result.folderSuggestion?.title : undefined;
      // Follow directly only when nothing about it needs a look: one feed,
      // not already followed, and a folder to put it in.
      if (m && feedUrl && m.result.candidates.length === 1 && res!.alreadyFollowing.length === 0 && target !== null) {
        const sub = await fetch("/api/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ feedUrl, categoryId: target }),
        });
        if (sub.ok) {
          setRowState((s) => ({ ...s, [site.host]: "followed" }));
          toast.push({ message: folderTitle ? `Following ${name}, in ${folderTitle}` : `Following ${name}` });
          router.refresh();
          const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          if (!reduced) await new Promise((r) => setTimeout(r, 600));
          await removeRow(site.host);
          return;
        }
      }
    } catch {
      // Fall through to the box, where the full card explains what happened.
    }
    setRowState((s) => ({ ...s, [site.host]: "idle" }));
    if (onShowInBox) onShowInBox(site.host, res);
    else toast.push({ message: "Couldn't follow. Try again." });
  }

  // The catalog is a bonus under the box; if it cannot load, it stays out of the way.
  if (failed) return null;

  return (
    <section aria-labelledby="fyr-title" className="add-fyr">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 id="fyr-title" className="t-eyebrow text-muted">
            From your reading
          </h2>
          <p className="t-caption mt-1 text-muted">Sites your sources keep linking to. Nothing here was picked by anyone.</p>
        </div>
        {sites && sites.length > 1 ? (
          <>
            <div role="radiogroup" aria-label="Sort" className="hidden shrink-0 rounded-sm bg-surface-3 p-0.5 lg:flex">
              {(["linked", "opened"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={sort === k}
                  onClick={() => setSort(k)}
                  className={`t-chip h-7 rounded-[4px] px-2.5 ${sort === k ? "bg-surface text-ink shadow-e1" : "text-muted hover:text-ink"}`}
                >
                  {k === "linked" ? "Most linked" : "Most opened"}
                </button>
              ))}
            </div>
            <div className="relative lg:hidden">
              <button
                type="button"
                onClick={() => setMenu((m) => !m)}
                aria-label="Sort"
                aria-expanded={menu}
                aria-haspopup="true"
                className="tap -mr-2 -mt-2 flex h-11 w-11 items-center justify-center rounded-sm text-muted"
              >
                <SlidersHorizontal className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden="true" />
              </button>
              {menu ? (
                <div
                  role="radiogroup"
                  aria-label="Sort"
                  className="add-fade-in absolute right-0 top-10 z-10 w-48 overflow-hidden rounded-lg border border-hairline bg-surface shadow-e2"
                >
                  {(["linked", "opened"] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      role="radio"
                      aria-checked={sort === k}
                      onClick={() => {
                        setSort(k);
                        setMenu(false);
                      }}
                      className="t-body flex min-h-11 w-full items-center justify-between border-b border-hairline px-4 text-left text-ink last:border-b-0 hover:bg-surface-2"
                    >
                      {k === "linked" ? "Most linked" : "Most opened"}
                      {sort === k ? <Check className="h-4 w-4 text-accent" strokeWidth={2} aria-hidden="true" /> : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </>
        ) : null}
      </div>

      {sites === null ? (
        <ul className="mt-3" aria-busy="true" aria-label="Loading">
          {Array.from({ length: 6 }, (_, i) => (
            <li key={i} className="flex h-16 items-center gap-3 border-b border-hairline lg:h-14" aria-hidden="true">
              <div className="skeleton h-8 w-8 shrink-0 rounded-sm" />
              <div className="flex-1">
                <div className="skeleton h-3.5 w-1/3" />
                <div className="skeleton mt-2 h-3 w-2/3" />
              </div>
              <div className="skeleton h-8 w-16 rounded-md" />
            </li>
          ))}
        </ul>
      ) : sites.length === 0 ? (
        everHad.current ? (
          <p className="t-body mt-6 text-muted">You follow everything your sources link to.</p>
        ) : (
          <div className="mx-auto mt-8 flex max-w-[300px] flex-col items-center text-center">
            <LinkIcon className="h-6 w-6 text-faint" strokeWidth={1.75} aria-hidden="true" />
            <p className="t-title mt-3 text-ink-2">Nothing here yet</p>
            <p className="mt-1 text-[0.9375rem] leading-5 text-muted">
              This fills in as your sources link out to other sites. Follow a few first.
            </p>
          </div>
        )
      ) : (
        <>
          <ul className="mt-2">
            {visible.map((s) => {
              const name = siteName(s);
              const state = rowState[s.host] ?? "idle";
              return (
                <li
                  key={s.host}
                  ref={(el) => {
                    if (el) rowRefs.current.set(s.host, el);
                    else rowRefs.current.delete(s.host);
                  }}
                  className="border-b border-hairline"
                >
                  <SwipeRow
                    rightAction={{
                      label: "Hide",
                      icon: <EyeOff className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />,
                      color: "var(--muted)",
                      onAction: () => hide(s),
                    }}
                  >
                    <div className="add-fyr-row group flex h-16 items-center gap-3 lg:h-14">
                      <LetterTile name={name} size={32} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[0.9375rem] leading-5 text-ink">
                          <span className="font-semibold">{name}</span>
                          {name !== displayHost(s.host) ? <span className="text-faint"> · {displayHost(s.host)}</span> : null}
                        </p>
                        <p className="t-caption truncate text-muted lg:whitespace-normal">{readingCaption(shortVia(s), READING_WINDOW)}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void hide(s)}
                        aria-label={`Hide ${name}`}
                        className="add-hide flex h-9 w-9 shrink-0 items-center justify-center rounded-sm text-faint hover:bg-surface-2 hover:text-muted"
                      >
                        <EyeOff className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                      </button>
                      {state === "followed" ? (
                        <span className="t-button flex h-11 shrink-0 items-center gap-1.5 px-1 text-ok lg:h-8" role="status">
                          <Check className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
                          Following
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void follow(s)}
                          disabled={state === "busy"}
                          aria-label={`Follow ${name}`}
                          className="tap add-secondary relative flex h-11 min-w-[4.5rem] shrink-0 items-center justify-center rounded-md px-3 before:absolute before:inset-x-0 before:top-1.5 before:bottom-1.5 before:rounded-md before:bg-surface-3 lg:h-8 lg:before:inset-0"
                        >
                          <span className="t-button relative text-ink-2">{state === "busy" ? <Spinner /> : "Follow"}</span>
                        </button>
                      )}
                    </div>
                  </SwipeRow>
                </li>
              );
            })}
          </ul>
          {sorted.length > shown ? (
            <button
              type="button"
              onClick={() => setShown((n) => n + PAGE)}
              className="tap t-button mt-4 flex h-12 w-full items-center justify-center rounded-md bg-surface-3 text-ink-2 lg:h-9"
            >
              Show {Math.min(PAGE, sorted.length - shown)} more
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}
