import Link from "next/link";
import { notFound } from "next/navigation";
import { Sparkles } from "lucide-react";
import { pool } from "@/lib/db";
import { articleById, clusterSiblings } from "@/lib/queries";
import { entryStarred } from "@/lib/miniflux";
import { displayName } from "@/lib/display-name";
import { proxied } from "@/lib/img";
import { cleanAuthor, longDate, readingMinutes, shortDate } from "@/lib/reader-format";
import { positiveIntParam } from "@/lib/route-params";
import ArticleBody from "@/app/components/ArticleBody";
import FeedIcon from "@/app/components/FeedIcon";
import Img from "@/app/components/Img";
import ArticleBackButton from "@/app/components/ArticleBackButton";
import { ReaderEndActions, ReaderToolbar } from "@/app/components/ArticleActions";
import DwellTracker from "@/app/components/DwellTracker";
import ReaderTopBar from "@/app/components/reader/ReaderTopBar";
import ReaderTitle from "@/app/components/reader/ReaderTitle";

/*
 * The reader (spec 5.3). It lives inside the (app) group so the rail stays
 * on desktop and the tab bar stays on the phone: the reader is content
 * pushed onto a tab, not a modal.
 *
 * Everything is fetched before anything renders, so the title is in the
 * first commit of this page. The route's loading.tsx renders the same bar
 * and the same title (when it can read it off the row you tapped), which is
 * what lets the headline morph into place (see ReaderTitle).
 */

export default async function ArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const articleId = positiveIntParam(id);
  if (articleId === null) notFound();

  const article = await articleById(articleId);
  if (!article) notFound();

  const [siblings, minifluxIdResult] = await Promise.all([
    article.clusterId ? clusterSiblings(article.clusterId, article.id) : Promise.resolve([]),
    pool.query<{ miniflux_id: string }>(`select miniflux_id from app.article where id = $1`, [article.id]),
  ]);
  const minifluxId = Number(minifluxIdResult.rows[0]?.miniflux_id ?? 0);
  // Read-only: shows the saved state on the bookmark. A Miniflux hiccup
  // must not take the article down with it.
  const saved = minifluxId ? await entryStarred(minifluxId).catch(() => false) : false;

  const source = displayName(article.feedTitle);
  const author = cleanAuthor(article.author, source);
  const mins = readingMinutes(article.extractedText);
  const image = proxied(article.leadImage, article.url, 1280);
  const actionProps = { articleId: article.id, minifluxId, saved, url: article.url, title: article.title };

  return (
    <main className="reader flex-1 min-w-0 bg-bg">
      <DwellTracker articleId={article.id} />

      <ReaderTopBar>
        <ArticleBackButton articleId={article.id} />
        <ReaderToolbar {...actionProps} />
      </ReaderTopBar>

      <div className="reader-column px-5 lg:px-10">
        <div className="mx-auto max-w-[640px] pt-3 lg:pt-10">
          <ReaderTitle id={article.id}>{article.title}</ReaderTitle>

          <p className="reader-byline mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 t-meta text-faint">
            <span className="flex min-w-0 items-center gap-1.5">
              <FeedIcon feedId={article.feedId} title={article.feedTitle} size={16} radius={4} />
              <span className="truncate text-muted" title={article.feedTitle}>
                {source}
              </span>
            </span>
            {author && (
              <>
                <span aria-hidden="true">·</span>
                <span className="min-w-0 truncate">{author}</span>
              </>
            )}
            <span aria-hidden="true">·</span>
            <time dateTime={article.publishedAt}>
              <span className="lg:hidden">{shortDate(article.publishedAt)}</span>
              <span className="hidden lg:inline">{longDate(article.publishedAt)}</span>
            </time>
            <span aria-hidden="true">·</span>
            <span>{mins} min</span>
          </p>

          {/* Same proxy as the list, so the image is never hotlinked. The
              body is plain extracted text with no images of its own, so the
              lead image never repeats one further down. No placeholder
              fill: an image that fails takes its space with it (Img). */}
          {image && (
            <Img
              src={image}
              alt=""
              width={640}
              height={360}
              referrerPolicy="no-referrer"
              className="mt-5 aspect-[16/9] w-full rounded-md object-cover"
            />
          )}

          {/* The screen's one indigo region: what the AI wrote. */}
          {article.summary && (
            <section aria-label="Summary" className="mt-5 rounded-lg bg-ai-bg p-4">
              <div className="flex items-center gap-1.5 text-ai">
                <Sparkles className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                <span className="t-eyebrow">Summary</span>
              </div>
              <p className="reader-summary mt-2 text-ai-ink">{article.summary}</p>
              {article.bullets && article.bullets.length > 0 && (
                <ul className="mt-3 flex flex-col gap-2">
                  {article.bullets.map((bullet, i) => (
                    <li key={i} className="reader-summary flex items-start gap-2.5 text-ai-ink">
                      <span className="mt-[0.55rem] h-1 w-1 shrink-0 rounded-full bg-ai" aria-hidden="true" />
                      {bullet}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {siblings.length > 0 && (
            <div className="mt-5 flex min-w-0 items-center gap-2.5 border-y border-hairline">
              <span className="flex shrink-0 py-3" aria-hidden="true">
                {siblings.slice(0, 3).map((sibling, i) => (
                  <span key={sibling.id} className={`inline-flex rounded-xs ring-2 ring-bg ${i > 0 ? "-ml-1" : ""}`}>
                    <FeedIcon feedId={sibling.feedId} title={sibling.feedTitle} size={16} radius={4} />
                  </span>
                ))}
              </span>
              <span className="min-w-0 flex-1 truncate t-meta text-muted">
                Also covered by {siblings.length} {siblings.length === 1 ? "source" : "sources"} you follow
              </span>
              <Link
                href={`/article/${siblings[0].id}`}
                className="tap -mr-2 flex h-11 shrink-0 items-center rounded-sm px-2 t-meta font-semibold text-accent"
              >
                Compare
              </Link>
            </div>
          )}

          <ArticleBody text={article.extractedText} title={article.title} />

          <ReaderEndActions {...actionProps} />
        </div>
      </div>
    </main>
  );
}
