-- Not every email to a newsletter address is an issue. The first two are
-- almost never: a "verify your address" and a "thanks for subscribing". Those
-- must not become articles (they were landing in Today and Newsletters as if
-- they were reading), but they must stay reachable, because the verification
-- link inside is exactly what the user needs to click.
--
--   issue  what the sender publishes; served in the feed
--   admin  verification, welcome, confirmation; kept, shown on the address card
alter table app.inbound_message
  add column if not exists kind text not null default 'issue';
create index if not exists inbound_message_kind_idx
  on app.inbound_message (address_id, kind, received_at desc);
