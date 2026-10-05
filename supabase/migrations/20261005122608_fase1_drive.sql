-- Fase 1 (S5, R2) — Drive: reel folders, uploads, the animator's kit, folder
-- shares (docs/fase1-plan.md §S5).
--
-- Additive, and inert while app_config.drive_enabled is false (R1): no job is
-- queued, every task keeps requires_drive = false and delivers with a link.
-- * reel_files: one row per uploaded version (and per kit file), written only
--   by the functions below. reel_folder_shares: the Drive permissions the app
--   granted on a reel folder.
-- * One job per reel, drive_reconcile (src/lib/jobs/handlers/drive-reconcile.ts),
--   converges folder → archive → kit → shares from drive_desired_state() and
--   reports each step as soon as it is done (save_drive_folder,
--   register_kit_file, archive_drive_files, record_drive_share), so a crash
--   halfway leaves nothing to redo twice; mark_drive_reconciled() closes it.
-- * Deliveries follow the task: requires_drive → a ready file; tasks born in
--   R1 → a link or a file. An animation task with requires_drive waits for
--   the kit of the approved audio: no message and no clock until then (I6).
-- * Uploads: prepare_upload_as() reserves the version and the standard name,
--   the server opens the resumable session, finish_upload_as() records the
--   file after the server has checked it on Drive. Service role only: the
--   browser cannot report a file the server did not verify.
-- Replaces private._create_task, private._transition, private._drive_reconcile,
-- public.set_app_config, public.sweep_tasks and public.job_health with create
-- or replace (I7).

-------------------------------------------------------------------------------
-- 1. Columns and tables
-------------------------------------------------------------------------------

alter table pages add column drive_folder_id text;
alter table batches add column drive_folder_id text;
alter table reels
  add column drive_folder_id text,
  add column drive_archive_folder_id text,
  -- Hash of the kit last written (script blocks, notes, approved audio).
  add column kit_hash text,
  -- Set when the kit matches the approved audio; cleared by a new approval.
  add column kit_ready_at timestamptz;

