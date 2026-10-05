-- Outbox, task sweep, stand-up and Telegram linking (docs/fase1-plan.md §S4).
-- The whole file is one transaction (seed.sql), so now() is constant:
-- thresholds are placed around it. The sweep skipping a locked reel needs a
-- second connection: run.sh checks it at the end.

-- People: d approver, 81 delegate (internal); e dubber titular, 82 dubber
-- reserve (external).
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000081', 'delegate4@example.test'),
  ('00000000-0000-0000-0000-000000000082', 'dubber4@example.test');
update profiles set account_type = 'internal', full_name = 'Delegata'
 where id = '00000000-0000-0000-0000-000000000081';
update profiles set external_kind = 'dubber', full_name = 'Riserva'
 where id = '00000000-0000-0000-0000-000000000082';
update approval_groups
   set approver_id = '00000000-0000-0000-0000-00000000000d',
       delegate_id = '00000000-0000-0000-0000-000000000081'
 where is_default;
update pages
   set dubber_titular_id = '00000000-0000-0000-0000-00000000000e',
       dubber_reserve_id = '00000000-0000-0000-0000-000000000082'
 where id = '10000000-0000-0000-0000-000000000001';

create function pg_temp.eq(p_got anyelement, p_want anyelement, p_label text)
returns void language plpgsql as $$
begin
  if p_got is distinct from p_want then
    raise exception 'FAIL: % — got %, want %', p_label, p_got, p_want;
  end if;
end $$;

-- Notify rows queued for a task, by event.
create function pg_temp.rows(p_task uuid, p_event text)
returns integer language sql as $$
  select count(*)::integer from job_outbox
   where payload ->> 'task_id' = p_task::text and payload ->> 'event' = p_event;
$$;

-------------------------------------------------------------------------------
-- 1. Service role only
-------------------------------------------------------------------------------

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
do $$
declare
  v_call text;
begin
  foreach v_call in array array[
    'select public.claim_jobs(1)',
    'select public.complete_job(1, 1, gen_random_uuid())',
    'select public.fail_job(1, gen_random_uuid(), ''x'')',
    'select public.sweep_tasks(now())',
    'select public.job_health(now())',
    'select public.standup_snapshot(now())',
    'select public.standup_claim(current_date)',
    'select public.link_telegram(''x'', ''1'')'
  ] loop
    begin
      execute v_call;
      raise exception 'FAIL: an admin user could run %', v_call;
    exception when insufficient_privilege then
      null;
    end;
  end loop;
end $$;
reset role;

-------------------------------------------------------------------------------
-- 2. Claim, lease, fencing token, generations, backoff, dead letter
-------------------------------------------------------------------------------

delete from job_outbox;
do $$
declare
  a record;
  b record;
  c record;
  v_k2 job_outbox%rowtype;
  n integer;
