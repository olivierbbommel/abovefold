-- The PWA needs the source name without joining Miniflux's schema, and
-- --rescore needs it to regenerate explanations.
alter table app.article add column if not exists feed_title text;
