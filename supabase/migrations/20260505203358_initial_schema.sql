-- Reellificio PM — initial schema
-- Sprint 0 foundation: users, pages, batches, reels, voice briefs, RACI, comments, notifications.
-- Conventions:
--   * All tables in `public` schema.
--   * Primary keys are uuid (gen_random_uuid).
--   * Foreign keys cascade on delete unless noted otherwise.
--   * Timestamps in `timestamptz`; `created_at` defaults to now().
--   * RLS enabled on every table; permissive policies added incrementally as features land.

-------------------------------------------------------------------------------
-- Enums
-------------------------------------------------------------------------------

create type user_role as enum (
  'admin',
  'core',
  'producer',
  'editor',
  'smm',
  'external',
  'viewer'
);

create type pipeline_phase as enum (
  'research',
  'script_validation',
  'dubbing',
  'editing',
  'qc',
  'publish_queue',
  'published'
);

create type phase_status as enum ('green', 'yellow', 'red');

create type reel_format as enum (
  'porcino_mono',
  'papaya_mono',
  'botta_e_risposta',
  'duo',
  'other'
);

create type reel_category as enum ('safe', 'adapted', 'test');

create type batch_status as enum ('draft', 'active', 'closed');

create type comment_target as enum ('reel', 'batch', 'voice_brief');

create type notification_channel as enum ('email', 'telegram', 'whatsapp', 'in_app');

create type notification_event as enum (
  'mention',
  'assignment',
  'phase_approval_request',
  'phase_approved',
  'phase_rejected',
  'buffer_alert',
  'kpi_alert',
  'daily_reminder',
  'weekly_digest'
);

-------------------------------------------------------------------------------
-- Profiles (1:1 with auth.users)
-------------------------------------------------------------------------------

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  is_admin boolean not null default false,
  daily_reminder_at time without time zone default '18:00',
  telegram_chat_id text,
  whatsapp_phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Auto-create a profile row whenever a new auth user is created.
create or replace function handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', null)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function handle_new_auth_user();

-------------------------------------------------------------------------------
-- Pages
-------------------------------------------------------------------------------

