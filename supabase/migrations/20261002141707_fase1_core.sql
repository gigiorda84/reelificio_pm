-- Fase 1 "Produzione 2.0" — core model (docs/fase1-plan.md §S1, D1–D3).
--
-- Expand only: the Fase 0 code in production keeps working unchanged.
-- * `reels.state` (10 states) joins the legacy `reels.phase`; a trigger keeps
--   them aligned, in both directions until the contract migration (S2).
-- * Tasks are the core object: `tasks` + `task_events`, one open task per
--   reel, SLA thresholds precomputed at creation.
-- * Profiles become internal or external. Every existing profile is internal;
--   new ones are born external unless the service role says otherwise.
-- * Internal helpers live in schema `private`: PostgREST does not expose it
--   and `anon`/`authenticated` have no USAGE on it.
-- Every new public function revokes EXECUTE from public, anon and
-- authenticated, then grants explicitly (allowlist in checks/00_guards.sql).

-------------------------------------------------------------------------------
-- 1. Schema `private`
-------------------------------------------------------------------------------

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
-- Functions get EXECUTE for PUBLIC by default, and a per-schema ALTER DEFAULT
-- PRIVILEGES cannot take a global default away: each migration that adds
-- functions here ends with an explicit revoke.

-------------------------------------------------------------------------------
-- 2. Types
-------------------------------------------------------------------------------

create type reel_state as enum (
  'idea', 'bozza', 'revisione', 'validazione', 'confermato',
  'doppiaggio', 'animazione', 'approvazione_finale', 'programmato', 'pubblicato'
);
create type reel_track as enum ('batch', 'express');
create type task_kind as enum (
  'writing', 'review', 'validation', 'dubbing', 'audio_approval',
  'animation', 'final_approval', 'scheduling'
);
-- "Open" = the first three.
create type task_status as enum (
  'unassigned', 'assigned', 'in_progress',
  'delivered', 'approved', 'sent_back', 'declined', 'expired', 'cancelled'
);
create type account_type as enum ('internal', 'external');
create type external_kind as enum ('dubber', 'animator', 'validator');
create type sla_step as enum (
  'writing', 'review', 'validation', 'dubbing_accept', 'dubbing',
  'audio_approval', 'animation_accept', 'animation', 'final_approval', 'scheduling'
);
create type job_kind as enum ('notify', 'drive_reconcile');
create type reel_file_kind as enum ('audio', 'video', 'script', 'other');

-------------------------------------------------------------------------------
-- 3. State mapping (table in docs/fase1-plan.md D2)
-------------------------------------------------------------------------------

-- Macro-phase used by RACI, the legacy `phase` column and the Fase 0 code.
-- `approvazione_finale` stays in `editing`: the buffer must not count reels
-- that are not approved yet, and the DoD policy on 'editing' stays valid.
create function public.state_raci_phase(p_state reel_state)
returns pipeline_phase
language sql
immutable
set search_path = public
as $$
  select (case p_state
    when 'idea' then 'research_prescript'
    when 'bozza' then 'script_writing'
    when 'revisione' then 'script_writing'
    when 'validazione' then 'scientific_validation'
    when 'confermato' then 'dubbing'
    when 'doppiaggio' then 'dubbing'
    when 'animazione' then 'editing'
    when 'approvazione_finale' then 'editing'
    when 'programmato' then 'publication'
    when 'pubblicato' then 'publication'
  end)::pipeline_phase;
$$;

create function private.legacy_phase_to_state(p_phase pipeline_phase, p_published_at timestamptz)
returns reel_state
language sql
immutable
set search_path = public
as $$
  select (case
    when p_published_at is not null then 'pubblicato'
    else case p_phase
      when 'research_prescript' then 'idea'
      when 'scientific_validation' then 'validazione'
      when 'script_writing' then 'bozza'
      when 'dubbing' then 'doppiaggio'
      when 'editing' then 'animazione'
      when 'qc' then 'approvazione_finale'
      when 'publication' then 'programmato'
      when 'published' then 'pubblicato'
    end
  end)::reel_state;
$$;

