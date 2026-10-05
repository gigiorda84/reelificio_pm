-- Drive (docs/fase1-plan.md §S5): the R1 → R2 switch with one reel per R1
-- state (E13 in SQL), uploads and versions, the kit gate on animation,
-- desired shares, what the job reports back, Drive switched off (I6a), kits
-- without audio and from a link (I6b, I6c), RLS, the sweep, privileges.
--
-- The Drive side of drive_reconcile is simulated by pg_temp.reconcile():
-- the folder id it would save, then mark_drive_reconciled() with the hash
-- read from drive_desired_state(). One transaction (seed.sql): now() is
-- constant.

-- People: d approver, 92 SMM (internal); e dubber titular, 93 dubber
-- reserve, 91 animator titular, 94 animator reserve (external).
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000091', 'animator.drive@example.test'),
  ('00000000-0000-0000-0000-000000000092', 'smm.drive@example.test'),
  ('00000000-0000-0000-0000-000000000093', 'dubber.drive@example.test'),
  ('00000000-0000-0000-0000-000000000094', 'animator2.drive@example.test');
update profiles set account_type = 'internal' where id = '00000000-0000-0000-0000-000000000092';
update profiles set external_kind = 'animator', drive_email = 'Animatore.Google@Gmail.test'
 where id in ('00000000-0000-0000-0000-000000000091');
update profiles set external_kind = 'animator' where id = '00000000-0000-0000-0000-000000000094';
update profiles set external_kind = 'dubber' where id = '00000000-0000-0000-0000-000000000093';
update approval_groups set approver_id = '00000000-0000-0000-0000-00000000000d' where is_default;
update pages
   set dubber_titular_id = '00000000-0000-0000-0000-00000000000e',
       dubber_reserve_id = '00000000-0000-0000-0000-000000000093',
       animator_titular_id = '00000000-0000-0000-0000-000000000091',
       animator_reserve_id = '00000000-0000-0000-0000-000000000094'
 where id = '10000000-0000-0000-0000-000000000001';
insert into raci_configs (page_id, phase, responsible)
values ('10000000-0000-0000-0000-000000000001', 'publication', '{00000000-0000-0000-0000-000000000092}');
-- The seed reels stay out of the way (no tasks: idea).
update reels set state = 'idea'
 where id in ('30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002');

create function pg_temp.eq(p_got anyelement, p_want anyelement, p_label text)
returns void language plpgsql as $$
begin
  if p_got is distinct from p_want then
    raise exception 'FAIL: % — got %, want %', p_label, p_got, p_want;
  end if;
end $$;

create function pg_temp.uid(p text) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-0000000000' || p)::uuid;
$$;
create function pg_temp.reel(p_n integer) returns uuid language sql immutable as $$
  select ('30000000-0000-0000-0000-000000000' || (100 + p_n))::uuid;
$$;
create function pg_temp.task(p_n integer) returns tasks language sql as $$
  select * from tasks where reel_id = pg_temp.reel(p_n) and status in ('unassigned', 'assigned', 'in_progress');
$$;
create function pg_temp.state(p_n integer) returns text language sql as $$
  select state::text from reels where id = pg_temp.reel(p_n);
$$;
create function pg_temp.rev(p_n integer) returns jsonb language sql as $$
  select jsonb_build_object('rev', script_rev) from reels where id = pg_temp.reel(p_n);
$$;
create function pg_temp.act(p_actor text, p_n integer, p_op text, p_payload jsonb default null,
                            p_channel text default 'app')
returns text language sql as $$
  select private.task_action_core(pg_temp.uid(p_actor), (pg_temp.task(p_n)).id, p_op, null, p_payload, p_channel);
$$;
create function pg_temp.ok(p_actor text, p_n integer, p_op text, p_payload jsonb default null)
returns void language plpgsql as $$
begin
  perform pg_temp.eq(pg_temp.act(p_actor, p_n, p_op, p_payload), 'ok', 'reel ' || p_n || ' ' || p_op || ' by ' || p_actor);
end $$;
create function pg_temp.audio_link(p_n integer) returns jsonb language sql immutable as $$
  select jsonb_build_object('file_url', 'https://link.example/a' || p_n || '.wav');
$$;
create function pg_temp.video_done(p_n integer) returns jsonb language sql immutable as $$
  select jsonb_build_object('file_url', 'https://link.example/v' || p_n || '.mp4',
                            'editing_done', true, 'subtitles', true);
$$;

-- A reel in bozza with a writing task, as "Avvia stesura" leaves it.
create function pg_temp.new_reel(p_n integer) returns void language plpgsql as $$
begin
  insert into reels (id, batch_id, page_id, code, ordinal, title, hook, corpo)
  values (pg_temp.reel(p_n), '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
          'PP-2610-' || (100 + p_n), 100 + p_n, 'Reel ' || p_n, 'Hook ' || p_n, 'Corpo ' || p_n);
  perform private._create_task(pg_temp.reel(p_n), 'writing', pg_temp.uid('0b'), 'in_progress', pg_temp.uid('0a'), null, null);
  perform private._set_state(pg_temp.reel(p_n), 'bozza');
end $$;

-- What drive_reconcile does, minus Drive: the folder id, then the closing call.
create function pg_temp.reconcile(p_n integer) returns text language plpgsql as $$
declare
  s jsonb := public.drive_desired_state(pg_temp.reel(p_n));
