-- "From your reading": sites the owner's own sources keep linking to.
--
-- There are no editorial picks by design: the catalog is computed entirely
-- from app.article (see web/lib/reading-discovery.ts).
-- These two tables only remember work already done:
--   discovered_site   whether a site has a readable feed, cached because
--                     checking means fetching the site (seconds, and polite
--                     to do rarely)
--   dismissed_site    sites the owner said "not interested" to
create table if not exists app.discovered_site (
  host        text primary key,
  status      text not null check (status in ('found', 'none', 'blocked', 'unavailable')),
  feed_url    text,
  feed_title  text,
  checked_at  timestamptz not null default now()
);

create table if not exists app.dismissed_site (
  host          text primary key,
  dismissed_at  timestamptz not null default now()
);
