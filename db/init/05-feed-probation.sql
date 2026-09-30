-- Feeds subscribed via "Preview 30 days first" (see web/app/api/subscribe).
-- Presence of a row means the feed ranks alongside everything else but its
-- entries don't count toward "unread" the way an established source's do.
create table if not exists app.feed_probation (
  feed_id bigint primary key,
  started_at timestamptz not null default now()
);
