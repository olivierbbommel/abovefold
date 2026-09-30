import { Bookmark } from "lucide-react";
import { cachedReadLaterItems } from "@/lib/nav-queries";
import StoryRow from "@/app/components/StoryRow";
import EmptyState from "@/app/components/EmptyState";
import RefreshableList from "@/app/components/RefreshableList";
import ListPage from "@/app/components/nav/ListPage";
import PageHeader from "@/app/components/nav/PageHeader";
import EnterOnRefresh from "@/app/components/nav/EnterOnRefresh";

// Always fresh: reflects live Miniflux starred state.
export const dynamic = "force-dynamic";

/* Read Later (spec 4.1: the Later tab), newest saved first. */
export default async function ReadLaterPage() {
  const items = await cachedReadLaterItems();

  return (
    <RefreshableList className="flex min-w-0 flex-1">
      <ListPage>
        <PageHeader title="Later" subtitle={`${items.length} ${items.length === 1 ? "story" : "stories"} saved`} />
        {items.length === 0 ? (
          <EmptyState icon={<Bookmark />} title="Nothing saved" body="Swipe a story to the right, or press s, to keep it here." />
        ) : (
          <EnterOnRefresh className="pb-6">
            {items.map((item) => (
              <StoryRow key={item.id} item={item} />
            ))}
          </EnterOnRefresh>
        )}
      </ListPage>
    </RefreshableList>
  );
}
