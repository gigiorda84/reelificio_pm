-- Task engine (docs/fase1-plan.md §S2): the full path idea → pubblicato with
-- distinct actors, refusals, reserve, send-back loops, DoD gate, script lock
-- and proposals, Express, migrated tasks, reassignment, offboarding, and the
-- final invariant "state = state derived from the tasks".
--
-- Actions go through private.task_action_core with an explicit actor (the
-- path task_action_as uses) and, where noted, through public.task_action as
-- a signed-in user.

-- People: d approver, DL delegate, S SMM (internal); e dubber titular,
-- G dubber reserve, F animator titular, H animator reserve, V validator
-- (external).
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000061', 'animator1@example.test'),
  ('00000000-0000-0000-0000-000000000062', 'animator2@example.test'),
  ('00000000-0000-0000-0000-000000000063', 'dubber2@example.test'),
  ('00000000-0000-0000-0000-000000000064', 'smm@example.test'),
  ('00000000-0000-0000-0000-000000000065', 'validator@example.test'),
  ('00000000-0000-0000-0000-000000000066', 'delegate@example.test');
update profiles set account_type = 'internal'
 where id in ('00000000-0000-0000-0000-000000000064', '00000000-0000-0000-0000-000000000066');
update profiles set external_kind = 'animator'
 where id in ('00000000-0000-0000-0000-000000000061', '00000000-0000-0000-0000-000000000062');
update profiles set external_kind = 'dubber' where id = '00000000-0000-0000-0000-000000000063';
update profiles set external_kind = 'validator' where id = '00000000-0000-0000-0000-000000000065';

update approval_groups
   set approver_id = '00000000-0000-0000-0000-00000000000d',
       delegate_id = '00000000-0000-0000-0000-000000000066'
 where is_default;
update pages
   set dubber_titular_id = '00000000-0000-0000-0000-00000000000e',
       dubber_reserve_id = '00000000-0000-0000-0000-000000000063',
       animator_titular_id = '00000000-0000-0000-0000-000000000061',
       animator_reserve_id = '00000000-0000-0000-0000-000000000062',
       validator_id = '00000000-0000-0000-0000-000000000065'
 where id = '10000000-0000-0000-0000-000000000001';
insert into raci_configs (page_id, phase, responsible)
values ('10000000-0000-0000-0000-000000000001', 'publication', '{00000000-0000-0000-0000-000000000064}');

-- Reel 3: new, in idea, empty script.
insert into reels (id, batch_id, page_id, code, ordinal, title) values
  ('30000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001', 'PP-2610-03', 3, 'Reel tre');

create function pg_temp.act(p_actor text, p_reel text, p_op text, p_payload jsonb default null,
                            p_note text default null, p_channel text default 'app')
returns text language sql as $$
  select private.task_action_core(
    ('00000000-0000-0000-0000-0000000000' || p_actor)::uuid,
    (select id from tasks where reel_id = ('30000000-0000-0000-0000-00000000000' || p_reel)::uuid
        and status in ('unassigned', 'assigned', 'in_progress')),
    p_op, p_note, p_payload, p_channel);
$$;

create function pg_temp.open_task(p_reel text)
returns tasks language sql as $$
  select * from tasks where reel_id = ('30000000-0000-0000-0000-00000000000' || p_reel)::uuid
     and status in ('unassigned', 'assigned', 'in_progress');
$$;

create function pg_temp.eq(p_got anyelement, p_want anyelement, p_label text)
returns void language plpgsql as $$
begin
  if p_got is distinct from p_want then
    raise exception 'FAIL: % — got %, want %', p_label, p_got, p_want;
  end if;
end $$;

create function pg_temp.state(p_reel text)
returns text language sql as $$
  select state::text from reels where id = ('30000000-0000-0000-0000-00000000000' || p_reel)::uuid;
$$;

create function pg_temp.rev(p_reel text)
returns jsonb language sql as $$
  select jsonb_build_object('rev', script_rev) from reels
   where id = ('30000000-0000-0000-0000-00000000000' || p_reel)::uuid;
$$;

