import Link from "next/link";
import { notFound } from "next/navigation";
import { Folder as FolderGlyph } from "lucide-react";
import { folderItems, sourceStats } from "@/lib/queries";
import { allCategories, feedsByCategory, folders as minifluxFolders } from "@/lib/miniflux";
import { sourceActivity } from "@/lib/source-activity";
import { positiveIntParam } from "@/lib/route-params";
import StoryRow from "@/app/components/StoryRow";
import SourceRow from "@/app/components/SourceRow";
import MuteSuggestion from "@/app/components/MuteSuggestion";
import FolderActions from "@/app/components/FolderActions";
import EmptyState from "@/app/components/EmptyState";
import RefreshableList from "@/app/components/RefreshableList";
import ListPage from "@/app/components/nav/ListPage";
import PageHeader from "@/app/components/nav/PageHeader";
import OpenAddButton from "@/app/components/reader/OpenAddButton";
import PageBack from "@/app/components/reader/PageBack";

/*
 * A folder (spec 5.6): its sources, then its stories as the same rows as
 * Today. No unread total (a count that reads 3675 every day is a guilt bar,
 * audit A9), no aggregate open rate (A19), and no "Suggested" section:
 * starter packs are retired, and discovery lives in the Add sheet.
 */

// Always fresh: this reflects live Miniflux and Postgres state.
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

export default async function FolderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ all?: string }>;
}) {
  const { id } = await params;
  const { all } = await searchParams;
  const showAll = all === "1";
  const folderId = positiveIntParam(id);
  if (folderId === null) notFound();

  const [allFolders, byCategory, moveTargets] = await Promise.all([
    minifluxFolders(),
    feedsByCategory(),
    // Unfiltered, so the default "All" bucket is still a place to move a source to.
    allCategories(),
  ]);

  const folder = allFolders.find((f) => f.id === folderId);
  if (!folder) notFound();

  const feeds = byCategory[folderId] ?? [];
  const feedIds = feeds.map((f) => f.id);

  // 100 stories in one column produced a 16,000px scroll with no way out.
  const [stats, activity, items] = await Promise.all([
    sourceStats(feedIds),
    sourceActivity(feedIds),
    folderItems(feedIds, showAll ? 200 : PAGE_SIZE + 1),
  ]);
  const hasMore = !showAll && items.length > PAGE_SIZE;
  const visibleItems = showAll ? items : items.slice(0, PAGE_SIZE);
  const newToday = feedIds.reduce((sum, fid) => sum + (activity[fid]?.new24h ?? 0), 0);

  // The mute nudge: high volume, rarely opened, and enough data to trust it.
  // Hidden until MuteSuggestion's buttons do something (not built yet);
  // dead buttons are worse than no card.
  const SHOW_MUTE_SUGGESTION = false;
  const muteCandidate = !SHOW_MUTE_SUGGESTION ? undefined : feeds.find((f) => {
    const s = stats[f.id];
    return s.openRate !== null && s.openRate < 0.15 && s.volumePerDay > 10;
  });

  return (
    <RefreshableList className="flex min-w-0 flex-1">
      <ListPage>
        <PageHeader
          title={folder.title}
          subtitle={`${feeds.length} ${feeds.length === 1 ? "source" : "sources"} · ${newToday} new today`}
          back={<PageBack href="/library" label="Library" />}
          trailing={<FolderActions folder={folder} feedCount={feeds.length} afterDelete="redirect" />}
        />

        {feeds.length === 0 ? (
          <EmptyState
            icon={<FolderGlyph />}
            title={`Nothing in ${folder.title} yet`}
            action={<OpenAddButton label="Add a source" folderId={folderId} variant="primary" />}
          />
        ) : (
          <>
            <section aria-labelledby="sources-heading" className="mt-6">
              <div className="flex items-center justify-between border-b border-line pb-1">
                <h2 id="sources-heading" className="t-eyebrow text-muted">
                  Sources
                </h2>
                <OpenAddButton label="Add a source" folderId={folderId} />
              </div>
              <div className="flex flex-col">
                {feeds.map((feed) => (
                  <SourceRow
                    key={feed.id}
                    feedId={feed.id}
                    title={feed.title}
                    categoryId={folderId}
                    folders={moveTargets}
                    stats={stats[feed.id]}
                    activity={activity[feed.id]}
                    problem={feed.problem}
                  />
                ))}
              </div>
              {muteCandidate && (
                <MuteSuggestion
                  feedTitle={muteCandidate.title}
                  volumePerDay={stats[muteCandidate.id].volumePerDay}
                  openRatePct={Math.round((stats[muteCandidate.id].openRate as number) * 100)}
                />
              )}
            </section>

            <section aria-labelledby="stories-heading" className="mt-10">
              <h2 id="stories-heading" className="sr-only">
                Stories
              </h2>
              {visibleItems.length === 0 ? (
                <EmptyState icon={<FolderGlyph />} title={`Nothing in ${folder.title} yet`} />
              ) : (
                <div className="flex flex-col pb-6">
                  {visibleItems.map((item) => (
                    <StoryRow key={item.id} item={item} />
                  ))}
                  {hasMore && (
                    <Link
                      href={`/folder/${folderId}?all=1`}
                      className="tap mt-6 flex h-11 w-full items-center justify-center rounded-md bg-surface-3 t-button text-ink-2 hover:bg-surface-2"
                    >
                      Show all stories in {folder.title}
                    </Link>
                  )}
                </div>
              )}
            </section>
          </>
        )}
      </ListPage>
    </RefreshableList>
  );
}