begin
  if (s ->> 'folder_needed')::boolean and s -> 'reel' ->> 'folder_id' is null then
    perform public.save_drive_folder(pg_temp.reel(p_n), 'reel', 'folder_' || lpad(p_n::text, 6, '0'));
  end if;
  return public.mark_drive_reconciled(pg_temp.reel(p_n), s -> 'kit' ->> 'hash');
end $$;

-- Upload of a small file by p_actor for the open task of reel p_n.
create function pg_temp.upload(p_actor text, p_n integer, p_ext text, p_mime text) returns uuid
language plpgsql as $$
declare
  v jsonb;
  v_id uuid;
begin
  v := public.prepare_upload_as(pg_temp.uid(p_actor), (pg_temp.task(p_n)).id, p_ext, p_mime, 1000);
  perform pg_temp.eq(v ->> 'code', 'ok', 'prepare upload on reel ' || p_n);
  v_id := (v ->> 'file_id')::uuid;
  perform pg_temp.eq(public.finish_upload_as(pg_temp.uid(p_actor), v_id, 'drive_' || replace(v_id::text, '-', ''),
                                             'https://drive.google.com/file/d/' || v_id || '/view'),
                     'ok', 'finish upload on reel ' || p_n);
  return v_id;
end $$;

create function pg_temp.drive_jobs(p_n integer) returns integer language sql as $$
  select count(*)::integer from job_outbox
   where kind = 'drive_reconcile' and dedup_key = 'drive:' || pg_temp.reel(p_n) and done_at is null;
$$;

-------------------------------------------------------------------------------
-- 1. R1: one reel per state, Drive off, link deliveries
-------------------------------------------------------------------------------

select pg_temp.eq((select value from app_config where key = 'drive_enabled'), 'false'::jsonb, 'Drive off at start');
select pg_temp.new_reel(n) from generate_series(1, 7) n;
select pg_temp.ok('0b', n, 'deliver') from generate_series(1, 7) n;
select pg_temp.ok('0d', n, 'approve', pg_temp.rev(n)) from generate_series(1, 7) n;
-- 101 stays confermato (dubbing assigned).
select pg_temp.ok('0e', n, 'accept') from generate_series(2, 7) n;
-- 102 stays doppiaggio with the dubbing in progress.
select pg_temp.ok('0e', n, 'deliver', pg_temp.audio_link(n)) from generate_series(3, 7) n;
-- 103 stays doppiaggio with the audio approval open.
select pg_temp.ok('0d', n, 'approve') from generate_series(4, 7) n;
-- 104 stays animazione with the animation assigned.
select pg_temp.ok('91', n, 'accept') from generate_series(5, 7) n;
-- 105 stays animazione with the animation in progress.
select pg_temp.ok('91', n, 'deliver', pg_temp.video_done(n)) from generate_series(6, 7) n;
-- 106 stays approvazione_finale.
select pg_temp.ok('0d', 7, 'approve');
-- 107 programmato with the scheduling open.

select pg_temp.eq((select string_agg(pg_temp.state(n) || '/' || (pg_temp.task(n)).kind || '/' || (pg_temp.task(n)).status, ' ' order by n)
                     from generate_series(1, 7) n),
                  'confermato/dubbing/assigned doppiaggio/dubbing/in_progress doppiaggio/audio_approval/in_progress '
                  'animazione/animation/assigned animazione/animation/in_progress '
                  'approvazione_finale/final_approval/in_progress programmato/scheduling/in_progress',
                  'one reel per R1 state');
select pg_temp.eq((select count(*)::integer from tasks where reel_id = any (array(select pg_temp.reel(n) from generate_series(1, 7) n))
                    and requires_drive), 0, 'R1 tasks need no Drive');
select pg_temp.eq((select count(*)::integer from job_outbox where kind = 'drive_reconcile'), 0, 'no Drive job while Drive is off');
select pg_temp.eq((pg_temp.task(5)).notified_at is not null, true, 'R1 animation notified without a kit');

-- Uploads are refused while Drive is off.
select pg_temp.eq(public.prepare_upload_as(pg_temp.uid('0e'), (pg_temp.task(2)).id, 'wav', 'audio/wav', 1000) ->> 'code',
                  'drive_disabled', 'upload with Drive off');

-------------------------------------------------------------------------------
-- 2. Switch to R2: drive_enabled, drive_backfill, reconcile (legacy kits)
-------------------------------------------------------------------------------

do $$ begin
  perform public.drive_backfill();
  raise exception 'FAIL: drive_backfill ran with Drive off';
exception when raise_exception then
  if sqlerrm not like 'drive_disabled%' then raise; end if;
end $$;

select pg_temp.eq(public.set_app_config('drive_enabled', 'true'), 'ok', 'Drive on (service role)');
select pg_temp.eq(public.drive_backfill(), 7, 'backfill: the 7 reels from confermato on');
select pg_temp.eq(public.drive_backfill(), 7, 'backfill again');
select pg_temp.eq((select string_agg(pg_temp.drive_jobs(n)::text, '' order by n) from generate_series(1, 7) n),
                  '1111111', 'one job per reel, deduplicated');

-- Kits from animazione on only; the legacy kit is the approved dubbing link.
select pg_temp.eq(public.drive_desired_state(pg_temp.reel(3)) -> 'kit', 'null'::jsonb, 'no kit before animazione');
select pg_temp.eq(public.drive_desired_state(pg_temp.reel(4)) -> 'kit' ->> 'audio_url', 'https://link.example/a4.wav', 'legacy kit link');
-- I6c: the link comes from the approved delivery, not from the reel column.
update reels set audio_drive_url = 'https://elsewhere.example/other.wav' where id = pg_temp.reel(4);
select pg_temp.eq(public.drive_desired_state(pg_temp.reel(4)) -> 'kit' ->> 'audio_url', 'https://link.example/a4.wav', 'I6c: link of the approved dubbing');
select pg_temp.eq(public.drive_desired_state(pg_temp.reel(4)) -> 'folder_needed', 'true'::jsonb, 'folder needed');