-------------------------------------------------------------------------------
-- 4. Profiles: internal / external
-------------------------------------------------------------------------------

-- Existing profiles are internal (default at ADD COLUMN fills them); every
-- profile created from now on is external unless set otherwise explicitly.
alter table profiles add column account_type account_type not null default 'internal';
alter table profiles alter column account_type set default 'external';
alter table profiles
  add column external_kind external_kind,
  add column drive_email text,
  add column absent_until timestamptz,
  add column deactivated_at timestamptz;
alter table profiles
  add constraint profiles_admin_internal_chk check (not (is_admin and account_type = 'external')),
  add constraint profiles_external_kind_chk check (external_kind is null or account_type = 'external');

-- A Telegram chat must identify one person: group chats (negative ids) and
-- duplicates (all but the most recently updated profile) are cleared.
update profiles set telegram_chat_id = null where telegram_chat_id like '-%';
update profiles p set telegram_chat_id = null
 where p.telegram_chat_id is not null
   and exists (
     select 1 from profiles q
      where q.telegram_chat_id = p.telegram_chat_id
        and (q.updated_at, q.id) > (p.updated_at, p.id)
   );
create unique index profiles_telegram_chat_id_key
  on profiles(telegram_chat_id) where telegram_chat_id is not null;

create function public.is_internal()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.account_type = 'internal' and p.deactivated_at is null
       from profiles p where p.id = auth.uid()),
    false);
$$;

-- Actor-explicit twins for functions called by the service role, where
-- auth.uid() is null. Never executable by anon/authenticated.
create function private.is_admin_uid(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.is_admin and p.deactivated_at is null from profiles p where p.id = p_uid),
    false);
$$;

create function private.is_internal_uid(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.account_type = 'internal' and p.deactivated_at is null
       from profiles p where p.id = p_uid),
    false);
$$;

create function private.has_raci_role_uid(
  p_page_id uuid, p_phase pipeline_phase, p_role text, p_uid uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from raci_configs rc
    where rc.page_id = p_page_id
      and rc.phase = p_phase
      and p_uid = any (
        case p_role
          when 'responsible' then rc.responsible
          when 'approver' then rc.approver
          when 'consulted' then rc.consulted
          when 'informed' then rc.informed
        end
      )
  );
$$;

-- None of the ids is an external profile (RACI members and approvers are
-- internal; a deactivated internal is tolerated so old rows stay editable).
create function private.none_external(p_ids uuid[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1 from profiles p
     where p.id = any (p_ids) and p.account_type = 'external'
  );
$$;

-- The first admin of a fresh environment is internal by definition (the
-- default is now external, and an admin cannot be external).
create or replace function public.claim_admin_if_first()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return false;
  end if;
  -- Serialise concurrent claims so only one user can win.
  perform pg_advisory_xact_lock(hashtext('claim_admin_if_first'));
  if exists (select 1 from profiles where is_admin) then
    return false;
  end if;
  update profiles set is_admin = true, account_type = 'internal' where id = v_uid;
  return found;
end;
$$;

-- account_type comes only from raw_app_meta_data, which only the service role
-- can set; raw_user_meta_data is user-writable and never trusted. Scripts
-- also set it explicitly afterwards, since GoTrue may write app_metadata
-- after the insert.
create or replace function handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, account_type)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', null),
    case when new.raw_app_meta_data ->> 'account_type' = 'internal'
      then 'internal'::account_type
      else 'external'::account_type
    end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-------------------------------------------------------------------------------
-- 5. Notifications
-------------------------------------------------------------------------------

-- The recipient may only mark a notification read (the app never updates
-- anything else; before this they could rewrite the payload).
revoke update on table notifications from anon, authenticated;
grant update (read_at) on table notifications to authenticated;

-- These rows were saved with the old "Telegram off" default; task events are
-- Telegram-first now (docs/fase1-plan.md §3). The report counts them.
delete from notification_prefs
 where event in ('assignment', 'phase_approval_request', 'phase_rejected');

-------------------------------------------------------------------------------
-- 6. Global switches, Telegram link tokens
-------------------------------------------------------------------------------