create table reel_files (
  id uuid primary key default gen_random_uuid(),
  reel_id uuid not null references reels(id) on delete cascade,
  task_id uuid references tasks(id) on delete set null,
  kind reel_file_kind not null,
  version integer not null check (version >= 1),
  status text not null default 'uploading' check (status in ('uploading', 'ready', 'failed')),
  drive_file_id text unique,
  name text not null,
  mime_type text,
  size_bytes bigint check (size_bytes >= 0),
  web_view_link text,
  -- Kit files: the kit they were written for.
  kit_hash text,
  uploaded_by uuid references profiles(id) on delete set null,
  approved_at timestamptz,
  approved_by uuid references profiles(id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (reel_id, kind, version),
  constraint reel_files_ready_chk check (status <> 'ready' or drive_file_id is not null)
);
create index reel_files_task_idx on reel_files(task_id);
create index reel_files_uploading_idx on reel_files(created_at) where status = 'uploading';
create trigger trg_reel_files_updated_at
  before update on reel_files for each row execute function set_updated_at();

create table reel_folder_shares (
  id bigserial primary key,
  reel_id uuid not null references reels(id) on delete cascade,
  user_id uuid references profiles(id) on delete set null,
  -- Lowercase; the profile's drive_email, else its email.
  email text not null,
  role text not null default 'reader' check (role in ('reader', 'writer')),
  drive_permission_id text,
  granted_at timestamptz,
  revoked_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index reel_folder_shares_live on reel_folder_shares(reel_id, email) where revoked_at is null;

alter table reel_files enable row level security;
alter table reel_folder_shares enable row level security;
revoke all on table reel_files, reel_folder_shares from anon, authenticated;
revoke all on sequence reel_folder_shares_id_seq from anon, authenticated;
grant select on table reel_files, reel_folder_shares to authenticated;

-- Same visibility as the reel.
create policy reel_files_read on reel_files
  for select to authenticated
  using ((select public.is_internal()) or reel_id = any ((select public.visible_reel_ids())::uuid[]));

-- Email addresses of collaborators: admins only.
create policy reel_folder_shares_admin_read on reel_folder_shares
  for select to authenticated
  using ((select public.is_admin()));

-- The Drive job for a reel: queued while Drive is on, and also with Drive
-- off when the reel folder is still shared with someone, so that closing or
-- moving a task revokes the access even during an incident (the job then
-- only revokes).
create or replace function private._drive_reconcile(p_reel_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if private._drive_enabled()
     or exists (select 1 from reel_folder_shares s where s.reel_id = p_reel_id and s.revoked_at is null) then
    perform private._enqueue('drive_reconcile', jsonb_build_object('reel_id', p_reel_id), 'drive:' || p_reel_id);
  end if;
end;
$$;

-------------------------------------------------------------------------------
-- 2. What the reel folder should look like
-------------------------------------------------------------------------------

-- What the work task behind a decision delivered: the decision's
-- previous_task_id points to the dubbing (animation) that created it, or to
-- the approval it replaced on a reassignment. Timestamps are not used: all
-- the tasks of one transaction share now(). null: none on record (a
-- migrated approval).
create function private._delivered_by(p_task_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_id uuid := p_task_id;
  t tasks%rowtype;
begin
  for i in 1..20 loop
    select * into t from tasks where id = (select previous_task_id from tasks where id = v_id);
    exit when not found;
    if t.kind in ('dubbing', 'animation') then
      return case when t.status = 'delivered' then t.payload end;
    end if;
    v_id := t.id;
  end loop;
  return null;
end;
$$;

-- The audio the kit is built on: what was delivered for the latest audio
-- approval ('file:<reel_files.id>', or 'link:<url>' for a dubbing born in
-- R1; attempt grows with each task of a kind, so the highest is the latest).
-- A reel migrated past dubbing has no delivery on record: its legacy link
-- (I6b, I6c). 'none': a script-only kit.
create function private._kit_audio_ref(p_reel_id uuid)
returns text
language sql
stable
security definer
set search_path = public, private
as $$
  select coalesce(
    (select case when s.d ? 'file_id' then 'file:' || (s.d ->> 'file_id')
                 else 'link:' || (s.d ->> 'file_url') end
       from (select private._delivered_by(a.id) as d
               from tasks a
              where a.reel_id = p_reel_id and a.kind = 'audio_approval' and a.status = 'approved'
              order by a.attempt desc
              limit 1) s),
    (select 'link:' || r.audio_drive_url from reels r
      where r.id = p_reel_id and r.audio_drive_url ~ '^https://\S+$'),
    'none');
$$;

-- Changes when the script, the notes or the approved audio change (accepted
-- proposals change the script, so they count too).
create function private._kit_hash(p_reel_id uuid)
returns text
language sql
stable
security definer
set search_path = public, private
as $$
  select encode(sha256(convert_to(concat_ws(chr(31),
           coalesce(r.hook, ''), coalesce(r.corpo, ''), coalesce(r.chiusura, ''), coalesce(r.cta, ''),
           coalesce(r.raw_content, ''), coalesce(r.notes, ''), private._kit_audio_ref(r.id)), 'UTF8')), 'hex')
    from reels r
   where r.id = p_reel_id;
$$;

-- Who may read the folder: the external holders of an in-progress dubbing or
-- animation task (validation comes before the folder), as reader. Internals
-- see it as members of the Shared Drive.
create function private._drive_desired_shares(p_reel_id uuid)
returns table (user_id uuid, email text, role text)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (2) p.id, lower(coalesce(nullif(trim(p.drive_email), ''), p.email)), 'reader'
    from tasks t
    join profiles p on p.id = t.assignee_id
    join reels r on r.id = t.reel_id
   where t.reel_id = p_reel_id
     and t.status = 'in_progress'
     and t.kind in ('dubbing', 'animation')
     and p.account_type = 'external'
     and p.deactivated_at is null
     and r.published_at is null
   order by 2, p.id;
$$;

-- Files that stay in the reel folder: for audio and video the newest ready
-- version and the newest approved one; of the kit, the files of its latest
-- generation (the newest script and what was written with it, such as the
-- audio link of a legacy kit). Every other ready file goes to archivio/.
create function private._drive_root_files(p_reel_id uuid)
returns table (id uuid)
language sql
stable
security definer
set search_path = public
as $$
  with kit as (
    select f.kit_hash from reel_files f
     where f.reel_id = p_reel_id and f.kind = 'script' and f.status = 'ready'
     order by f.version desc limit 1
  )
  select distinct x.id from (
    select (select f.id from reel_files f
             where f.reel_id = p_reel_id and f.kind = k and f.status = 'ready'
             order by f.version desc limit 1) as id
      from unnest(array['audio', 'video']::reel_file_kind[]) k
    union all
    select (select f.id from reel_files f
             where f.reel_id = p_reel_id and f.kind = k and f.status = 'ready' and f.approved_at is not null
             order by f.approved_at desc, f.version desc limit 1)
      from unnest(array['audio', 'video']::reel_file_kind[]) k
    union all
    select f.id from reel_files f, kit
     where f.reel_id = p_reel_id and f.kind in ('script', 'other') and f.status = 'ready'
       and f.kit_hash is not distinct from kit.kit_hash
  ) x
  where x.id is not null;
$$;

-- Everything drive_reconcile needs, read once at the start of a run.
create function public.drive_desired_state(p_reel_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private
as $$
declare
  r reels%rowtype;
  pg pages%rowtype;
  b batches%rowtype;
  v_ref text;
  v_kit boolean;
begin
  select * into r from reels where id = p_reel_id;
  if not found then
    return null;
  end if;
  select * into pg from pages where id = r.page_id;
  select * into b from batches where id = r.batch_id;
  v_ref := private._kit_audio_ref(r.id);
  v_kit := r.published_at is null and r.state in ('animazione', 'approvazione_finale', 'programmato');

  return jsonb_build_object(
    'enabled', private._drive_enabled(),
    'reel', jsonb_build_object(
      'id', r.id, 'code', r.code, 'title', r.title, 'state', r.state,
      'published', r.published_at is not null,
      'folder_id', r.drive_folder_id, 'archive_folder_id', r.drive_archive_folder_id,
      'kit_hash', r.kit_hash, 'kit_ready_at', r.kit_ready_at),
    'page', jsonb_build_object('id', pg.id, 'prefix', pg.code_prefix, 'name', pg.name,
                               'folder_id', pg.drive_folder_id),
    'batch', jsonb_build_object('id', b.id, 'label', b.label, 'folder_id', b.drive_folder_id),
    -- From confermato on (the dubber uploads there), or once it exists.
    'folder_needed', r.published_at is null and r.state >= 'confermato' or r.drive_folder_id is not null,
    'kit', case when v_kit then jsonb_build_object(
      'hash', private._kit_hash(r.id),
      'audio_ref', v_ref,
      'audio', (select jsonb_build_object('id', f.id, 'drive_file_id', f.drive_file_id, 'name', f.name)
                  from reel_files f where v_ref = 'file:' || f.id::text),
      'audio_url', case when v_ref like 'link:%' then substr(v_ref, 6) end,
      'script', jsonb_build_object('hook', r.hook, 'corpo', r.corpo, 'chiusura', r.chiusura, 'cta', r.cta,
                                   'raw_content', r.raw_content, 'notes', r.notes),
      'files', (select coalesce(jsonb_agg(jsonb_build_object(
                         'id', f.id, 'kind', f.kind, 'version', f.version, 'name', f.name,
                         'drive_file_id', f.drive_file_id, 'kit_hash', f.kit_hash) order by f.version), '[]'::jsonb)
                  from reel_files f
                 where f.reel_id = r.id and f.kind in ('script', 'other') and f.status = 'ready'
                   and f.archived_at is null),
      'next_version', jsonb_build_object(
        'script', coalesce((select max(f.version) from reel_files f where f.reel_id = r.id and f.kind = 'script'), 0) + 1,
        'other', coalesce((select max(f.version) from reel_files f where f.reel_id = r.id and f.kind = 'other'), 0) + 1))
    end,
    'to_archive', (select coalesce(jsonb_agg(jsonb_build_object(
                           'id', f.id, 'drive_file_id', f.drive_file_id, 'name', f.name) order by f.kind, f.version),
                         '[]'::jsonb)
                     from reel_files f
                    where f.reel_id = r.id and f.status = 'ready' and f.archived_at is null
                      and f.id not in (select k.id from private._drive_root_files(r.id) k)),
    'shares', (select coalesce(jsonb_agg(jsonb_build_object('user_id', s.user_id, 'email', s.email, 'role', s.role)),
                               '[]'::jsonb)
                 from private._drive_desired_shares(r.id) s),
    'recorded_shares', (select coalesce(jsonb_agg(jsonb_build_object(
                                 'user_id', s.user_id, 'email', s.email, 'role', s.role,
                                 'permission_id', s.drive_permission_id, 'last_error', s.last_error)), '[]'::jsonb)
                          from reel_folder_shares s
                         where s.reel_id = r.id and s.revoked_at is null)
  );
end;
$$;

-------------------------------------------------------------------------------
-- 3. What drive_reconcile reports back (service role)
-------------------------------------------------------------------------------

-- Saves a folder id right after files.create (I3 of iter3: a crash halfway
-- must not create the folder twice). The first id wins: a concurrent run
-- that created its own gets the stored one back and trashes its duplicate.
-- p_stale: a stored id the handler found missing on Drive, replaced.
create function public.save_drive_folder(p_reel_id uuid, p_level text, p_folder_id text, p_stale text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v text;
begin
  if p_folder_id is null or p_folder_id !~ '^[A-Za-z0-9_-]{10,200}$' then
    raise exception 'invalid_input: folder id' using errcode = 'P0001';
  end if;
  if p_level = 'page' then
    update pages
       set drive_folder_id = case when drive_folder_id is null or drive_folder_id = p_stale
                                  then p_folder_id else drive_folder_id end
     where id = (select page_id from reels where id = p_reel_id)
    returning drive_folder_id into v;
  elsif p_level = 'batch' then
    update batches
       set drive_folder_id = case when drive_folder_id is null or drive_folder_id = p_stale
                                  then p_folder_id else drive_folder_id end
     where id = (select batch_id from reels where id = p_reel_id)
    returning drive_folder_id into v;
  elsif p_level = 'reel' then
    update reels
       set drive_folder_id = case when drive_folder_id is null or drive_folder_id = p_stale
                                  then p_folder_id else drive_folder_id end
     where id = p_reel_id
    returning drive_folder_id into v;
  elsif p_level = 'archive' then
    update reels
       set drive_archive_folder_id = case when drive_archive_folder_id is null or drive_archive_folder_id = p_stale
                                          then p_folder_id else drive_archive_folder_id end
     where id = p_reel_id
    returning drive_archive_folder_id into v;
  else
    raise exception 'invalid_input: level %', p_level using errcode = 'P0001';
  end if;
  return v;
end;
$$;

-- A kit file (script, or the audio link of a legacy kit) written by the job.
-- 'conflict': that version or that Drive file is already recorded.
create function public.register_kit_file(
  p_reel_id uuid, p_kind reel_file_kind, p_version integer, p_drive_file_id text, p_name text,
  p_size bigint, p_link text, p_kit_hash text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_kind not in ('script', 'other') then
    return 'invalid_input';
  end if;
  insert into reel_files (reel_id, kind, version, status, drive_file_id, name, mime_type, size_bytes,
                          web_view_link, kit_hash)
  values (p_reel_id, p_kind, p_version, 'ready', p_drive_file_id, p_name, 'text/plain', p_size,
          p_link, p_kit_hash)
  on conflict do nothing
  returning id into v_id;
  return case when v_id is null then 'conflict' else 'ok' end;
end;
$$;

create function public.archive_drive_files(p_ids uuid[])
returns integer
language sql
security definer
set search_path = public
as $$
  with done as (
    update reel_files set archived_at = now()
     where id = any (p_ids) and archived_at is null
    returning 1)
  select count(*)::integer from done;
$$;

-- p_action: granted (with the permission id), revoked, error. A new error
-- (none recorded before) warns the admins and the person once.
create function public.record_drive_share(
  p_reel_id uuid, p_user_id uuid, p_email text, p_action text,
  p_permission_id text default null, p_error text default null
)
returns text
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_email text := lower(trim(p_email));
  v_had_error boolean;
begin
  if v_email is null or v_email = '' then
    return 'invalid_input';
  end if;
  if p_action = 'granted' then
    insert into reel_folder_shares (reel_id, user_id, email, drive_permission_id, granted_at)
    values (p_reel_id, p_user_id, v_email, p_permission_id, now())
    on conflict (reel_id, email) where revoked_at is null
    do update set drive_permission_id = excluded.drive_permission_id, granted_at = now(),
                  user_id = coalesce(excluded.user_id, reel_folder_shares.user_id),
                  last_error = null, last_error_at = null;
  elsif p_action = 'revoked' then
    update reel_folder_shares
       set revoked_at = now()
     where reel_id = p_reel_id and revoked_at is null
       and (email = v_email or (p_permission_id is not null and drive_permission_id = p_permission_id));
  elsif p_action = 'error' then
    select last_error is not null into v_had_error
      from reel_folder_shares
     where reel_id = p_reel_id and email = v_email and revoked_at is null;
    insert into reel_folder_shares (reel_id, user_id, email, last_error, last_error_at)
    values (p_reel_id, p_user_id, v_email, left(coalesce(p_error, 'error'), 500), now())
    on conflict (reel_id, email) where revoked_at is null
    do update set last_error = excluded.last_error, last_error_at = now();
    if not coalesce(v_had_error, false) then
      perform private._enqueue('notify',
        jsonb_build_object('event', 'drive_issue', 'code', 'share_failed', 'reel_id', p_reel_id,
                           'user_id', p_user_id, 'email', v_email, 'error', left(p_error, 300)),
        'drive_issue:share:' || p_reel_id || ':' || v_email);
    end if;
  else
    return 'invalid_input';
  end if;
  return 'ok';
end;
$$;

-- End of a run. With a kit: saves its hash and, when it is the kit of the
-- current approved audio, sets kit_ready_at and starts the animation task
-- that waited for it (thresholds from now, assignment message). 'stale':
-- the script or the approval changed meanwhile; the job runs again.
create function public.mark_drive_reconciled(p_reel_id uuid, p_kit_hash text)
returns text
language plpgsql
security definer
set search_path = public, private
as $$
declare
  r reels%rowtype;
  t tasks%rowtype;
begin
  select * into r from reels where id = p_reel_id for update;
  if not found then
    return 'invalid_input';
  end if;
  if p_kit_hash is null then
    return 'ok';
  end if;
  if p_kit_hash is distinct from private._kit_hash(r.id) then
    return 'stale';
  end if;

  update reels set kit_hash = p_kit_hash, kit_ready_at = coalesce(kit_ready_at, now()) where id = r.id;
  -- A kit without audio (migrated past dubbing with no audio on record, I6b):
  -- ready all the same, the admins hear of it.
  if r.kit_hash is distinct from p_kit_hash and private._kit_audio_ref(r.id) = 'none' then
    perform private._enqueue('notify',
      jsonb_build_object('event', 'drive_issue', 'code', 'kit_without_audio', 'reel_id', r.id),
      'drive_issue:kit:' || r.id);
  end if;

  select * into t from tasks
   where reel_id = r.id and kind = 'animation' and private._is_open(status)
     and requires_drive and assignee_id is not null and notified_at is null
   for update;
  if found then
    perform private._restart_clock(t.id);
    perform private._notify_task(t.id, 'assignment');
    perform private._log(t.id, r.id, null, 'kit_ready', 'drive', 'ok', null);
  end if;
  return 'ok';
end;
$$;

-- R2 (scripts/fase1-r2-enable-drive.sql): every reel in flight gets its
-- folder, kit (legacy too) and shares. Idempotent through the dedup key.
create function public.drive_backfill()
returns integer
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_id uuid;
  v_n integer := 0;
begin
  if not private._drive_enabled() then
    raise exception 'drive_disabled: set drive_enabled first' using errcode = 'P0001';
  end if;
  for v_id in
    select id from reels
     where published_at is null and state >= 'confermato' and state < 'pubblicato'
     order by id
  loop
    perform private._drive_reconcile(v_id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-------------------------------------------------------------------------------
-- 4. Uploads (service role: the server action checks the session first)
-------------------------------------------------------------------------------

-- Reserves the next version for the holder (or an admin) of an in-progress
-- dubbing (audio) or animation (video) task. The name is the standard one,
-- <code>_<kind>_v<n>.<ext>. Limits: audio ≤ 300 MB, video ≤ 4 GiB. A new
-- upload replaces the person's unfinished ones on the same task (a tab
-- closed or a session expired), which are marked failed.
create function public.prepare_upload_as(
  p_actor uuid, p_task_id uuid, p_ext text, p_mime text, p_size bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_reel_id uuid;
  r reels%rowtype;
  t tasks%rowtype;
  v_kind reel_file_kind;
  v_ext text := lower(trim(p_ext));
  v_version integer;
  v_name text;
  v_id uuid;
  v_code text := 'ok';
begin
  select reel_id into v_reel_id from tasks where id = p_task_id;
  if not found or p_actor is null then
    return jsonb_build_object('code', case when p_actor is null then 'not_authorized' else 'task_not_found' end);
  end if;
  select * into r from reels where id = v_reel_id for update;
  select * into t from tasks where id = p_task_id for update;
  v_kind := case t.kind when 'dubbing' then 'audio' when 'animation' then 'video' end;

  if v_kind is null then
    v_code := 'invalid_input';
  elsif not coalesce(t.assignee_id = p_actor or private.is_admin_uid(p_actor), false) then
    v_code := 'not_authorized';
  elsif t.status <> 'in_progress' then
    v_code := 'invalid_state';
  elsif not private._drive_enabled() then
    v_code := 'drive_disabled';
  elsif p_size is null or p_size <= 0
     -- In parentheses: plpgsql ends an IF condition at the first bare THEN.
     or p_size > (case v_kind when 'audio' then 300 * 1024 * 1024::bigint else 4 * 1024 * 1024 * 1024::bigint end)
     or not (v_ext = any ((case v_kind
               when 'audio' then array['wav', 'mp3', 'm4a', 'aac', 'flac', 'aif', 'aiff', 'ogg', 'opus']
               else array['mp4', 'mov', 'm4v', 'webm'] end)))
     or coalesce(p_mime, '') !~ ('^(' || v_kind::text || '/[A-Za-z0-9.+-]+|application/octet-stream)$') then
    v_code := 'invalid_input';
  end if;
  if v_code <> 'ok' then
    perform private._log(t.id, r.id, p_actor, 'upload_start', 'app', v_code, null);
    return jsonb_build_object('code', v_code);
  end if;

  update reel_files set status = 'failed'
   where task_id = t.id and uploaded_by = p_actor and status = 'uploading';
  v_version := coalesce((select max(f.version) from reel_files f where f.reel_id = r.id and f.kind = v_kind), 0) + 1;
  v_name := r.code || '_' || v_kind::text || '_v' || v_version || '.' || v_ext;
  insert into reel_files (reel_id, task_id, kind, version, status, name, mime_type, size_bytes, uploaded_by)
  values (r.id, t.id, v_kind, v_version, 'uploading', v_name, p_mime, p_size, p_actor)
  returning id into v_id;
  return jsonb_build_object('code', 'ok', 'file_id', v_id, 'reel_id', r.id, 'kind', v_kind,
                            'version', v_version, 'name', v_name, 'folder_id', r.drive_folder_id);
end;
$$;

-- The server found the file on Drive in the reel folder with the expected
-- size: ready. The legacy URL column follows (the R1 code and a rollback
-- always see the delivered file); the job archives older versions.
create function public.finish_upload_as(
  p_actor uuid, p_file_id uuid, p_drive_file_id text, p_web_view_link text
)
returns text
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_reel_id uuid;
  f reel_files%rowtype;
  t tasks%rowtype;
  v_code text := 'ok';
begin
  select reel_id into v_reel_id from reel_files where id = p_file_id;
  if not found or p_actor is null then
    return case when p_actor is null then 'not_authorized' else 'invalid_input' end;
  end if;
  perform 1 from reels where id = v_reel_id for update;
  select * into f from reel_files where id = p_file_id for update;
  select * into t from tasks where id = f.task_id;

  if f.status = 'ready' and f.drive_file_id = p_drive_file_id then
    return 'ok';
  elsif not coalesce(f.uploaded_by = p_actor or private.is_admin_uid(p_actor), false) then
    v_code := 'not_authorized';
  elsif f.status <> 'uploading' or t.id is null or t.status <> 'in_progress' then
    v_code := 'invalid_state';
  elsif p_drive_file_id is null or p_drive_file_id !~ '^[A-Za-z0-9_-]{10,200}$'
     or p_web_view_link is null or p_web_view_link !~ '^https://\S+$' then
    v_code := 'invalid_input';
  end if;
  if v_code <> 'ok' then
    perform private._log(t.id, v_reel_id, p_actor, 'upload:' || f.kind, 'app', v_code, null);
    return v_code;
  end if;

  update reel_files
     set status = 'ready', drive_file_id = p_drive_file_id, web_view_link = p_web_view_link
   where id = f.id;
  if f.kind = 'audio' then
    update reels set audio_drive_url = p_web_view_link where id = v_reel_id;
  elsif f.kind = 'video' then
    update reels set video_drive_url = p_web_view_link where id = v_reel_id;
  end if;
  perform private._log(t.id, v_reel_id, p_actor, 'upload:' || f.kind, 'app', 'ok', f.name);
  perform private._drive_reconcile(v_reel_id);
  return 'ok';
end;
$$;

-- The server could not verify the upload (or the browser gave up).
create function public.fail_upload(p_file_id uuid)
returns text
language sql
security definer
set search_path = public
as $$
  update reel_files set status = 'failed' where id = p_file_id and status = 'uploading';
  select 'ok';
$$;

-------------------------------------------------------------------------------
-- 5. The task engine with Drive (replaces the R1 versions, I7)
-------------------------------------------------------------------------------

-- As in R1, except: an animation task created while Drive is on waits for
-- the kit of the approved audio (no clock, no message) when someone holds
-- it; mark_drive_reconciled() starts it. Unassigned tasks still reach the
-- admins at once.
create or replace function private._create_task(
  p_reel_id uuid,
  p_kind task_kind,
  p_assignee uuid,
  p_status task_status,
  p_actor uuid,
  p_previous uuid default null,
  p_notify text default 'assignment'
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_status task_status := case when p_assignee is null then 'unassigned' else p_status end;
  v_drive boolean := private._drive_enabled();
  v_id uuid;
begin
  insert into tasks (
    reel_id, kind, status, assignee_id, attempt, previous_task_id,
    accepted_at, requires_drive, origin, created_by
  ) values (
    p_reel_id, p_kind, v_status, p_assignee,
    coalesce((select max(attempt) from tasks where reel_id = p_reel_id and kind = p_kind), 0) + 1,
    p_previous,
    case when v_status = 'in_progress' and p_kind in ('dubbing', 'animation') then now() end,
    v_drive, 'app', p_actor
  )
  returning id into v_id;
  if p_kind = 'animation' and v_drive and v_status <> 'unassigned'
     and (select kit_ready_at from reels where id = p_reel_id) is null then
    perform private._log(v_id, p_reel_id, p_actor, 'kit_wait', 'drive', 'ok', null);
    return v_id;
  end if;
  perform private._restart_clock(v_id);
  if p_notify is not null then
    perform private._notify_task(v_id, p_notify);
  end if;
  return v_id;
end;
$$;

-- The R1 transitions plus: the kit gate on animation (accept and deliver
-- answer kit_not_ready until the kit is ready), file deliveries (a ready
-- file uploaded within the task wins over a link; requires_drive needs one),
-- approvals that mark the approved file and clear kit_ready_at.
create or replace function private._transition(
  p_actor uuid, t tasks, r reels, p_op text, p_note text, p_payload jsonb, p_channel text
)
returns text
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_url text;
  v_to text;
  v_prev uuid;
  v_file reel_files%rowtype;
  v_delivery jsonb;
  v_last jsonb;
begin
  if not private._is_open(t.status) then
    return 'invalid_state';
  end if;

  -- Accept / decline: the assignee of a work task waiting for acceptance.
  if p_op in ('accept', 'decline') then
    if t.kind not in ('dubbing', 'animation') then return 'invalid_input'; end if;
    if t.status <> 'assigned' then return 'invalid_state'; end if;
    if t.assignee_id is distinct from p_actor then return 'not_authorized'; end if;

    if p_op = 'accept' then
      if t.kind = 'animation' and t.requires_drive and r.kit_ready_at is null then
        return 'kit_not_ready';
      end if;
      update tasks set status = 'in_progress', accepted_at = now() where id = t.id;
      perform private._restart_clock(t.id);
      if t.kind = 'dubbing' then
        perform private._set_state(r.id, 'doppiaggio');
      end if;
    else
      perform private._close_task(t.id, 'declined', p_actor, p_channel, p_note);
      perform private._create_task(r.id, t.kind, private._pick_work_candidate(r.id, t.kind),
                                   'assigned', p_actor, t.id);
      perform private._set_state(r.id, r.state);
    end if;
    perform private._drive_reconcile(r.id);
    return 'ok';
  end if;

  -- Deliver: the assignee (or an admin) of a work task in progress.
  if p_op = 'deliver' then
    if t.kind not in ('writing', 'dubbing', 'animation') then return 'invalid_input'; end if;
    if t.status <> 'in_progress' then return 'invalid_state'; end if;
    if not coalesce(t.assignee_id = p_actor or private.is_admin_uid(p_actor), false) then return 'not_authorized'; end if;

    if t.kind = 'writing' then
      perform private._close_task(t.id, 'delivered', p_actor, p_channel, p_note);
      perform private._create_task(r.id, 'review', private._pick_work_candidate(r.id, 'review'),
                                   'in_progress', p_actor, t.id, 'phase_approval_request');
      perform private._set_state(r.id, 'revisione');
      return 'ok';
    end if;

    if t.kind = 'animation' and t.requires_drive and r.kit_ready_at is null then
      return 'kit_not_ready';
    end if;
    -- The newest file uploaded within this task; else (tasks born in R1) a
    -- link. The payload says which: it is what the approval will mark and
    -- what the kit is built on.
    select * into v_file from reel_files f
     where f.task_id = t.id and f.status = 'ready'
       and f.kind = case t.kind when 'dubbing' then 'audio' else 'video' end::reel_file_kind
     order by f.version desc
     limit 1;
    if found then
      v_url := v_file.web_view_link;
      v_delivery := jsonb_build_object('file_id', v_file.id, 'file_url', v_url);
    else
      if t.requires_drive then return 'file_missing'; end if;
      v_url := p_payload ->> 'file_url';
      if v_url is null or v_url !~ '^https://\S+$' then return 'invalid_input'; end if;
      v_delivery := jsonb_build_object('file_url', v_url);
    end if;

    if t.kind = 'dubbing' then
      update reels set audio_drive_url = v_url where id = r.id;
      perform private._close_task(t.id, 'delivered', p_actor, p_channel, p_note, v_delivery);
      perform private._create_task(r.id, 'audio_approval', private._pick_work_candidate(r.id, 'audio_approval'),
                                   'in_progress', p_actor, t.id, 'phase_approval_request');
      perform private._set_state(r.id, 'doppiaggio');
    else
      -- The animator confirms editing and subtitles in the delivery form.
      if p_payload -> 'editing_done' is distinct from 'true'::jsonb
         or p_payload -> 'subtitles' is distinct from 'true'::jsonb then
        return 'invalid_input';
      end if;
      update reels set video_drive_url = v_url where id = r.id;
      perform private._add_dod(r.id, 'editing_done', p_actor);
      perform private._add_dod(r.id, 'subtitles', p_actor);
      perform private._close_task(t.id, 'delivered', p_actor, p_channel, p_note, v_delivery);
      perform private._create_task(r.id, 'final_approval', private._pick_work_candidate(r.id, 'final_approval'),
                                   'in_progress', p_actor, t.id, 'phase_approval_request');
      perform private._set_state(r.id, 'approvazione_finale');
    end if;
    perform private._drive_reconcile(r.id);
    return 'ok';
  end if;

  -- Approve / send back: approvals and validation.
  if p_op in ('approve', 'send_back') then
    if t.kind not in ('review', 'validation', 'audio_approval', 'final_approval') then return 'invalid_input'; end if;
    if not private._can_decide(p_actor, t, r.page_id) then return 'not_authorized'; end if;

    -- Script approvals carry the revision the approver saw.
    if p_op = 'approve' and t.kind in ('review', 'validation') and t.origin <> 'migration' then
      if private._script_missing(r) then return 'script_missing'; end if;
      if jsonb_typeof(p_payload -> 'rev') is distinct from 'number'
         or (p_payload ->> 'rev')::integer <> r.script_rev then
        return 'stale';
      end if;
    end if;

    if t.kind in ('review', 'validation') then
      if p_op = 'send_back' then
        perform private._close_task(t.id, 'sent_back', p_actor, p_channel, p_note);
        -- Back to the last author; a migrated validation has none (I14).
        perform private._create_task(r.id, 'writing',
          coalesce(private._last_assignee(r.id, 'writing', array['delivered']::task_status[]),
                   private._pick_work_candidate(r.id, 'writing')),
          'in_progress', p_actor, t.id, 'phase_rejected');
        perform private._set_state(r.id, 'bozza');
      elsif t.kind = 'validation' and t.origin = 'migration' then
        -- In the old flow validation came before writing: write it now.
        perform private._close_task(t.id, 'approved', p_actor, p_channel, p_note);
        perform private._create_task(r.id, 'writing', private._pick_work_candidate(r.id, 'writing'),
                                     'in_progress', p_actor, t.id);
        perform private._set_state(r.id, 'bozza');
      elsif t.kind = 'review' then
        perform private._close_task(t.id, 'approved', p_actor, p_channel, p_note);
        perform private._add_dod(r.id, 'script_validated', p_actor);
        if (select requires_scientific_validation from pages where id = r.page_id) then
          perform private._create_task(r.id, 'validation', private._pick_work_candidate(r.id, 'validation'),
                                       'in_progress', p_actor, t.id);
          perform private._set_state(r.id, 'validazione');
        else
          perform private._confirm(r.id, p_actor, t.id);
        end if;
      else
        perform private._close_task(t.id, 'approved', p_actor, p_channel, p_note);
        perform private._confirm(r.id, p_actor, t.id);
      end if;
      return 'ok';
    end if;

    -- What the dubbing (animation) under decision delivered.
    v_last := private._delivered_by(t.id);

    if t.kind = 'audio_approval' then
      if p_op = 'approve' then
        perform private._close_task(t.id, 'approved', p_actor, p_channel, p_note);
        perform private._add_dod(r.id, 'audio_recorded', p_actor);
        if v_last ? 'file_id' then
          update reel_files set approved_at = now(), approved_by = p_actor
           where id = (v_last ->> 'file_id')::uuid and approved_at is null;
        end if;
        -- A new approved audio needs a new kit before the animator starts.
        update reels set kit_ready_at = null where id = r.id;
        -- After a send-back to dubbing the animation returns to the same
        -- animator, already accepted; otherwise to the next candidate.
        v_prev := (select a.assignee_id from tasks a
                    where a.reel_id = r.id and a.kind = 'animation' and a.accepted_at is not null
                      and a.assignee_id is not null
                    order by a.created_at desc limit 1);
        if v_prev is not null and private.role_fits(v_prev, 'animator') then
          perform private._create_task(r.id, 'animation', v_prev, 'in_progress', p_actor, t.id);
        else
          perform private._create_task(r.id, 'animation', private._pick_work_candidate(r.id, 'animation'),
                                       'assigned', p_actor, t.id);
        end if;
        perform private._set_state(r.id, 'animazione');
      else
        perform private._close_task(t.id, 'sent_back', p_actor, p_channel, p_note);
        perform private._create_task(r.id, 'dubbing',
          private._last_assignee(r.id, 'dubbing', array['delivered']::task_status[]),
          'in_progress', p_actor, t.id, 'phase_rejected');
        perform private._set_state(r.id, 'doppiaggio');
      end if;
      perform private._drive_reconcile(r.id);
      return 'ok';
    end if;

    -- final_approval
    if p_op = 'approve' then
      if (select count(*) from reel_dod_items d
           where d.reel_id = r.id
             and d.key in ('script_validated', 'audio_recorded', 'editing_done', 'subtitles')) < 4 then
        return 'dod_incomplete';
      end if;
      perform private._add_dod(r.id, 'qc_approved', p_actor);
      perform private._close_task(t.id, 'approved', p_actor, p_channel, p_note);
      if v_last ? 'file_id' then
        update reel_files set approved_at = now(), approved_by = p_actor
         where id = (v_last ->> 'file_id')::uuid and approved_at is null;
      end if;
      perform private._create_task(r.id, 'scheduling', private._pick_work_candidate(r.id, 'scheduling'),
                                   'in_progress', p_actor, t.id);
      perform private._set_state(r.id, 'programmato');
      perform private._drive_reconcile(r.id);
      return 'ok';
    end if;

    -- Send back to the animator (default, Telegram too) or, from the app
    -- only, to the dubber (the audio must be redone).
    v_to := coalesce(p_payload ->> 'to', 'animation');
    if v_to not in ('animation', 'dubbing') or (v_to = 'dubbing' and p_channel <> 'app') then
      return 'invalid_input';
    end if;
    perform private._close_task(t.id, 'sent_back', p_actor, p_channel, p_note);
    if v_to = 'animation' then
      -- Same kit: the animator starts again at once.
      perform private._create_task(r.id, 'animation',
        private._last_assignee(r.id, 'animation', array['delivered']::task_status[]),
        'in_progress', p_actor, t.id, 'phase_rejected');
      perform private._set_state(r.id, 'animazione');
    else
      perform private._create_task(r.id, 'dubbing',
        private._last_assignee(r.id, 'dubbing', array['delivered']::task_status[]),
        'in_progress', p_actor, t.id, 'phase_rejected');
      perform private._set_state(r.id, 'doppiaggio');
    end if;
    perform private._drive_reconcile(r.id);
    return 'ok';
  end if;

  return 'invalid_input';
end;
$$;

-- The script, the notes, the raw content or the legacy audio link (the kit
-- of a migrated reel uses it) changed on a reel whose kit exists: the kit is
-- rewritten (new version, the old one archived).
create function private.reels_kit_on_script_change()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.published_at is null
     and new.state in ('animazione', 'approvazione_finale', 'programmato')
     and (new.hook, new.corpo, new.chiusura, new.cta, new.notes, new.raw_content, new.audio_drive_url)
         is distinct from (old.hook, old.corpo, old.chiusura, old.cta, old.notes, old.raw_content, old.audio_drive_url) then
    perform private._drive_reconcile(new.id);
  end if;
  return null;
end;
$$;
create trigger trg_reels_kit_on_script_change
  after update of hook, corpo, chiusura, cta, notes, raw_content, audio_drive_url on reels
  for each row execute function private.reels_kit_on_script_change();

-------------------------------------------------------------------------------
-- 6. Switching Drive off (incident, Scenario 3)
-------------------------------------------------------------------------------

-- Open tasks go back to link deliveries at once (task_events op drive_off);
-- an animation that waited for the kit starts now (I6a). Turning Drive on
-- again affects only the tasks created afterwards.
create function private._drive_off(p_actor uuid)
returns integer
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_reel uuid;
  t tasks%rowtype;
  v_n integer := 0;
begin
  for v_reel in
    select distinct tk.reel_id from tasks tk
     where tk.requires_drive and private._is_open(tk.status)
     order by 1
  loop
    perform 1 from reels where id = v_reel for update;
    for t in
      select * from tasks
       where reel_id = v_reel and requires_drive and private._is_open(status)
       for update
    loop
      update tasks set requires_drive = false where id = t.id;
      perform private._log(t.id, v_reel, p_actor, 'drive_off', 'admin', 'ok', null);
      if t.kind = 'animation' and t.assignee_id is not null and t.notified_at is null then
        perform private._restart_clock(t.id);
        perform private._notify_task(t.id, 'assignment');
      end if;
      v_n := v_n + 1;
    end loop;
  end loop;
  return v_n;
end;
$$;

-- Admin (session) or the service role / SQL (no uid) may flip a switch.
create or replace function public.set_app_config(p_key text, p_value jsonb)
returns text
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_uid uuid := auth.uid();
  v_prev jsonb;
begin
  if v_uid is not null and not private.is_admin_uid(v_uid) then
    return 'not_authorized';
  end if;
  if p_key not in ('escalation_enabled', 'standup_enabled', 'drive_enabled')
     or jsonb_typeof(p_value) <> 'boolean' then
    return 'invalid_input';
  end if;
  select value into v_prev from app_config where key = p_key for update;
  update app_config set value = p_value, updated_at = now(), updated_by = v_uid where key = p_key;
  if p_key = 'drive_enabled' and p_value = 'false'::jsonb and v_prev is distinct from 'false'::jsonb then
    perform private._drive_off(v_uid);
  end if;
  return 'ok';
end;
$$;

-------------------------------------------------------------------------------
-- 7. Sweep: the R1 version plus Drive housekeeping
-------------------------------------------------------------------------------

-- Added: uploads left 'uploading' for 24 h fail; a reel is reconciled again
-- when a share is still open with no matching task (a missed revocation, Drive
-- on or off; at most every 30 minutes) or, with Drive on, when its last drive
-- job died more than an hour ago (once per failure, at most three failures a
-- day: then job_health and the admins take over).
create or replace function public.sweep_tasks(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_notify boolean := coalesce(
    (select c.value = 'true'::jsonb from app_config c where c.key = 'escalation_enabled'), false);
  v_reel uuid;
  r reels%rowtype;
  t tasks%rowtype;
  v_expired integer := 0;
  v_overdue integer := 0;
  v_escalated integer := 0;
  v_suppressed integer := 0;
  v_locked integer := 0;
  v_errors integer := 0;
  v_violations integer;
  v_uploads_failed integer := 0;
  v_drive_requeued integer := 0;
  v_report jsonb;
begin
  for v_reel in
    select tk.reel_id
      from tasks tk
     where private._is_open(tk.status)
       and ((tk.status = 'assigned' and tk.due_at <= p_now and not tk.escalation_paused)
            or (tk.due_at <= p_now and tk.overdue_notified_at is null)
            or (tk.escalate_at <= p_now and tk.escalated_at is null))
     group by tk.reel_id
     order by tk.reel_id
  loop
    begin
      select * into r from reels where id = v_reel for update skip locked;
      if not found then
        v_locked := v_locked + 1;
        continue;
      end if;
      -- Reel, then task; a task locked by someone breaking that order is
      -- skipped too rather than waited for.
      select * into t from tasks where reel_id = v_reel and private._is_open(status) for update skip locked;
      if not found then
        v_locked := v_locked + 1;
        continue;
      end if;
      if t.status = 'assigned' and t.due_at <= p_now and not t.escalation_paused then
        perform private._close_task(t.id, 'expired', null, 'sweep', null);
        perform private._create_task(r.id, t.kind, private._pick_work_candidate(r.id, t.kind),
                                     'assigned', null, t.id);
        perform private._set_state(r.id, r.state);
        perform private._drive_reconcile(r.id);
        perform private._log(t.id, r.id, null, 'expire', 'sweep', 'ok', null);
        v_expired := v_expired + 1;
        continue;
      end if;

      if t.due_at <= p_now and t.overdue_notified_at is null then
        update tasks set overdue_notified_at = p_now where id = t.id;
        if v_notify and not t.escalation_paused then
          perform private._enqueue('notify',
            jsonb_build_object('event', 'task_overdue', 'task_id', t.id, 'reel_id', r.id,
                               'to', case when t.assignee_id is null then 'admins' else 'assignee' end,
                               'assignee_id', t.assignee_id),
            'task:' || t.id || ':task_overdue');
          perform private._log(t.id, r.id, null, 'overdue', 'sweep', 'ok', null);
          v_overdue := v_overdue + 1;
        else
          perform private._log(t.id, r.id, null, 'overdue_suppressed', 'sweep', 'ok', null);
          v_suppressed := v_suppressed + 1;
        end if;
      end if;

      if t.escalate_at <= p_now and t.escalated_at is null then
        update tasks set escalated_at = p_now where id = t.id;
        if v_notify and not t.escalation_paused then
          perform private._enqueue('notify',
            jsonb_build_object('event', 'task_escalated', 'task_id', t.id, 'reel_id', r.id,
                               'assignee_id', t.assignee_id) || private._escalation_payload(t, r),
            'task:' || t.id || ':task_escalated');
          perform private._log(t.id, r.id, null, 'escalate', 'sweep', 'ok', null);
          v_escalated := v_escalated + 1;
        else
          perform private._log(t.id, r.id, null, 'escalation_suppressed', 'sweep', 'ok', null);
          v_suppressed := v_suppressed + 1;
        end if;
      end if;
    exception when others then
      v_errors := v_errors + 1;
      raise warning 'sweep_tasks: reel % failed: %', v_reel, sqlerrm;
    end;
  end loop;

  -- Uploads the browser never finished.
  with failed as (
    update reel_files set status = 'failed'
     where status = 'uploading' and created_at < p_now - interval '24 hours'
    returning 1)
  select count(*) into v_uploads_failed from failed;

  for v_reel in
    select s.reel_id from reel_folder_shares s
     where s.revoked_at is null
       and not exists (
         select 1 from private._drive_desired_shares(s.reel_id) d where d.email = s.email)
       and not exists (
         select 1 from job_outbox j
          where j.dedup_key = 'drive:' || s.reel_id and j.created_at > p_now - interval '30 minutes')
    union
    select (j.payload ->> 'reel_id')::uuid from job_outbox j
     where private._drive_enabled()
       and j.kind = 'drive_reconcile'
       and j.failed_at > p_now - interval '24 hours'
       and j.failed_at < p_now - interval '1 hour'
       and not exists (
         select 1 from job_outbox n
          where n.dedup_key = j.dedup_key and n.id > j.id)
       and (select count(*) from job_outbox x
             where x.dedup_key = j.dedup_key and x.failed_at > p_now - interval '24 hours') < 3
  loop
    perform private._drive_reconcile(v_reel);
    v_drive_requeued := v_drive_requeued + 1;
  end loop;

  -- Invariant: every active reel is in the state its tasks say.
  select count(*) into v_violations
    from reels rr
   where rr.published_at is null
     and private.derived_state(rr.id) is distinct from rr.state;

  v_report := jsonb_build_object(
    'at', p_now, 'escalation_enabled', v_notify,
    'expired', v_expired, 'overdue', v_overdue, 'escalated', v_escalated,
    'suppressed', v_suppressed, 'skipped_locked', v_locked, 'errors', v_errors,
    'violations', v_violations,
    'uploads_failed', v_uploads_failed, 'drive_requeued', v_drive_requeued);
  update system_heartbeats set last_run_at = now(), last_report = v_report where name = 'task_sweep';
  return v_report;
end;
$$;

-- Health with one more signal (the R1 fields unchanged): animation tasks
-- waiting more than 30 minutes for their kit. They have no clock and send
-- no message until the kit is ready, so a Drive job that keeps failing
-- would otherwise go unnoticed.
create or replace function public.job_health(p_now timestamptz default now())
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'sweep_last_run', h.last_run_at,
    'sweep_age_minutes', floor(extract(epoch from p_now - h.last_run_at) / 60)::integer,
    'oldest_job_minutes', (
      select floor(extract(epoch from p_now - min(j.run_after)) / 60)::integer
        from job_outbox j
       where j.done_at is null and j.failed_at is null and j.run_after <= p_now),
    'dead_letters_24h', (
      select count(*) from job_outbox j where j.failed_at > p_now - interval '24 hours'),
    'violations', coalesce((h.last_report ->> 'violations')::integer, 0),
    'sweep_errors', coalesce((h.last_report ->> 'errors')::integer, 0),
    'kit_waiting', (
      select count(*) from tasks t
       where t.kind = 'animation' and t.status in ('assigned', 'in_progress') and t.requires_drive
         and t.assignee_id is not null and t.notified_at is null
         and t.created_at < p_now - interval '30 minutes'))
  from system_heartbeats h
  where h.name = 'task_sweep';
$$;

-------------------------------------------------------------------------------
-- 8. Function privileges
-------------------------------------------------------------------------------

revoke execute on function public.drive_desired_state(uuid) from public, anon, authenticated;
revoke execute on function public.save_drive_folder(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.register_kit_file(uuid, reel_file_kind, integer, text, text, bigint, text, text)
  from public, anon, authenticated;
revoke execute on function public.archive_drive_files(uuid[]) from public, anon, authenticated;
revoke execute on function public.record_drive_share(uuid, uuid, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.mark_drive_reconciled(uuid, text) from public, anon, authenticated;
revoke execute on function public.drive_backfill() from public, anon, authenticated;
revoke execute on function public.prepare_upload_as(uuid, uuid, text, text, bigint) from public, anon, authenticated;
revoke execute on function public.finish_upload_as(uuid, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.fail_upload(uuid) from public, anon, authenticated;

grant execute on function public.drive_desired_state(uuid) to service_role;
grant execute on function public.save_drive_folder(uuid, text, text, text) to service_role;
grant execute on function public.register_kit_file(uuid, reel_file_kind, integer, text, text, bigint, text, text)
  to service_role;
grant execute on function public.archive_drive_files(uuid[]) to service_role;
grant execute on function public.record_drive_share(uuid, uuid, text, text, text, text) to service_role;
grant execute on function public.mark_drive_reconciled(uuid, text) to service_role;
grant execute on function public.drive_backfill() to service_role;
grant execute on function public.prepare_upload_as(uuid, uuid, text, text, bigint) to service_role;
grant execute on function public.finish_upload_as(uuid, uuid, text, text) to service_role;
grant execute on function public.fail_upload(uuid) to service_role;

revoke execute on all functions in schema private from public, anon, authenticated;
