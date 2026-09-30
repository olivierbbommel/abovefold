-- API spend incurred by the web app itself, search and AI Feed query
-- embeddings. Distinct from app.article_ai (one row per article, owned by
-- the worker): a search query has no article_id. worker/abovefold_worker/
-- store.py's month_to_date_spend() sums this table alongside
-- app.article_ai so the monthly cost cap sees ONE true total instead of
-- silently excluding embeddings made from the web app (see web/lib/
-- api-spend.ts and web/lib/embed.ts).
create table if not exists app.api_spend (
  id          bigserial primary key,
  kind        text not null,
  cost_usd    numeric(14,10) not null,
  created_at  timestamptz not null default now()
);
create index if not exists api_spend_created_idx on app.api_spend (created_at);
