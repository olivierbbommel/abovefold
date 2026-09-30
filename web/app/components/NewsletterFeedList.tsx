"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { MailX } from "lucide-react";
import { displayName } from "@/lib/display-name";
import FeedIcon from "./FeedIcon";
import RowMenu from "./reader/RowMenu";
import { useToast } from "./Toast";

/*
 * Newsletters that arrive by RSS (TLDR publishes a feed). They have no
 * address, so no Copy and no admin mail. The name opens the source.
 * "Remove from Newsletters" only stops listing it here; the source stays
 * followed in its folder, so it needs no confirmation.
 */
export default function NewsletterFeedList({
  feeds,
}: {
  feeds: { feedId: number; title: string; categoryTitle: string; unread: number }[];
}) {
  const router = useRouter();
  const { push } = useToast();

  async function remove(feedId: number, name: string) {
    const response = await fetch(`/api/newsletter-feed?feedId=${feedId}`, { method: "DELETE" }).catch(() => null);
    if (!response?.ok) {
      push({ message: "Couldn't remove that newsletter. Try again." });
      return;
    }
    push({ message: `${name} is no longer listed here` });
    router.refresh();
  }

  if (feeds.length === 0) return null;

  return (
    <ul className="flex flex-col">
      {feeds.map((feed) => {
        const name = displayName(feed.title) || feed.title;
        return (
          <li key={feed.feedId} className="flex min-h-16 items-center gap-2 border-b border-hairline py-2.5">
            <Link href={`/feed/${feed.feedId}`} className="flex min-w-0 flex-1 items-center gap-3 rounded-sm">
              <FeedIcon feedId={feed.feedId} title={feed.title} size={24} radius={6} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[0.9375rem] font-semibold leading-5 text-ink" title={feed.title}>
                  {name}
                </span>
                <span className="mt-0.5 block truncate t-caption text-faint">By feed · in {feed.categoryTitle}</span>
              </span>
            </Link>
            <RowMenu
              label={`Options for ${name}`}
              items={[
                {
                  label: "Remove from Newsletters",
                  icon: <MailX className="h-[18px] w-[18px]" strokeWidth={1.75} />,
                  onSelect: () => remove(feed.feedId, name),
                },
              ]}
            />
          </li>
        );
      })}
    </ul>
  );
}