-------------------------------------------------------------------------------
-- Writing and review (reel 3)
-------------------------------------------------------------------------------

-- Start writing: Responsible of script_writing (b) or admin, signed in.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
select pg_temp.eq(public.start_writing('20000000-0000-0000-0000-000000000001', 1), 'not_authorized', 'start_writing by c');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select pg_temp.eq(public.start_writing('20000000-0000-0000-0000-000000000001', 1), 'ok', 'start_writing by b');
reset role;
select pg_temp.eq(pg_temp.state('3'), 'bozza', 'state after start_writing');
select pg_temp.eq((pg_temp.open_task('3')).kind::text, 'writing', 'writing task');
select pg_temp.eq((pg_temp.open_task('3')).assignee_id, '00000000-0000-0000-0000-00000000000b'::uuid, 'writing to the Responsible');
select pg_temp.eq((select count(*) from job_outbox where dedup_key like 'start_writing:%')::int, 1, 'one grouped message');
select pg_temp.eq((pg_temp.open_task('3')).notified_at is not null, true, 'writing marked notified');

select pg_temp.eq(pg_temp.act('0c', '3', 'deliver'), 'not_authorized', 'deliver by a stranger');
select pg_temp.eq(pg_temp.act('0b', '3', 'deliver'), 'ok', 'writing delivered');
select pg_temp.eq(pg_temp.state('3'), 'revisione', 'state after writing');
select pg_temp.eq((pg_temp.open_task('3')).kind::text, 'review', 'review task');
select pg_temp.eq((pg_temp.open_task('3')).assignee_id, '00000000-0000-0000-0000-00000000000d'::uuid, 'review to the approver');

-- Script locked for members from revisione on; admins pass.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
do $$ begin
  update reels set hook = 'x' where id = '30000000-0000-0000-0000-000000000003';
  raise exception 'FAIL: member edited a script in revisione';
exception when insufficient_privilege then null;
end $$;
reset role;

select pg_temp.eq(pg_temp.act('0b', '3', 'approve', pg_temp.rev('3')), 'not_authorized', 'review approved by the author');
select pg_temp.eq(pg_temp.act('0d', '3', 'approve', pg_temp.rev('3')), 'script_missing', 'empty script');
update reels set hook = 'Lo sapevi che…', corpo = 'Il porcino…' where id = '30000000-0000-0000-0000-000000000003';
select pg_temp.eq(pg_temp.act('0d', '3', 'approve', '{"rev": 0}'), 'stale', 'old revision');
select pg_temp.eq(pg_temp.act('0d', '3', 'approve', '{}'), 'stale', 'no revision');

-- Approved by the approver, signed in: no validation flag → confermato.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', false);
select pg_temp.eq(public.task_action((pg_temp.open_task('3')).id, 'approve', 'ok', pg_temp.rev('3')), 'ok', 'review approved');
reset role;
select pg_temp.eq(pg_temp.state('3'), 'confermato', 'state after review');
select pg_temp.eq(exists (select 1 from reel_dod_items where reel_id = '30000000-0000-0000-0000-000000000003'
                          and key = 'script_validated'), true, 'DoD script_validated');
select pg_temp.eq((pg_temp.open_task('3')).kind::text || '/' || (pg_temp.open_task('3')).status::text,
                  'dubbing/assigned', 'dubbing waits for acceptance');
select pg_temp.eq((pg_temp.open_task('3')).assignee_id, '00000000-0000-0000-0000-00000000000e'::uuid, 'dubbing to the titular');
-- Acceptance SLA: 24 working hours (Batch).
select pg_temp.eq((select due_at = private.add_sla(started_at, 1440, 'batch') from tasks
                    where id = (pg_temp.open_task('3')).id), true, 'acceptance deadline');

-------------------------------------------------------------------------------
-- Dubbing: decline → reserve → unassigned → admin assigns → accept
-------------------------------------------------------------------------------