select pg_temp.eq(pg_temp.reconcile(n), 'ok', 'reconcile reel ' || n) from generate_series(1, 7) n;
select pg_temp.eq((select string_agg((kit_ready_at is not null)::text, ' ' order by code) from reels
                    where id = any (array(select pg_temp.reel(n) from generate_series(1, 7) n))),
                  'false false false true true true true', 'legacy kits ready from animazione on');
select pg_temp.eq((select drive_folder_id from reels where id = pg_temp.reel(1)), 'folder_000001', 'folder id saved');
-- The first saved id wins; a stale one can be replaced.
select pg_temp.eq(public.save_drive_folder(pg_temp.reel(1), 'reel', 'folder_other_1'), 'folder_000001', 'first folder id wins');
select pg_temp.eq(public.save_drive_folder(pg_temp.reel(1), 'reel', 'folder_new_1', 'folder_000001'), 'folder_new_1', 'stale folder id replaced');
select pg_temp.eq(public.save_drive_folder(pg_temp.reel(1), 'batch', 'folder_batch_1'), 'folder_batch_1', 'batch folder');
select pg_temp.eq((select drive_folder_id from batches where id = '20000000-0000-0000-0000-000000000001'), 'folder_batch_1', 'batch folder saved');

-------------------------------------------------------------------------------
-- 3. Every R1 task closes up to programmato; new tasks follow Drive
-------------------------------------------------------------------------------

-- 107: scheduling.
select pg_temp.eq(private.schedule_reel(pg_temp.uid('92'), pg_temp.reel(7), 'Caption', now() + interval '1 day'), 'ok', '107 scheduled');

-- 106: final approval.
select pg_temp.ok('0d', 6, 'approve');

-- 105: R1 animation in progress delivers a link; the final approval sends it
-- back to the animator: the new task needs Drive and starts at once (legacy
-- kit ready).
select pg_temp.ok('91', 5, 'deliver', pg_temp.video_done(5));
select pg_temp.ok('0d', 5, 'send_back', '{"to":"animation"}');
select pg_temp.eq((pg_temp.task(5)).requires_drive, true, '105 send-back task needs Drive');
select pg_temp.eq((pg_temp.task(5)).notified_at is not null and (pg_temp.task(5)).due_at is not null, true, '105 starts at once on the legacy kit');
select pg_temp.eq(pg_temp.act('91', 5, 'deliver', pg_temp.video_done(5)), 'file_missing', '105 a link is not enough now');
select pg_temp.upload('91', 5, 'mp4', 'video/mp4');
select pg_temp.ok('91', 5, 'deliver', '{"editing_done":true,"subtitles":true}');
select pg_temp.ok('0d', 5, 'approve');

-- 104: R1 animation assigned: no kit gate, delivers a link.
select pg_temp.ok('91', 4, 'accept');
select pg_temp.ok('91', 4, 'deliver', pg_temp.video_done(4));
select pg_temp.ok('0d', 4, 'approve');

-- 103: audio approval open at the switch (audio as a link): approving it
-- clears the kit, the new animation waits for the legacy kit.
select pg_temp.ok('0d', 3, 'approve');
select pg_temp.eq((pg_temp.task(3)).requires_drive, true, '103 animation needs Drive');
select pg_temp.eq((pg_temp.task(3)).notified_at, null::timestamptz, '103 animation not notified before the kit');
select pg_temp.eq((pg_temp.task(3)).due_at, null::timestamptz, '103 no clock before the kit');
select pg_temp.eq((select count(*)::integer from job_outbox where payload ->> 'task_id' = (pg_temp.task(3)).id::text), 0, '103 no message yet');
select pg_temp.eq(pg_temp.act('91', 3, 'accept'), 'kit_not_ready', '103 accept before the kit');
select pg_temp.eq(pg_temp.drive_jobs(3), 1, '103 reconcile queued');
select pg_temp.eq(public.drive_desired_state(pg_temp.reel(3)) -> 'kit' ->> 'audio_url', 'https://link.example/a3.wav', '103 legacy kit');
select pg_temp.eq(pg_temp.reconcile(3), 'ok', '103 kit written');
select pg_temp.eq((pg_temp.task(3)).notified_at is not null and (pg_temp.task(3)).due_at is not null, true, '103 starts at kit ready');
select pg_temp.eq((select count(*)::integer from job_outbox
                    where payload ->> 'task_id' = (pg_temp.task(3)).id::text and payload ->> 'event' = 'assignment'),
                  1, '103 one assignment message');
select pg_temp.eq(pg_temp.reconcile(3), 'ok', '103 reconcile again');
select pg_temp.eq((select count(*)::integer from job_outbox
                    where payload ->> 'task_id' = (pg_temp.task(3)).id::text and payload ->> 'event' = 'assignment'),
                  1, '103 the thresholds start once');
select pg_temp.ok('91', 3, 'accept');
select pg_temp.upload('91', 3, 'mov', 'video/quicktime');
select pg_temp.ok('91', 3, 'deliver', '{"editing_done":true,"subtitles":true}');
select pg_temp.ok('0d', 3, 'approve');