begin
  perform private._enqueue('notify', '{"n": 1}', 'k1');
  perform private._enqueue('notify', '{"n": 2}', 'k2');

  select * into a from public.claim_jobs(1);
  perform pg_temp.eq(a.attempts::integer, 1, 'first claim counts one attempt');
  select count(*)::integer into n from public.claim_jobs(5);
  perform pg_temp.eq(n, 1, 'a second claim gets only the job not under lease');
  select count(*)::integer into n from public.claim_jobs(5);
  perform pg_temp.eq(n, 0, 'nothing to claim while both are under lease');

  -- The first worker dies: after its lease the job is claimed again.
  update job_outbox set lease_until = now() - interval '1 second' where id = a.id;
  select * into b from public.claim_jobs(5);
  perform pg_temp.eq(b.id, a.id, 'expired lease: the job is claimed again');
  perform pg_temp.eq(b.attempts::integer, 2, 'the new claim counts');
  if b.lease_token = a.lease_token then
    raise exception 'FAIL: a new claim must get a new lease token';
  end if;
  perform pg_temp.eq(public.complete_job(a.id, a.gen, a.lease_token), 'stale_lease', 'the old worker cannot complete');
  perform pg_temp.eq(public.fail_job(a.id, a.lease_token, 'late'), 'stale_lease', 'the old worker cannot fail');
  perform pg_temp.eq((select done_at is null and last_error is null from job_outbox where id = a.id), true,
                     'a stale worker leaves the row as it was');

  -- Requested again while running: a single row, back to pending.
  perform private._enqueue('notify', '{"n": 1}', 'k1');
  perform pg_temp.eq((select count(*)::integer from job_outbox where dedup_key = 'k1'), 1, 'dedup keeps one row');
  perform pg_temp.eq(public.complete_job(b.id, b.gen, b.lease_token), 'requeued', 'an older generation does not close the job');
  select * into c from public.claim_jobs(5);
  perform pg_temp.eq(c.id, a.id, 'the requeued job is claimable');
  perform pg_temp.eq(c.gen, 2, 'it runs the newer generation');
  perform pg_temp.eq(public.complete_job(c.id, c.gen, c.lease_token), 'ok', 'complete');
  perform pg_temp.eq((select done_at is not null from job_outbox where id = a.id), true, 'done');

  -- Backoff, then the 6th attempt is the dead letter.
  select * into v_k2 from job_outbox where dedup_key = 'k2';
  perform pg_temp.eq(public.fail_job(v_k2.id, v_k2.lease_token, 'boom'), 'retry', 'first failure retries');
  perform pg_temp.eq((select run_after = now() + interval '2 minutes' from job_outbox where id = v_k2.id), true,
                     'backoff 2^attempts minutes');
  update job_outbox set attempts = 5, run_after = now() where id = v_k2.id;
  select * into c from public.claim_jobs(5);
  perform pg_temp.eq(c.attempts::integer, 6, 'sixth attempt');
  perform pg_temp.eq(public.fail_job(c.id, c.lease_token, 'boom'), 'dead', 'sixth failure is the dead letter');
  perform pg_temp.eq((select count(*)::integer from public.claim_jobs(5)), 0, 'a dead job is never claimed');

  -- A worker that dies on the sixth attempt: the expired lease is the dead
  -- letter, not a seventh attempt.
  perform private._enqueue('notify', '{"n": 3}', 'k3');
  update job_outbox set attempts = 5 where dedup_key = 'k3';
  select * into c from public.claim_jobs(5);
  perform pg_temp.eq(c.attempts::integer, 6, 'sixth attempt claimed');
  update job_outbox set lease_until = now() - interval '1 second' where id = c.id;
  perform pg_temp.eq((select count(*)::integer from public.claim_jobs(5)), 0, 'not claimed a seventh time');
  perform pg_temp.eq((select failed_at is not null from job_outbox where id = c.id), true, 'dead letter after its last lease');
  perform pg_temp.eq((public.job_health(now()) ->> 'dead_letters_24h')::integer, 2, 'job_health counts them');
end $$;

-------------------------------------------------------------------------------
-- 3. Sweep: acceptance timeout, overdue, escalation, idempotence, switch
-------------------------------------------------------------------------------

delete from job_outbox;
update app_config set value = 'true' where key = 'escalation_enabled';

insert into reels (id, batch_id, page_id, code, ordinal, title, state) values
  ('30000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001', 'PP-2610-05', 5, 'Reel cinque', 'bozza'),
  ('30000000-0000-0000-0000-000000000006', '20000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001', 'PP-2610-06', 6, 'Reel sei', 'confermato'),
  ('30000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001', 'PP-2610-07', 7, 'Reel sette', 'revisione'),
  ('30000000-0000-0000-0000-000000000008', '20000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001', 'PP-2610-08', 8, 'Reel otto', 'confermato'),
  ('30000000-0000-0000-0000-000000000009', '20000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001', 'PP-2610-09', 9, 'Reel nove', 'bozza');

