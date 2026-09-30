-- Admin mail (verification, welcome) that became an article before
-- classification existed.
--
-- Hiding these used to be derived at query time from the matching row in
-- app.inbound_message. That coupling was wrong: pressing Dismiss on the
-- address card deletes the message, the derived exclusion disappears with
-- it, and both emails sprang back into the Newsletters list as issues.
-- Which is exactly what happened, twice.
--
-- Whether an article should be shown is a property of the article, so it
-- lives on the article and survives whatever happens to the message.
alter table app.article
  add column if not exists hidden boolean not null default false;

create index if not exists article_hidden_idx on app.article (hidden) where hidden;
