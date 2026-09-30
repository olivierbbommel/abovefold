-- A newsletter does not have to arrive by email.
--
-- Many newsletters publish RSS, so they get subscribed as ordinary feeds and
-- land in a folder. The Newsletters section only knew about feeds behind an
-- inbound address, so it showed "0 issues" while the issues sat elsewhere,
-- with nowhere to open them from. Email is the fallback for publishers
-- with no feed; it is not what makes something a newsletter.
--
-- This records "the user considers this feed a newsletter", independent of
-- how it is delivered.
create table if not exists app.newsletter_feed (
  miniflux_feed_id bigint primary key,
  added_at         timestamptz not null default now()
);