create table app_config (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id) on delete set null
);
insert into app_config (key, value) values
  ('escalation_enabled', 'false'),
  ('standup_enabled', 'false'),
  ('drive_enabled', 'false');

create table telegram_link_tokens (
  token_hash text primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

-------------------------------------------------------------------------------
-- 7. Approvers
-------------------------------------------------------------------------------

create table approval_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  approver_id uuid references profiles(id) on delete set null,
  delegate_id uuid references profiles(id) on delete set null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint approval_groups_distinct_chk
    check (approver_id is null or delegate_id is null or approver_id <> delegate_id)
);
create unique index approval_groups_one_default on approval_groups(is_default) where is_default;
create trigger trg_approval_groups_updated_at
  before update on approval_groups for each row execute function set_updated_at();

-- The approver is set by the admin after the migration (fase1-prod-config.sql).
insert into approval_groups (name, is_default) values ('Tutte le pagine', true);

create function private.approval_groups_check()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if not private.none_external(array[new.approver_id, new.delegate_id]) then
    raise exception 'invalid_assignee: approver and delegate must be internal'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger trg_approval_groups_check
  before insert or update of approver_id, delegate_id on approval_groups
  for each row execute function private.approval_groups_check();

-------------------------------------------------------------------------------
-- 8. Pages: validation flag, titular and reserve workers, group
-------------------------------------------------------------------------------

alter table pages
  add column requires_scientific_validation boolean not null default false,
  add column dubber_titular_id uuid references profiles(id) on delete set null,
  add column dubber_reserve_id uuid references profiles(id) on delete set null,
  add column animator_titular_id uuid references profiles(id) on delete set null,
  add column animator_reserve_id uuid references profiles(id) on delete set null,
  add column validator_id uuid references profiles(id) on delete set null,
  add column approval_group_id uuid references approval_groups(id) on delete set null;
alter table pages
  add constraint pages_dubbers_distinct_chk
    check (dubber_titular_id is null or dubber_reserve_id is null or dubber_titular_id <> dubber_reserve_id),
  add constraint pages_animators_distinct_chk
    check (animator_titular_id is null or animator_reserve_id is null or animator_titular_id <> animator_reserve_id),
  add constraint pages_titulars_distinct_chk
    check (dubber_titular_id is null or animator_titular_id is null or dubber_titular_id <> animator_titular_id);

-- An internal fits any role; an external only the role of its kind; a
-- deactivated profile none.
create function private.role_fits(p_uid uuid, p_kind external_kind)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_uid is null or exists (
    select 1 from profiles p
     where p.id = p_uid
       and p.deactivated_at is null
       and (p.account_type = 'internal' or p.external_kind = p_kind)
  );
$$;

create function private.pages_check_roles()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if not (private.role_fits(new.dubber_titular_id, 'dubber')
      and private.role_fits(new.dubber_reserve_id, 'dubber')
      and private.role_fits(new.animator_titular_id, 'animator')
      and private.role_fits(new.animator_reserve_id, 'animator')
      and private.role_fits(new.validator_id, 'validator')) then
    raise exception 'invalid_assignee: profile kind does not fit the page role'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger trg_pages_check_roles
  before insert or update of dubber_titular_id, dubber_reserve_id, animator_titular_id,
    animator_reserve_id, validator_id on pages
  for each row execute function private.pages_check_roles();

-------------------------------------------------------------------------------
-- 9. Reels: state, track, script revision
-------------------------------------------------------------------------------

alter table reels
  add column state reel_state,
  add column track reel_track not null default 'batch',
  add column state_entered_at timestamptz,
  add column script_rev integer not null default 0;

-- Backfill without bumping updated_at (the weekly digest reads it).
alter table reels disable trigger trg_reels_updated_at;
update reels
   set state = private.legacy_phase_to_state(phase, published_at),
       state_entered_at = phase_entered_at;
-- Normalise the rows whose phase no longer matches their state: deprecated
-- 'qc' (→ editing) and 'published' (→ publication), and published reels left
-- in another phase. Active phases round-trip unchanged.
update reels
   set phase = public.state_raci_phase(state)
 where phase is distinct from public.state_raci_phase(state);
