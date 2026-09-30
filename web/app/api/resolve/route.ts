import { NextRequest, NextResponse } from "next/server";
import { discoverFeeds, type DiscoverResult } from "@/lib/discover";
import { nameCandidates, nameSlugs, parseInput } from "@/lib/resolve-input";
import { readingHostList } from "@/lib/reading-discovery";
import { allFeeds } from "@/lib/miniflux";
import { fetchChecked, mapLimit, refused } from "@/lib/safe-fetch";

/*
 * The smart Add box. Accepts whatever was typed: a URL, a bare domain, a
 * subreddit, a YouTube handle, or a publication's name.
 *
 * A name is turned into candidate sites mechanically (lib/resolve-input.ts),
 * preferring sites the owner's own reading already links to. Nothing here
 * comes from a list we chose: the owner curates their own sources.
 */
export const dynamic = "force-dynamic";

export type ResolveMatch = {
  host: string;
  label: string;
  from: "typed" | "reading" | "guess";
  result: DiscoverResult;
};

export type ResolveResponse = {
  input: ReturnType<typeof parseInput>["kind"];
  matches: ResolveMatch[];
  alreadyFollowing: { feedId: number; title: string }[];
};

const MAX_NAME_TRIES = 3;

function hostOf(url: string): string {
  try {
    return new URL(url.includes("://") ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Does anything answer at this host? A 403 counts: the site exists, it just blocks robots. */
async function siteExists(host: string): Promise<boolean> {
  try {
    const res = await fetchChecked(new URL(`https://${host}/`), { timeoutMs: 5000 });
    if (refused(res)) return false;
    // Only the status matters; do not leave the body streaming.
    await res.body?.cancel().catch(() => {});
    return res.status < 500 && res.status !== 404;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  let q = "";
  try {
    const body = await request.json();
    q = typeof body?.q === "string" ? body.q.slice(0, 300) : "";
  } catch {
    return NextResponse.json({ error: "body must be valid JSON" }, { status: 400 });
  }
  const parsed = parseInput(q);
  if (parsed.kind === "empty") {
    return NextResponse.json({ error: "type a name or paste a link" }, { status: 400 });
  }

  const feeds = await allFeeds().catch(() => []);
  // What counts as "you already follow this" depends on what was typed. The
  // first version matched a subreddit by its host ("r"), so "r/worldnews"
  // claimed you already followed an unrelated feed with "r" in its name.
  const key =
    parsed.kind === "name"
      ? parsed.name.toLowerCase()
      : parsed.kind === "subreddit"
        ? parsed.label.toLowerCase()
        : parsed.kind === "youtube"
          ? parsed.label.split(" ")[0].toLowerCase()
          : hostOf(parsed.url).toLowerCase();
  // Hosts compare exactly, ignoring www./feeds./rss. prefixes: a substring
  // test said "week.com" was already followed because theweek.com is.
  const bareHost = (h: string) => h.toLowerCase().replace(/^(www|feeds?|rss)\./, "");
  const feedHosts = (f: (typeof feeds)[number]) =>
    [f.site_url, f.feed_url].map((u) => {
      try {
        return bareHost(new URL(u ?? "").hostname);
      } catch {
        return "";
      }
    });
  const alreadyFollowing =
    key.length < 3
      ? []
      : feeds
          .filter((f) => {
            if (parsed.kind === "name") return f.title.toLowerCase().includes(key);
            if (parsed.kind === "subreddit") return new RegExp(`/${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(/|\\.|$)`, "i").test(f.feed_url);
            if (parsed.kind === "youtube") return `${f.title} ${f.site_url ?? ""} ${f.feed_url}`.toLowerCase().includes(key);
            return feedHosts(f).includes(bareHost(key));
          })
          .slice(0, 3)
          .map((f) => ({ feedId: f.id, title: f.title }));

  if (parsed.kind !== "name") {
    const outcome = await discoverFeeds(parsed.url);
    if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: 400 });
    const label = parsed.kind === "url" ? hostOf(parsed.url) : parsed.label;
    const body: ResolveResponse = {
      input: parsed.kind,
      matches: [{ host: hostOf(parsed.url), label, from: "typed", result: outcome.result }],
      alreadyFollowing,
    };
    return NextResponse.json(body);
  }

  const reading = await readingHostList().catch(() => []);
  const candidates = nameCandidates(parsed.name, reading, 10);
  const alive = await mapLimit(candidates, 4, async (c) => ((await siteExists(c.host)) ? c : null));

  // One host per slug. theatlantic.com (which the owner's reading links to)
  // and theatlantic.net (an unrelated site) are the same slug: the first one
  // that answers wins, and reading hosts are always tried first. Without this
  // a parked domain that happened to have a feed outranked the real paper.
  const slugOf = (host: string) => host.split(".")[0].replace(/-/g, "");
  const slugs = new Set(nameSlugs(parsed.name).map((x) => x.replace(/-/g, "")));
  const perSlug = new Map<string, (typeof candidates)[number]>();
  for (const c of alive) {
    if (!c) continue;
    const slug = slugOf(c.host);
    if (c.from === "guess" && !slugs.has(slug)) continue;
    if (!perSlug.has(slug)) perSlug.set(slug, c);
  }
  const toTry = [...perSlug.values()].slice(0, MAX_NAME_TRIES);

  const results: (ResolveMatch | null)[] = await Promise.all(
    toTry.map(async (c): Promise<ResolveMatch | null> => {
      const outcome = await discoverFeeds(c.host);
      return outcome.ok ? { host: c.host, label: c.host, from: c.from, result: outcome.result } : null;
    })
  );

  // Order: the owner's reading first, then sites with a feed. Same feed twice
  // (theguardian.com and .co.uk) is shown once.
  const seenFeeds = new Set<string>();
  const matches = results
    .filter((m): m is ResolveMatch => m !== null && m.result.kind !== "unavailable")
    .sort(
      (a, b) =>
        Number(b.from === "reading") - Number(a.from === "reading") ||
        Number(b.result.kind === "found") - Number(a.result.kind === "found")
    )
    .filter((m) => {
      const feed = m.result.candidates[0]?.url.replace(/^https?:\/\/(www\.)?/, "");
      if (!feed) return true;
      if (seenFeeds.has(feed)) return false;
      seenFeeds.add(feed);
      return true;
    });

  const body: ResolveResponse = { input: "name", matches, alreadyFollowing };
  return NextResponse.json(body);
}
