import { pool } from "@/lib/db";
import { allFeeds } from "@/lib/miniflux";

/*
 * "From your reading": sites the owner's sources keep pointing at, that they
 * do not already follow. No editorial input anywhere: every row is derived
 * from app.article.
 *
 * A story counts as a LINK-OUT only when its site differs from its own feed's
 * home site. The home site of a feed is the host most of its stories live on.
 * Without that rule, feeds you used to follow top the list with their own
 * articles, which is "sources you removed", not "sites your reading points
 * at".
 */

export const WINDOW_DAYS = 60;
export const MIN_APPEARANCES = 2;

/*
 * Platforms, not publications. Filtering these is not curation: nobody
 * "follows github.com". Keep this list to hosting and social sites only.
 */
const PLATFORMS =
  /(^|\.)(github\.com|gitlab\.com|youtube\.com|youtu\.be|x\.com|twitter\.com|reddit\.com|ycombinator\.com|linkedin\.com|facebook\.com|instagram\.com|tiktok\.com|wikipedia\.org|google\.com|apple\.com|bsky\.app|t\.co|bit\.ly|archive\.org|archive\.ph|docs\.google\.com)$/;

export type ReadingSite = {
  host: string;
  appearances: number;
  opened: number;
  via: string[];
  lastSeen: string;
  status: "found" | "none" | "blocked" | "unavailable" | null;
  feedUrl: string | null;
  feedTitle: string | null;
};

function hostOf(u: string): string | null {
  const m = u.match(/^https?:\/\/([^/:]+)/i);
  return m ? m[1].toLowerCase().replace(/^www\./, "") : null;
}

export async function followedHosts(): Promise<Set<string>> {
  const feeds = await allFeeds().catch(() => []);
  const hosts = new Set<string>();
  for (const f of feeds) {
    for (const u of [f.site_url, f.feed_url]) {
      const h = u ? hostOf(u) : null;
      if (h) {
        hosts.add(h);
        // feeds.macrumors.com follows macrumors.com, not a different site.
        hosts.add(h.replace(/^(feeds?|rss|blog)\./, ""));
      }
    }
  }
  return hosts;
}

export async function readingSites(limit = 30): Promise<ReadingSite[]> {
  const [followed, { rows }] = await Promise.all([
    followedHosts(),
    pool.query<{
      host: string;
      appearances: number;
      opened: number;
      via: string[];
      last_seen: Date;
      status: ReadingSite["status"];
      feed_url: string | null;
      feed_title: string | null;
    }>(
      `with art as (
         select a.id, a.feed_id, a.feed_title, a.published_at,
                lower(regexp_replace(substring(a.url from '^https?://([^/:]+)'), '^www\\.', '')) as host
           from app.article a
          where a.published_at > now() - make_interval(days => $1) and not a.hidden),
       home as (
         select feed_id, mode() within group (order by host) as home from art group by feed_id),
       linkout as (
         select art.* from art join home using (feed_id) where art.host <> home.home)
       select l.host,
              count(distinct l.id)::int as appearances,
              count(distinct i.article_id) filter (where i.action = 'opened')::int as opened,
              array_agg(distinct l.feed_title) filter (where l.feed_title is not null) as via,
              max(l.published_at) as last_seen,
              -- A cached answer older than 14 days is returned as unchecked, so the
              -- catalog shows the site again and checks it afresh.
              case when d.checked_at < now() - interval '14 days' then null else d.status end as status,
              case when d.checked_at < now() - interval '14 days' then null else d.feed_url end as feed_url,
              case when d.checked_at < now() - interval '14 days' then null else d.feed_title end as feed_title
         from linkout l
         left join app.interaction i on i.article_id = l.id
         left join app.discovered_site d on d.host = l.host
        where l.host is not null
          and not exists (select 1 from app.dismissed_site x where x.host = l.host)
          and (d.status is null or d.status <> 'none' or d.checked_at < now() - interval '14 days')
        group by l.host, d.status, d.feed_url, d.feed_title, d.checked_at
       having count(distinct l.id) >= $2
        order by count(distinct l.id) + 3 * count(distinct i.article_id) filter (where i.action = 'opened') desc, max(l.published_at) desc
        limit $3`,
      [WINDOW_DAYS, MIN_APPEARANCES, limit * 3]
    ),
  ]);

  return rows
    .filter((r) => !followed.has(r.host) && !PLATFORMS.test(r.host))
    .slice(0, limit)
    .map((r) => ({
      host: r.host,
      appearances: r.appearances,
      opened: r.opened,
      via: r.via ?? [],
      lastSeen: r.last_seen.toISOString(),
      status: r.status,
      feedUrl: r.feed_url,
      feedTitle: r.feed_title,
    }));
}

/** All hosts the owner's reading has linked to recently, for matching typed names. */
export async function readingHostList(): Promise<string[]> {
  const sites = await readingSites(200).catch(() => []);
  return sites.map((s) => s.host);
}

export async function cacheSiteCheck(
  host: string,
  status: NonNullable<ReadingSite["status"]>,
  feedUrl: string | null,
  feedTitle: string | null
): Promise<void> {
  await pool.query(
    `insert into app.discovered_site (host, status, feed_url, feed_title, checked_at)
     values ($1, $2, $3, $4, now())
     on conflict (host) do update set status = excluded.status, feed_url = excluded.feed_url,
       feed_title = excluded.feed_title, checked_at = now()`,
    [host, status, feedUrl, feedTitle]
  );
}

export async function dismissSite(host: string): Promise<void> {
  await pool.query(`insert into app.dismissed_site (host) values ($1) on conflict do nothing`, [host]);
}