create table pages (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  code_prefix char(2) not null unique,
  description text,
  buffer_threshold smallint not null default 3,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table page_members (
  page_id uuid not null references pages(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role user_role not null,
  created_at timestamptz not null default now(),
  primary key (page_id, user_id)
);

create index page_members_user_idx on page_members(user_id);

-------------------------------------------------------------------------------
-- Voice briefs (1:1 per page)
-------------------------------------------------------------------------------

create table voice_briefs (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null unique references pages(id) on delete cascade,
  adjectives text[] not null default '{}',
  reference_audio_urls text[] not null default '{}',
  banned_words text[] not null default '{}',
  allowed_liberties text,
  anomaly_procedure text,
  version integer not null default 1,
  updated_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-------------------------------------------------------------------------------
-- RACI config (per page, per phase)
-------------------------------------------------------------------------------

create table raci_configs (
  page_id uuid not null references pages(id) on delete cascade,
  phase pipeline_phase not null,
  responsible uuid[] not null default '{}',
  approver uuid[] not null default '{}',
  consulted uuid[] not null default '{}',
  informed uuid[] not null default '{}',
  primary key (page_id, phase)
);

-------------------------------------------------------------------------------
-- Batches & reels
-------------------------------------------------------------------------------

create table batches (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references pages(id) on delete cascade,
  label text not null,
  source_doc_url text,
  source_doc_id text,
  source_doc_synced_at timestamptz,
  source_doc_revision_id text,
  status batch_status not null default 'draft',
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index batches_page_idx on batches(page_id);

create table reels (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references batches(id) on delete cascade,
  page_id uuid not null references pages(id) on delete cascade,
  code text not null unique,
  ordinal smallint not null,
  title text not null,
  format reel_format not null default 'other',
  category reel_category not null default 'adapted',

  hook text,
  corpo text,
  chiusura text,
  cta text,
  notes text,
  raw_content text,
  parser_warning text,

  phase pipeline_phase not null default 'research',
  phase_status phase_status not null default 'green',
  phase_entered_at timestamptz not null default now(),

  audio_drive_url text,
  video_drive_url text,
  caption text,
  scheduled_at timestamptz,
  posted_url text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index reels_batch_idx on reels(batch_id);
create index reels_phase_idx on reels(phase);

create table reel_assignments (
  reel_id uuid not null references reels(id) on delete cascade,
  phase pipeline_phase not null,
  user_id uuid not null references profiles(id) on delete cascade,
  primary key (reel_id, phase, user_id)
);

-------------------------------------------------------------------------------
-- Comments
-------------------------------------------------------------------------------

create table comments (
  id uuid primary key default gen_random_uuid(),
  target_type comment_target not null,
  target_id uuid not null,
  parent_id uuid references comments(id) on delete cascade,
  author_id uuid references profiles(id) on delete set null,
  body text not null,
  mentions uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index comments_target_idx on comments(target_type, target_id);
create index comments_author_idx on comments(author_id);

-------------------------------------------------------------------------------
-- Notifications
-------------------------------------------------------------------------------

create table notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references profiles(id) on delete cascade,
  event notification_event not null,
  channel notification_channel not null,
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_recipient_idx on notifications(recipient_id, read_at);

create table notification_prefs (
  user_id uuid not null references profiles(id) on delete cascade,
  event notification_event not null,
  channel notification_channel not null,
  enabled boolean not null default true,
  primary key (user_id, event, channel)
);

-------------------------------------------------------------------------------
-- Magic-link invites for external collaborators
-------------------------------------------------------------------------------

create table magic_link_invites (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  reel_id uuid references reels(id) on delete cascade,
  batch_id uuid references batches(id) on delete cascade,
  page_id uuid references pages(id) on delete cascade,
  scope text not null,
  phase pipeline_phase,
  invitee_email text,
  invitee_phone text,
  created_by uuid references profiles(id) on delete set null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index magic_link_invites_reel_idx on magic_link_invites(reel_id);

-------------------------------------------------------------------------------
-- updated_at triggers
-------------------------------------------------------------------------------

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_profiles_updated_at      before update on profiles      for each row execute function set_updated_at();
create trigger trg_pages_updated_at         before update on pages         for each row execute function set_updated_at();
create trigger trg_voice_briefs_updated_at  before update on voice_briefs  for each row execute function set_updated_at();
create trigger trg_batches_updated_at       before update on batches       for each row execute function set_updated_at();
create trigger trg_reels_updated_at         before update on reels         for each row execute function set_updated_at();
create trigger trg_comments_updated_at      before update on comments      for each row execute function set_updated_at();

-------------------------------------------------------------------------------
-- RLS — baseline policies (admin-write, authenticated-read for most tables)
-------------------------------------------------------------------------------

alter table profiles            enable row level security;
alter table pages               enable row level security;
alter table page_members        enable row level security;
alter table voice_briefs        enable row level security;
alter table raci_configs        enable row level security;
alter table batches             enable row level security;
alter table reels               enable row level security;
alter table reel_assignments    enable row level security;
alter table comments            enable row level security;
alter table notifications       enable row level security;
alter table notification_prefs  enable row level security;
alter table magic_link_invites  enable row level security;

create policy profiles_read_authenticated on profiles
  for select to authenticated using (true);

create policy profiles_update_self on profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy pages_read_auth on pages
  for select to authenticated using (true);

create policy pages_admin_write on pages
  for all to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin));

create policy page_members_read_auth on page_members
  for select to authenticated using (true);

create policy page_members_admin_write on page_members
  for all to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin));

create policy voice_briefs_read_auth on voice_briefs
  for select to authenticated using (true);

create policy voice_briefs_admin_write on voice_briefs
  for all to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin));

create policy raci_configs_read_auth on raci_configs
  for select to authenticated using (true);

create policy raci_configs_admin_write on raci_configs
  for all to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin));

create policy batches_read_auth on batches
  for select to authenticated using (true);

create policy batches_admin_write on batches
  for all to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin));

create policy reels_read_auth on reels
  for select to authenticated using (true);

create policy reels_write_auth on reels
  for all to authenticated
  using (true)
  with check (true);

create policy reel_assignments_read_auth on reel_assignments
  for select to authenticated using (true);

create policy reel_assignments_admin_write on reel_assignments
  for all to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin));

create policy comments_read_auth on comments
  for select to authenticated using (true);

create policy comments_insert_self on comments
  for insert to authenticated with check (author_id = auth.uid());

create policy comments_update_own on comments
  for update to authenticated using (author_id = auth.uid()) with check (author_id = auth.uid());

create policy comments_delete_own on comments
  for delete to authenticated using (author_id = auth.uid());

create policy notifications_recipient_read on notifications
  for select to authenticated using (recipient_id = auth.uid());

create policy notifications_recipient_update on notifications
  for update to authenticated using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());

create policy notification_prefs_self on notification_prefs
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy magic_link_invites_admin_all on magic_link_invites
  for all to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin));