select pg_temp.eq(pg_temp.act('63', '3', 'accept'), 'not_authorized', 'accept by someone else');
select pg_temp.eq(pg_temp.act('0e', '3', 'deliver', '{"file_url":"https://x.it/a.wav"}'), 'invalid_state', 'deliver before accepting');
select pg_temp.eq(pg_temp.act('0e', '3', 'decline', null, 'Non posso'), 'ok', 'titular declines');
select pg_temp.eq((pg_temp.open_task('3')).assignee_id, '00000000-0000-0000-0000-000000000063'::uuid, 'to the reserve');
select pg_temp.eq((pg_temp.open_task('3')).attempt::int, 2, 'attempt 2');
select pg_temp.eq(pg_temp.act('63', '3', 'decline'), 'ok', 'reserve declines');
select pg_temp.eq((pg_temp.open_task('3')).status::text, 'unassigned', 'nobody left');
select pg_temp.eq((select payload ->> 'to' from job_outbox
                    where dedup_key = 'task:' || (pg_temp.open_task('3')).id || ':assignment'), 'admins', 'admins notified');
select pg_temp.eq(pg_temp.state('3'), 'confermato', 'still confermato');

select pg_temp.eq(private.assign_task('00000000-0000-0000-0000-00000000000d', (pg_temp.open_task('3')).id,
                  '00000000-0000-0000-0000-00000000000e'), 'not_authorized', 'assign by a non-admin');
select pg_temp.eq(private.assign_task('00000000-0000-0000-0000-00000000000a', (pg_temp.open_task('3')).id,
                  '00000000-0000-0000-0000-000000000061'), 'invalid_assignee', 'animator as dubber');
select pg_temp.eq(private.assign_task('00000000-0000-0000-0000-00000000000a', (pg_temp.open_task('3')).id,
                  '00000000-0000-0000-0000-00000000000e'), 'ok', 'admin assigns the titular again');
select pg_temp.eq((pg_temp.open_task('3')).status::text, 'assigned', 'reassigned dubbing waits for acceptance');

do $$ declare v_due timestamptz := (pg_temp.open_task('3')).due_at; begin
  perform pg_temp.eq(pg_temp.act('0e', '3', 'accept'), 'ok', 'titular accepts');
  perform pg_temp.eq(pg_temp.state('3'), 'doppiaggio', 'state after accept');
  perform pg_temp.eq((pg_temp.open_task('3')).due_at > v_due, true, 'work deadline replaces acceptance');
end $$;

-------------------------------------------------------------------------------
-- Dubbing delivery, audio approval loop
-------------------------------------------------------------------------------

select pg_temp.eq(pg_temp.act('0e', '3', 'deliver'), 'invalid_input', 'deliver without a link');
select pg_temp.eq(pg_temp.act('0e', '3', 'deliver', '{"file_url":"http://x.it/a.wav"}'), 'invalid_input', 'deliver with http');
select pg_temp.eq(pg_temp.act('0e', '3', 'deliver', '{"file_url":"https://drive.google.com/a"}'), 'ok', 'audio delivered');
select pg_temp.eq((select audio_drive_url from reels where id = '30000000-0000-0000-0000-000000000003'),
                  'https://drive.google.com/a', 'audio link saved');
select pg_temp.eq((pg_temp.open_task('3')).kind::text, 'audio_approval', 'audio approval task');

-- Proposals while locked: the dubber (open task) and the SMM (RACI) may
-- propose; an internal without role or task may not.
select pg_temp.eq(private.propose_text_change('00000000-0000-0000-0000-00000000000c',
  '30000000-0000-0000-0000-000000000003', 'hook', 'x'), 'not_authorized', 'proposal by a stranger');
select pg_temp.eq(private.propose_text_change('00000000-0000-0000-0000-000000000064',
  '30000000-0000-0000-0000-000000000003', 'titolo', 'x'), 'invalid_input', 'proposal on a bad field');

-- Audio sent back → same dubber, in progress, no new acceptance.
select pg_temp.eq(pg_temp.act('0d', '3', 'send_back', null, 'Rifai il finale'), 'ok', 'audio sent back');
select pg_temp.eq((pg_temp.open_task('3')).kind::text || '/' || (pg_temp.open_task('3')).status::text,
                  'dubbing/in_progress', 'dubbing again, in progress');