-- 5: the member's writing, past due and past escalation.
-- 6: dubbing waiting for the titular's acceptance, past due.
-- 7: a review the approver themself is late on.
-- 8: a migrated dubbing still paused, past due.
-- 9: writing past due, escalation not reached yet.
insert into tasks (id, reel_id, kind, status, assignee_id, started_at, yellow_at, due_at, escalate_at, escalation_paused) values
  ('50000000-0000-0000-0000-000000000005', '30000000-0000-0000-0000-000000000005', 'writing', 'in_progress',
   '00000000-0000-0000-0000-00000000000b', now() - interval '10 hours', now() - interval '3 hours',
   now() - interval '1 hour', now() - interval '1 minute', false),
  ('50000000-0000-0000-0000-000000000006', '30000000-0000-0000-0000-000000000006', 'dubbing', 'assigned',
   '00000000-0000-0000-0000-00000000000e', now() - interval '25 hours', now() - interval '7 hours',
   now() - interval '1 minute', now() + interval '12 hours', false),
  ('50000000-0000-0000-0000-000000000007', '30000000-0000-0000-0000-000000000007', 'review', 'in_progress',
   '00000000-0000-0000-0000-00000000000d', now() - interval '40 hours', now() - interval '20 hours',
   now() - interval '10 hours', now() - interval '1 minute', false),
  ('50000000-0000-0000-0000-000000000008', '30000000-0000-0000-0000-000000000008', 'dubbing', 'assigned',
   '00000000-0000-0000-0000-00000000000e', now() - interval '25 hours', now() - interval '7 hours',
   now() - interval '1 minute', now() + interval '12 hours', true),
  ('50000000-0000-0000-0000-000000000009', '30000000-0000-0000-0000-000000000009', 'writing', 'in_progress',
   '00000000-0000-0000-0000-00000000000b', now() - interval '10 hours', now() - interval '3 hours',
   now() - interval '1 minute', now() + interval '5 hours', false);

do $$
declare
  v_rep jsonb;
  v_new tasks%rowtype;
  v_esc jsonb;
  v_violations integer;
