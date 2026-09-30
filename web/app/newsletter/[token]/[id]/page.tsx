import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { pool } from "@/lib/db";
import { addressByToken } from "@/lib/newsletter";
import { sanitizeHtml } from "@/lib/sanitize-html";
import { positiveIntParam } from "@/lib/route-params";
import { cleanAuthor, longDate } from "@/lib/reader-format";
import RemoteImages from "@/app/components/RemoteImages";

/*
 * One newsletter issue, as it was sent.
 *
 * Exempt from the session cookie in middleware.ts, authorised by the address
 * token in the path instead. Two readers need it and neither has a session:
 * the worker fetches this URL to extract the article text, and Miniflux
 * records it as the entry's link. The token is unguessable and scoped to a
 * single address, so the blast radius of a leaked URL is one newsletter,
 * which the user can revoke by deleting the address.
 *
 * The HTML is attacker-influenced (anyone who learns the address can mail
 * arbitrary markup to it), so it goes through lib/sanitize-html.ts first.
 * Typography follows the reader (spec 5.3); the sent HTML keeps its own
 * layout inside .newsletter-body.
 */

export const dynamic = "force-dynamic";

type Row = {
  subject: string;
  from_name: string | null;
  from_address: string | null;
  html: string | null;
  body_text: string | null;
  sent_at: Date | null;
  received_at: Date;
};

export default async function NewsletterMessagePage({
  params,
}: {
  params: Promise<{ token: string; id: string }>;
}) {
  const { token, id } = await params;
  const messageId = positiveIntParam(id);
  if (messageId === null) notFound();

  const address = await addressByToken(token);
  if (!address) notFound();

  const { rows } = await pool.query<Row>(
    `select subject, from_name, from_address, html, body_text, sent_at, received_at
       from app.inbound_message
      where id = $1 and address_id = $2`,
    [messageId, address.id],
  );
  const message = rows[0];
  if (!message) notFound();

  const when = message.sent_at ?? message.received_at;
  // A byline never shows an email address (spec 5.3): the sender's display
  // name, else the name the address was given.
  const sender = cleanAuthor(message.from_name, address.label);

  // Images are deferred (data-src, no src) and loaded only on request; the
  // sender's hosts are frequently behind bot protection that refuses our
  // proxy, and loading unasked is a read receipt. Tracking pixels are gone
  // entirely. See SanitizeOptions.deferImages.
  const bodyHtml = message.html ? sanitizeHtml(message.html, { deferImages: true }) : null;
  const imageCount = bodyHtml ? (bodyHtml.match(/ data-src="/g) ?? []).length : 0;

  return (
    <main className="min-h-screen bg-bg">
      <div className="mx-auto w-full max-w-[720px] px-5 pb-24 pt-[calc(env(safe-area-inset-top)+8px)] lg:px-8 lg:pt-8">
        <Link
          href="/newsletters"
          className="tap -ml-2 inline-flex h-11 items-center gap-0.5 rounded-sm pl-1 pr-2 t-button font-medium text-ink-2 hover:bg-surface-2"
        >
          <ChevronLeft className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
          Newsletters
        </Link>

        <h1 className="mt-3 t-reader-title text-ink">{message.subject}</h1>
        <p className="mt-3 flex flex-wrap items-center gap-x-1.5 t-meta text-faint">
          <span className="text-muted">{address.label}</span>
          {sender && (
            <>
              <span aria-hidden="true">·</span>
              <span>{sender}</span>
            </>
          )}
          <span aria-hidden="true">·</span>
          <time dateTime={when.toISOString()}>{longDate(when.toISOString())}</time>
        </p>

        <RemoteImages count={imageCount} />

        <div className="mt-6 border-t border-hairline pt-6">
          {bodyHtml ? (
            <div className="newsletter-body" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
          ) : (
            <pre className="whitespace-pre-wrap break-words t-reader text-ink">{message.body_text}</pre>
          )}
        </div>
      </div>
    </main>
  );
}
