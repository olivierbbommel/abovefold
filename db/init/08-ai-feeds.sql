-- AI Feeds: a natural-language query saved as a standing search that keeps
-- matching new articles as they arrive (Feedly Pro+'s headline feature).
-- The query is embedded ONCE, at save time (see web/lib/embed.ts's
-- embedQuery and the POST handler in web/app/api/ai-feeds/route.ts), the
-- embedding is stored here and reused forever, never re-embedded on view.
create table if not exists app.ai_feed (
  id          bigserial primary key,
  name        text not null,
  query       text not null,
  embedding   vector(1536) not null,
  created_at  timestamptz not null default now()
);
