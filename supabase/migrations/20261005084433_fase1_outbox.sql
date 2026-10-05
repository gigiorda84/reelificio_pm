-- Fase 1 (S4) — operational notifications (docs/fase1-plan.md §S4):
-- outbox claim with a lease and a fencing token, the task sweep (acceptance
-- timeouts, overdue and escalation stamps), the stand-up snapshot and its
-- daily claim, system health, Telegram account linking.
--
-- Everything here is for the service role (cron routes, the drain, the
-- Telegram webhook): no function is executable by anon or authenticated.

insert into system_heartbeats (name) values ('task_sweep'), ('standup')
on conflict (name) do nothing;

-------------------------------------------------------------------------------
-- 1. Outbox
-------------------------------------------------------------------------------

-- Takes up to p_limit due jobs. A job is due when not done or dead, its
-- run_after has come and nobody holds a live lease on it: a worker that died
-- leaves the job to the next one once the lease expires. Each claim gets a
-- new lease_token (fencing: only its holder may complete or fail the job)
-- and remembers the generation it is running. The lease outlives the route
-- that drains (maxDuration 60 s). A job whose sixth attempt never came back
-- (the worker died every time) is the dead letter, not claimed again.
create function public.claim_jobs(p_limit integer default 20, p_lease interval default '2 minutes')
returns table (id bigint, kind job_kind, payload jsonb, gen integer, lease_token uuid, attempts smallint)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  update job_outbox
     set failed_at = now(), lease_until = null, lease_token = null,
         last_error = left(coalesce(last_error || ' · ', '') || 'lease expired on the last attempt', 2000)
   where done_at is null and failed_at is null
     and attempts >= 6 and lease_until < now();

  return query
  with picked as (
    select j.id
      from job_outbox j
     where j.done_at is null and j.failed_at is null
       and j.run_after <= now()
       and (j.lease_until is null or j.lease_until < now())
     order by j.run_after, j.id
     limit greatest(coalesce(p_limit, 0), 0)
     for update skip locked
  )
  update job_outbox j
     set lease_until = now() + p_lease,
         attempts = j.attempts + 1,
         claimed_gen = j.requested_gen,
         lease_token = gen_random_uuid()
    from picked
   where j.id = picked.id
  returning j.id, j.kind, j.payload, j.requested_gen, j.lease_token, j.attempts;
end;
$$;

