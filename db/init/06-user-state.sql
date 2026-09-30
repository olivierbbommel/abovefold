-- Singleton row marking whether the (single) user has completed onboarding.
-- Same shape as app.sync_state (03/04): id fixed at 1, updated in place.
create table if not exists app.user_state (
  id           int primary key default 1,
  onboarded_at timestamptz,
  constraint user_state_singleton check (id = 1)
);
insert into app.user_state (id) values (1) on conflict do nothing;
