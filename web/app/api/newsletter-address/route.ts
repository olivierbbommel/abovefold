import { NextRequest, NextResponse } from "next/server";
import {
  addressFor,
  attachFeed,
  createAddress,
  deleteAddress,
  listAddresses,
} from "@/lib/newsletter";
import { deleteFeed, updateFeed } from "@/lib/miniflux";

/*
 * Create and remove inbound newsletter addresses.
 *
 * Creating one also subscribes Miniflux to the address's generated feed, so
 * a newsletter becomes an ordinary source the moment the address exists , 
 * folders, unread counts, renaming and deleting all work on it unchanged.
 *
 * Behind the session cookie (this route is NOT in middleware's exempt list).
 */

export const dynamic = "force-dynamic";

function minifluxBaseUrl(): string {
  return process.env.MINIFLUX_URL ?? "http://miniflux:8080";
}

function minifluxToken(): string {
  const token = process.env.MINIFLUX_API_TOKEN;
  if (!token) throw new Error("MINIFLUX_API_TOKEN environment variable is not set");
  return token;
}

/*
 * The URL Miniflux will poll. Deliberately the internal compose address, not
 * the public one: the token authorises the feed, and keeping the URL on the
 * Docker bridge means it is never reachable from the internet and never
 * appears in a request that leaves this host.
 */
function internalFeedUrl(token: string): string {
  const base = process.env.ABOVEFOLD_INTERNAL_URL ?? "http://web:3000";
  return `${base.replace(/\/+$/, "")}/api/newsletter/${encodeURIComponent(token)}`;
}

export async function GET() {
  const addresses = await listAddresses();
  return NextResponse.json({
    addresses: addresses.map((address) => ({
      token: address.token,
      label: address.label,
      email: addressFor(address.token),
      minifluxFeedId: address.minifluxFeedId,
      createdAt: address.createdAt.toISOString(),
      lastReceivedAt: address.lastReceivedAt?.toISOString() ?? null,
      messageCount: address.messageCount,
    })),
  });
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (typeof parsed !== "object" || parsed === null) throw new Error("not an object");
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "body must be a JSON object" }, { status: 400 });
  }

  const label = typeof body.label === "string" ? body.label.trim() : "";
  if (label.length === 0) {
    return NextResponse.json({ error: "label is required" }, { status: 400 });
  }

  let categoryId: number | undefined;
  if (body.categoryId !== undefined && body.categoryId !== null) {
    categoryId = Number(body.categoryId);
    if (!Number.isInteger(categoryId) || categoryId <= 0) {
      return NextResponse.json({ error: "categoryId must be a positive integer" }, { status: 400 });
    }
  }

  const address = await createAddress(label);

  // Subscribe Miniflux to the generated feed. The feed is empty until the
  // first newsletter lands, which Miniflux accepts, an Atom document with
  // no entries is valid.
  let feedId: number | null = null;
  try {
    const response = await fetch(`${minifluxBaseUrl()}/v1/feeds`, {
      method: "POST",
      headers: { "X-Auth-Token": minifluxToken(), "Content-Type": "application/json" },
      body: JSON.stringify({
        feed_url: internalFeedUrl(address.token),
        ...(categoryId !== undefined ? { category_id: categoryId } : {}),
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (response.ok) {
      feedId = Number(((await response.json()) as { feed_id: number }).feed_id);
      await attachFeed(address.id, feedId);
      // Miniflux titles a feed from its <title>, which is right, but set it
      // explicitly so the source reads as the newsletter's name immediately
      // rather than after the first fetch.
      await updateFeed(feedId, { title: address.label });
    }
  } catch {
    // Fall through: the address exists and will collect mail either way.
    // Reported below so the UI can say the source needs adding by hand.
  }

  return NextResponse.json({
    token: address.token,
    label: address.label,
    email: addressFor(address.token),
    minifluxFeedId: feedId,
    feedCreated: feedId !== null,
  });
}

export async function DELETE(request: NextRequest) {
  const token = new URL(request.url).searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "token is required" }, { status: 400 });
  }

  const address = await deleteAddress(token);
  if (!address) {
    return NextResponse.json({ error: "unknown address" }, { status: 404 });
  }

  // Stored messages go with the address (ON DELETE CASCADE). Remove the
  // Miniflux feed too, otherwise it stays behind polling a 404.
  if (address.minifluxFeedId !== null) {
    try {
      await deleteFeed(address.minifluxFeedId);
    } catch {
      // The address is already gone; a stale feed is visible and removable
      // from the sources list, so this is not worth failing the request over.
    }
  }

  return NextResponse.json({ deleted: true });
}