begin
  -- First pass with escalation off.
  update app_config set value = 'false' where key = 'escalation_enabled';
  v_rep := public.sweep_tasks(now());
  perform pg_temp.eq(pg_temp.rows('50000000-0000-0000-0000-000000000009', 'task_overdue'), 0,
                     'escalation off: no message');
  perform pg_temp.eq((select overdue_notified_at is not null from tasks where id = '50000000-0000-0000-0000-000000000009'),
                     true, 'escalation off: the threshold is stamped');
  perform pg_temp.eq((select count(*)::integer from task_events
                       where task_id = '50000000-0000-0000-0000-000000000009' and op = 'overdue_suppressed'), 1,
                     'escalation off: logged as suppressed');
  perform pg_temp.eq((select status::text from tasks where id = '50000000-0000-0000-0000-000000000006'), 'expired',
                     'acceptance timeout works with escalation off (AC5)');
  perform pg_temp.eq((select overdue_notified_at is not null from tasks where id = '50000000-0000-0000-0000-000000000008'),
                     true, 'paused task: stamped');
  perform pg_temp.eq((select status::text from tasks where id = '50000000-0000-0000-0000-000000000008'), 'assigned',
                     'paused migrated task: not expired');

  -- Escalation back on: only thresholds passed from now on are reported.
  -- Undo the off-pass on 5 and 7 so they are swept with escalation on.
  update app_config set value = 'true' where key = 'escalation_enabled';
  update tasks set overdue_notified_at = null, escalated_at = null
   where id in ('50000000-0000-0000-0000-000000000005', '50000000-0000-0000-0000-000000000007');
  delete from job_outbox where payload ->> 'event' in ('task_overdue', 'task_escalated');

  v_rep := public.sweep_tasks(now());
  perform pg_temp.eq((v_rep ->> 'overdue')::integer, 2, 'two overdue messages (5 and 7)');
  perform pg_temp.eq((v_rep ->> 'escalated')::integer, 2, 'two escalations (5 and 7)');
  perform pg_temp.eq(pg_temp.rows('50000000-0000-0000-0000-000000000005', 'task_overdue'), 1, '5: overdue to the assignee');
  perform pg_temp.eq((select payload ->> 'to' from job_outbox
                       where payload ->> 'task_id' = '50000000-0000-0000-0000-000000000005'
                         and payload ->> 'event' = 'task_overdue'), 'assignee', '5: overdue goes to the assignee');
  select payload into v_esc from job_outbox
   where payload ->> 'task_id' = '50000000-0000-0000-0000-000000000005' and payload ->> 'event' = 'task_escalated';
  perform pg_temp.eq(v_esc -> 'recipients', '["00000000-0000-0000-0000-00000000000d"]'::jsonb,
                     '5: escalation to the approver');
  select payload into v_esc from job_outbox
   where payload ->> 'task_id' = '50000000-0000-0000-0000-000000000007' and payload ->> 'event' = 'task_escalated';
  perform pg_temp.eq(v_esc -> 'recipients', '["00000000-0000-0000-0000-000000000081"]'::jsonb,
                     '7: the approver is late — to the delegate');
  perform pg_temp.eq((v_esc ->> 'admins')::boolean, true, '7: and to the admins');
  perform pg_temp.eq(pg_temp.rows('50000000-0000-0000-0000-000000000009', 'task_overdue'), 0,
                     '9: stamped while off, not reported after');

  -- A second pass changes nothing.
  v_rep := public.sweep_tasks(now());
  perform pg_temp.eq((v_rep ->> 'overdue')::integer + (v_rep ->> 'escalated')::integer + (v_rep ->> 'expired')::integer, 0,
                     'second pass: nothing new');
  perform pg_temp.eq(pg_temp.rows('50000000-0000-0000-0000-000000000005', 'task_escalated'), 1, 'second pass: one row per threshold');

  -- 9 reaches its escalation threshold now: that one is reported.
  update tasks set escalate_at = now() - interval '1 second' where id = '50000000-0000-0000-0000-000000000009';
  perform public.sweep_tasks(now());
  perform pg_temp.eq(pg_temp.rows('50000000-0000-0000-0000-000000000009', 'task_escalated'), 1,
                     '9: a threshold passed after turning it back on is reported');

  -- 6: the titular let it expire → the reserve, waiting for acceptance.
  select * into v_new from tasks
   where reel_id = '30000000-0000-0000-0000-000000000006' and status in ('unassigned', 'assigned', 'in_progress');
  perform pg_temp.eq(v_new.assignee_id, '00000000-0000-0000-0000-000000000082'::uuid, '6: next candidate is the reserve');
  perform pg_temp.eq(v_new.status::text, 'assigned', '6: the reserve must accept');
  perform pg_temp.eq(pg_temp.rows(v_new.id, 'assignment'), 1, '6: the reserve is told');
  perform pg_temp.eq((select closed_via from tasks where id = '50000000-0000-0000-0000-000000000006'), 'sweep',
                     '6: closed by the sweep');
  -- The reserve lets it expire too → unassigned, the admins are told.
  update tasks set due_at = now() - interval '1 second' where id = v_new.id;
  perform public.sweep_tasks(now());
  select * into v_new from tasks
   where reel_id = '30000000-0000-0000-0000-000000000006' and status in ('unassigned', 'assigned', 'in_progress');
  perform pg_temp.eq(v_new.status::text, 'unassigned', '6: nobody left → unassigned');
  perform pg_temp.eq((select payload ->> 'to' from job_outbox
                       where payload ->> 'task_id' = v_new.id::text and payload ->> 'event' = 'assignment'), 'admins',
                     '6: the admins are told');
  perform pg_temp.eq((select state::text from reels where id = '30000000-0000-0000-0000-000000000006'), 'confermato',
                     '6: the reel stays confermato');

  -- Invariant counter: one more inconsistent reel, one more violation.
  v_violations := (public.sweep_tasks(now()) ->> 'violations')::integer;
  update reels set state = 'revisione' where id = '30000000-0000-0000-0000-000000000005';
  perform pg_temp.eq((public.sweep_tasks(now()) ->> 'violations')::integer, v_violations + 1, 'violations counted');
  update reels set state = 'bozza' where id = '30000000-0000-0000-0000-000000000005';

  perform pg_temp.eq((select last_run_at is not null from system_heartbeats where name = 'task_sweep'), true,
                     'the sweep writes its heartbeat');

  -- A reel the sweep cannot process (its state contradicts its tasks, as
  -- the old code could leave it): counted, the other reels still swept.
  insert into reels (id, batch_id, page_id, code, ordinal, title, state) values
    ('30000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-000000000001',
     '10000000-0000-0000-0000-000000000001', 'PP-2610-10', 10, 'Reel dieci', 'bozza');
  insert into tasks (id, reel_id, kind, status, assignee_id, started_at, due_at, escalate_at) values
    ('50000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-00000000000a', 'dubbing', 'assigned',
     '00000000-0000-0000-0000-00000000000e', now() - interval '2 days', now() - interval '1 day', now() + interval '1 day');
  update tasks set overdue_notified_at = null where id = '50000000-0000-0000-0000-000000000009';
  v_rep := public.sweep_tasks(now());
  perform pg_temp.eq((v_rep ->> 'errors')::integer, 1, 'the failing reel is counted');
  perform pg_temp.eq((select status::text from tasks where id = '50000000-0000-0000-0000-00000000000a'), 'assigned',
                     'its work is rolled back');
  perform pg_temp.eq((select overdue_notified_at is not null from tasks where id = '50000000-0000-0000-0000-000000000009'), true,
                     'the other reels are still swept');
  perform pg_temp.eq((public.job_health(now()) ->> 'sweep_errors')::integer, 1, 'job_health reports sweep errors');
  delete from tasks where id = '50000000-0000-0000-0000-00000000000a';