select pg_temp.eq((pg_temp.open_task('3')).assignee_id, '00000000-0000-0000-0000-00000000000e'::uuid, 'same dubber');
select pg_temp.eq(pg_temp.state('3'), 'doppiaggio', 'still doppiaggio');
select pg_temp.eq(pg_temp.act('0e', '3', 'deliver', '{"file_url":"https://drive.google.com/b"}'), 'ok', 'audio delivered again');

-- The delegate decides too.
select pg_temp.eq(pg_temp.act('66', '3', 'approve'), 'ok', 'delegate approves audio');
select pg_temp.eq(exists (select 1 from reel_dod_items where reel_id = '30000000-0000-0000-0000-000000000003'
                          and key = 'audio_recorded'), true, 'DoD audio_recorded');
select pg_temp.eq(pg_temp.state('3'), 'animazione', 'state after audio');
select pg_temp.eq((pg_temp.open_task('3')).kind::text || '/' || (pg_temp.open_task('3')).status::text,
                  'animation/assigned', 'animation waits for acceptance');
select pg_temp.eq((pg_temp.open_task('3')).assignee_id, '00000000-0000-0000-0000-000000000061'::uuid, 'animation to the titular');

-------------------------------------------------------------------------------
-- Animation, final approval loops
-------------------------------------------------------------------------------

select pg_temp.eq(pg_temp.act('61', '3', 'decline'), 'ok', 'animator declines');
select pg_temp.eq((pg_temp.open_task('3')).assignee_id, '00000000-0000-0000-0000-000000000062'::uuid, 'animation to the reserve');
-- Accepting restarts the clock on the work SLA (72 h), not the acceptance one.
select pg_temp.eq(pg_temp.act('62', '3', 'accept'), 'ok', 'reserve accepts the animation');
select pg_temp.eq((select due_at = private.add_sla(started_at, 4320, 'batch') from tasks
                    where id = (pg_temp.open_task('3')).id), true, 'animation work deadline after accept');
select pg_temp.eq(pg_temp.act('62', '3', 'deliver', '{"file_url":"https://drive.google.com/v"}'), 'invalid_input',
                  'animation without the DoD ticks');
select pg_temp.eq(pg_temp.act('62', '3', 'deliver',
  '{"file_url":"https://drive.google.com/v","editing_done":true,"subtitles":true}'), 'ok', 'video delivered');
select pg_temp.eq(pg_temp.state('3'), 'approvazione_finale', 'state after video');
select pg_temp.eq((select count(*) from reel_dod_items where reel_id = '30000000-0000-0000-0000-000000000003'
                    and key in ('editing_done', 'subtitles'))::int, 2, 'animator DoD items');

-- Send back to the animator (default, Telegram too).
select pg_temp.eq(pg_temp.act('0d', '3', 'send_back', '{"to":"dubbing"}', null, 'telegram'), 'invalid_input',
                  'send back to dubbing is app-only');
select pg_temp.eq(pg_temp.act('0d', '3', 'send_back', null, 'Sottotitoli sfasati', 'telegram'), 'ok', 'final sent back');
select pg_temp.eq((pg_temp.open_task('3')).kind::text || '/' || (pg_temp.open_task('3')).status::text
                  || '/' || (pg_temp.open_task('3')).assignee_id, 'animation/in_progress/00000000-0000-0000-0000-000000000062',
                  'same animator, in progress');
select pg_temp.eq((select closed_via from tasks where reel_id = '30000000-0000-0000-0000-000000000003'
                    and kind = 'final_approval' order by closed_at desc limit 1), 'telegram', 'closed_via telegram');
select pg_temp.eq(pg_temp.act('62', '3', 'deliver',
  '{"file_url":"https://drive.google.com/v2","editing_done":true,"subtitles":true}'), 'ok', 'video delivered again');