-- 102: R1 dubbing in progress delivers a link; then the new path.
select pg_temp.ok('0e', 2, 'deliver', pg_temp.audio_link(2));
select pg_temp.ok('0d', 2, 'approve');
select pg_temp.eq(pg_temp.reconcile(2), 'ok', '102 kit');
select pg_temp.ok('91', 2, 'accept');
select pg_temp.upload('91', 2, 'mp4', 'video/mp4');
select pg_temp.ok('91', 2, 'deliver', '{"editing_done":true,"subtitles":true}');
select pg_temp.ok('0d', 2, 'approve');

-- 101: R1 dubbing assigned: accept and a link still work.
select pg_temp.ok('0e', 1, 'accept');
select pg_temp.ok('0e', 1, 'deliver', pg_temp.audio_link(1));
select pg_temp.ok('0d', 1, 'approve');
select pg_temp.eq(pg_temp.reconcile(1), 'ok', '101 kit');
select pg_temp.ok('91', 1, 'accept');
select pg_temp.upload('91', 1, 'mp4', 'video/mp4');
select pg_temp.ok('91', 1, 'deliver', '{"editing_done":true,"subtitles":true}');
select pg_temp.ok('0d', 1, 'approve');

select pg_temp.eq((select string_agg(pg_temp.state(n), ' ' order by n) from generate_series(1, 7) n),
                  'programmato programmato programmato programmato programmato programmato programmato',
                  'every reel reached programmato');
select pg_temp.eq((select count(*)::integer from task_events
                    where reel_id = any (array(select pg_temp.reel(n) from generate_series(1, 7) n))
                      and code in ('kit_not_ready', 'file_missing')
                      and task_id in (select id from tasks where not requires_drive)),
                  0, 'no R1 task refused for Drive');

-------------------------------------------------------------------------------
-- 4. Uploads: who, versions, names, limits (reel 108, Drive on)
-------------------------------------------------------------------------------

select pg_temp.new_reel(8);
select pg_temp.ok('0b', 8, 'deliver');
select pg_temp.ok('0d', 8, 'approve', pg_temp.rev(8));
select pg_temp.eq((pg_temp.task(8)).requires_drive, true, 'dubbing born with Drive on');
select pg_temp.eq(public.prepare_upload_as(pg_temp.uid('0e'), (pg_temp.task(8)).id, 'wav', 'audio/wav', 1000) ->> 'code',
                  'invalid_state', 'upload before accepting');
select pg_temp.ok('0e', 8, 'accept');
select pg_temp.eq(public.prepare_upload_as(pg_temp.uid('93'), (pg_temp.task(8)).id, 'wav', 'audio/wav', 1000) ->> 'code',
                  'not_authorized', 'upload by someone else');
select pg_temp.eq(public.prepare_upload_as(pg_temp.uid('0e'), (pg_temp.task(8)).id, 'mp4', 'video/mp4', 1000) ->> 'code',
                  'invalid_input', 'video on a dubbing task');
select pg_temp.eq(public.prepare_upload_as(pg_temp.uid('0e'), (pg_temp.task(8)).id, 'wav', 'video/mp4', 1000) ->> 'code',
                  'invalid_input', 'audio extension with a video type');
select pg_temp.eq(public.prepare_upload_as(pg_temp.uid('0e'), (pg_temp.task(8)).id, 'wav', 'audio/wav', 301 * 1024 * 1024) ->> 'code',
                  'invalid_input', 'audio over 300 MB');
select pg_temp.eq(pg_temp.act('0e', 8, 'deliver', pg_temp.audio_link(8)), 'file_missing', 'a link on a Drive task');

select pg_temp.eq(public.prepare_upload_as(pg_temp.uid('0e'), (pg_temp.task(8)).id, 'WAV', 'audio/x-wav', 300 * 1024 * 1024)
                    - 'file_id' - 'reel_id' - 'folder_id',
                  '{"code":"ok","kind":"audio","name":"PP-2610-108_audio_v1.wav","version":1}'::jsonb, 'first version');
create temp table up as
  select id, version from reel_files where reel_id = pg_temp.reel(8) order by version;
select pg_temp.eq(public.finish_upload_as(pg_temp.uid('93'), (select id from up where version = 1), 'drive_aaaaaaaaaaaaaaaa', 'https://drive.google.com/a'),
                  'not_authorized', 'finish by someone else');
select pg_temp.eq(public.finish_upload_as(pg_temp.uid('0e'), (select id from up where version = 1), 'bad id', 'https://drive.google.com/a'),
                  'invalid_input', 'finish with a bad Drive id');
select pg_temp.eq(public.finish_upload_as(pg_temp.uid('0e'), (select id from up where version = 1), 'drive_aaaaaaaaaaaaaaaa', 'https://drive.google.com/a'),
                  'ok', 'finish v1');
select pg_temp.eq(public.finish_upload_as(pg_temp.uid('0e'), (select id from up where version = 1), 'drive_aaaaaaaaaaaaaaaa', 'https://drive.google.com/a'),
                  'ok', 'finish v1 again (idempotent)');
select pg_temp.eq((select audio_drive_url from reels where id = pg_temp.reel(8)), 'https://drive.google.com/a', 'finish writes the legacy URL');
select pg_temp.eq(public.prepare_upload_as(pg_temp.uid('0e'), (pg_temp.task(8)).id, 'mp3', 'application/octet-stream', 5000) ->> 'name',
                  'PP-2610-108_audio_v2.mp3', 'second version');
insert into up select id, version from reel_files where reel_id = pg_temp.reel(8) and version = 2;
select pg_temp.eq(public.finish_upload_as(pg_temp.uid('0e'), (select id from up where version = 2), 'drive_bbbbbbbbbbbbbbbb', 'https://drive.google.com/b'),
                  'ok', 'finish v2');