alter table reels enable trigger trg_reels_updated_at;

alter table reels
  alter column state set not null,
  alter column state set default 'idea',
  alter column state_entered_at set not null,
  alter column state_entered_at set default now();

create index reels_active_state_idx on reels(state, state_entered_at) where published_at is null;

-- Keeps `state` and `phase` aligned. Named to run after
-- trg_reels_published_at (BEFORE triggers fire in name order), so it sees the
-- published_at that trigger sets from posted_url.
-- * state changed (the task engine, S2): phase follows the state.
-- * phase or published_at changed (Fase 0 code: decide_phase_advance,
--   posted_url): state follows them, until the contract migration (S2)
--   turns this branch into a refusal.
-- Only real value changes count: the Fase 0 code sends every column on
-- each save (src/lib/reels/actions.ts).
-- script_rev counts edits of the script blocks, notes and raw content.
create function private.reels_sync_state()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_phase pipeline_phase;
begin
  if tg_op = 'INSERT' then
    if new.phase = 'research_prescript' and new.published_at is null then
      new.phase := public.state_raci_phase(new.state);
    else
      new.state := private.legacy_phase_to_state(new.phase, new.published_at);
      new.phase := public.state_raci_phase(new.state);
    end if;
    return new;
  end if;

  if new.state is distinct from old.state then
    new.state_entered_at := now();
  elsif new.phase is distinct from old.phase
     or new.published_at is distinct from old.published_at then
    new.state := private.legacy_phase_to_state(new.phase, new.published_at);
    if new.state is distinct from old.state then
      new.state_entered_at := now();
    end if;
  end if;

  v_phase := public.state_raci_phase(new.state);
  if new.phase is distinct from v_phase then
    new.phase := v_phase;
  end if;
  if new.phase is distinct from old.phase
     and new.phase_entered_at is not distinct from old.phase_entered_at then
    new.phase_entered_at := now();
  end if;

  if (new.hook, new.corpo, new.chiusura, new.cta, new.notes, new.raw_content)
     is distinct from (old.hook, old.corpo, old.chiusura, old.cta, old.notes, old.raw_content) then
    new.script_rev := old.script_rev + 1;
  else
    new.script_rev := old.script_rev;
  end if;
  return new;
end;
$$;
create trigger trg_reels_sync_state
  before insert or update on reels
  for each row execute function private.reels_sync_state();

-------------------------------------------------------------------------------
-- 10. Comments visible only to internals
-------------------------------------------------------------------------------

alter table comments add column internal_only boolean not null default false;

-------------------------------------------------------------------------------
-- 11. SLA policies
-------------------------------------------------------------------------------

-- page_id null = global default; a page row overrides it.
create table sla_policies (
  id uuid primary key default gen_random_uuid(),
  page_id uuid references pages(id) on delete cascade,
  track reel_track not null,
  step sla_step not null,
  minutes integer not null check (minutes > 0),
  updated_at timestamptz not null default now(),
  constraint sla_policies_unique unique nulls not distinct (page_id, track, step)
);
create trigger trg_sla_policies_updated_at
  before update on sla_policies for each row execute function set_updated_at();

-- Defaults (docs/fase1-plan.md §3, gaps filled in docs/fase1-decisioni.md).
-- Batch minutes are working minutes (weekends skipped), Express real time.
insert into sla_policies (page_id, track, step, minutes) values
  (null, 'batch', 'writing', 7200),
  (null, 'batch', 'review', 1440),
  (null, 'batch', 'validation', 2880),
  (null, 'batch', 'dubbing_accept', 1440),
  (null, 'batch', 'dubbing', 2880),
  (null, 'batch', 'audio_approval', 1440),
  (null, 'batch', 'animation_accept', 1440),
  (null, 'batch', 'animation', 4320),
  (null, 'batch', 'final_approval', 1440),
  (null, 'batch', 'scheduling', 2880),
  (null, 'express', 'writing', 120),
  (null, 'express', 'review', 60),
  (null, 'express', 'validation', 120),
  (null, 'express', 'dubbing_accept', 120),
  (null, 'express', 'dubbing', 180),
  (null, 'express', 'audio_approval', 30),
  (null, 'express', 'animation_accept', 120),
  (null, 'express', 'animation', 600),
  (null, 'express', 'final_approval', 120),
  (null, 'express', 'scheduling', 120);

