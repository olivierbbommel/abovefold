import { Mail } from "lucide-react";
import { addressFor, listAddresses, listNewsletterFeeds } from "@/lib/newsletter";
import { newsletterItems } from "@/lib/queries";
import { folders as minifluxFolders, feedsByCategory } from "@/lib/miniflux";
import NewsletterFeedList from "@/app/components/NewsletterFeedList";
import NewsletterAddressList from "@/app/components/NewsletterAddressList";
import MarkReadOnScroll from "@/app/components/MarkReadOnScroll";
import StoryRow from "@/app/components/StoryRow";
import EmptyState from "@/app/components/EmptyState";
import RefreshableList from "@/app/components/RefreshableList";
import ListPage from "@/app/components/nav/ListPage";
import PageHeader from "@/app/components/nav/PageHeader";
import OpenAddButton from "@/app/components/reader/OpenAddButton";

/*
 * Newsletters (spec 5.7). They read differently from feeds: a newsletter is
 * a dated issue you either read or you do not, not a headline competing for
 * a slot in a ranked digest. So the issues here are chronological and
 * uncapped, where Today is ranked and limited to three per source.
 *
 * Underneath it is the ordinary article query restricted to the feeds behind
 * inbound addresses plus the feeds marked as newsletters. Newsletters are
 * feeds; only the framing here is different. Adding one opens the Add sheet
 * on its email step.
 */

export const dynamic = "force-dynamic";

export default async function NewslettersPage() {
  const [addresses, folders, rssFeedIds, byCategory] = await Promise.all([
    listAddresses(),
    minifluxFolders(),
    listNewsletterFeeds(),
    feedsByCategory(),
  ]);

  // Newsletters delivered by RSS. They live in a normal folder like any feed;
  // this section also claims them, because this is where you look.
  const rssSet = new Set(rssFeedIds);
  const rssFeeds = Object.entries(byCategory).flatMap(([catId, feeds]) =>
    feeds
      .filter((f) => rssSet.has(f.id))
      .map((f) => ({
        feedId: f.id,
        title: f.title,
        categoryTitle: folders.find((folder) => folder.id === Number(catId))?.title ?? "No folder",
        unread: f.unread,
      })),
  );
  const feedIds = [
    ...addresses.map((a) => a.minifluxFeedId).filter((id): id is number => id !== null),
    ...rssFeedIds,
  ];

  const items = feedIds.length > 0 ? await newsletterItems(feedIds, 100) : [];
  const sourceCount = addresses.length + rssFeeds.length;
  const received = addresses.reduce((sum, a) => sum + a.messageCount, 0) + rssFeeds.length;

  return (
    <RefreshableList className="flex min-w-0 flex-1">
      <ListPage>
        <MarkReadOnScroll />
        <PageHeader
          title="Newsletters"
          // newsletterItems() leaves out issues already read, so this counts
          // unread ones; calling them just "issues" would sit next to a row
          // saying "1 issue" and read as a contradiction.
          subtitle={`${sourceCount} ${sourceCount === 1 ? "newsletter" : "newsletters"} · ${items.length} unread`}
          trailing={sourceCount > 0 && <OpenAddButton label="Add newsletter" asNewsletter variant="icon" />}
        />

        {sourceCount === 0 ? (
          <EmptyState
            icon={<Mail />}
            title="No newsletters yet"
            body="Create a private address, sign up with it, and each issue arrives here as a story."
            action={<OpenAddButton label="Create an address" step="email" variant="primary" />}
          />
        ) : (
          <>
            <section aria-label="Your newsletters">
              <NewsletterFeedList feeds={rssFeeds} />
              {addresses.length > 0 && (
                <NewsletterAddressList
                  addresses={addresses.map((address) => ({
                    token: address.token,
                    label: address.label,
                    email: addressFor(address.token),
                    messageCount: address.messageCount,
                    lastReceivedAt: address.lastReceivedAt?.toISOString() ?? null,
                    pendingAdmin: address.pendingAdmin
                      ? {
                          id: address.pendingAdmin.id,
                          subject: address.pendingAdmin.subject,
                          receivedAt: address.pendingAdmin.receivedAt.toISOString(),
                        }
                      : null,
                  }))}
                />
              )}
            </section>

            {items.length === 0 ? (
              <EmptyState
                icon={<Mail />}
                title="No unread issues"
                body={
                  received > 0
                    ? undefined
                    : "Sign up with one of the addresses above. The first issue can take a day."
                }
              />
            ) : (
              <section aria-labelledby="issues-heading" className="mt-8">
                <h2 id="issues-heading" className="t-eyebrow text-muted">
                  Recent issues
                </h2>
                <div className="flex flex-col pb-6">
                  {items.map((item) => (
                    <StoryRow key={item.id} item={item} />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </ListPage>
    </RefreshableList>
  );
}
