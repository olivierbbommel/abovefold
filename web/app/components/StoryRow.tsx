import Link from "next/link";
import { Layers, Sparkles } from "lucide-react";
import type { Item } from "@/lib/types";
import { displayName } from "@/lib/display-name";
import { proxied } from "@/lib/img";
import { timeAgo } from "./Icons";
import FeedIcon from "./FeedIcon";
import Img from "./Img";
import SwipeableItem from "./SwipeableItem";
import RowActions from "./RowActions";

/*
 * One story, in two sizes (spec 5.2). Replaces ItemRow and LeadItem.
 *
 * Contract other code relies on: the row is an <article> inside <main> and
 * contains an <a href="/article/{id}">. KeyboardNav and MarkReadOnScroll find
 * rows that way, deliberately without props.
 *
 * Layout fixes the audit's worst phone bug (A2): the meta line used to be a
 * wrapping flex row with an unshrinkable name, so it broke into three lines
 * (icon, then "MacRumors: Mac News and Rumors - All S...", then "3h"). Now it
 * never wraps, the time never truncates, and the name gives way.
 */

function Meta({ item }: { item: Item }) {
  const name = displayName(item.feedTitle);
  return (
    <div className="flex min-w-0 items-center gap-1.5 whitespace-nowrap t-meta">
      <FeedIcon feedId={item.feedId} title={item.feedTitle} size={16} radius={4} />
      <span className="min-w-0 shrink truncate text-muted" title={item.feedTitle}>
        {name}
      </span>
      <span className="shrink-0 text-faint" aria-hidden="true">
        ·
      </span>
      <time className="shrink-0 text-faint" dateTime={item.publishedAt}>
        {timeAgo(item.publishedAt)}
      </time>
      {item.clusterSize > 1 && (
        <span className="story-pill ml-1 hidden shrink-0 items-center gap-1 rounded-full bg-surface-3 px-2 py-0.5 t-caption text-muted min-[360px]:inline-flex">
          <Layers className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
          {item.clusterSize} sources
        </span>
      )}
    </div>
  );
}

/*
 * The worker writes the matched interest as its raw lowercase keyword
 * ("Strong match to your interest in meta vr"). Quote it so it reads as the
 * topic's name rather than a typo. Display only; the stored text is left as
 * it is.
 */
const INTEREST = /^(Strong match to your interest in )(.+?)((?: \u00b7 \d+ sources)?)$/;

export function readableReason(reason: string): string {
  const m = INTEREST.exec(reason);
  return m ? `${m[1]}"${m[2]}"${m[3]}` : reason;
}

function Reason({ reason }: { reason: string }) {
  if (!reason) return null;
  return (
    <div className="story-reason mt-2 flex min-w-0 items-center gap-1.5">
      <Sparkles className="h-3 w-3 shrink-0 text-ai" strokeWidth={2} aria-hidden="true" />
      <span className="truncate t-caption text-faint">{readableReason(reason)}</span>
    </div>
  );
}

export default function StoryRow({ item, variant = "row" }: { item: Item; variant?: "row" | "lead" }) {
  const image = proxied(item.leadImage, item.url);
  const href = `/article/${item.id}`;

  if (variant === "lead") {
    return (
      <SwipeableItem articleId={item.id}>
        <article className="story story-lead relative border-b border-hairline py-5 lg:py-6">
          <Link href={href} className="story-link grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px] lg:gap-7">
            {image && (
              <Img
                src={proxied(item.leadImage, item.url, 720)!}
                alt=""
                width={720}
                height={405}
                referrerPolicy="no-referrer"
                className="story-thumb aspect-[16/9] w-full rounded-md object-cover lg:order-2 lg:aspect-[3/2] lg:w-[240px]"
              />
            )}
            <div className="story-text min-w-0">
              <Meta item={item} />
              <h2 className="mt-2 t-lead text-ink" style={{ viewTransitionName: `story-${item.id}` }}>
                {item.title}
              </h2>
              {item.summary && (
                <p className="mt-2 hidden t-body text-ink-2 lg:line-clamp-2">{item.summary}</p>
              )}
              <Reason reason={item.reason} />
            </div>
          </Link>
          <RowActions articleId={item.id} className="story-actions" />
        </article>
      </SwipeableItem>
    );
  }

  return (
    <SwipeableItem articleId={item.id}>
      <article className="story relative border-b border-hairline py-4 lg:py-[18px]">
        <Link
          href={href}
          className="story-link grid grid-cols-1 gap-x-4 has-[.story-thumb]:grid-cols-[minmax(0,1fr)_72px] lg:has-[.story-thumb]:grid-cols-[minmax(0,1fr)_96px]"
        >
          <div className="story-text min-w-0">
            <h2 className="t-headline text-ink line-clamp-3" style={{ viewTransitionName: `story-${item.id}` }}>
              {item.title}
            </h2>
            <div className="mt-3">
              <Meta item={item} />
            </div>
            {item.summary && (
              <p className="mt-2 hidden t-body text-ink-2 lg:line-clamp-2">{item.summary}</p>
            )}
            <Reason reason={item.reason} />
          </div>
          {image && (
            <Img
              src={proxied(item.leadImage, item.url, 240)!}
              alt=""
              width={96}
              height={72}
              loading="lazy"
              referrerPolicy="no-referrer"
              className="story-thumb h-[72px] w-[72px] self-start rounded-md object-cover lg:w-[96px]"
            />
          )}
        </Link>
        <RowActions articleId={item.id} className="story-actions" />
      </article>
    </SwipeableItem>
  );
}