select pg_temp.eq(public.drive_desired_state(pg_temp.reel(8)) -> 'to_archive' -> 0 ->> 'drive_file_id', 'drive_aaaaaaaaaaaaaaaa', 'v1 superseded → archive');
select pg_temp.eq(public.archive_drive_files(array[(select id from up where version = 1)]), 1, 'v1 archived');
select pg_temp.eq(jsonb_array_length(public.drive_desired_state(pg_temp.reel(8)) -> 'to_archive'), 0, 'nothing else to archive');
-- A new upload replaces the person's unfinished one (a closed tab): no
-- lockout, the old row fails.
select pg_temp.eq(public.prepare_upload_as(pg_temp.uid('0e'), (pg_temp.task(8)).id, 'wav', 'audio/wav', 1000) ->> 'name',
                  'PP-2610-108_audio_v3.wav', 'third upload started');
select pg_temp.eq(public.prepare_upload_as(pg_temp.uid('0e'), (pg_temp.task(8)).id, 'wav', 'audio/wav', 1000) ->> 'name',
                  'PP-2610-108_audio_v4.wav', 'fourth upload started');
select pg_temp.eq((select string_agg(status, ' ' order by version) from reel_files where reel_id = pg_temp.reel(8) and version > 2),
                  'failed uploading', 'the unfinished upload is replaced');

-- The newest ready file of the task is delivered.
select pg_temp.ok('0e', 8, 'deliver');
select pg_temp.eq((select payload ->> 'file_id' from tasks where reel_id = pg_temp.reel(8) and kind = 'dubbing'),
                  (select id::text from up where version = 2), 'delivery records the file');
select pg_temp.eq(public.fail_upload((select id from up where version = 2)), 'ok', 'fail_upload on a ready file does nothing');
select pg_temp.eq((select status from reel_files where id = (select id from up where version = 2)), 'ready', 'ready file untouched');

-------------------------------------------------------------------------------
-- 5. Approval marks the file; the kit gate; shares follow the tasks
-------------------------------------------------------------------------------

-- Dubbing delivered: no share (the approver is internal).
select pg_temp.eq(public.drive_desired_state(pg_temp.reel(8)) -> 'shares', '[]'::jsonb, 'no share during the audio approval');
select pg_temp.ok('0d', 8, 'approve');
select pg_temp.eq((select approved_at is not null from reel_files where id = (select id from up where version = 2)), true, 'approved audio marked');
select pg_temp.eq(public.drive_desired_state(pg_temp.reel(8)) -> 'kit' ->> 'audio_ref', 'file:' || (select id from up where version = 2), 'kit on the approved file');
select pg_temp.eq((pg_temp.task(8)).kind || '/' || (pg_temp.task(8)).status, 'animation/assigned', 'animation assigned');
select pg_temp.eq(pg_temp.act('91', 8, 'accept'), 'kit_not_ready', 'accept waits for the kit');

-- The script changes while the job runs: the job's hash is stale.
create temp table snap as select public.drive_desired_state(pg_temp.reel(8)) as s;
update reels set hook = 'Hook nuovo' where id = pg_temp.reel(8);
select pg_temp.eq(public.mark_drive_reconciled(pg_temp.reel(8), (select s -> 'kit' ->> 'hash' from snap)), 'stale', 'stale kit hash');
select pg_temp.eq((select kit_ready_at from reels where id = pg_temp.reel(8)), null::timestamptz, 'stale: kit not ready');
select pg_temp.eq(pg_temp.reconcile(8), 'ok', 'kit of the new script');
select pg_temp.ok('91', 8, 'accept');
select pg_temp.eq(public.drive_desired_state(pg_temp.reel(8)) -> 'shares',
                  '[{"role":"reader","email":"animatore.google@gmail.test","user_id":"00000000-0000-0000-0000-000000000091"}]'::jsonb,
                  'share to the animator, by drive_email');

-- A script change from animazione on queues the kit again.
update job_outbox set done_at = now() where dedup_key = 'drive:' || pg_temp.reel(8);
update reels set corpo = 'Corpo nuovo' where id = pg_temp.reel(8);
select pg_temp.eq(pg_temp.drive_jobs(8), 1, 'script change → reconcile');

-- What the job reports about shares.
select pg_temp.eq(public.record_drive_share(pg_temp.reel(8), pg_temp.uid('91'), 'Animatore.Google@Gmail.test', 'granted', 'perm-91'), 'ok', 'share granted');
select pg_temp.eq((select count(*)::integer from reel_folder_shares where reel_id = pg_temp.reel(8) and revoked_at is null), 1, 'one live share');

