import { Suspense } from "react";
import { MIN_QUERY_LENGTH, performSearch } from "@/lib/search";
import { cachedRecentlyReadItems } from "@/lib/nav-queries";
import SearchPageInput from "@/app/components/SearchPageInput";
import StoryRow from "@/app/components/StoryRow";
import { SkeletonRow } from "@/app/components/Skeleton";
import ListPage from "@/app/components/nav/ListPage";
import PageHeader from "@/app/components/nav/PageHeader";

// Always fresh: a result set is never something to statically cache.
export const dynamic = "force-dynamic";

/** How many recently read stories the landing shows (spec 5.8). */
const RECENT_ON_LANDING = 30;

/*
 * Search (spec 5.8). The tab is useful before a character is typed: its
 * landing page is Recently read, the best suggestion list there is. The rail
 * field on desktop navigates here with ?q=, and the server runs that first
 * search itself so the results arrive with the page.
 */
export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const query = (q ?? "").trim();
  const result = query.length >= MIN_QUERY_LENGTH ? await performSearch(query) : null;

  return (
    <ListPage>
      <PageHeader title="Search" rule={false} />
      <div className="mt-4">
        {/* Keyed on the server query: a fresh navigation here (the rail
            field) must reset any in-progress typing to the new result. */}
        <SearchPageInput
          key={query}
          initialQuery={query}
          initialResult={result}
          landing={
            <Suspense fallback={<LandingSkeleton />}>
              <RecentlyRead />
            </Suspense>
          }
        />
      </div>
    </ListPage>
  );
}

async function RecentlyRead() {
  const items = (await cachedRecentlyReadItems()).slice(0, RECENT_ON_LANDING);
  if (items.length === 0) return null;
  return (
    <section className="pt-6">
      <h2 className="t-eyebrow text-muted">Recently read</h2>
      <div className="read-list">
        {items.map((item) => (
          <StoryRow key={item.id} item={item} />
        ))}
      </div>
    </section>
  );
}

function LandingSkeleton() {
  return (
    <div className="pt-6">
      <div className="skeleton h-3 w-24" />
      {Array.from({ length: 4 }).map((_, i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  );
}
