import { NextRequest, NextResponse } from "next/server";
import { discoverFeeds } from "@/lib/discover";
import { cacheSiteCheck, readingHostList } from "@/lib/reading-discovery";
import { mapLimit } from "@/lib/safe-fetch";

/*
 * Check a small batch of sites for a readable feed and cache the answer.
 * Called by the catalog after it renders, so the list appears immediately and
 * feed status fills in progressively instead of the page waiting on a dozen
 * slow sites.
 *
 * Only hosts already in the owner's catalog are checked. The catalog is
 * built from links inside articles, which outsiders write, so this endpoint
 * must not become a way to point the server at an arbitrary list of hosts.
 */
export const dynamic = "force-dynamic";

const MAX_BATCH = 6;
const HOST = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

export async function POST(request: NextRequest) {
  let hosts: string[] = [];
  try {
    const body = await request.json();
    hosts = Array.isArray(body?.hosts) ? body.hosts : [];
  } catch {
    return NextResponse.json({ error: "body must be valid JSON" }, { status: 400 });
  }
  if (hosts.length > MAX_BATCH) return NextResponse.json({ error: "too many hosts in one batch" }, { status: 400 });
  const catalog = new Set(await readingHostList());
  const valid = [...new Set(hosts.filter((h) => typeof h === "string" && h.length <= 253 && HOST.test(h) && catalog.has(h)))];

  const results = await mapLimit(valid, 3, async (host) => {
    const outcome = await discoverFeeds(host);
    if (!outcome.ok) {
      await cacheSiteCheck(host, "none", null, null);
      return { host, status: "none" as const, feedUrl: null, feedTitle: null };
    }
    const r = outcome.result;
    const top = r.candidates[0] ?? null;
    // "unavailable" is a network failure that may be transient: do not
    // cache it, or one bad minute would bury the site for good.
    if (r.kind !== "unavailable") await cacheSiteCheck(host, r.kind, top?.url ?? null, top?.title ?? null);
    return { host, status: r.kind, feedUrl: top?.url ?? null, feedTitle: top?.title ?? null, preview: r.preview };
  });
  return NextResponse.json({ results });
}