-- Send back to the dubber (app): audio redone, then animation returns to the
-- same animator already accepted.
select pg_temp.eq(pg_temp.act('0d', '3', 'send_back', '{"to":"dubbing"}', 'Audio da rifare'), 'ok', 'final sent to dubbing');
select pg_temp.eq(pg_temp.state('3'), 'doppiaggio', 'back in doppiaggio');
select pg_temp.eq((pg_temp.open_task('3')).assignee_id, '00000000-0000-0000-0000-00000000000e'::uuid, 'same dubber again');
select pg_temp.eq(pg_temp.act('0e', '3', 'deliver', '{"file_url":"https://drive.google.com/c"}'), 'ok', 'third audio');
select pg_temp.eq(pg_temp.act('0d', '3', 'approve'), 'ok', 'audio approved again');
select pg_temp.eq((pg_temp.open_task('3')).kind::text || '/' || (pg_temp.open_task('3')).status::text
                  || '/' || (pg_temp.open_task('3')).assignee_id, 'animation/in_progress/00000000-0000-0000-0000-000000000062',
                  'animation back to the same animator, no acceptance');
select pg_temp.eq(pg_temp.act('62', '3', 'deliver',
  '{"file_url":"https://drive.google.com/v3","editing_done":true,"subtitles":true}'), 'ok', 'final video');

-- DoD gate on the final approval.
delete from reel_dod_items where reel_id = '30000000-0000-0000-0000-000000000003' and key = 'subtitles';
select pg_temp.eq(pg_temp.act('0d', '3', 'approve'), 'dod_incomplete', 'final approval without the DoD');
insert into reel_dod_items (reel_id, key) values ('30000000-0000-0000-0000-000000000003', 'subtitles');
select pg_temp.eq(pg_temp.act('0d', '3', 'approve'), 'ok', 'final approval');
select pg_temp.eq(pg_temp.act('0d', '3', 'approve'), 'invalid_input', 'scheduling is not approved');
select pg_temp.eq(private.task_action_core('00000000-0000-0000-0000-00000000000d',
  (select id from tasks where reel_id = '30000000-0000-0000-0000-000000000003' and kind = 'final_approval'
    order by closed_at desc limit 1), 'approve', null, null, 'app'), 'invalid_state', 'double decision');
select pg_temp.eq((select count(*) from reel_dod_items where reel_id = '30000000-0000-0000-0000-000000000003')::int,
                  5, 'all five DoD items');
select pg_temp.eq(pg_temp.state('3'), 'programmato', 'state after final approval');
select pg_temp.eq((pg_temp.open_task('3')).kind::text || '/' || (pg_temp.open_task('3')).assignee_id,
                  'scheduling/00000000-0000-0000-0000-000000000064', 'scheduling to the SMM');

-- Scheduling by the SMM (in the same transaction as every step before it:
-- the state must not depend on timestamp order), then publication.
select pg_temp.eq(private.schedule_reel('00000000-0000-0000-0000-00000000000e',
  '30000000-0000-0000-0000-000000000003', 'c', now() + interval '1 day'), 'not_authorized', 'schedule by the dubber');
select pg_temp.eq(private.schedule_reel('00000000-0000-0000-0000-000000000064',
  '30000000-0000-0000-0000-000000000003', 'Caption', now() + interval '1 day'), 'ok', 'SMM schedules');
select pg_temp.eq(pg_temp.state('3') || '/' || coalesce((pg_temp.open_task('3')).kind::text, 'none'),
                  'programmato/none', 'scheduled, no open task');
select pg_temp.eq(private.publish_reel('00000000-0000-0000-0000-000000000064',
  '30000000-0000-0000-0000-000000000003', 'https://instagram.com/p/tre'), 'ok', 'SMM publishes');
select pg_temp.eq(pg_temp.state('3'), 'pubblicato', 'state after publication');
select pg_temp.eq((select published_at is not null from reels where id = '30000000-0000-0000-0000-000000000003'),
                  true, 'published_at');

-- Publication closes a scheduling task still open (reel 7).
insert into reels (id, batch_id, page_id, code, ordinal, title) values
  ('30000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001', 'PP-2610-07', 7, 'Reel sette');
