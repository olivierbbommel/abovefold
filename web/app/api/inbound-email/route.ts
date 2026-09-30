import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import {
  MAX_HTML_BYTES,
  addressByToken,
  classifyMessage,
  inboundDomain,
  storeMessage,
} from "@/lib/newsletter";

/*
 * Delivery target for the Cloudflare Email Worker (see workers/abovefold-email/).
 *
 * Many hosts block inbound port 25, so mail does not reach the
 * box directly. Cloudflare Email Routing accepts it, an Email Worker parses
 * the MIME, and posts the result here.
 *
 * Exempt from the session cookie in middleware.ts, Cloudflare has no session.
 * Authorised by a shared secret instead, compared in constant time.
 */

export const dynamic = "force-dynamic";

const MAX_SUBJECT = 500;

function authorised(request: NextRequest): boolean {
  const expected = process.env.ABOVEFOLD_INBOUND_SECRET;
  if (!expected || expected.length < 16) return false; // unset means closed

  const presented = request.headers.get("x-abovefold-secret") ?? "";
  const expectedBuf = Buffer.from(expected);
  const presentedBuf = Buffer.from(presented);
  if (expectedBuf.length !== presentedBuf.length) return false;
  return timingSafeEqual(expectedBuf, presentedBuf);
}

/**
 * The local part of whichever recipient belongs to our inbound domain.
 * A newsletter often lands with the real subscriber in To: and us in Cc:,
 * or arrives via a list that rewrites To: entirely, so check them all.
 */
function localPartFor(recipients: string[]): string | null {
  const domain = inboundDomain().toLowerCase();
  for (const raw of recipients) {
    const address = raw.toLowerCase().trim().replace(/^.*<|>.*$/g, "");
    const at = address.lastIndexOf("@");
    if (at === -1) continue;
    if (address.slice(at + 1) !== domain) continue;
    // Strip any plus-tag the sender added, so foo+bar@ still finds foo.
    const local = address.slice(0, at);
    const plus = local.indexOf("+");
    return plus === -1 ? local : local.slice(0, plus);
  }
  return null;
}

function asString(value: unknown, limit: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, limit);
}

export async function POST(request: NextRequest) {
  if (!authorised(request)) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (typeof parsed !== "object" || parsed === null) throw new Error("not an object");
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "body must be a JSON object" }, { status: 400 });
  }

  const recipients = Array.isArray(body.to)
    ? body.to.filter((value): value is string => typeof value === "string")
    : typeof body.to === "string"
      ? [body.to]
      : [];

  const local = localPartFor(recipients);
  if (!local) {
    return NextResponse.json({ error: "no recipient on the inbound domain" }, { status: 400 });
  }

  const address = await addressByToken(local);
  if (!address) {
    // A real case, not an error: Email Routing is catch-all, so mail to a
    // deleted or never-created address lands here. Drop it with a 200 so
    // Cloudflare does not retry, and so a sender cannot probe which
    // addresses exist by watching for failures.
    return NextResponse.json({ accepted: false, reason: "unknown address" }, { status: 200 });
  }

  const subject = asString(body.subject, MAX_SUBJECT) ?? "(no subject)";
  const html = asString(body.html, MAX_HTML_BYTES);
  const bodyText = asString(body.text, MAX_HTML_BYTES);
  if (!html && !bodyText) {
    return NextResponse.json({ accepted: false, reason: "empty body" }, { status: 200 });
  }

  // Fall back to a deterministic key so a message without a Message-ID still
  // dedupes on resend, instead of arriving fresh every time.
  const messageId =
    asString(body.messageId, 400) ?? `abovefold:${address.id}:${subject}:${(html ?? bodyText)!.length}`;

  const sentRaw = asString(body.date, 60);
  const sentAt = sentRaw ? new Date(sentRaw) : null;

  const stored = await storeMessage(address.id, {
    kind: classifyMessage(subject),
    messageId,
    subject,
    fromName: asString(body.fromName, 200),
    fromAddress: asString(body.from, 320),
    html,
    bodyText,
    sentAt: sentAt && !Number.isNaN(sentAt.getTime()) ? sentAt : null,
  });

  return NextResponse.json({ accepted: stored, duplicate: !stored }, { status: 200 });
}
