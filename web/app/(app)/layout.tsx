import { Suspense } from "react";
import { listAiFeeds } from "@/lib/ai-feeds";
import { newsletterFeedIds } from "@/lib/newsletter";
import {
  TODAY_LIMIT,
  cachedFeedsByCategory,
  cachedFolders,
  cachedReadLaterItems,
  cachedTodayItems,
  newTodayByFolder,
  newsletterUnread,
} from "@/lib/nav-queries";
import Rail from "@/app/components/nav/Rail";
import TabBar from "@/app/components/nav/TabBar";
import KeyboardNav from "@/app/components/KeyboardNav";
import AddSheetProvider from "@/app/components/add/AddSheetProvider";
import { SkeletonRail } from "@/app/components/Skeleton";

/*
 * Shared shell for every signed-in route except /login, /welcome, the reader
 * and the API. One navigation model (spec 4): the rail on desktop, four tabs
 * on the phone, no drawer. Rendered once here, so neither remounts on
 * navigation.
 *
 * The tab bar needs no data and renders immediately. The rail's queries all
 * start at once and stream in behind SkeletonRail. The Add sheet provider
 * wraps everything, so any plus button in the app opens the same sheet.
 */
export const dynamic = "force-dynamic";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AddSheetProvider>
      <div className="app-shell flex min-h-dvh bg-bg text-ink">
        <Suspense fallback={<SkeletonRail />}>
          <RailSection />
        </Suspense>
        {children}
      </div>
      <TabBar />
      <KeyboardNav />
    </AddSheetProvider>
  );
}

async function RailSection() {
  const [folders, byCategory, newToday, today, readLater, aiFeeds, newsletterIds] = await Promise.all([
    cachedFolders(),
    cachedFeedsByCategory(),
    newTodayByFolder().catch(() => ({}) as Record<number, number>),
    cachedTodayItems(TODAY_LIMIT, "ranked"),
    cachedReadLaterItems(),
    listAiFeeds(),
    newsletterFeedIds(),
  ]);
  const newsletterCount = await newsletterUnread(newsletterIds);

  return (
    <Rail
      folders={folders}
      feedsByCategory={byCategory}
      newToday={newToday}
      todayCount={today.length}
      readLaterCount={readLater.length}
      newsletterCount={newsletterCount}
      aiFeeds={aiFeeds}
    />
  );
}