-- Final approval sent back to dubbing: the dubber gets the folder, the
-- animator loses it (the job revokes).
select pg_temp.upload('91', 8, 'mp4', 'video/mp4');
select pg_temp.ok('91', 8, 'deliver', '{"editing_done":true,"subtitles":true}');
select pg_temp.eq(public.drive_desired_state(pg_temp.reel(8)) -> 'shares', '[]'::jsonb, 'share revoked after the delivery');
select pg_temp.eq(pg_temp.act('0d', 8, 'send_back', '{"to":"dubbing"}', 'telegram'), 'invalid_input', 'to dubbing only from the app');
select pg_temp.ok('0d', 8, 'send_back', '{"to":"dubbing"}');
select pg_temp.eq(public.drive_desired_state(pg_temp.reel(8)) -> 'shares' -> 0 ->> 'email', 'dubber@example.test', 'share to the dubber');
-- A new audio: v3. The approved v2 stays at the root while v3 waits.
select pg_temp.upload('0e', 8, 'wav', 'audio/wav');
select pg_temp.eq(jsonb_array_length(public.drive_desired_state(pg_temp.reel(8)) -> 'to_archive'), 0, 'approved v2 kept while v5 waits');
select pg_temp.ok('0e', 8, 'deliver');
select pg_temp.ok('0d', 8, 'approve');
select pg_temp.eq(public.drive_desired_state(pg_temp.reel(8)) -> 'to_archive' -> 0 ->> 'name', 'PP-2610-108_audio_v2.mp3', 'v2 superseded by the approved v3');
-- Back to the same animator, in progress, waiting for the regenerated kit.
select pg_temp.eq((pg_temp.task(8)).status || '/' || coalesce((pg_temp.task(8)).notified_at::text, 'waiting'), 'in_progress/waiting', 'animator waits for the new kit');
select pg_temp.eq(pg_temp.act('91', 8, 'deliver', '{"editing_done":true,"subtitles":true}'), 'kit_not_ready', 'deliver waits for the kit');
select pg_temp.eq(pg_temp.reconcile(8), 'ok', 'new kit');
select pg_temp.eq((pg_temp.task(8)).notified_at is not null, true, 'animator notified at kit ready');

-- Sharing errors warn once.
select pg_temp.eq(public.record_drive_share(pg_temp.reel(8), pg_temp.uid('0e'), 'dubber@example.test', 'error', null, 'not a Google account'), 'ok', 'share error');
select pg_temp.eq(public.record_drive_share(pg_temp.reel(8), pg_temp.uid('0e'), 'dubber@example.test', 'error', null, 'not a Google account'), 'ok', 'share error again');
select pg_temp.eq((select count(*)::integer from job_outbox where payload ->> 'event' = 'drive_issue' and payload ->> 'code' = 'share_failed'),
                  1, 'one warning per failing share');
select pg_temp.eq(public.record_drive_share(pg_temp.reel(8), null, 'dubber@example.test', 'revoked'), 'ok', 'share closed');
select pg_temp.eq((select count(*)::integer from reel_folder_shares where reel_id = pg_temp.reel(8) and email = 'dubber@example.test' and revoked_at is null),
                  0, 'no live share left for the dubber');

-------------------------------------------------------------------------------
-- 6. Drive off again (incident): open tasks back to links, the waiting
--    animation starts (I6a)
-------------------------------------------------------------------------------

select pg_temp.new_reel(9);
select pg_temp.ok('0b', 9, 'deliver');
select pg_temp.ok('0d', 9, 'approve', pg_temp.rev(9));
select pg_temp.ok('0e', 9, 'accept');
select pg_temp.upload('0e', 9, 'wav', 'audio/wav');
select pg_temp.ok('0e', 9, 'deliver');
select pg_temp.ok('0d', 9, 'approve');
select pg_temp.eq((pg_temp.task(9)).notified_at, null::timestamptz, '109 animation waits for the kit');
select pg_temp.eq((public.job_health(now()) ->> 'kit_waiting')::integer, 0, 'kit_waiting: not yet');
select pg_temp.eq((public.job_health(now() + interval '31 minutes') ->> 'kit_waiting')::integer, 1, 'kit_waiting after 30 minutes');
-- The folder is shared with the animator (as the job would record it).
select pg_temp.eq(public.record_drive_share(pg_temp.reel(9), pg_temp.uid('91'), 'animatore.google@gmail.test', 'granted', 'perm-109'), 'ok', '109 shared');
update job_outbox set done_at = now() where dedup_key = 'drive:' || pg_temp.reel(9) and done_at is null;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select pg_temp.eq(public.set_app_config('drive_enabled', 'false'), 'not_authorized', 'only admins switch Drive');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select pg_temp.eq(public.set_app_config('drive_enabled', 'false'), 'ok', 'admin switches Drive off');
reset role;
select set_config('request.jwt.claim.sub', '', false);

select pg_temp.eq((select count(*)::integer from tasks where requires_drive and status in ('unassigned', 'assigned', 'in_progress')),
                  0, 'no open task needs Drive');
select pg_temp.eq((pg_temp.task(9)).notified_at is not null and (pg_temp.task(9)).due_at is not null, true, 'I6a: the waiting animation starts');
select pg_temp.eq((select count(*)::integer from task_events where task_id = (pg_temp.task(9)).id and op = 'drive_off'), 1, 'drive_off logged');
select pg_temp.ok('91', 9, 'accept');
-- Drive off, but the folder is still shared: the job is queued (it only
-- revokes), so a task closing during an incident does not leave access open.
select pg_temp.eq(pg_temp.drive_jobs(9), 1, 'Drive off: a shared reel still gets its job');
select pg_temp.ok('91', 9, 'deliver', pg_temp.video_done(9));
select pg_temp.eq(public.set_app_config('drive_enabled', 'true'), 'ok', 'Drive on again');
select pg_temp.eq((pg_temp.task(9)).requires_drive, false, 'open tasks stay on links');

-------------------------------------------------------------------------------
-- 7. A migrated reel past dubbing with no audio on record (I6b)
-------------------------------------------------------------------------------

insert into reels (id, batch_id, page_id, code, ordinal, title, hook, phase)
values (pg_temp.reel(10), '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
        'PP-2610-110', 110, 'Reel migrato', 'Hook', 'editing');
