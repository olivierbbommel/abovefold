import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRight, Folder, Library, Mail, SlidersHorizontal, Sparkles } from "lucide-react";
import { listAiFeeds } from "@/lib/ai-feeds";
import { newsletterFeedIds } from "@/lib/newsletter";
import { cachedFeedsByCategory, cachedFolders, newTodayByFolder, newsletterUnread } from "@/lib/nav-queries";
import EmptyState from "@/app/components/EmptyState";
import { AutoMarkReadToggle } from "@/app/components/MarkReadOnScroll";
import ListPage from "@/app/components/nav/ListPage";
import PageHeader from "@/app/components/nav/PageHeader";
import AddButton from "@/app/components/nav/AddButton";
import NewFolderRow from "@/app/components/nav/NewFolderRow";

export const dynamic = "force-dynamic";

/*
 * Library (spec 5.6): where sources live. Phone tab; on desktop the rail
 * already lists all of this, and /library renders the same page in the
 * content column. Inset grouped lists of 52px rows: folders (each opens its
 * folder page, count = new in the last 24h), Newsletters, AI feeds, and the
 * one reading preference. Rename, move and unfollow live on the folder page.
 */
export default async function LibraryPage() {
  const [folders, byCategory, newToday, aiFeeds, newsletterIds] = await Promise.all([
    cachedFolders(),
    cachedFeedsByCategory(),
    newTodayByFolder().catch(() => ({}) as Record<number, number>),
    listAiFeeds(),
    newsletterFeedIds(),
  ]);
  const newsletterCount = await newsletterUnread(newsletterIds);
  const sourceCount = Object.values(byCategory).flat().length;

  return (
    <ListPage>
      <PageHeader
        title="Library"
        subtitle={`${folders.length} ${folders.length === 1 ? "folder" : "folders"} · ${sourceCount} ${
          sourceCount === 1 ? "source" : "sources"
        }`}
        trailing={<AddButton />}
      />

      {folders.length === 0 ? (
        <EmptyState
          icon={<Library />}
          title="No sources yet"
          body="Follow one and a folder is created for it."
          actionHref="/add"
          actionLabel="Add a source"
        />
      ) : (
        <div className="flex flex-col gap-7 pb-8 pt-6">
          <Group label="Folders">
            {folders.map((folder) => {
              const count = newToday[folder.id] ?? 0;
              return (
                <Row
                  key={folder.id}
                  href={`/folder/${folder.id}`}
                  icon={<Folder className="h-[18px] w-[18px] text-muted" strokeWidth={1.75} aria-hidden="true" />}
                  label={folder.title}
                  count={count}
                  countLabel={`${count} new today`}
                />
              );
            })}
            <NewFolderRow />
          </Group>

          <Group label="Newsletters">
            <Row
              href="/newsletters"
              icon={<Mail className="h-[18px] w-[18px] text-muted" strokeWidth={1.75} aria-hidden="true" />}
              label="Newsletters"
              count={newsletterCount}
              countLabel={`${newsletterCount} unread`}
            />
          </Group>

          {aiFeeds.length > 0 && (
            <Group label="AI feeds">
              {aiFeeds.map((feed) => (
                <Row
                  key={feed.id}
                  href={`/ai-feed/${feed.id}`}
                  icon={<Sparkles className="h-[18px] w-[18px] text-ai" strokeWidth={1.75} aria-hidden="true" />}
                  label={feed.name}
                />
              ))}
            </Group>
          )}

          <Group label="Reading">
            <li>
              <AutoMarkReadToggle
                icon={<SlidersHorizontal className="h-[18px] w-[18px] shrink-0 text-muted" strokeWidth={1.75} aria-hidden="true" />}
                className="min-h-[52px] px-4 t-body text-ink"
              />
            </li>
          </Group>
        </div>
      )}
    </ListPage>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="px-1 pb-2 t-eyebrow text-muted">{label}</h2>
      <ul className="inset-group overflow-hidden rounded-lg border border-line bg-surface">{children}</ul>
    </section>
  );
}

function Row({
  href,
  icon,
  label,
  count = 0,
  countLabel,
}: {
  href: string;
  icon: ReactNode;
  label: string;
  count?: number;
  countLabel?: string;
}) {
  return (
    <li>
      <Link href={href} className="inset-row flex min-h-[52px] items-center gap-3 px-4 t-body text-ink">
        {icon}
        <span className="inset-row-label flex min-h-[52px] min-w-0 flex-1 items-center gap-3">
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {count > 0 && (
            <span className="t-meta text-faint" aria-label={countLabel}>
              {count}
            </span>
          )}
          <ChevronRight className="h-4 w-4 shrink-0 text-faint" strokeWidth={2} aria-hidden="true" />
        </span>
      </Link>
    </li>
  );
}
