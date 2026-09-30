"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { accessSessionExpired } from "@/lib/session-check";
import { useRouter } from "next/navigation";
import { CircleAlert, CircleCheck } from "lucide-react";
import { classifyInput, emailLabel, hostOf } from "@/lib/resolve-input";
import { displayHost, linkedHereLine } from "@/lib/add-format";
import { displayName } from "@/lib/display-name";
import AddBox from "./AddBox";
import { AlreadyCard, FoundCard, ProblemCard, ResolvingCard, WhichCard, matchName } from "./Cards";
import FolderPicker from "./FolderPicker";
import FollowByEmailStep from "./FollowByEmailStep";
import FromYourReading from "./FromYourReading";
import {
  READING_WINDOW,
  type AddContext,
  type CardModel,
  type Folder,
  type ReadingSite,
  type ResolveMatch,
  type ResolveResponse,
} from "./types";

/*
 * Add a source (spec 5.4, 5.5): the whole flow, used by the app-wide sheet
 * (AddSheet) and by the /add page. It owns its steps (search, Follow by
 * email, Choose a folder) and hands its header to the caller through
 * `frame`, so the sheet can put Back in its own header and the page can put
 * it above the content. No step ever opens a second sheet.
 */

export type AddStep = "search" | "email" | "folder";
export type AddHeader = { step: AddStep; title: string; onBack: (() => void) | null };

const STEPS = ["Finding the site", "Reading the feed", "Looking at the last 30 days"];
const SKELETON_AFTER_MS = 300;
const STEP_EVERY_MS = 1100;
const STEP_MIN_MS = 400;

const normUrl = (u: string) => u.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const desktop = () => typeof window !== "undefined" && window.matchMedia("(width >= 64rem)").matches;

/** Turn the resolver's answer into the cards to show (spec 5.4 states 4, 6 to 10). */
export function buildCards(
  res: ResolveResponse,
  query: string,
  ctx: AddContext | null,
  sites: ReadingSite[],
  { asNewsletter = false }: { asNewsletter?: boolean } = {}
): CardModel[] {
  const feeds = ctx?.feeds ?? [];
  const folderTitle = (categoryId: number) => ctx?.folders.find((f) => f.id === categoryId)?.title ?? null;
  const siteByHost = new Map(sites.map((s) => [s.host, s]));

  const followedFeed = (m: ResolveMatch) => {
    const url = m.result.candidates[0]?.url;
    const byFeed = url ? feeds.find((f) => normUrl(f.feedUrl) === normUrl(url)) : undefined;
    if (byFeed) return byFeed;
    // A site host says "followed" only for real sites: every subreddit and
    // channel shares reddit.com or youtube.com.
    if (res.input === "subreddit" || res.input === "youtube") return undefined;
    return feeds.find((f) => f.siteUrl && hostOf(f.siteUrl) === displayHost(m.host));
  };
  const already = (key: string, feed: { id: number; title: string; categoryId?: number }): CardModel => ({
    t: "already",
    key,
    name: displayName(feed.title) || feed.title,
    feedId: feed.id,
    folderTitle: feed.categoryId !== undefined ? folderTitle(feed.categoryId) : null,
  });
  const fromList = (feedId: number) => {
    const f = feeds.find((x) => x.id === feedId);
    return f ? { id: f.id, title: f.title, categoryId: f.categoryId } : undefined;
  };
  const card = (m: ResolveMatch, i: number): CardModel => {
    const key = `${m.host}-${i}`;
    if (m.result.kind === "found") {
      // From Newsletters, a feed you already follow keeps its Follow card:
      // following it there lists it under Newsletters (/api/newsletter-feed
      // adopts the existing feed), which "You already follow" never offered.
      const f = followedFeed(m);
      if (f && asNewsletter) {
        // Post the feed URL already stored, not this candidate: Miniflux only
        // says "already exists" for an exact match, and a different URL for
        // the same publication would create a second subscription instead.
        const [first, ...rest] = m.result.candidates;
        const adopted = { ...m, result: { ...m.result, candidates: [{ ...first, url: f.feedUrl }, ...rest] } };
        return { t: "found", key, match: adopted, linkedLine: null };
      }
      if (f) return already(key, { id: f.id, title: f.title, categoryId: f.categoryId });
      const site = m.from === "reading" ? siteByHost.get(displayHost(m.host)) : undefined;
      return { t: "found", key, match: m, linkedLine: site ? linkedHereLine(site, READING_WINDOW) : null };
    }
    const t = m.result.kind === "blocked" ? "blocked" : m.result.kind === "none" ? "none" : "unreachable";
    return { t, key, host: displayHost(m.host) };
  };

  if (res.input !== "name") {
    const m = res.matches[0];
    if (m && m.result.kind === "found") return [card(m, 0)];
    const listed = res.alreadyFollowing[0];
    if (listed) {
      const f = fromList(listed.feedId);
      return [already("already", f ?? { id: listed.feedId, title: listed.title })];
    }
    return m ? [card(m, 0)] : [{ t: "unreachable", key: "u", host: hostOf(query) ?? query }];
  }

  // A site the owner's reading already points at is the answer, even when it
  // refuses robots: "The Atlantic" is theatlantic.com, not atlantic.com, and
  // the honest card for it is the email one.
  const top = res.matches[0];
  if (top && top.from === "reading") return [card(top, 0)];

  const found = res.matches.filter((m) => m.result.kind === "found");
  if (found.length === 0) {
    const listed = res.alreadyFollowing[0];
    if (listed) return [already("already", fromList(listed.feedId) ?? { id: listed.feedId, title: listed.title })];
    const other = res.matches[0];
    return other ? [card(other, 0)] : [{ t: "nothing", key: "n", query }];
  }
  // Two live sites for one name need the person to choose, unless one of
  // them is already followed: "Hacker News" offered two sites and picking
  // the first subscribed HN a second time.
  // Only a real match counts: a found site that is followed, or a followed
  // source whose name starts with what was typed. The resolver's title match
  // is loose ("News" matches AI News), too loose to take the choice away.
  const typed = query.trim().toLowerCase();
  const followedHit = found.map(followedFeed).find((f) => f !== undefined);
  const namedHit = res.alreadyFollowing.find((l) => (displayName(l.title) || l.title).toLowerCase().startsWith(typed));
  if (found.length > 1 && (followedHit || namedHit)) {
    if (followedHit) return [already("already", { id: followedHit.id, title: followedHit.title, categoryId: followedHit.categoryId })];
    const listed = namedHit!;
    return [already("already", fromList(listed.feedId) ?? { id: listed.feedId, title: listed.title })];
  }
  if (found.length === 1) return [card(found[0], 0)];
  return [{ t: "which", key: "which", matches: found.slice(0, 3) }];
}

