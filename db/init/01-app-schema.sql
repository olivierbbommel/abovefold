create extension if not exists vector;
create schema if not exists app;

create table if not exists app.article (
  id              bigserial primary key,
  miniflux_id     bigint unique not null,
  feed_id         bigint not null,
  url             text not null,
  title           text not null,
  author          text,
  published_at    timestamptz not null,
  extracted_text  text,
  extract_status  text not null default 'pending',  -- pending|ok|fallback|failed
  lead_image      text,
  word_count      int,
  lang            text,
  created_at      timestamptz not null default now()
);
create index if not exists article_published_idx on app.article (published_at desc);
create index if not exists article_feed_idx on app.article (feed_id);

create table if not exists app.article_ai (
  article_id   bigint primary key references app.article(id) on delete cascade,
  summary      text,
  bullets      jsonb,
  topics       text[],
  embedding    vector(1536),
  model        text not null,
  cost_usd     numeric(10,6) not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists article_ai_embedding_idx
  on app.article_ai using hnsw (embedding vector_cosine_ops);
create index if not exists article_ai_created_idx on app.article_ai (created_at);

create table if not exists app.cluster (
  id                    bigserial primary key,
  canonical_article_id  bigint not null references app.article(id) on delete cascade,
  created_at            timestamptz not null default now()
);

create table if not exists app.article_cluster (
  article_id  bigint primary key references app.article(id) on delete cascade,
  cluster_id  bigint not null references app.cluster(id) on delete cascade,
  similarity  real not null
);
create index if not exists article_cluster_cluster_idx on app.article_cluster (cluster_id);

create table if not exists app.interaction (
  id          bigserial primary key,
  article_id  bigint not null references app.article(id) on delete cascade,
  action      text not null,           -- opened|skipped|read_later|archived|hidden_source
  dwell_ms    int,
  created_at  timestamptz not null default now()
);
create index if not exists interaction_article_idx on app.interaction (article_id);
create index if not exists interaction_created_idx on app.interaction (created_at desc);

create table if not exists app.score (
  article_id      bigint primary key references app.article(id) on delete cascade,
  relevance       real not null,
  source_affinity real not null,
  novelty         real not null,
  recency         real not null,
  noise_penalty   real not null,
  final_score     real not null,
  reason          text,
  computed_at     timestamptz not null default now()
);
create index if not exists score_final_idx on app.score (final_score desc);

create table if not exists app.sync_state (
  id            int primary key default 1,
  last_entry_id bigint not null default 0,
  updated_at    timestamptz not null default now(),
  constraint sync_state_singleton check (id = 1)
);
insert into app.sync_state (id) values (1) on conflict do nothing;
