import { Suspense } from "react";
import { SlidersHorizontal, Sun } from "lucide-react";
import { briefForToday } from "@/lib/queries";
import {
  TODAY_LIMIT,
  cachedFeedsByCategory,
  cachedFolders,
  cachedTodayItems,
  todayMix,
  folderFilterCounts,
  type MixEntry,
} from "@/lib/nav-queries";
import { todayHref, type TodaySort } from "@/lib/url";
import type { Folder, Item } from "@/lib/types";
import StoryRow from "@/app/components/StoryRow";
import Brief from "@/app/components/Brief";
import EmptyState from "@/app/components/EmptyState";
import { SkeletonBrief, SkeletonLead, SkeletonRow } from "@/app/components/Skeleton";
import RefreshableList from "@/app/components/RefreshableList";
import MarkAllRead from "@/app/components/MarkAllRead";
import MarkReadOnScroll from "@/app/components/MarkReadOnScroll";
import PageHeader from "@/app/components/nav/PageHeader";
import AddButton from "@/app/components/nav/AddButton";
import FilterSheet from "@/app/components/nav/FilterSheet";
import FolderPullDown from "@/app/components/nav/FolderPullDown";
import SortControl from "@/app/components/nav/SortControl";
import RefreshButton from "@/app/components/nav/RefreshButton";
import ShowMore from "@/app/components/nav/ShowMore";
import EnterOnRefresh from "@/app/components/nav/EnterOnRefresh";

// Always fresh: this is a live feed, not a static page.
export const dynamic = "force-dynamic";

/*
 * Today (spec 5.1). One route, one title: /today redirects here, and the
 * rest of the list is revealed in place by "Show N more" instead of on a
 * second page that was also called Today (audit A6).
 *
 * Every query starts here in parallel and is awaited only inside the
 * Suspense boundary that needs it, so the title paints at once and the list,
 * the controls and the right rail stream in behind their own skeletons.
 */

/** Rows shown under the lead before "Show N more". */
const VISIBLE_ROWS = 8;

