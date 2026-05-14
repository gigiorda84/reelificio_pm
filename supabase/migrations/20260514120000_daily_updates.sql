-- Sprint 9 — Daily async update + weekly digest.
--
-- One row per (user, date). `did_today` is required; `blockers` and `tomorrow`
-- are optional. Users post their own update for "today" (their tz; we store
-- date in UTC for simplicity — Italy is UTC+1/+2 so a 16:00 UTC reminder
-- always lands the same calendar day).

create table daily_updates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  date date not null,
  did_today text not null,
  blockers text,
  tomorrow text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, date)
);

create index daily_updates_date_idx on daily_updates(date desc);
create index daily_updates_user_idx on daily_updates(user_id, date desc);

create trigger trg_daily_updates_updated_at
  before update on daily_updates
  for each row execute function set_updated_at();

alter table daily_updates enable row level security;

-- All authenticated users can read team updates.
create policy daily_updates_read_auth on daily_updates
  for select to authenticated using (true);

-- Users can insert/update/delete only their own rows.
create policy daily_updates_insert_own on daily_updates
  for insert to authenticated
  with check (user_id = auth.uid());

create policy daily_updates_update_own on daily_updates
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy daily_updates_delete_own on daily_updates
  for delete to authenticated
  using (user_id = auth.uid());