export default function AddPanel({
  initialStep = "search",
  initialQuery,
  folderId = null,
  initialFolders,
  autoFocus = true,
  asNewsletter = false,
  onClose,
  frame,
}: {
  initialStep?: "search" | "email";
  initialQuery?: string;
  /** Preselected folder (a folder page's "Add a source"). */
  folderId?: number | null;
  /** Folders the page already has, so the page never waits on them. */
  initialFolders?: Folder[];
  autoFocus?: boolean;
  /**
   * Opened from Newsletters. A followed feed goes through
   * /api/newsletter-feed so it is marked as a newsletter and lists there;
   * the box says a feed or an email address both work.
   */
  asNewsletter?: boolean;
  /** Present in the sheet: Done and navigation close it. */
  onClose?: () => void;
  frame: (header: AddHeader, body: ReactNode) => ReactNode;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [ctx, setCtx] = useState<AddContext | null>(null);
  const folders = ctx?.folders ?? initialFolders ?? [];
  const validFolder = folderId !== null && (folders.length === 0 || folders.some((f) => f.id === folderId)) ? folderId : null;

  const [step, setStep] = useState<AddStep>(initialStep);
  const [folderReturn, setFolderReturn] = useState<{ step: "search" | "email"; key: string | null }>({ step: "search", key: null });

  const [text, setText] = useState(initialStep === "search" ? initialQuery ?? "" : "");
  const classified = useMemo(() => classifyInput(text), [text]);
  const [outcome, setOutcome] = useState<{ query: string; cards: CardModel[]; now: number } | null>(null);
  const [resolving, setResolving] = useState(false);
  const [skeleton, setSkeleton] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [cardFolder, setCardFolder] = useState<Record<string, number | null>>({});
  const [emailName, setEmailName] = useState(initialStep === "email" ? initialQuery ?? "" : "");
  const [emailFolder, setEmailFolder] = useState<number | null>(folderId);
  const [emailKey, setEmailKey] = useState(0);
  const [opml, setOpml] = useState<{ label: string | null; result: { ok: boolean; text: string } | null }>({ label: null, result: null });

  const sites = useRef<ReadingSite[]>([]);
  const ctxRef = useRef<AddContext | null>(null);
  const run = useRef<{ abort: AbortController | null; timers: number[]; stepAt: number }>({ abort: null, timers: [], stepAt: 0 });

  useEffect(() => {
    let live = true;
    fetch("/api/add/context")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((c: AddContext) => {
        if (!live) return;
        ctxRef.current = c;
        setCtx(c);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const clearTimers = () => {
    run.current.timers.forEach((t) => window.clearTimeout(t));
    run.current.timers = [];
  };

  const resolve = useCallback(async (raw: string) => {
    const q = raw.trim();
    if (!q) return;
    const kind = classifyInput(q).kind;
    if (kind === "email") {
      setEmailName(emailLabel(q));
      setStep("email");
      return;
    }
    run.current.abort?.abort();
    clearTimers();
    const ac = new AbortController();
    run.current.abort = ac;
    setResolving(true);
    setSkeleton(false);
    setOutcome(null);
    setOpml({ label: null, result: null });

    // The skeleton only appears if the answer is slow; its words step on a
    // timer, each held long enough to read.
    run.current.timers.push(
      window.setTimeout(() => {
        setSkeleton(true);
        setStepIdx(0);
        run.current.stepAt = performance.now();
        for (let i = 1; i < STEPS.length; i++) {
          run.current.timers.push(
            window.setTimeout(() => {
              setStepIdx(i);
              run.current.stepAt = performance.now();
            }, i * STEP_EVERY_MS)
          );
        }
      }, SKELETON_AFTER_MS)
    );

    let cards: CardModel[];
    try {
      const r = await fetch("/api/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q }),
        signal: ac.signal,
      });
      if (!r.ok) cards = [{ t: "unreachable", key: "u", host: hostOf(q) ?? q }];
      else cards = buildCards((await r.json()) as ResolveResponse, q, ctxRef.current, sites.current, { asNewsletter });
    } catch {
      if (ac.signal.aborted) return;
      // Behind Cloudflare Access an expired session turns this request into a
      // cross-origin redirect that fetch reports as a network error. That is
      // not the site's fault: reload so the sign-in page can show.
      if (await accessSessionExpired()) {
        window.location.reload();
        return;
      }
      cards = [{ t: "unreachable", key: "u", host: hostOf(q) ?? q }];
    }
    if (ac.signal.aborted) return;
    if (run.current.stepAt) {
      const held = performance.now() - run.current.stepAt;
      if (held < STEP_MIN_MS) await new Promise((res) => setTimeout(res, STEP_MIN_MS - held));
      if (ac.signal.aborted) return;
    }
    clearTimers();
    run.current.stepAt = 0;
    setCardFolder({});
    setResolving(false);
    setSkeleton(false);
    setOutcome({ query: q, cards, now: Date.now() });
  }, []);

  // Arriving with a query ("From your reading" on another screen, a deep link) resolves it.
  useEffect(() => {
    if (initialStep === "search" && initialQuery?.trim()) void resolve(initialQuery);
    return () => {
      run.current.abort?.abort();
      clearTimers();
    };
  }, [initialStep, initialQuery, resolve]);

  // Focus the first field of whichever step is showing. autoFocus alone is
  // not enough inside the sheet: showModal() runs after React mounts the
  // content and moves focus to the first button (Cancel).
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!autoFocus) return;
    const t = window.setTimeout(() => {
      const scope = panelRef.current?.querySelector<HTMLElement>(`[data-step="${step}"]`);
      scope?.querySelector<HTMLElement>("input:not([type=file]), [role=option][aria-selected=true], [role=option]")?.focus({ preventScroll: true });
    }, 60);
    return () => window.clearTimeout(t);
  }, [step, autoFocus]);

  function focusBox() {
    if (step !== "search") setStep("search");
    requestAnimationFrame(() => {
      boxRef.current?.scrollIntoView({ block: "nearest", behavior: reduced() ? "auto" : "smooth" });
      inputRef.current?.focus();
    });
  }

  function addAnother() {
    setOutcome(null);
    setText("");
    focusBox();
  }

  function showInBox(host: string, res: ResolveResponse | null) {
    setText(host);
    if (res) {
      setOutcome({ query: host, cards: buildCards(res, host, ctxRef.current, sites.current, { asNewsletter }), now: Date.now() });
      setCardFolder({});
    } else void resolve(host);
    focusBox();
  }

  function toEmail(name: string) {
    setEmailName(name);
    setEmailKey((k) => k + 1);
    setStep("email");
  }

  function chooseFolder(from: "search" | "email", key: string | null) {
    setFolderReturn({ step: from, key });
    setStep("folder");
  }

  function pickFolder(id: number | null) {
    if (folderReturn.step === "email") setEmailFolder(id);
    else if (folderReturn.key) setCardFolder((m) => ({ ...m, [folderReturn.key!]: id }));
    setStep(folderReturn.step);
  }

  async function importOpml(file: File) {
    const text = await file.text().catch(() => "");
    const n = (text.match(/xmlUrl\s*=/gi) ?? []).length;
    if (n === 0) {
      setOpml({ label: null, result: { ok: false, text: `No sources in ${file.name}.` } });
      return;
    }
    setOutcome(null);
    setOpml({ label: `Importing ${n} source${n === 1 ? "" : "s"}`, result: null });
    try {
      const form = new FormData();
      form.append("file", file);
      const r = await fetch("/api/opml", { method: "POST", body: form });
      const d = await r.json();
      if (!r.ok) throw new Error();
      const added = Number(d.added) || 0;
      const existing = Number(d.existing) || 0;
      const failed = Number(d.failed) || 0;
      let msg = `Added ${added} source${added === 1 ? "" : "s"}.`;
      if (existing) msg += ` ${existing} ${existing === 1 ? "was" : "were"} already followed.`;
      if (failed) msg += ` ${failed} couldn't be added.`;
      setOpml({ label: null, result: { ok: true, text: msg } });
      router.refresh();
    } catch {
      setOpml({ label: null, result: { ok: false, text: "Couldn't import that file. Try again." } });
    }
  }

  const onSites = useCallback((s: ReadingSite[]) => {
    sites.current = s;
  }, []);

  const addTitle = asNewsletter ? "Add a newsletter" : "Add a source";
  const header: AddHeader =
    step === "folder"
      ? { step, title: "Choose a folder", onBack: () => setStep(folderReturn.step) }
      : step === "email"
        ? { step, title: addTitle, onBack: () => setStep("search") }
        : { step, title: addTitle, onBack: null };

  const cards = outcome?.cards ?? [];
  const folderValue =
    folderReturn.step === "email" ? emailFolder : folderReturn.key ? (cardFolder[folderReturn.key] ?? null) : null;

  const body = (
    <div ref={panelRef} className="add-panel">
      {/* Search step stays mounted while a sub-step is open, so Back returns to the same cards. */}
      <div hidden={step !== "search"} data-step="search">
        <div ref={boxRef} className="scroll-mt-4">
          <AddBox
            value={text}
            classified={classified}
            resolving={resolving}
            inputRef={inputRef}
            autoFocus={autoFocus && initialStep === "search"}
            opmlLabel={opml.label}
            showHints={!outcome && !resolving && !opml.result && !opml.label}
            onChange={(v: string) => {
              setText(v);
              // An emptied box is a fresh start: the hints, OPML import and
              // "No feed? Get an email address" come back.
              if (!v.trim()) {
                setOutcome(null);
                setOpml({ label: null, result: null });
              }
            }}
            onSubmit={() => void resolve(text)}
            onPasteSubmit={(v) => {
              setText(v);
              const k = classifyInput(v).kind;
              if (k !== "name" && k !== "email" && k !== "empty") void resolve(v);
            }}
            onOpml={(f) => void importOpml(f)}
            asNewsletter={asNewsletter}
            onEmail={() => toEmail(text.trim())}
          />
        </div>

        <div className="mt-4 space-y-3 empty:mt-0" aria-live="polite">
          {resolving && skeleton ? <ResolvingCard step={STEPS[stepIdx]} /> : null}
          {opml.result ? (
            <p
              role="status"
              className={`add-rise t-meta flex items-start gap-2 rounded-lg border border-line bg-surface p-4 shadow-e1 ${
                opml.result.ok ? "text-ok" : "text-muted"
              }`}
            >
              {opml.result.ok ? (
                <CircleCheck className="mt-px h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
              ) : (
                <CircleAlert className="mt-px h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
              )}
              {opml.result.text}
            </p>
          ) : null}
          {outcome
            ? cards.map((c, i) => {
                switch (c.t) {
                  case "found": {
                    const suggestedId = c.match.result.folderSuggestion?.categoryId ?? null;
                    const value = c.key in cardFolder ? cardFolder[c.key] : (validFolder ?? suggestedId);
                    return (
                      <FoundCard
                        key={c.key}
                        index={i}
                        match={c.match}
                        linkedLine={c.linkedLine}
                        folders={folders}
                        folderId={value}
                        suggestedId={validFolder === null ? suggestedId : null}
                        now={outcome.now}
                        onChangeFolder={() => {
                          setCardFolder((m) => (c.key in m ? m : { ...m, [c.key]: value }));
                          chooseFolder("search", c.key);
                        }}
                        onFollowed={() => {
                          setText("");
                          router.refresh();
                          if (desktop()) inputRef.current?.focus();
                        }}
                        onAlready={() => {
                          const name = matchName(c.match);
                          setOutcome({
                            ...outcome,
                            cards: cards.map((x) =>
                              x.key === c.key
                                ? { t: "already", key: c.key, name, feedId: 0, folderTitle: null }
                                : x
                            ),
                          });
                        }}
                        onAddAnother={addAnother}
                        onNavigate={() => onClose?.()}
                        asNewsletter={asNewsletter}
                      />
                    );
                  }
                  case "already":
                    return c.feedId ? (
                      <AlreadyCard key={c.key} index={i} name={c.name} feedId={c.feedId} folderTitle={c.folderTitle} onNavigate={() => onClose?.()} />
                    ) : (
                      <p key={c.key} className="add-rise t-meta rounded-lg border border-line bg-surface p-4 text-muted shadow-e1">
                        You already follow {c.name}.
                      </p>
                    );
                  case "which":
                    return (
                      <WhichCard
                        key={c.key}
                        index={i}
                        matches={c.matches}
                        onPick={(m) =>
                          setOutcome({ ...outcome, cards: buildCards({ input: "url", matches: [m], alreadyFollowing: [] }, m.host, ctxRef.current, sites.current, { asNewsletter }) })
                        }
                      />
                    );
                  default:
                    return (
                      <ProblemCard
                        key={c.key}
                        index={i}
                        kind={c.t}
                        host={c.t === "nothing" ? "" : c.host}
                        query={outcome.query}
                        onEmail={() => toEmail(c.t === "nothing" || classifyInput(outcome.query).kind === "name" ? outcome.query : c.host)}
                        onRetry={() => (c.t === "none" ? focusBox() : void resolve(outcome.query))}
                      />
                    );
                }
              })
            : null}
        </div>

        {/* Sites from your reading are sources, not newsletters. */}
        {asNewsletter ? null : (
          <div className="mt-8 border-t border-hairline pt-6 lg:mt-10">
            <FromYourReading folderId={validFolder} onSites={onSites} onShowInBox={showInBox} onEmail={toEmail} />
          </div>
        )}
      </div>

      {step === "email" || (step === "folder" && folderReturn.step === "email") ? (
        <div hidden={step !== "email"} data-step="email">
          <FollowByEmailStep
            key={emailKey}
            name={emailName}
            onNameChange={setEmailName}
            folders={folders}
            folderId={emailFolder}
            onChangeFolder={() => chooseFolder("email", null)}
            onDone={() => {
              if (onClose) onClose();
              else {
                setEmailName("");
                setEmailKey((k) => k + 1);
                setStep("search");
              }
            }}
            onAnother={() => {
              setEmailName("");
              setEmailKey((k) => k + 1);
            }}
          />
        </div>
      ) : null}

      {step === "folder" ? (
        <div data-step="folder">
        <FolderPicker
          folders={folders}
          value={folderValue}
          onPick={pickFolder}
          onCreated={(f) => {
            const next = ctxRef.current ? { ...ctxRef.current, folders: [...ctxRef.current.folders, f] } : { folders: [...folders, f], feeds: [] };
            ctxRef.current = next;
            setCtx(next);
            pickFolder(f.id);
          }}
        />
        </div>
      ) : null}
    </div>
  );

  return <>{frame(header, body)}</>;
}