update reels set state = 'programmato' where id = '30000000-0000-0000-0000-000000000007';
select private._create_task('30000000-0000-0000-0000-000000000007', 'scheduling',
  '00000000-0000-0000-0000-000000000064', 'in_progress', '00000000-0000-0000-0000-00000000000a');
select pg_temp.eq(private.publish_reel('00000000-0000-0000-0000-000000000064',
  '30000000-0000-0000-0000-000000000007', 'https://instagram.com/p/sette'), 'ok', 'publish with scheduling open');
select pg_temp.eq((select status::text || '/' || decision_note from tasks
                    where reel_id = '30000000-0000-0000-0000-000000000007' and kind = 'scheduling'),
                  'delivered/[chiuso dalla pubblicazione]', 'scheduling closed by the publication');

-- Every operation, refusals included, is in task_events; no Drive jobs
-- while Drive is off.
select pg_temp.eq((select count(*) from task_events where reel_id = '30000000-0000-0000-0000-000000000003'
                    and code <> 'ok')::int > 10, true, 'refusals logged');
select pg_temp.eq((select count(*) from task_events where reel_id = '30000000-0000-0000-0000-000000000003'
                    and code = 'ok')::int >= 20, true, 'operations logged');
select pg_temp.eq((select count(*) from job_outbox where kind = 'drive_reconcile')::int, 0, 'no Drive jobs');

-------------------------------------------------------------------------------
-- Scientific validation (reel 4), proposals, Express
-------------------------------------------------------------------------------

update pages set requires_scientific_validation = true where id = '10000000-0000-0000-0000-000000000001';
insert into reels (id, batch_id, page_id, code, ordinal, title) values
  ('30000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001', 'PP-2610-04', 4, 'Reel quattro');
select pg_temp.eq(private.start_writing('00000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-000000000001', 5),
                  'ok', 'start_writing by admin');
select pg_temp.eq(pg_temp.state('4'), 'bozza', 'reel 4 in bozza');
update reels set corpo = 'testo' where id = '30000000-0000-0000-0000-000000000004';
select pg_temp.eq(pg_temp.act('0b', '4', 'deliver'), 'ok', 'reel 4 written');
select pg_temp.eq(pg_temp.act('0d', '4', 'approve', pg_temp.rev('4')), 'ok', 'reel 4 reviewed');
select pg_temp.eq(pg_temp.state('4'), 'validazione', 'flagged page → validazione');
select pg_temp.eq((pg_temp.open_task('4')).assignee_id, '00000000-0000-0000-0000-000000000065'::uuid, 'to the validator');
select pg_temp.eq(pg_temp.act('0d', '4', 'approve', pg_temp.rev('4')), 'not_authorized', 'validation decided by the approver');
select pg_temp.eq(pg_temp.act('65', '4', 'send_back', null, 'Fonte mancante'), 'ok', 'validator sends back');
select pg_temp.eq(pg_temp.state('4') || '/' || (pg_temp.open_task('4')).assignee_id,
                  'bozza/00000000-0000-0000-0000-00000000000b', 'back to the last author');
select pg_temp.eq(pg_temp.act('0b', '4', 'deliver'), 'ok', 'reel 4 rewritten');
select pg_temp.eq(pg_temp.act('0d', '4', 'approve', pg_temp.rev('4')), 'ok', 'reel 4 reviewed again');

-- Proposal accepted moves the revision; an older proposal is then stale.
do $$
declare
  p1 uuid;
  p2 uuid;
  v_rev int := (select script_rev from reels where id = '30000000-0000-0000-0000-000000000004');
