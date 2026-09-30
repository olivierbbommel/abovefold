-- Small per-article costs round to zero at numeric(10,6): an embedding is
-- ~$0.00004. Widen, and record the models and tokens actually used so spend
-- is auditable rather than inferred.
alter table app.article_ai alter column cost_usd type numeric(14,10);
alter table app.article_ai add column if not exists summary_model text;
alter table app.article_ai add column if not exists embed_cost_usd numeric(14,10) not null default 0;
alter table app.article_ai add column if not exists prompt_tokens int;
alter table app.article_ai add column if not exists completion_tokens int;
alter table app.article_ai add column if not exists summary_attempts int not null default 0;
create index if not exists article_ai_needs_summary_idx
  on app.article_ai (article_id) where summary is null;
