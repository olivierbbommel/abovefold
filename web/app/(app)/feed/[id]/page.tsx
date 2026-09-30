import Link from "next/link";
import { notFound } from "next/navigation";
import { Rss } from "lucide-react";
import { folderItems, sourceStats } from "@/lib/queries";
import { feedsByCategory, folders as minifluxFolders } from "@/lib/miniflux";
import { displayName } from "@/lib/display-name";
import { openedLabel, sourceActivity, volumeLabel } from "@/lib/source-activity";
import { shortAgo } from "@/lib/reader-format";
import { positiveIntParam } from "@/lib/route-params";
import StoryRow from "@/app/components/StoryRow";
import FeedIcon from "@/app/components/FeedIcon";
import EmptyState from "@/app/components/EmptyState";
import RefreshableList from "@/app/components/RefreshableList";
import ListPage from "@/app/components/nav/ListPage";
import PageHeader from "@/app/components/nav/PageHeader";
import PageBack from "@/app/components/reader/PageBack";

// Same as the folder page: live Miniflux and Postgres state.
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

/*
 * One source: its display name, one line of facts, and its stories as the
 * same rows as Today. The facts follow the folder page's rule (spec 5.6,
 * audit A19): the open figure only with ten or more stories behind it, and
 * as the raw pair so the sample size is visible.
 */
export default async function FeedPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ all?: string }>;
}) {
  const { id } = await params;
  const { all } = await searchParams;
  const showAll = all === "1";
  const feedId = positiveIntParam(id);
  if (feedId === null) notFound();

  // Miniflux has no "get one feed" call here; feedsByCategory() already has
  // every feed, and says which folder it is in.
  const [byCategory, allFolders] = await Promise.all([feedsByCategory(), minifluxFolders()]);
  let categoryId: number | null = null;
  let feed: { id: number; title: string; problem: string | null } | undefined;
  for (const [cat, feeds] of Object.entries(byCategory)) {
    const match = feeds.find((f) => f.id === feedId);
    if (match) {
      feed = match;
      categoryId = Number(cat);
      break;
    }
  }
  if (!feed) notFound();
  const folder = allFolders.find((f) => f.id === categoryId);

  const [stats, activity, items] = await Promise.all([
    sourceStats([feedId]),
    sourceActivity([feedId]),
    folderItems([feedId], showAll ? 200 : PAGE_SIZE + 1),
  ]);
  const hasMore = !showAll && items.length > PAGE_SIZE;
  const visibleItems = showAll ? items : items.slice(0, PAGE_SIZE);

  const s = stats[feedId];
  const facts = [volumeLabel(s.volumePerDay), s.lastPost ? `last post ${shortAgo(s.lastPost)} ago` : "no posts yet"];
  const opened = openedLabel(activity[feedId]);
  if (opened) facts.push(`${opened} this month`);
  const name = displayName(feed.title) || feed.title;
  if (feed.problem) facts.unshift(feed.problem);

  return (
    <RefreshableList className="flex min-w-0 flex-1">
      <ListPage>
        <PageHeader
          title={name}
          subtitle={facts.join(" · ")}
          icon={<FeedIcon feedId={feedId} title={feed.title} size={28} radius={6} />}
          back={<PageBack href={folder ? `/folder/${folder.id}` : "/library"} label={folder?.title ?? "Library"} />}
        />

        {visibleItems.length === 0 ? (
          <EmptyState icon={<Rss />} title={`Nothing from ${name} yet`} />
        ) : (
          <div className="flex flex-col pb-6">
            {visibleItems.map((item) => (
              <StoryRow key={item.id} item={item} />
            ))}
            {hasMore && (
              <Link
                href={`/feed/${feedId}?all=1`}
                className="tap mt-6 flex h-11 w-full items-center justify-center rounded-md bg-surface-3 t-button text-ink-2 hover:bg-surface-2"
              >
                Show all stories from {name}
              </Link>
            )}
          </div>
        )}
      </ListPage>
    </RefreshableList>
  );
}
