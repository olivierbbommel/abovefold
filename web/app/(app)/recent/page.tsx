import { History } from "lucide-react";
import { cachedRecentlyReadItems } from "@/lib/nav-queries";
import StoryRow from "@/app/components/StoryRow";
import EmptyState from "@/app/components/EmptyState";
import RefreshableList from "@/app/components/RefreshableList";
import ListPage from "@/app/components/nav/ListPage";
import PageHeader from "@/app/components/nav/PageHeader";

// Always fresh: reflects live Miniflux read state.
export const dynamic = "force-dynamic";

/*
 * Recently read. On desktop it is a rail destination; on the phone the same
 * list is the Search tab's landing page (spec 4.3). Read rows get the quieter
 * headline (ink-2, 500) via the .read-list class in styles/nav.css.
 */
export default async function RecentlyReadPage() {
  const items = await cachedRecentlyReadItems();

  return (
    <RefreshableList className="flex min-w-0 flex-1">
      <ListPage>
        <PageHeader title="Recently read" subtitle={`${items.length} ${items.length === 1 ? "story" : "stories"}`} />
        {items.length === 0 ? (
          <EmptyState icon={<History />} title="Nothing read yet" body="Open a story from Today and it lands here, so you can find your way back to it." />
        ) : (
          <div className="read-list pb-6">
            {items.map((item) => (
              <StoryRow key={item.id} item={item} />
            ))}
          </div>
        )}
      </ListPage>
    </RefreshableList>
  );
}