create function private.sla_minutes(p_page_id uuid, p_track reel_track, p_step sla_step)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_minutes integer;
begin
  select coalesce(
    (select s.minutes from sla_policies s
      where s.page_id = p_page_id and s.track = p_track and s.step = p_step),
    (select s.minutes from sla_policies s
      where s.page_id is null and s.track = p_track and s.step = p_step))
  into v_minutes;
  if v_minutes is null then
    raise exception 'no SLA for % / %', p_track, p_step;
  end if;
  return v_minutes;
end;
$$;

-- Deadline p_minutes after p_start. Batch counts working time only: Saturday
-- and Sunday (Europe/Rome) are skipped, so a 24 h task created Friday 18:00
-- is due Monday 18:00. Express counts real time, nights and weekends included.
-- Batch arithmetic is on Rome wall-clock time; DST changes fall on Sundays,
-- which Batch skips.
create function private.add_sla(p_start timestamptz, p_minutes numeric, p_track reel_track)
returns timestamptz
language plpgsql
stable
set search_path = public
as $$
declare
  v_local timestamp;
  v_day_end timestamp;
  v_left numeric := p_minutes;
  v_avail numeric;
begin
  if p_start is null or p_minutes is null then
    return null;
  end if;
  if p_track = 'express' then
    return p_start + p_minutes * interval '1 minute';
  end if;

  v_local := p_start at time zone 'Europe/Rome';
  loop
    if extract(isodow from v_local) >= 6 then
      v_local := date_trunc('day', v_local) + interval '1 day';
      continue;
    end if;
    v_day_end := date_trunc('day', v_local) + interval '1 day';
    v_avail := extract(epoch from v_day_end - v_local) / 60;
    if v_left <= v_avail then
      return (v_local + v_left * interval '1 minute') at time zone 'Europe/Rome';
    end if;
    v_left := v_left - v_avail;
    v_local := v_day_end;
  end loop;
end;
$$;

-------------------------------------------------------------------------------
-- 12. Tasks and their history
-------------------------------------------------------------------------------

create table tasks (
  id uuid primary key default gen_random_uuid(),
  reel_id uuid not null references reels(id) on delete cascade,
  kind task_kind not null,
  status task_status not null,
  -- restrict: the history must survive; GDPR erasure anonymises the profile.
  assignee_id uuid references profiles(id) on delete restrict,
  attempt smallint not null default 1 check (attempt >= 1),
  previous_task_id uuid references tasks(id) on delete set null,
  started_at timestamptz,
  yellow_at timestamptz,
  due_at timestamptz,
  escalate_at timestamptz,
  accepted_at timestamptz,
  delivered_at timestamptz,
  closed_at timestamptz,
  closed_by uuid references profiles(id) on delete set null,
  closed_via text check (closed_via in ('app', 'telegram', 'sweep', 'migration', 'admin')),
  decision_note text,
  payload jsonb not null default '{}'::jsonb,
  notified_at timestamptz,
  overdue_notified_at timestamptz,
  escalated_at timestamptz,
  escalation_paused boolean not null default false,
  requires_drive boolean not null default false,
  origin text not null default 'app' check (origin in ('app', 'migration')),
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- An open task is unassigned exactly when it has no assignee.
  constraint tasks_open_assignee_chk check (
    status not in ('unassigned', 'assigned', 'in_progress')
    or (status = 'unassigned') = (assignee_id is null)
  ),
  constraint tasks_closed_at_chk check (
    (status in ('unassigned', 'assigned', 'in_progress')) = (closed_at is null)
  )
);

-- Fase 1 flow is sequential: one open task per reel. Fase 2 (parallel
-- dubbing) turns this into (reel_id, kind); it is a partial index, no data
-- changes.
create unique index tasks_one_open_per_reel on tasks(reel_id)
  where status in ('unassigned', 'assigned', 'in_progress');