begin
  perform pg_temp.eq(private.propose_text_change('00000000-0000-0000-0000-000000000065',
    '30000000-0000-0000-0000-000000000004', 'corpo', 'testo corretto'), 'ok', 'validator proposes');
  perform pg_temp.eq(private.propose_text_change('00000000-0000-0000-0000-000000000064',
    '30000000-0000-0000-0000-000000000004', 'hook', 'hook nuovo'), 'ok', 'SMM proposes');
  select id into p1 from text_change_proposals where field = 'corpo' and reel_id = '30000000-0000-0000-0000-000000000004';
  select id into p2 from text_change_proposals where field = 'hook' and reel_id = '30000000-0000-0000-0000-000000000004';
  perform pg_temp.eq(private.decide_text_proposal('00000000-0000-0000-0000-000000000065', p1, 'accepted', null),
                     'not_authorized', 'proposer decides');
  perform pg_temp.eq(private.decide_text_proposal('00000000-0000-0000-0000-00000000000d', p1, 'accepted', null),
                     'ok', 'approver accepts');
  perform pg_temp.eq((select corpo from reels where id = '30000000-0000-0000-0000-000000000004'), 'testo corretto', 'text applied');
  perform pg_temp.eq((select script_rev from reels where id = '30000000-0000-0000-0000-000000000004'), v_rev + 1, 'rev moved');
  perform pg_temp.eq(private.decide_text_proposal('00000000-0000-0000-0000-00000000000d', p2, 'accepted', null),
                     'proposal_stale', 'older proposal is stale');
  perform pg_temp.eq(private.decide_text_proposal('00000000-0000-0000-0000-00000000000d', p2, 'rejected', 'no'),
                     'ok', 'stale proposal rejected');
end $$;
-- The validator saw the old revision: stale; with the new one: confirmed.
select pg_temp.eq(pg_temp.act('65', '4', 'approve', jsonb_build_object('rev',
  (select script_rev - 1 from reels where id = '30000000-0000-0000-0000-000000000004'))), 'stale', 'validation on old text');
select pg_temp.eq(pg_temp.act('65', '4', 'approve', pg_temp.rev('4')), 'ok', 'validation approved');
select pg_temp.eq(pg_temp.state('4'), 'confermato', 'validated → confermato');

-- Express: thresholds of the open task recomputed from its start.
select pg_temp.eq(private.set_reel_track('00000000-0000-0000-0000-00000000000c',
  '30000000-0000-0000-0000-000000000004', 'express'), 'not_authorized', 'Express by a stranger');
select pg_temp.eq(private.set_reel_track('00000000-0000-0000-0000-00000000000d',
  '30000000-0000-0000-0000-000000000004', 'express'), 'ok', 'Express by the approver');
select pg_temp.eq((select due_at = started_at + interval '120 minutes' from tasks
                    where id = (pg_temp.open_task('4')).id), true, 'Express acceptance deadline');
select pg_temp.eq(private.set_reel_track('00000000-0000-0000-0000-00000000000a',
  '30000000-0000-0000-0000-000000000003', 'express'), 'invalid_state', 'Express on a published reel');

-- Offboarding the titular dubber moves their open task to the reserve.
select pg_temp.eq(private.offboard_collaborator('00000000-0000-0000-0000-00000000000a',
  '00000000-0000-0000-0000-00000000000e'), 'ok', 'offboard the titular dubber');
select pg_temp.eq((pg_temp.open_task('4')).assignee_id || '/' || (pg_temp.open_task('4')).status,
                  '00000000-0000-0000-0000-000000000063/assigned', 'task moved to the reserve');
select pg_temp.eq(pg_temp.state('4'), 'confermato', 'still confermato');

-------------------------------------------------------------------------------
-- Migrated validation (reel 5) and confirmation of migrated tasks
-------------------------------------------------------------------------------

insert into reels (id, batch_id, page_id, code, ordinal, title, phase) values
  ('30000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001', 'PP-2610-05', 5, 'Reel cinque', 'scientific_validation');
-- (The backfill also gives the two seed reels, which have no task, theirs.)
select pg_temp.eq(public.fase1_backfill_open_tasks() ->> 'tasks_created', '3', 'backfill creates the validation');
select pg_temp.eq((pg_temp.open_task('5')).origin || '/' || (pg_temp.open_task('5')).escalation_paused,
                  'migration/true', 'migrated, paused');
select pg_temp.eq(private.confirm_migrated_tasks('00000000-0000-0000-0000-00000000000d',
  array[(pg_temp.open_task('5')).id]), 'not_authorized', 'confirm by a non-admin');
