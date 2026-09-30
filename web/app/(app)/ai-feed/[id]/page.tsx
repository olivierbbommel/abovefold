import { notFound } from "next/navigation";
import { Sparkles } from "lucide-react";
import { aiFeedById, aiFeedItems } from "@/lib/ai-feeds";
import { positiveIntParam } from "@/lib/route-params";
import StoryRow from "@/app/components/StoryRow";
import RefreshableList from "@/app/components/RefreshableList";
import AiFeedActions from "@/app/components/AiFeedActions";
import PageBack from "@/app/components/reader/PageBack";

// Always fresh: a standing query keeps matching new articles as they arrive.
export const dynamic = "force-dynamic";

const RESULT_LIMIT = 50;

export default async function AiFeedPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const feedId = positiveIntParam(id);
  if (feedId === null) notFound();

  const feed = await aiFeedById(feedId);
  if (!feed) notFound();

  // Ranks app.article_ai.embedding against feed.embedding, already stored.
  // NO embedding call happens on this page view. See lib/ai-feeds.ts.
  const result = await aiFeedItems(feedId, RESULT_LIMIT);
  const items = result?.items ?? [];
  const hasStrongMatch = result?.hasStrongMatch ?? false;

  return (
    <RefreshableList className="flex-1 min-w-0 flex">
      <main className="flex-1 min-w-0 px-5 pb-[calc(50px+env(safe-area-inset-bottom)+40px)] pt-[calc(env(safe-area-inset-top)+8px)] lg:px-10 lg:pb-12 lg:pt-8">
        <div className="mx-auto max-w-[720px]">
          <header>
            <PageBack href="/folders" label="Library" />
            <div className="flex items-start gap-2">
              <h1 className="min-w-0 flex-1 t-display text-ink">{feed.name}</h1>
              <AiFeedActions feed={feed} iconClassName="h-4 w-4" />
            </div>
            <p className="mt-1.5 flex min-w-0 items-center gap-1.5 t-meta text-muted">
              <Sparkles className="h-3 w-3 shrink-0 text-ai" strokeWidth={2} aria-hidden="true" />
              <span className="truncate">&ldquo;{feed.query}&rdquo;</span>
            </p>
          </header>

          <section aria-label="Stories" className="mt-6 border-t border-line">
            {items.length === 0 ? (
              <div className="flex flex-col items-center gap-2 pb-16 pt-24 text-center">
                <Sparkles className="mb-1 h-6 w-6 text-faint" strokeWidth={1.75} aria-hidden="true" />
                <p className="t-title text-ink-2">Nothing matched yet</p>
                <p className="max-w-[300px] t-body text-muted text-pretty">
                  New stories are checked against this feed as they arrive. Check back later, or rename it with a
                  broader query.
                </p>
              </div>
            ) : (
              <div className="flex flex-col">
                {/* Semantic ranking always returns something: the nearest
                    vectors exist whether or not they answer the query. Say
                    so rather than presenting near misses as a match. */}
                {!hasStrongMatch && (
                  <p className="pt-3 t-caption text-muted">Nothing matched closely. These are the nearest stories.</p>
                )}
                {items.map((item) => (
                  <StoryRow key={item.id} item={item} />
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
    </RefreshableList>
  );
}