create index tasks_open_assignee_due_idx on tasks(assignee_id, due_at)
  where status in ('unassigned', 'assigned', 'in_progress');
create index tasks_open_due_idx on tasks(due_at)
  where status in ('unassigned', 'assigned', 'in_progress');
create index tasks_open_escalate_idx on tasks(escalate_at)
  where status in ('unassigned', 'assigned', 'in_progress');
create index tasks_reel_created_idx on tasks(reel_id, created_at);
create index tasks_assignee_closed_idx on tasks(assignee_id, closed_at);

create trigger trg_tasks_updated_at
  before update on tasks for each row execute function set_updated_at();

-- Append-only log of every operation, accepted or refused, written by the
-- SQL functions. Feeds the Activity tab and the metrics.
create table task_events (
  id bigserial primary key,
  task_id uuid references tasks(id) on delete cascade,
  reel_id uuid references reels(id) on delete cascade,
  actor_id uuid references profiles(id) on delete set null, -- null = system
  op text not null,
  channel text,
  code text not null default 'ok',
  note text,
  created_at timestamptz not null default now()
);
create index task_events_task_idx on task_events(task_id, created_at);
create index task_events_reel_idx on task_events(reel_id, created_at);

create table text_change_proposals (
  id uuid primary key default gen_random_uuid(),
  reel_id uuid not null references reels(id) on delete cascade,
  task_id uuid references tasks(id) on delete set null,
  proposed_by uuid references profiles(id) on delete set null,
  field text not null check (field in ('hook', 'corpo', 'chiusura', 'cta')),
  original_text text,
  proposed_text text not null,
  base_rev integer not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  decided_by uuid references profiles(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now()
);
create index text_change_proposals_reel_idx on text_change_proposals(reel_id, status);

-- Transactional outbox, written in the same transaction as the transition.
-- Lease, fencing token and generation semantics arrive with S4.
create table job_outbox (
  id bigserial primary key,
  kind job_kind not null,
  payload jsonb not null default '{}'::jsonb,
  dedup_key text,
  run_after timestamptz not null default now(),
  attempts smallint not null default 0,
  requested_gen integer not null default 1,
  claimed_gen integer,
  lease_until timestamptz,
  lease_token uuid,
  last_error text,
  done_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index job_outbox_dedup_open on job_outbox(dedup_key)
  where done_at is null and failed_at is null;
create index job_outbox_pending_idx on job_outbox(run_after)
  where done_at is null and failed_at is null;

create table system_heartbeats (
  name text primary key,
  last_run_at timestamptz,
  last_report jsonb
);

-------------------------------------------------------------------------------
-- 13. Helpers on tasks and approvers
-------------------------------------------------------------------------------

-- Present and active: not deactivated, not absent now.
create function private.is_available(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_uid is not null and exists (
    select 1 from profiles p
     where p.id = p_uid
       and p.deactivated_at is null
       and (p.absent_until is null or p.absent_until <= now())
  );
$$;

-- The page's group (or the default group): approver, else the delegate when
-- the approver is away, else null (the task goes unassigned to the admins).
create function private.effective_approver(p_page_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, private
as $$
  select case
    when private.is_available(g.approver_id) then g.approver_id
    when private.is_available(g.delegate_id) then g.delegate_id
  end
  from approval_groups g
  where g.id = coalesce(
    (select pg.approval_group_id from pages pg where pg.id = p_page_id),
    (select d.id from approval_groups d where d.is_default)
  );
$$;

-- Reels an external may see: those with an open task of theirs, or one
-- closed with an outcome in the last 7 days. Declined, expired or cancelled
-- tasks give no access; a deactivated profile sees nothing. Policies check
-- is_internal() first, so internals never depend on this list.
create function public.visible_reel_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct t.reel_id), '{}')
  from tasks t
  join profiles p on p.id = t.assignee_id
  where t.assignee_id = auth.uid()
    and p.deactivated_at is null
    and (
      t.status in ('unassigned', 'assigned', 'in_progress')
      or (t.status in ('delivered', 'approved', 'sent_back')
          and t.closed_at > now() - interval '7 days')
    );
$$;

create function public.visible_page_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct r.page_id), '{}')
  from reels r
  where r.id = any (public.visible_reel_ids());
