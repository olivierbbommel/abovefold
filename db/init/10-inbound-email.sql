-- Newsletters as feeds.
--
-- A newsletter arrives as email, and email cannot reach this box directly:
-- inbound port 25 is blocked by the provider (verified 2026-08-27 by binding
-- a listener and probing from outside, zero packets arrived). So delivery is
-- Cloudflare Email Routing -> an Email Worker -> POST /api/inbound-email.
--
-- Once a message is stored, GET /api/newsletter/<token> renders the address's
-- recent messages as an Atom feed and Miniflux subscribes to it like any other
-- source. That is the whole point of this shape: a newsletter becomes an
-- ordinary feed, so extraction, embedding, dedupe, scoring, folders, unread
-- counts and every piece of the UI work on it unchanged, with no special case
-- anywhere downstream.

create table if not exists app.inbound_address (
  id               bigserial primary key,
  -- The local part of the address. Unguessable: the feed URL is authorised by
  -- possession of this token and nothing else.
  token            text not null unique,
  label            text not null,
  miniflux_feed_id bigint,
  created_at       timestamptz not null default now(),
  last_received_at timestamptz,
  message_count    integer not null default 0
);

create table if not exists app.inbound_message (
  id           bigserial primary key,
  address_id   bigint not null references app.inbound_address(id) on delete cascade,
  -- RFC 5322 Message-ID. Mailing lists retry; without this a resend would
  -- appear as a second article.
  message_id   text not null,
  subject      text not null,
  from_name    text,
  from_address text,
  html         text,
  body_text    text,
  sent_at      timestamptz,
  received_at  timestamptz not null default now()
);

create unique index if not exists inbound_message_dedupe_idx
  on app.inbound_message (address_id, message_id);

create index if not exists inbound_message_feed_idx
  on app.inbound_message (address_id, received_at desc);
