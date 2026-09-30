"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CircleX, History, Search, Sparkles } from "lucide-react";
import type { SearchResponse } from "@/lib/search";
import StoryRow from "./StoryRow";
import EmptyState from "./EmptyState";
import { SkeletonRow } from "./Skeleton";
import RenameDialog from "./RenameDialog";
import { useToast } from "./Toast";

// Mirrors lib/search.ts's MIN_QUERY_LENGTH. Not imported: that module pulls
// in pg and server env, which have no business in a client bundle.
const MIN_QUERY_LENGTH = 3;
// Spec 5.8 says 250ms. Each search is one embedding call (cheap, not free);
// this still stops a fast typist paying for one call per keystroke.
const DEBOUNCE_MS = 250;
const RECENT_KEY = "abovefold:recent-searches";
const RECENT_MAX = 8;

type Status = "idle" | "searching" | "error";

function readRecent(): string[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string").slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

function writeRecent(list: string[]) {
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // Private mode or storage disabled: recent searches just aren't kept.
  }
}

/*
 * The Search tab (spec 5.8). A field at the top; under it, before anything is
 * typed, the landing: Recently read (server rendered, passed in as
 * `landing`) and recent searches kept in this browser, which can be cleared.
 * As the owner types, results replace the landing, debounced, as one flat
 * list, best match first, with no highlighting (it fights the serif).
 *
 * The first paint of a /search?q= URL comes from the server (page.tsx runs
 * the search itself); this only fetches once the query is edited.
 */