// The reader's time zone (ABOVEFOLD_TIMEZONE, default UTC). Without this the
// date under "Today" is yesterday's for the first eight hours of every day.
const TIME_ZONE = process.env.ABOVEFOLD_TIMEZONE || "UTC";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; folder?: string }>;
}) {
  const { sort: sortParam, folder: folderParam } = await searchParams;
  const sort: TodaySort = sortParam === "newest" ? "newest" : "ranked";
  // A ?folder= that isn't a positive integer is no filter at all, never a
  // crash and never a silent "0 stories" from a hand-edited URL.
  const folderParamId = folderParam && /^\d+$/.test(folderParam) ? Number(folderParam) : null;

  const foldersPromise = cachedFolders();
  // A stale folder id (deleted, hand-edited) quietly falls back to no filter
  // instead of claiming a filter that nothing backs.
  const activeFolderPromise = foldersPromise.then((folders) => folders.find((f) => f.id === folderParamId) ?? null);
  const itemsPromise = itemsFor(sort, activeFolderPromise);
  const mixPromise = todayMix();
  const filterCountsPromise = folderFilterCounts();
  const briefPromise = briefForToday();

  const dateLabel = new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: TIME_ZONE,
  });

  return (
    <div className="flex min-w-0 flex-1">
      <MarkReadOnScroll />
      <RefreshableList className="flex min-w-0 flex-1">
        <main className="page-main">
          <div className="page-column">
            <PageHeader
              title="Today"
              subtitle={
                <Suspense fallback={<span>{dateLabel}</span>}>
                  <Subtitle itemsPromise={itemsPromise} activeFolderPromise={activeFolderPromise} dateLabel={dateLabel} />
                </Suspense>
              }
              trailing={
                <>
                  <div className="flex items-center lg:hidden">
                    <Suspense fallback={<StaticFilterButton />}>
                      <PhoneFilter
                        foldersPromise={foldersPromise}
                        activeFolderPromise={activeFolderPromise}
                        mixPromise={filterCountsPromise}
                        sort={sort}
                      />
                    </Suspense>
                    <AddButton />
                  </div>
                  <div className="hidden items-center gap-2 lg:flex">
                    <SortControl sort={sort} folderId={folderParamId} />
                    <Suspense fallback={<div className="h-7 w-[112px] rounded-sm border border-line" />}>
                      <DesktopFilter
                        foldersPromise={foldersPromise}
                        activeFolderPromise={activeFolderPromise}
                        mixPromise={filterCountsPromise}
                        sort={sort}
                      />
                    </Suspense>
                    <RefreshButton />
                  </div>
                </>
              }
            />

            <Suspense fallback={<ListSkeleton />}>
              <TodayList itemsPromise={itemsPromise} activeFolderPromise={activeFolderPromise} sort={sort} />
            </Suspense>
          </div>
        </main>
      </RefreshableList>

      <Suspense fallback={<SkeletonBrief />}>
        <RightRail briefPromise={briefPromise} itemsPromise={itemsPromise} mixPromise={mixPromise} />
      </Suspense>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="pb-6">
      <SkeletonLead />
      {Array.from({ length: 6 }).map((_, i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  );
}

function StaticFilterButton() {
  return (
    <span className="flex h-11 w-11 items-center justify-center text-ink-2" aria-hidden="true">
      <SlidersHorizontal className="h-[22px] w-[22px]" strokeWidth={1.75} />
    </span>
  );
}

async function Subtitle({
  itemsPromise,
  activeFolderPromise,
  dateLabel,
}: {
  itemsPromise: Promise<Item[]>;
  activeFolderPromise: Promise<Folder | null>;
  dateLabel: string;
}) {
  const [items, activeFolder] = await Promise.all([itemsPromise, activeFolderPromise]);
  return (
    <span>
      {dateLabel}
      {activeFolder && (
        <>
          {" · "}
          <span className="font-medium text-ink-2">{activeFolder.title}</span>
        </>
      )}
      {" · "}
      {items.length} {items.length === 1 ? "story" : "stories"}
    </span>
  );
}

async function TodayList({
  itemsPromise,
  activeFolderPromise,
  sort,
}: {
  itemsPromise: Promise<Item[]>;
  activeFolderPromise: Promise<Folder | null>;
  sort: TodaySort;
}) {
  const [items, activeFolder] = await Promise.all([itemsPromise, activeFolderPromise]);

  if (items.length === 0) {
    return activeFolder ? (
      <EmptyState
        icon={<Sun />}
        title={`Nothing new in ${activeFolder.title}`}
        body="Clear the filter to see everything else."
        actionHref={todayHref({ sort, folderId: null })}
        actionLabel="Show all folders"
      />
    ) : (
      <EmptyState icon={<Sun />} title="Nothing new in the last 48 hours" body="Pull to refresh, or open Library to follow more." />
    );
  }

  const [lead, ...rest] = items;
  const visible = rest.slice(0, VISIBLE_ROWS);
  const hidden = rest.slice(VISIBLE_ROWS);

  return (
    // Keyed on the view, so switching sort or folder is a fresh list (no
    // entrance animation), while a refresh of the same view animates only
    // the stories that are new.
    <EnterOnRefresh key={`${sort}:${activeFolder?.id ?? "all"}`} className="pb-6">
      <StoryRow item={lead} variant="lead" />
      {visible.map((item) => (
        <StoryRow key={item.id} item={item} />
      ))}
      <ShowMore
        rows={hidden.map((item) => (
          <StoryRow key={item.id} item={item} />
        ))}
        end={
          <span className="hidden lg:inline-flex">
            <MarkAllRead categoryId={activeFolder?.id} scopeName={activeFolder?.title} />
          </span>
        }
      />
    </EnterOnRefresh>
  );
}

async function PhoneFilter({
  foldersPromise,
  activeFolderPromise,
  mixPromise,
  sort,
}: {
  foldersPromise: Promise<Folder[]>;
  activeFolderPromise: Promise<Folder | null>;
  mixPromise: Promise<MixEntry[]>;
  sort: TodaySort;
}) {
  const [folders, activeFolder, mix] = await Promise.all([foldersPromise, activeFolderPromise, mixPromise]);
  return <FilterSheet folders={folders} activeFolderId={activeFolder?.id ?? null} sort={sort} mix={mix} />;
}

async function DesktopFilter({
  foldersPromise,
  activeFolderPromise,
  mixPromise,
  sort,
}: {
  foldersPromise: Promise<Folder[]>;
  activeFolderPromise: Promise<Folder | null>;
  mixPromise: Promise<MixEntry[]>;
  sort: TodaySort;
}) {
  const [folders, activeFolder, mix] = await Promise.all([foldersPromise, activeFolderPromise, mixPromise]);
  return <FolderPullDown folders={folders} activeFolderId={activeFolder?.id ?? null} sort={sort} mix={mix} />;
}

/*
 * The brief is deliberately NOT folder-filtered: its lines come from a
 * standalone query over every article in the last 24h, and rewriting that
 * prose per folder is out of scope for a filter. Today's mix is also the
 * unfiltered list (it describes Today, and a filtered list is one folder by
 * definition). Also covered follows the list on screen.
 */
async function RightRail({
  briefPromise,
  itemsPromise,
  mixPromise,
}: {
  briefPromise: Promise<string[]>;
  itemsPromise: Promise<Item[]>;
  mixPromise: Promise<MixEntry[]>;
}) {
  const [lines, items, mix] = await Promise.all([briefPromise, itemsPromise, mixPromise]);
  return <Brief lines={lines} items={items} mix={mix} />;
}

/** Resolves the active folder into the feed ids Today is restricted to. */
async function itemsFor(sort: TodaySort, activeFolderPromise: Promise<Folder | null>): Promise<Item[]> {
  const activeFolder = await activeFolderPromise;
  if (!activeFolder) return cachedTodayItems(TODAY_LIMIT, sort);
  const byCategory = await cachedFeedsByCategory();
  const feedIds = (byCategory[activeFolder.id] ?? []).map((f) => f.id);
  return cachedTodayItems(TODAY_LIMIT, sort, feedIds);
}
