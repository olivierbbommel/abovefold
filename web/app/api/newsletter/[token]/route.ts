import { NextRequest, NextResponse } from "next/server";
import { publicUrl } from "@/lib/public-url";
import { addressByToken, recentMessages } from "@/lib/newsletter";
import { sanitizeHtml } from "@/lib/sanitize-html";

/*
 * The generated Atom feed for one inbound address.
 *
 * Miniflux fetches this over the compose network at
 * http://web:3000/api/newsletter/<token>, so the token never leaves the
 * Docker bridge and this route is not reachable from the internet at all.
 * It is exempt from the session cookie in middleware.ts because Miniflux
 * has no session; possession of the token is the only authorisation, which
 * is why mintToken() makes it unguessable.
 */

export const dynamic = "force-dynamic";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function publicBaseUrl(): string {
  return publicUrl();
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const address = await addressByToken(token);
  if (!address) {
    return new NextResponse("unknown address", { status: 404 });
  }

  const messages = await recentMessages(address.id);
  const base = publicBaseUrl();
  const updated = (address.lastReceivedAt ?? address.createdAt).toISOString();

  const entries = messages
    .map((message) => {
      const when = (message.sentAt ?? message.receivedAt).toISOString();
      const link = `${base}/newsletter/${encodeURIComponent(token)}/${message.id}`;
      // The body carried here is what the worker's extractor falls back to
      // when it cannot fetch a better version, so it must be the real thing.
      const body = message.html
        ? sanitizeHtml(message.html)
        : `<pre>${escapeXml(message.bodyText ?? "")}</pre>`;
      const author = message.fromName ?? message.fromAddress ?? address.label;
      return [
        `  <entry>`,
        `    <id>urn:abovefold:message:${message.id}</id>`,
        `    <title type="text">${escapeXml(message.subject)}</title>`,
        `    <link rel="alternate" type="text/html" href="${escapeXml(link)}"/>`,
        `    <updated>${when}</updated>`,
        `    <published>${when}</published>`,
        `    <author><name>${escapeXml(author)}</name></author>`,
        `    <content type="html">${escapeXml(body)}</content>`,
        `  </entry>`,
      ].join("\n");
    })
    .join("\n");

  const feed = [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<feed xmlns="http://www.w3.org/2005/Atom">`,
    `  <id>urn:abovefold:address:${address.id}</id>`,
    `  <title type="text">${escapeXml(address.label)}</title>`,
    `  <subtitle type="text">Delivered by email to ${escapeXml(address.token)}</subtitle>`,
    `  <updated>${updated}</updated>`,
    `  <link rel="self" href="${escapeXml(`${base}/api/newsletter/${encodeURIComponent(token)}`)}"/>`,
    `  <generator>abovefold</generator>`,
    entries,
    `</feed>`,
  ].join("\n");

  return new NextResponse(feed, {
    status: 200,
    headers: {
      "Content-Type": "application/atom+xml; charset=utf-8",
      // Miniflux polls this on its own schedule; nothing else should cache it.
      "Cache-Control": "no-store",
    },
  });
}