-- Done, unless the job was requested again while it ran (requested_gen went
-- up): then it goes back to pending and runs once more. A stale lease token
-- (the lease expired and another worker took the job) changes nothing.
create function public.complete_job(p_id bigint, p_gen integer, p_lease_token uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  j job_outbox%rowtype;
begin
  select * into j from job_outbox where job_outbox.id = p_id for update;
  if not found or j.done_at is not null or j.failed_at is not null
     or j.lease_token is distinct from p_lease_token then
    return 'stale_lease';
  end if;
  if j.requested_gen > p_gen then
    update job_outbox
       set lease_until = null, lease_token = null, run_after = now(), attempts = 0
     where job_outbox.id = p_id;
    return 'requeued';
  end if;
  update job_outbox
     set done_at = now(), lease_until = null, lease_token = null, last_error = null
   where job_outbox.id = p_id;
  return 'ok';
end;
$$;

-- Failure: retry after 2^attempts minutes; the 6th attempt (or p_retry =
-- false) is the dead letter, visible in job_health().
create function public.fail_job(p_id bigint, p_lease_token uuid, p_error text, p_retry boolean default true)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  j job_outbox%rowtype;
begin
  select * into j from job_outbox where job_outbox.id = p_id for update;
  if not found or j.done_at is not null or j.failed_at is not null
     or j.lease_token is distinct from p_lease_token then
    return 'stale_lease';
  end if;
  if not coalesce(p_retry, true) or j.attempts >= 6 then
    update job_outbox
       set failed_at = now(), lease_until = null, lease_token = null, last_error = left(p_error, 2000)
     where job_outbox.id = p_id;
    return 'dead';
  end if;
  update job_outbox
     set run_after = now() + power(2, j.attempts) * interval '1 minute',
         lease_until = null, lease_token = null, last_error = left(p_error, 2000)
   where job_outbox.id = p_id;
  return 'retry';
end;
$$;

-------------------------------------------------------------------------------
-- 2. Task sweep
-------------------------------------------------------------------------------

-- Who hears of an escalation: the effective approver; when the late person
-- is the approver, their delegate (if available) and the admins; when there
-- is nobody to ask, the admins.
create function private._escalation_payload(t tasks, r reels)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private
as $$
declare
  v_approver uuid := private.effective_approver(r.page_id);
  v_delegate uuid;
begin
  if t.assignee_id is null or v_approver is null then
    return jsonb_build_object('to', 'admins');
  end if;
  if v_approver <> t.assignee_id then
    return jsonb_build_object('to', 'users', 'recipients', jsonb_build_array(v_approver));
  end if;
  select g.delegate_id into v_delegate
    from approval_groups g
   where g.id = coalesce((select pg.approval_group_id from pages pg where pg.id = r.page_id),
                         (select d.id from approval_groups d where d.is_default));
  if not private.is_available(v_delegate) or v_delegate = t.assignee_id then
    v_delegate := null;
  end if;
  return jsonb_build_object('to', 'users', 'admins', true,
    'recipients', case when v_delegate is null then '[]'::jsonb else jsonb_build_array(v_delegate) end);
end;
$$;

-- One pass over the open tasks whose thresholds have passed, a reel at a time
-- (lock the reel, then the task; a reel locked by a running transition is
-- skipped and picked up by the next pass):
-- - acceptance not given by due_at → expired, next candidate (or unassigned
--   for the admins). Assignment, not escalation: it runs with escalation
--   off; not for migrated tasks still paused (their clock starts when the
--   admin confirms them);
-- - due_at passed → overdue_notified_at, message to the assignee;
-- - escalate_at passed → escalated_at, message to the approver.
-- Escalation off (app_config) or a paused task: stamps and task_events only,
-- no message; turning it back on reports only thresholds passed later.
-- Each reel runs in its own subtransaction: one failing reel (say a state
-- the old code moved, I3) is counted in `errors` and the others go on.
-- p_now lets the checks move time.
create function public.sweep_tasks(p_now timestamptz default now())
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

  -- Invariant: every active reel is in the state its tasks say.
  select count(*) into v_violations
    from reels rr
   where rr.published_at is null
     and private.derived_state(rr.id) is distinct from rr.state;

  v_report := jsonb_build_object(
    'at', p_now, 'escalation_enabled', v_notify,
    'expired', v_expired, 'overdue', v_overdue, 'escalated', v_escalated,
    'suppressed', v_suppressed, 'skipped_locked', v_locked, 'errors', v_errors,
    'violations', v_violations);
  update system_heartbeats set last_run_at = now(), last_report = v_report where name = 'task_sweep';
  return v_report;
end;
$$;

-- Same lock order as every transition and the sweep: the reels, then the
-- tasks. The S2 version locked the tasks first, so with the sweep holding a
-- reel the two could deadlock (the task_events insert takes a key-share lock
-- on the reel).
create or replace function private.confirm_migrated_tasks(p_actor uuid, p_task_ids uuid[])
returns text
language plpgsql
security definer
set search_path = public, private
as $$
declare
  t tasks%rowtype;
begin
  if not private.is_admin_uid(p_actor) then return 'not_authorized'; end if;
  perform 1 from reels
   where id in (select tk.reel_id from tasks tk where tk.id = any (p_task_ids))
   order by id
   for update;
  for t in
    select * from tasks
     where id = any (p_task_ids) and escalation_paused and private._is_open(status)
     order by reel_id
     for update
  loop
    perform private._restart_clock(t.id);
    update tasks set escalation_paused = false where id = t.id;
    perform private._log(t.id, t.reel_id, p_actor, 'confirm_migrated', 'app', 'ok', null);
  end loop;
  return 'ok';
end;
$$;

-------------------------------------------------------------------------------
-- 3. Health and stand-up
-------------------------------------------------------------------------------

-- What the job_health alert, the stand-up and the drain look at: sweep
-- heartbeat, oldest due job (pending or leased), dead letters of the last
-- day, invariant violations from the last sweep.
create function public.job_health(p_now timestamptz default now())
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
    'sweep_errors', coalesce((h.last_report ->> 'errors')::integer, 0))
  from system_heartbeats h
  where h.name = 'task_sweep';
$$;