insert into tasks (reel_id, kind, status, assignee_id, accepted_at, origin, escalation_paused, notified_at)
values (pg_temp.reel(10), 'animation', 'in_progress', pg_temp.uid('91'), now(), 'migration', true, now());
select pg_temp.eq(pg_temp.state(10), 'animazione', 'migrated reel in animazione');
select pg_temp.eq(public.drive_desired_state(pg_temp.reel(10)) -> 'kit' ->> 'audio_ref', 'none', 'I6b: no audio on record');
select pg_temp.eq(pg_temp.reconcile(10), 'ok', 'script-only kit');
select pg_temp.eq((select kit_ready_at is not null from reels where id = pg_temp.reel(10)), true, 'I6b: script-only kit is ready');
select pg_temp.eq(pg_temp.reconcile(10), 'ok', 'reconcile again');
select pg_temp.eq((select count(*)::integer from job_outbox where payload ->> 'code' = 'kit_without_audio'), 1, 'I6b: the admins hear once');

-------------------------------------------------------------------------------
-- 8. Kit files reported by the job
-------------------------------------------------------------------------------

select pg_temp.eq(public.register_kit_file(pg_temp.reel(10), 'script', 1, 'drive_script_110_v1', 'PP-2610-110_script_v1.txt', 120,
                                           'https://drive.google.com/s1', 'h1'), 'ok', 'kit script v1');
select pg_temp.eq(public.register_kit_file(pg_temp.reel(10), 'script', 1, 'drive_script_110_v1b', 'PP-2610-110_script_v1.txt', 120,
                                           'https://drive.google.com/s1', 'h1'), 'conflict', 'same version twice');
select pg_temp.eq(public.register_kit_file(pg_temp.reel(10), 'audio', 1, 'drive_x_110', 'x', 1, 'https://x', 'h'), 'invalid_input', 'kit files are script or other');
select pg_temp.eq(public.register_kit_file(pg_temp.reel(10), 'script', 2, 'drive_script_110_v2', 'PP-2610-110_script_v2.txt', 130,
                                           'https://drive.google.com/s2', 'h2'), 'ok', 'kit script v2');
select pg_temp.eq(public.drive_desired_state(pg_temp.reel(10)) -> 'to_archive' -> 0 ->> 'name', 'PP-2610-110_script_v1.txt', 'old script → archive');
-- A legacy kit's audio link stays with its generation only.
select pg_temp.eq(public.register_kit_file(pg_temp.reel(10), 'other', 1, 'drive_link_110_v1', 'PP-2610-110_audio_link.txt', 40,
                                           'https://drive.google.com/l1', 'h2'), 'ok', 'audio link of kit h2');
select pg_temp.eq(jsonb_array_length(public.drive_desired_state(pg_temp.reel(10)) -> 'to_archive'), 1, 'link kept with its kit');
select pg_temp.eq(public.register_kit_file(pg_temp.reel(10), 'script', 3, 'drive_script_110_v3', 'PP-2610-110_script_v3.txt', 130,
                                           'https://drive.google.com/s3', 'h3'), 'ok', 'kit h3 without a link');
select pg_temp.eq((select string_agg(e ->> 'name', ' ' order by e ->> 'name')
                     from jsonb_array_elements(public.drive_desired_state(pg_temp.reel(10)) -> 'to_archive') e),
                  'PP-2610-110_audio_link.txt PP-2610-110_script_v1.txt PP-2610-110_script_v2.txt', 'old link archived with its kit');
select pg_temp.eq(public.drive_desired_state(pg_temp.reel(10)) -> 'kit' -> 'next_version', '{"script": 4, "other": 2}'::jsonb, 'next kit versions');

-------------------------------------------------------------------------------
-- 9. RLS: files with the reel, shares for admins
-------------------------------------------------------------------------------

set role authenticated;
-- The animator holds the open task of 110 (and 103's tasks are closed, but
-- delivered within 7 days: still visible).
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000091', false);
select pg_temp.eq((select count(*)::integer from reel_files where reel_id = pg_temp.reel(10)), 4, 'animator reads the kit files');
select pg_temp.eq((select count(*)::integer from reel_files where reel_id = pg_temp.reel(9)), 1, 'animator reads the audio of 109');
select pg_temp.eq((select count(*)::integer from reel_folder_shares), 0, 'external reads no share');
-- The reserve dubber never worked on these reels.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000093', false);
select pg_temp.eq((select count(*)::integer from reel_files), 0, 'other external reads no file');
-- Internals read files; only admins read shares.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
select pg_temp.eq((select count(*)::integer from reel_files where reel_id = pg_temp.reel(8)) > 0, true, 'internal reads files');
select pg_temp.eq((select count(*)::integer from reel_folder_shares), 0, 'internal non-admin reads no share');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select pg_temp.eq((select count(*)::integer from reel_folder_shares) > 0, true, 'admin reads shares');
-- No writes for users.
do $$ begin
  insert into reel_files (reel_id, kind, version, name) values ('30000000-0000-0000-0000-000000000110', 'audio', 9, 'x');
  raise exception 'FAIL: user inserted a reel file';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  update reel_files set status = 'ready' where reel_id = '30000000-0000-0000-0000-000000000110';
  raise exception 'FAIL: user updated a reel file';
exception when insufficient_privilege then null;
end $$;
-- Service-role functions are denied to users.
do $$
declare
  v_call text;
