-- Sources the user has permanently dismissed from the "Suggested" block on
-- a folder page (see web/lib/suggestions.ts). Presence of a row means
-- suggestionsForFolder() must never offer that feed URL again, in any
-- folder, dismissal isn't scoped to the folder it happened to appear in.
create table if not exists app.dismissed_suggestion (
  feed_url     text primary key,
  dismissed_at timestamptz not null default now()
);