$$;

-- The caller holds an open task on the reel (lets internals with a task edit
-- the reel, see the access migration).
create function public.holds_open_task(p_reel_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from tasks t
     where t.reel_id = p_reel_id
       and t.assignee_id = auth.uid()
       and t.status in ('unassigned', 'assigned', 'in_progress')
  );
$$;

-- Admin (session) or the service role / SQL (no uid) may flip a switch.
create function public.set_app_config(p_key text, p_value jsonb)
returns text
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is not null and not private.is_admin_uid(v_uid) then
    return 'not_authorized';
  end if;
  if p_key not in ('escalation_enabled', 'standup_enabled', 'drive_enabled')
     or jsonb_typeof(p_value) <> 'boolean' then
    return 'invalid_input';
  end if;
  update app_config set value = p_value, updated_at = now(), updated_by = v_uid where key = p_key;
  return 'ok';
end;
$$;

-------------------------------------------------------------------------------
-- 14. RLS and grants on the new tables (no direct writes for users)
-------------------------------------------------------------------------------

alter table app_config enable row level security;
alter table telegram_link_tokens enable row level security;
alter table approval_groups enable row level security;
alter table sla_policies enable row level security;
alter table tasks enable row level security;
alter table task_events enable row level security;
alter table text_change_proposals enable row level security;
alter table job_outbox enable row level security;
alter table system_heartbeats enable row level security;

revoke all on table app_config, telegram_link_tokens, approval_groups, sla_policies, tasks,
  task_events, text_change_proposals, job_outbox, system_heartbeats from anon, authenticated;
revoke all on sequence task_events_id_seq, job_outbox_id_seq from anon, authenticated;
grant select on table app_config, approval_groups, sla_policies, tasks, task_events,
  text_change_proposals to authenticated;

create policy app_config_admin_read on app_config
  for select to authenticated using ((select public.is_admin()));

create policy approval_groups_internal_read on approval_groups
  for select to authenticated using ((select public.is_internal()));

create policy sla_policies_internal_read on sla_policies
  for select to authenticated using ((select public.is_internal()));

create policy tasks_read on tasks
  for select to authenticated
  using (
    (select public.is_internal())
    or (assignee_id = (select auth.uid()) and reel_id = any ((select public.visible_reel_ids())::uuid[]))
  );

create policy task_events_internal_read on task_events
  for select to authenticated using ((select public.is_internal()));

create policy text_change_proposals_read on text_change_proposals
  for select to authenticated
  using (
    (select public.is_internal())
    or (proposed_by = (select auth.uid()) and reel_id = any ((select public.visible_reel_ids())::uuid[]))
  );

-- job_outbox, system_heartbeats, telegram_link_tokens: service role only.

-------------------------------------------------------------------------------
-- 15. Function privileges
-------------------------------------------------------------------------------

revoke execute on function public.state_raci_phase(reel_state) from public, anon, authenticated;
revoke execute on function public.is_internal() from public, anon, authenticated;
revoke execute on function public.visible_reel_ids() from public, anon, authenticated;
revoke execute on function public.visible_page_ids() from public, anon, authenticated;
revoke execute on function public.holds_open_task(uuid) from public, anon, authenticated;
revoke execute on function public.set_app_config(text, jsonb) from public, anon, authenticated;

grant execute on function public.state_raci_phase(reel_state) to authenticated, service_role;
grant execute on function public.is_internal() to authenticated, service_role;
grant execute on function public.visible_reel_ids() to authenticated, service_role;
grant execute on function public.visible_page_ids() to authenticated, service_role;
grant execute on function public.holds_open_task(uuid) to authenticated, service_role;
grant execute on function public.set_app_config(text, jsonb) to authenticated, service_role;

revoke execute on all functions in schema private from public, anon, authenticated;
