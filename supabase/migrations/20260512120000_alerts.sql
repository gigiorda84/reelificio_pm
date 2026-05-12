-- Sprint 3 — Alert engine.
--
-- Two MVP rules from BP §6: buffer < threshold per page, and phase stuck > 24h
-- on a reel with no comments. Alerts are deduplicated by `dedup_key` while
-- open. Closing an alert requires a `proposed_solution` per BP §6.2.

create type alert_kind as enum ('buffer_low', 'phase_stuck');
create type alert_status as enum ('open', 'closed');

-- Extend notification_event so the dispatcher can route phase-stuck alerts
-- through the standard channel-prefs flow. (`buffer_alert` already exists.)
alter type notification_event add value if not exists 'phase_stuck_alert';

create table alerts (
  id uuid primary key default gen_random_uuid(),
  kind alert_kind not null,
  dedup_key text not null,
  page_id uuid references pages(id) on delete cascade,
  reel_id uuid references reels(id) on delete cascade,
  phase pipeline_phase,
  payload jsonb not null default '{}'::jsonb,
  status alert_status not null default 'open',
  opened_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by uuid references profiles(id) on delete set null,
  proposed_solution text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index alerts_status_idx on alerts(status, opened_at desc);
create index alerts_page_idx on alerts(page_id);
create index alerts_reel_idx on alerts(reel_id);

-- One open alert per dedup_key at a time. Reopen after close uses a new row.
create unique index alerts_one_open_per_dedup
  on alerts(dedup_key)
  where status = 'open';

create trigger trg_alerts_updated_at
  before update on alerts
  for each row execute function set_updated_at();

alter table alerts enable row level security;

-- All authenticated users can read alerts (they affect the whole pipeline).
create policy alerts_read_auth on alerts
  for select to authenticated using (true);

-- Only admins can close alerts (and they must provide proposed_solution at
-- the application layer; enforced again here by a check).
create policy alerts_admin_update on alerts
  for update to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin));

-- Inserts happen via the service-role cron handler; deny direct client inserts.
-- (No insert policy → not insertable by `authenticated`.)
