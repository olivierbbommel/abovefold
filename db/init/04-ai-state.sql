-- Separates ingestion from paid AI work. An article stays 'pending' until it
-- has been embedded, so an embed failure, a rate limit, or a tripped cost cap
-- leaves it retryable instead of silently orphaned forever.
alter table app.article add column if not exists ai_state text not null default 'pending';
-- pending | skipped (prefiltered) | done
create index if not exists article_ai_state_idx on app.article (ai_state) where ai_state = 'pending';

-- Backfill: anything that already has an embedding is done; the 8 prefiltered
-- rows have no article_ai row and go back in the queue for the recalibrated
-- prefilter to judge again.
update app.article a set ai_state = 'done'
  where exists (select 1 from app.article_ai ai where ai.article_id = a.id);