select pg_temp.eq(private.confirm_migrated_tasks('00000000-0000-0000-0000-00000000000a',
  array[(pg_temp.open_task('5')).id]), 'ok', 'admin confirms');
select pg_temp.eq((pg_temp.open_task('5')).escalation_paused, false, 'escalation resumed');
-- In the old flow validation came first: approving it starts the writing.
select pg_temp.eq(pg_temp.act('65', '5', 'approve'), 'ok', 'migrated validation approved without script');
select pg_temp.eq(pg_temp.state('5') || '/' || (pg_temp.open_task('5')).kind,
                  'bozza/writing', 'migrated validation → bozza + writing');
select pg_temp.eq(exists (select 1 from reel_dod_items where reel_id = '30000000-0000-0000-0000-000000000005'),
                  false, 'no DoD for the migrated validation');

-------------------------------------------------------------------------------
-- Dubber never animates the same reel (reel 6)
-------------------------------------------------------------------------------

-- c (internal) dubs reel 6 and is the animator titular: skipped as candidate,
-- refused by assign_task.
update pages set animator_titular_id = '00000000-0000-0000-0000-00000000000c'
 where id = '10000000-0000-0000-0000-000000000001';
insert into reels (id, batch_id, page_id, code, ordinal, title, phase, hook) values
  ('30000000-0000-0000-0000-000000000006', '20000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001', 'PP-2610-06', 6, 'Reel sei', 'research_prescript', 'h');
update reels set state = 'confermato' where id = '30000000-0000-0000-0000-000000000006';
select private._create_task('30000000-0000-0000-0000-000000000006', 'dubbing',
  '00000000-0000-0000-0000-000000000063', 'assigned', '00000000-0000-0000-0000-00000000000a');
select pg_temp.eq(private.assign_task('00000000-0000-0000-0000-00000000000a', (pg_temp.open_task('6')).id,
                  '00000000-0000-0000-0000-00000000000c'), 'ok', 'dubbing to an internal');
select pg_temp.eq(pg_temp.act('0c', '6', 'accept'), 'ok', 'internal accepts dubbing');
select pg_temp.eq(pg_temp.act('0c', '6', 'deliver', '{"file_url":"https://x.it/6.wav"}'), 'ok', 'internal delivers audio');
select pg_temp.eq(pg_temp.act('0d', '6', 'approve'), 'ok', 'audio 6 approved');
select pg_temp.eq((pg_temp.open_task('6')).assignee_id, '00000000-0000-0000-0000-000000000062'::uuid,
                  'animator titular skipped: they dubbed this reel');
select pg_temp.eq(private.assign_task('00000000-0000-0000-0000-00000000000a', (pg_temp.open_task('6')).id,
                  '00000000-0000-0000-0000-00000000000c'), 'invalid_assignee', 'dubber as animator of the same reel');
select pg_temp.eq(private.assign_task('00000000-0000-0000-0000-00000000000a', (pg_temp.open_task('6')).id,
                  '00000000-0000-0000-0000-00000000000e'), 'invalid_assignee', 'deactivated profile');

-------------------------------------------------------------------------------
-- Invariants
-------------------------------------------------------------------------------

do $$ begin
  begin
    insert into tasks (reel_id, kind, status, assignee_id)
    values ('30000000-0000-0000-0000-000000000004', 'writing', 'in_progress', '00000000-0000-0000-0000-00000000000b');
    raise exception 'FAIL: two open tasks on a reel';
  exception when unique_violation then null;
  end;
  begin
    perform private._set_state('30000000-0000-0000-0000-000000000004', 'animazione');
    raise exception 'FAIL: _set_state accepted a state the tasks do not support';
  exception when raise_exception then
    if sqlerrm not like 'invalid_state%' then raise; end if;
  end;
end $$;

-- Every reel of this check is in the state its tasks derive.
select pg_temp.eq((select string_agg(code || ':' || state || '≠' || coalesce(private.derived_state(id)::text, 'null'), ', ')
                     from reels
                    where code >= 'PP-2610-03' and state is distinct from private.derived_state(id)),
                  null::text, 'state = derived state');

rollback;