begin
  foreach v_call in array array[
    'select public.drive_desired_state(gen_random_uuid())',
    'select public.save_drive_folder(gen_random_uuid(), ''reel'', ''folder_xxxxxxxx'')',
    'select public.register_kit_file(gen_random_uuid(), ''script'', 1, ''x'', ''x'', 1, ''x'', ''x'')',
    'select public.archive_drive_files(array[gen_random_uuid()])',
    'select public.record_drive_share(gen_random_uuid(), null, ''x@y'', ''revoked'')',
    'select public.mark_drive_reconciled(gen_random_uuid(), null)',
    'select public.drive_backfill()',
    'select public.prepare_upload_as(gen_random_uuid(), gen_random_uuid(), ''wav'', ''audio/wav'', 1)',
    'select public.finish_upload_as(gen_random_uuid(), gen_random_uuid(), ''x'', ''x'')',
    'select public.fail_upload(gen_random_uuid())'
  ] loop
    begin
      execute v_call;
      raise exception 'FAIL: allowed to a user: %', v_call;
    exception when insufficient_privilege then null;
    end;
  end loop;
end $$;
reset role;

-------------------------------------------------------------------------------
-- 10. Sweep: stale uploads fail, a share without its task is reconciled
-------------------------------------------------------------------------------

select pg_temp.new_reel(11);
select pg_temp.ok('0b', 11, 'deliver');
select pg_temp.ok('0d', 11, 'approve', pg_temp.rev(11));
select pg_temp.ok('0e', 11, 'accept');
select pg_temp.eq(public.prepare_upload_as(pg_temp.uid('0e'), (pg_temp.task(11)).id, 'wav', 'audio/wav', 1000) ->> 'code', 'ok', 'upload left halfway');
-- A share the job granted to someone who no longer holds a task here.
select pg_temp.eq(public.record_drive_share(pg_temp.reel(4), pg_temp.uid('91'), 'animatore.google@gmail.test', 'granted', 'perm-x'), 'ok', 'stray share');
update job_outbox set done_at = now() where kind = 'drive_reconcile' and done_at is null;

create temp table sw as select public.sweep_tasks(now() + interval '25 hours') as r;
select pg_temp.eq((select (r ->> 'uploads_failed')::integer >= 1 from sw), true, 'stale upload failed');
select pg_temp.eq((select status from reel_files where reel_id = pg_temp.reel(11)), 'failed', 'upload row failed');
select pg_temp.eq(pg_temp.drive_jobs(4), 1, 'stray share → reconcile');
-- What the job does next: revoke it.
select pg_temp.eq(public.record_drive_share(pg_temp.reel(4), null, 'animatore.google@gmail.test', 'revoked', 'perm-x'), 'ok', 'stray share revoked');
-- At most every 30 minutes per reel: a revocation that keeps failing does
-- not fill the queue.
select pg_temp.eq(public.record_drive_share(pg_temp.reel(5), pg_temp.uid('91'), 'animatore.google@gmail.test', 'granted', 'perm-y'), 'ok', 'stray share on 105');
update job_outbox set done_at = now() where kind = 'drive_reconcile' and done_at is null;
insert into job_outbox (kind, payload, dedup_key, done_at)
values ('drive_reconcile', jsonb_build_object('reel_id', pg_temp.reel(5)), 'drive:' || pg_temp.reel(5), now());
select public.sweep_tasks(now() + interval '10 minutes');
select pg_temp.eq(pg_temp.drive_jobs(5), 0, 'stray share: a job ran 10 minutes ago, wait');
select public.sweep_tasks(now() + interval '31 minutes');
select pg_temp.eq(pg_temp.drive_jobs(5), 1, 'stray share: queued again after 30 minutes');
select pg_temp.eq(public.record_drive_share(pg_temp.reel(5), null, 'animatore.google@gmail.test', 'revoked', 'perm-y'), 'ok', 'stray share on 105 revoked');
-- A dead drive job is retried after an hour, once (the newest dead row
-- counts; older ones have a newer row).
update job_outbox set done_at = null, failed_at = now() - interval '2 hours'
 where dedup_key = 'drive:' || pg_temp.reel(4);
create temp table dead as select count(*)::integer as n from job_outbox where dedup_key = 'drive:' || pg_temp.reel(4);
select public.sweep_tasks(now());
select pg_temp.eq((select count(*)::integer from job_outbox where dedup_key = 'drive:' || pg_temp.reel(4) and done_at is null and failed_at is null),
                  1, 'dead drive job retried');
select public.sweep_tasks(now());
select pg_temp.eq((select count(*)::integer from job_outbox where dedup_key = 'drive:' || pg_temp.reel(4)), (select n + 1 from dead), 'retried once');
select pg_temp.eq((select requested_gen from job_outbox where dedup_key = 'drive:' || pg_temp.reel(4) and failed_at is null), 1, 'not requested again');
-- Three failures in a day: no more retries.
update job_outbox set failed_at = now() - interval '2 hours' where dedup_key = 'drive:' || pg_temp.reel(4) and failed_at is null;
insert into job_outbox (kind, payload, dedup_key, failed_at)
values ('drive_reconcile', jsonb_build_object('reel_id', pg_temp.reel(4)), 'drive:' || pg_temp.reel(4), now() - interval '2 hours');
select public.sweep_tasks(now());
select pg_temp.eq((select count(*)::integer from job_outbox where dedup_key = 'drive:' || pg_temp.reel(4) and failed_at is null), 0, 'no retry after three failures');

-- Every reel of this check is in the state its tasks derive.
select pg_temp.eq((select string_agg(code || ':' || state || '≠' || coalesce(private.derived_state(id)::text, 'null'), ', ')
                     from reels
                    where code like 'PP-2610-1__' and state is distinct from private.derived_state(id)),
                  null::text, 'state = derived state');

rollback;
