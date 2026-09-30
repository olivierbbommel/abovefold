"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Check, ChevronRight, CircleAlert, CircleCheck } from "lucide-react";
import { cardMeta, displayHost, shortAge } from "@/lib/add-format";
import { decodeEntities } from "@/lib/entities";
import { displayName } from "@/lib/display-name";
import { collapseOut } from "@/lib/collapse";
import { FolderLine, LetterTile, PrimaryButton, Spinner, TextButton } from "./parts";
import type { Folder, ResolveMatch } from "./types";

/*
 * The cards under the Add box (spec 5.4 states 3 to 10). Each is e1, r-lg,
 * 16 inset, and rises 6px into place, staggered 40ms by its index.
 */

export function matchName(m: ResolveMatch): string {
  const name = displayName(decodeEntities(m.result.candidates[0]?.title ?? ""));
  // Reddit titles its feeds with their own URL; "r/worldnews" is the name.
  if (!name || /^https?:\/\//i.test(name)) return displayHost(m.label || m.host);
  return name;
}

function Card({ index, children, label }: { index: number; children: React.ReactNode; label?: string }) {
  return (
    <section
      aria-label={label}
      className="add-card add-rise rounded-lg border border-line bg-surface p-4 shadow-e1"
      style={{ animationDelay: `${index * 40}ms` }}
    >
      {children}
    </section>
  );
}

function Header({ name, meta, extra }: { name: string; meta?: string; extra?: string | null }) {
  return (
    <div className="flex items-start gap-3">
      <LetterTile name={name} />
      <div className="min-w-0 flex-1">
        <h3 className="t-title break-words text-ink">{name}</h3>
        {meta ? <p className="t-meta mt-0.5 text-muted">{meta}</p> : null}
        {extra ? <p className="t-caption mt-1 text-muted">{extra}</p> : null}
      </div>
    </div>
  );
}

type FollowPhase = "idle" | "busy" | "confirm" | "done";

export function FoundCard({
  index,
  match,
  linkedLine,
  folders,
  folderId,
  suggestedId,
  now,
  onChangeFolder,
  onFollowed,
  onAlready,
  onAddAnother,
  onNavigate,
  asNewsletter = false,
}: {
  index: number;
  match: ResolveMatch;
  linkedLine: string | null;
  folders: Folder[];
  folderId: number | null;
  suggestedId: number | null;
  now: number;
  onChangeFolder: () => void;
  onFollowed: () => void;
  onAlready: () => void;
  onAddAnother: () => void;
  onNavigate: () => void;
  /** Opened from Newsletters: the feed is marked as a newsletter, so it lists there. */
  asNewsletter?: boolean;
}) {
  const name = matchName(match);
  const feed = match.result.candidates[0];
  const preview = match.result.preview;
  const [phase, setPhase] = useState<FollowPhase>("idle");
  const [feedId, setFeedId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const body = useRef<HTMLDivElement>(null);

  async function follow() {
    if (phase !== "idle" || !feed) return;
    setPhase("busy");
    setError(null);
    try {
      const res = await fetch(asNewsletter ? "/api/newsletter-feed" : "/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedUrl: feed.url, categoryId: folderId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // /api/subscribe passes Miniflux's "already exists" through;
        // /api/newsletter-feed answers 409 with its own wording.
        if (res.status === 409 || /already exists/i.test(String(data?.error ?? ""))) {
          onAlready();
          return;
        }
        throw new Error();
      }
      setFeedId(Number(data.feedId));
      setPhase("confirm");
      onFollowed();
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!reduced) await new Promise((r) => setTimeout(r, 520));
      if (body.current) await collapseOut(body.current).catch(() => {});
      setPhase("done");
    } catch {
      setError("Couldn't follow. Try again.");
      setPhase("idle");
    }
  }

  return (
    <Card index={index} label={name}>
      <Header name={name} meta={cardMeta(match.host, preview, now)} extra={linkedLine} />

      {phase === "done" ? (
        <div className="add-fade-in mt-3" role="status">
          <p className="t-meta flex items-start gap-2 text-ok">
            <CircleCheck className="mt-px h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
            <span>
              {asNewsletter
                ? `Added ${name} to Newsletters. Past issues arrive within a few minutes.`
                : `Following ${name}. First stories arrive within a few minutes.`}
            </span>
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-5">
            {feedId ? (
              <Link
                href={`/feed/${feedId}`}
                onClick={onNavigate}
                className="tap -mx-1.5 inline-flex min-h-11 items-center rounded-sm px-1.5 text-[0.8125rem] font-semibold text-accent lg:min-h-8 lg:text-[0.75rem]"
              >
                Open {name}
              </Link>
            ) : null}
            <TextButton onClick={onAddAnother}>Add another</TextButton>
          </div>
        </div>
      ) : (
        <div ref={body}>
          {preview && preview.recentItems.length > 0 ? (
            <div className="mt-4 border-t border-hairline pt-3">
              <p className="t-eyebrow text-muted">Latest</p>
              <ul className="mt-2 space-y-2">
                {preview.recentItems.map((item, i) => (
                  <li key={i} className="grid grid-cols-[36px_minmax(0,1fr)] items-baseline">
                    <span className="t-caption tabular-nums text-faint">{shortAge(item.publishedAt, now)}</span>
                    <span className="add-headline text-ink">{decodeEntities(item.title)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="mt-3 border-t border-hairline pt-1">
            <FolderLine folders={folders} value={folderId} suggestedId={suggestedId} onChange={onChangeFolder} />
          </div>
          <div className="mt-2 flex">
            <PrimaryButton onClick={follow} busy={phase === "busy"} desktopInline>
              <span className="add-follow-label relative inline-flex items-center justify-center">
                {phase === "busy" ? (
                  <Spinner label="Following" />
                ) : phase === "confirm" ? (
                  <span className="add-fade-in inline-flex items-center gap-1.5">
                    <Check className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
                    Following
                  </span>
                ) : (
                  <>
                    <span className="lg:hidden">Follow {name}</span>
                    <span className="hidden lg:inline">Follow</span>
                  </>
                )}
              </span>
            </PrimaryButton>
          </div>
          {error ? (
            <p className="t-caption mt-2 text-danger" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      )}
    </Card>
  );
}

export function AlreadyCard({
  index,
  name,
  feedId,
  folderTitle,
  onNavigate,
}: {
  index: number;
  name: string;
  feedId: number;
  folderTitle: string | null;
  onNavigate: () => void;
}) {
  return (
    <Card index={index} label={name}>
      <Header
        name={name}
        meta={folderTitle ? `You already follow ${name}, in ${folderTitle}.` : `You already follow ${name}.`}
      />
      <div className="mt-2 pl-[52px]">
        <Link
          href={`/feed/${feedId}`}
          onClick={onNavigate}
          className="tap -mx-1.5 inline-flex min-h-11 items-center rounded-sm px-1.5 text-[0.8125rem] font-semibold text-accent lg:min-h-8 lg:text-[0.75rem]"
        >
          Open {name}
        </Link>
      </div>
    </Card>
  );
}

export function WhichCard({
  index,
  matches,
  onPick,
}: {
  index: number;
  matches: ResolveMatch[];
  onPick: (m: ResolveMatch) => void;
}) {
  return (
    <Card index={index} label="Which one?">
      <h3 className="t-title text-ink">Which one?</h3>
      <ul className="mt-2 divide-y divide-hairline">
        {matches.map((m) => {
          const headline = m.result.preview?.recentItems[0]?.title;
          return (
            <li key={m.host}>
              <button
                type="button"
                onClick={() => onPick(m)}
                className="add-which flex min-h-14 w-full items-center gap-3 rounded-sm py-2 text-left hover:bg-surface-2"
              >
                <LetterTile name={matchName(m)} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="t-body block truncate text-ink">{displayHost(m.host)}</span>
                  {headline ? <span className="t-caption block truncate text-muted">{decodeEntities(headline)}</span> : null}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-faint" strokeWidth={2} aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export function ProblemCard({
  index,
  kind,
  host,
  query,
  onEmail,
  onRetry,
}: {
  index: number;
  kind: "none" | "blocked" | "unreachable" | "nothing";
  host: string;
  query: string;
  onEmail: () => void;
  onRetry: () => void;
}) {
  host = displayHost(host);
  const copy = {
    none: {
      title: `No feed at ${host}`,
      body: "If you know the feed address, paste it. Some sites publish one on a different domain. Or follow it by email.",
    },
    blocked: {
      title: `${host} refuses automated requests`,
      body: "Nothing running on a server can poll this site, so the feed can't be followed here. Follow it by email instead: they send to you, and there is nothing to block.",
    },
    unreachable: { title: `Couldn't reach ${host}`, body: "Check the address, or try again in a moment." },
    nothing: {
      title: `Nothing found for “${query}”`,
      body: "Try the site's address instead, or follow it by email.",
    },
  }[kind];
  return (
    <Card index={index} label={copy.title}>
      <div className="flex items-start gap-2">
        <CircleAlert className="mt-[3px] h-4 w-4 shrink-0 text-muted" strokeWidth={2} aria-hidden="true" />
        <h3 className="t-title min-w-0 break-words text-ink">{copy.title}</h3>
      </div>
      <p className="t-body mt-2 text-ink-2">{copy.body}</p>
      <div className="mt-4 flex items-center gap-4">
        {kind === "unreachable" ? (
          <PrimaryButton onClick={onRetry} desktopInline>
            Try again
          </PrimaryButton>
        ) : (
          <>
            <PrimaryButton onClick={onEmail} desktopInline className={kind === "none" ? "flex-1 lg:flex-none" : ""}>
              {kind === "blocked" ? `Follow ${host} by email` : "Follow by email"}
            </PrimaryButton>
            {kind === "none" ? <TextButton onClick={onRetry}>Try again</TextButton> : null}
          </>
        )}
      </div>
    </Card>
  );
}

export function ResolvingCard({ step }: { step: string }) {
  return (
    <section className="add-card add-fade-in rounded-lg border border-line bg-surface p-4 shadow-e1" aria-busy="true">
      <div className="flex items-start gap-3" aria-hidden="true">
        <div className="skeleton h-10 w-10 shrink-0 rounded-md" />
        <div className="flex-1 pt-1">
          <div className="skeleton h-3.5 w-2/5" />
          <div className="skeleton mt-2 h-3 w-4/5" />
        </div>
      </div>
      <div className="mt-4 space-y-2.5 border-t border-hairline pt-4" aria-hidden="true">
        <div className="skeleton h-3.5 w-11/12" />
        <div className="skeleton h-3.5 w-4/5" />
        <div className="skeleton h-3.5 w-5/6" />
      </div>
      <p className="t-caption mt-4 flex items-center gap-2 text-muted" role="status">
        <Spinner size={14} />
        <span key={step} className="add-fade-in">
          {step}
        </span>
      </p>
    </section>
  );
}