-- The stand-up content: late (open past due_at), due today (Rome day, not
-- late yet), to assign; Express first, then the deadline. Migrated tasks not
-- yet confirmed are left out of late/today (their clock has not started).
create function public.standup_snapshot(p_now timestamptz default now())
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with open_tasks as (
    select t.id as task_id, r.id as reel_id, r.code, r.title, t.kind, t.status, t.due_at,
           r.track = 'express' as express, p.full_name as assignee_name, t.escalation_paused
      from tasks t
      join reels r on r.id = t.reel_id
      left join profiles p on p.id = t.assignee_id
     where t.status in ('unassigned', 'assigned', 'in_progress')
       and r.published_at is null
  )
  select jsonb_build_object(
    'late', coalesce((
      select jsonb_agg(to_jsonb(o) - 'escalation_paused' order by o.express desc, o.due_at)
        from open_tasks o
       where o.status <> 'unassigned' and not o.escalation_paused and o.due_at < p_now), '[]'::jsonb),
    'due_today', coalesce((
      select jsonb_agg(to_jsonb(o) - 'escalation_paused' order by o.express desc, o.due_at)
        from open_tasks o
       where o.status <> 'unassigned' and not o.escalation_paused and o.due_at >= p_now
         and (o.due_at at time zone 'Europe/Rome')::date = (p_now at time zone 'Europe/Rome')::date), '[]'::jsonb),
    'unassigned', coalesce((
      select jsonb_agg(to_jsonb(o) - 'escalation_paused' order by o.express desc, o.due_at)
        from open_tasks o
       where o.status = 'unassigned'), '[]'::jsonb),
    'health', public.job_health(p_now));
$$;

-- Once a day: true for the first caller of the day (two cron invocations,
-- 06:30 and 07:30 UTC around DST, cannot both send).
create function public.standup_claim(p_date date)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update system_heartbeats
     set last_run_at = now(), last_report = jsonb_build_object('date', p_date::text)
   where name = 'standup'
     and (last_report ->> 'date') is distinct from p_date::text;
  return found;
end;
$$;

-------------------------------------------------------------------------------
-- 4. Telegram account linking (D4)
-------------------------------------------------------------------------------

-- Consumes a one-time link token (sha256 of the opaque token from
-- /settings, 15 minutes) and saves the private chat id on the profile.
-- Codes: ok, invalid (unknown, used, expired, deactivated profile, not a
-- private chat id), chat_taken (another profile has this chat).
create function public.link_telegram(p_token_hash text, p_chat_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  tok telegram_link_tokens%rowtype;
begin
  if p_chat_id is null or p_chat_id !~ '^[0-9]{1,20}$' then
    return jsonb_build_object('code', 'invalid');
  end if;
  select * into tok from telegram_link_tokens where token_hash = p_token_hash for update;
  if not found or tok.used_at is not null or tok.expires_at < now()
     or exists (select 1 from profiles p where p.id = tok.user_id and p.deactivated_at is not null) then
    return jsonb_build_object('code', 'invalid');
  end if;
  if exists (select 1 from profiles p where p.telegram_chat_id = p_chat_id and p.id <> tok.user_id) then
    return jsonb_build_object('code', 'chat_taken', 'user_id', tok.user_id);
  end if;
  update telegram_link_tokens set used_at = now() where token_hash = p_token_hash;
  update profiles set telegram_chat_id = p_chat_id where id = tok.user_id;
  return jsonb_build_object('code', 'ok', 'user_id', tok.user_id);
end;
$$;

-------------------------------------------------------------------------------
-- 5. Privileges: service role only
-------------------------------------------------------------------------------

revoke execute on function public.claim_jobs(integer, interval) from public, anon, authenticated;
revoke execute on function public.complete_job(bigint, integer, uuid) from public, anon, authenticated;
revoke execute on function public.fail_job(bigint, uuid, text, boolean) from public, anon, authenticated;
revoke execute on function public.sweep_tasks(timestamptz) from public, anon, authenticated;
revoke execute on function public.job_health(timestamptz) from public, anon, authenticated;
revoke execute on function public.standup_snapshot(timestamptz) from public, anon, authenticated;
revoke execute on function public.standup_claim(date) from public, anon, authenticated;
revoke execute on function public.link_telegram(text, text) from public, anon, authenticated;
grant execute on function public.claim_jobs(integer, interval) to service_role;
grant execute on function public.complete_job(bigint, integer, uuid) to service_role;
grant execute on function public.fail_job(bigint, uuid, text, boolean) to service_role;
grant execute on function public.sweep_tasks(timestamptz) to service_role;
grant execute on function public.job_health(timestamptz) to service_role;
grant execute on function public.standup_snapshot(timestamptz) to service_role;
grant execute on function public.standup_claim(date) to service_role;
grant execute on function public.link_telegram(text, text) to service_role;

revoke execute on all functions in schema private from public, anon, authenticated;