end $$;

-------------------------------------------------------------------------------
-- 4. Stand-up
-------------------------------------------------------------------------------

do $$
declare
  v_snap jsonb;
  v_now timestamptz := '2026-10-20 08:30 Europe/Rome';
begin
  perform pg_temp.eq(public.standup_claim('2026-10-20'), true, 'first claim of the day');
  perform pg_temp.eq(public.standup_claim('2026-10-20'), false, 'second claim the same day');
  perform pg_temp.eq(public.standup_claim('2026-10-21'), true, 'next day');

  update reels set track = 'express' where id = '30000000-0000-0000-0000-000000000007';
  update tasks set due_at = '2026-10-20 18:00 Europe/Rome' where id = '50000000-0000-0000-0000-000000000009';
  v_snap := public.standup_snapshot(v_now);
  perform pg_temp.eq(v_snap -> 'late' -> 0 ->> 'task_id', '50000000-0000-0000-0000-000000000007',
                     'Express first among the late');
  perform pg_temp.eq(jsonb_array_length(v_snap -> 'due_today'), 1, 'due today (Rome day)');
  perform pg_temp.eq(v_snap -> 'due_today' -> 0 ->> 'task_id', '50000000-0000-0000-0000-000000000009', 'the one due today');
  perform pg_temp.eq(jsonb_array_length(v_snap -> 'unassigned'), 1, 'to assign');
  if exists (select 1 from jsonb_array_elements(v_snap -> 'late') e
              where e ->> 'task_id' = '50000000-0000-0000-0000-000000000008') then
    raise exception 'FAIL: a paused migrated task is listed as late';
  end if;
  if v_snap -> 'health' is null then
    raise exception 'FAIL: the snapshot has no health line';
  end if;
end $$;

-------------------------------------------------------------------------------
-- 5. Telegram linking
-------------------------------------------------------------------------------

insert into telegram_link_tokens (token_hash, user_id, expires_at) values
  ('h-member', '00000000-0000-0000-0000-00000000000b', now() + interval '15 minutes'),
  ('h-old', '00000000-0000-0000-0000-00000000000c', now() - interval '1 second'),
  ('h-ext', '00000000-0000-0000-0000-00000000000e', now() + interval '15 minutes');
do $$
begin
  perform pg_temp.eq(public.link_telegram('h-member', '123') ->> 'code', 'ok', 'link');
  perform pg_temp.eq((select telegram_chat_id from profiles where id = '00000000-0000-0000-0000-00000000000b'), '123',
                     'chat saved');
  perform pg_temp.eq(public.link_telegram('h-member', '123') ->> 'code', 'invalid', 'a token works once');
  perform pg_temp.eq(public.link_telegram('h-old', '456') ->> 'code', 'invalid', 'an expired token');
  perform pg_temp.eq(public.link_telegram('h-ext', '123') ->> 'code', 'chat_taken', 'a chat of another profile');
  perform pg_temp.eq(public.link_telegram('h-ext', '-1001') ->> 'code', 'invalid', 'a group chat id');
  perform pg_temp.eq(public.link_telegram('nope', '789') ->> 'code', 'invalid', 'an unknown token');
  perform pg_temp.eq(public.link_telegram('h-ext', '789') ->> 'code', 'ok', 'the external links a chat of their own');
end $$;

rollback;