export default function SearchPageInput({
  initialQuery,
  initialResult,
  landing,
}: {
  initialQuery: string;
  initialResult: SearchResponse | null;
  landing: ReactNode;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [query, setQuery] = useState(initialQuery);
  // The URL is updated with replaceState, so Back can restore a cached page
  // rendered for "/search" with no query while the address bar still says
  // ?q=openai. Trust the address bar.
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("q") ?? "";
    if (fromUrl && fromUrl !== initialQuery) setQuery(fromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [result, setResult] = useState<SearchResponse | null>(initialResult);
  const [status, setStatus] = useState<Status>("idle");
  const [recent, setRecent] = useState<string[]>([]);
  const [savingFeed, setSavingFeed] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // The first effect run is the mount itself; the server already searched.
  const skipNext = useRef(true);

  useEffect(() => setRecent(readRecent()), []);

  function remember(q: string) {
    const next = [q, ...readRecent().filter((r) => r.toLowerCase() !== q.toLowerCase())].slice(0, RECENT_MAX);
    writeRecent(next);
    setRecent(next);
  }

  useEffect(() => {
    if (initialResult && initialQuery.trim().length >= MIN_QUERY_LENGTH) remember(initialQuery.trim());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (skipNext.current) {
      skipNext.current = false;
      return;
    }
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setResult(null);
      setStatus("idle");
      if (trimmed.length === 0) window.history.replaceState(null, "", "/search");
      return;
    }

    setStatus("searching");
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, { signal: controller.signal });
        if (!res.ok) throw new Error(`search failed: ${res.status}`);
        const data: SearchResponse = await res.json();
        setResult(data);
        setStatus("idle");
        remember(trimmed);
        // replaceState, not router.replace: a router navigation would re-run
        // the same search on the server a second time. This only keeps the
        // URL shareable.
        window.history.replaceState(null, "", `/search?q=${encodeURIComponent(trimmed)}`);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setStatus("error");
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const trimmed = query.trim();
  const searching = trimmed.length >= MIN_QUERY_LENGTH;

  // Turns this search into a standing AI feed: POST /api/ai-feeds embeds the
  // query once and stores the vector (lib/ai-feeds.ts).
  async function saveAsFeed(name: string) {
    setSaveBusy(true);
    try {
      const res = await fetch("/api/ai-feeds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, query: trimmed }),
      });
      const data = (await res.json().catch(() => ({}))) as { id?: number; error?: string };
      if (!res.ok || typeof data.id !== "number") {
        push({ message: data.error ?? "Couldn't save the AI feed. Try again." });
        return;
      }
      setSavingFeed(false);
      push({ message: `Saved "${name}" as an AI feed` });
      router.push(`/ai-feed/${data.id}`);
    } catch {
      push({ message: "Couldn't save the AI feed. Try again." });
    } finally {
      setSaveBusy(false);
    }
  }

  return (
    <div>
      {/* The whole 52px field is the label, so a tap on its padding focuses
          the input instead of landing on a dead box around a 24px line. */}
      <label
        htmlFor="search-page-input"
        className="search-field flex h-[52px] cursor-text items-center gap-2.5 rounded-xl border border-line bg-surface px-4 focus-within:border-accent focus-within:shadow-[0_0_0_1px_var(--accent)] lg:h-12"
      >
        <Search className="h-4 w-4 shrink-0 text-faint" strokeWidth={2} aria-hidden="true" />
        <span className="sr-only">Search</span>
        <input
          ref={input}
          id="search-page-input"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search"
          autoFocus={initialQuery === ""}
          enterKeyHint="search"
          autoComplete="off"
          className="min-w-0 flex-1 self-stretch bg-transparent t-body text-ink placeholder:text-faint focus:outline-none [&::-webkit-search-cancel-button]:hidden"
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              input.current?.focus();
            }}
            aria-label="Clear search"
            className="tap -mr-2 flex h-11 w-11 items-center justify-center text-faint hover:text-muted"
          >
            <CircleX className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          </button>
        )}
      </label>

      {searching && (
        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={() => setSavingFeed(true)}
            className="tap -mr-2 flex items-center gap-1.5 rounded-sm px-2 py-1.5 t-meta text-muted hover:text-ink"
          >
            <Sparkles className="h-3 w-3 text-ai" strokeWidth={2} aria-hidden="true" />
            Save as AI feed
          </button>
        </div>
      )}

      <RenameDialog
        open={savingFeed}
        heading="Save as AI feed"
        label="Name"
        initialValue={trimmed.length > 60 ? trimmed.slice(0, 60) : trimmed}
        maxLength={60}
        busy={saveBusy}
        onSave={saveAsFeed}
        onCancel={() => setSavingFeed(false)}
      />

      {!searching ? (
        <div className="pb-6">
          {landing}
          {recent.length > 0 && (
            <section className="pt-8">
              <div className="flex items-center justify-between pb-1">
                <h2 className="t-eyebrow text-muted">Recent searches</h2>
                <button
                  type="button"
                  onClick={() => {
                    writeRecent([]);
                    setRecent([]);
                  }}
                  className="tap -mr-2 rounded-sm px-2 py-1 t-meta text-accent"
                >
                  Clear
                </button>
              </div>
              <ul>
                {recent.map((r) => (
                  <li key={r} className="border-b border-hairline">
                    <button
                      type="button"
                      onClick={() => setQuery(r)}
                      className="flex min-h-11 w-full items-center gap-3 text-left t-body text-ink-2 hover:text-ink"
                    >
                      <History className="h-4 w-4 shrink-0 text-faint" strokeWidth={2} aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate">{r}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      ) : status === "error" ? (
        <EmptyState icon={<Search />} title="Search didn't work" body="Try again in a moment." />
      ) : status === "searching" && !result ? (
        <div className="pt-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      ) : result && result.items.length === 0 ? (
        <EmptyState
          icon={<Search />}
          title={`No stories match “${result.query}”`}
          body="Search covers titles and text from the last 90 days."
        />
      ) : result ? (
        <div className={`pb-6 pt-2 ${status === "searching" ? "opacity-60" : ""}`} aria-busy={status === "searching"}>
          {/* Semantic search always returns the nearest vectors, whether or
              not they answer the question. Saying so beats presenting
              near misses as answers. */}
          {!result.hasStrongMatch && (
            <p className="pb-1 pt-2 t-caption text-faint">Nothing matched closely. These are the nearest stories.</p>
          )}
          {result.items.map((item) => (
            <StoryRow key={item.id} item={item} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
