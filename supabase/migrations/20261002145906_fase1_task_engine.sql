-- Fase 1 — task engine (docs/fase1-plan.md §S2, transitions table).
--
-- Expand, tolerated by the Fase 0 code in production: it adds functions and
-- the script lock. The only change the Fase 0 code sees is that from
-- `revisione` onwards only admins edit the script text (legacy reels in
-- dubbing/editing/publication included): wanted, announced at release.
--
-- Every transition runs in one transaction: lock the reel, then the task;
-- close the task, create the next one (with its SLA thresholds and its
-- notification row in job_outbox), move the reel state, log task_events.
-- Authorization uses the explicit actor (private.*_uid), never auth.uid(),
-- so the app (task_action) and Telegram (task_action_as) share one path.
-- Return codes: ok, not_authorized, invalid_input, task_not_found,
-- invalid_state, invalid_assignee, stale, file_missing, dod_incomplete,
-- script_missing, proposal_stale.
--
-- R1 handles link deliveries only (requires_drive is false while Drive is
-- off); S5 replaces task_action_core with the Drive file path (I7).

-------------------------------------------------------------------------------
-- 1. Building blocks
-------------------------------------------------------------------------------

create function private._is_open(p_status task_status)
returns boolean
language sql
immutable
as $$
  select p_status in ('unassigned', 'assigned', 'in_progress');
$$;

-- Work tasks waiting for acceptance run on the acceptance SLA.
create function private._sla_step(p_kind task_kind, p_status task_status)
returns sla_step
language sql
immutable
as $$
  select case
    when p_kind = 'dubbing' and p_status in ('assigned', 'unassigned') then 'dubbing_accept'
    when p_kind = 'animation' and p_status in ('assigned', 'unassigned') then 'animation_accept'
    else p_kind::text
  end::sla_step;
$$;

create function private._log(
  p_task uuid, p_reel uuid, p_actor uuid, p_op text, p_channel text, p_code text, p_note text
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into task_events (task_id, reel_id, actor_id, op, channel, code, note)
  values (p_task, p_reel, p_actor, p_op, p_channel, p_code, p_note);
$$;

-- Outbox row in the caller's transaction. A pending row with the same
-- dedup_key is not duplicated: its generation goes up, so a worker that is
-- already running it knows to run it again (S4).
create function private._enqueue(p_kind job_kind, p_payload jsonb, p_dedup text, p_run_after timestamptz default now())
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_dedup is null then
    insert into job_outbox (kind, payload, run_after) values (p_kind, p_payload, p_run_after);
    return;
  end if;
  insert into job_outbox (kind, payload, dedup_key, run_after)
  values (p_kind, p_payload, p_dedup, p_run_after)
  on conflict (dedup_key) where done_at is null and failed_at is null
  do update set requested_gen = job_outbox.requested_gen + 1,
                run_after = least(job_outbox.run_after, excluded.run_after);
end;
$$;

create function private._drive_enabled()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select c.value = 'true'::jsonb from app_config c where c.key = 'drive_enabled'), false);
$$;

-- Drive work for a reel (folder, kit, shares) is queued only once Drive is
-- on (R2), so no row waits without a handler.
create function private._drive_reconcile(p_reel_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if private._drive_enabled() then
    perform private._enqueue('drive_reconcile', jsonb_build_object('reel_id', p_reel_id), 'drive:' || p_reel_id);
  end if;
end;
$$;

-- Notification for a task: to the assignee, or to the admins when nobody
-- could be assigned. The S4 handler re-reads the task before sending.
create function private._notify_task(p_task_id uuid, p_event text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  t tasks%rowtype;
begin
  select * into t from tasks where id = p_task_id;
  perform private._enqueue(
    'notify',
    jsonb_build_object(
      'event', p_event,
      'task_id', t.id,
      'reel_id', t.reel_id,
      'to', case when t.status = 'unassigned' then 'admins' else 'assignee' end,
      'assignee_id', t.assignee_id,
      'note', p_note),
    'task:' || t.id || ':' || p_event);
  update tasks set notified_at = now() where id = t.id;
end;
$$;

-- Starts the SLA clock now with the step for the task's kind and status.
create function private._restart_clock(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  t tasks%rowtype;
  r reels%rowtype;
  v_minutes integer;
  v_now timestamptz := now();
begin
  select * into t from tasks where id = p_task_id;
  select * into r from reels where id = t.reel_id;
  v_minutes := private.sla_minutes(r.page_id, r.track, private._sla_step(t.kind, t.status));
  update tasks
     set started_at = v_now,
         yellow_at = private.add_sla(v_now, v_minutes * 0.75, r.track),
         due_at = private.add_sla(v_now, v_minutes, r.track),
         escalate_at = private.add_sla(v_now, v_minutes * 1.5, r.track),
         overdue_notified_at = null,
         escalated_at = null
   where id = t.id;
end;
$$;

-- Creates the next task. No assignee → unassigned (the admins hear of it).
-- p_notify: the event to queue, or null for no message.
create function private._create_task(
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
    private._drive_enabled(), 'app', p_actor
  )
  returning id into v_id;
  perform private._restart_clock(v_id);
  if p_notify is not null then
    perform private._notify_task(v_id, p_notify);
  end if;
  return v_id;
end;
$$;

create function private._close_task(
  p_task_id uuid, p_status task_status, p_actor uuid, p_channel text, p_note text,
  p_payload jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = public
as $$
  update tasks
     set status = p_status,
         closed_at = now(),
         closed_by = p_actor,
         closed_via = case when p_channel in ('telegram', 'sweep', 'admin', 'migration') then p_channel else 'app' end,
         decision_note = p_note,
         delivered_at = case when p_status = 'delivered' then now() else delivered_at end,
         payload = payload || coalesce(p_payload, '{}'::jsonb)
   where id = p_task_id;
$$;

-- Assignee of the latest task of a kind on the reel with one of the statuses.
create function private._last_assignee(p_reel_id uuid, p_kind task_kind, p_statuses task_status[])
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select t.assignee_id from tasks t
   where t.reel_id = p_reel_id and t.kind = p_kind and t.status = any (p_statuses)
     and t.assignee_id is not null
   order by coalesce(t.closed_at, t.created_at) desc
   limit 1;
$$;

-- Who should get a task of this kind on the reel:
-- dubbing/animation: titular, then reserve, skipping whoever already declined
-- or let expire this kind on the reel, deactivated profiles, and the other
-- role's worker (the dubber never animates the same reel, and vice versa);
-- validation: the page validator; writing / scheduling: first RACI
-- Responsible; approvals: the effective approver.
create function private._pick_work_candidate(p_reel_id uuid, p_kind task_kind)
returns uuid
language plpgsql
stable
security definer
set search_path = public, private
as $$
declare
  r reels%rowtype;
  pg pages%rowtype;
  v_other uuid;
  v_candidate uuid;
begin
  select * into r from reels where id = p_reel_id;
  select * into pg from pages where id = r.page_id;

  if p_kind in ('review', 'audio_approval', 'final_approval') then
    return private.effective_approver(r.page_id);
  elsif p_kind = 'writing' then
    return private.first_responsible(r.page_id, 'script_writing');
  elsif p_kind = 'scheduling' then
    return private.first_responsible(r.page_id, 'publication');
  end if;

  v_other := case p_kind
    when 'animation' then private._last_assignee(p_reel_id, 'dubbing', array['delivered']::task_status[])
    when 'dubbing' then private._last_assignee(p_reel_id, 'animation', array['delivered']::task_status[])
  end;

  foreach v_candidate in array case p_kind
      when 'dubbing' then array[pg.dubber_titular_id, pg.dubber_reserve_id]
      when 'animation' then array[pg.animator_titular_id, pg.animator_reserve_id]
      when 'validation' then array[pg.validator_id]
    end
  loop
    continue when v_candidate is null or v_candidate is not distinct from v_other;
    continue when exists (select 1 from profiles p where p.id = v_candidate and p.deactivated_at is not null);
    continue when exists (
      select 1 from tasks t
       where t.reel_id = p_reel_id and t.kind = p_kind and t.assignee_id = v_candidate
         and t.status in ('declined', 'expired'));
    return v_candidate;
  end loop;
  return null;
end;
$$;

-- The state the reel should be in, from its tasks: the open task, else the
-- last closed one. A reel without tasks keeps idea, pubblicato (legacy
-- 'published' rows without a URL) or programmato when migrated already
-- scheduled (I14: the current state counts). null = inconsistent.
create function private.derived_state(p_reel_id uuid)
returns reel_state
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r reels%rowtype;
  t tasks%rowtype;
begin
  select * into r from reels where id = p_reel_id;
  if r.published_at is not null then
    return 'pubblicato';
  end if;

  select * into t from tasks
   where reel_id = p_reel_id and status in ('unassigned', 'assigned', 'in_progress');
  if found then
    return case t.kind
      when 'writing' then 'bozza'
      when 'review' then 'revisione'
      when 'validation' then 'validazione'
      when 'dubbing' then case
        when exists (select 1 from tasks d where d.reel_id = p_reel_id and d.kind = 'dubbing'
                      and d.accepted_at is not null) then 'doppiaggio'
        else 'confermato' end
      when 'audio_approval' then 'doppiaggio'
      when 'animation' then 'animazione'
      when 'final_approval' then 'approvazione_finale'
      when 'scheduling' then 'programmato'
    end::reel_state;
  end if;

  select * into t from tasks where reel_id = p_reel_id order by closed_at desc nulls last limit 1;
  if not found then
    return case
      when r.state = 'pubblicato' then 'pubblicato'
      when r.state = 'programmato' and r.scheduled_at is not null then 'programmato'
      else 'idea' end::reel_state;
  end if;
  if t.kind = 'scheduling' and t.status = 'delivered' then
    return 'programmato';
  end if;
  return null;
end;
$$;

-- The only writer of reels.state from the engine: refuses a state the tasks
-- do not support.
create function private._set_state(p_reel_id uuid, p_state reel_state)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_derived reel_state := private.derived_state(p_reel_id);
begin
  if v_derived is distinct from p_state then
    raise exception 'invalid_state: % is not supported by the tasks (derived %)', p_state, v_derived
      using errcode = 'P0001';
  end if;
  update reels set state = p_state where id = p_reel_id and state is distinct from p_state;
end;
$$;

-- Approver, delegate (of the page's group) or admin; the assignee too.
-- Validation is decided only by its assignee or an admin.
create function private._can_decide(p_actor uuid, p_task tasks, p_page_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  -- coalesce: a null comparison (unassigned task) must mean "no", never pass.
  select coalesce(
    private.is_admin_uid(p_actor)
      or p_task.assignee_id = p_actor
      or (p_task.kind <> 'validation' and exists (
            select 1 from approval_groups g
             where g.id = coalesce(
                     (select pg.approval_group_id from pages pg where pg.id = p_page_id),
                     (select d.id from approval_groups d where d.is_default))
               and p_actor in (g.approver_id, g.delegate_id))),
    false);
$$;

create function private._script_missing(p_reel reels)
returns boolean
language sql
immutable
as $$
  select coalesce(nullif(trim(p_reel.hook), ''), nullif(trim(p_reel.corpo), ''),
                  nullif(trim(p_reel.chiusura), ''), nullif(trim(p_reel.cta), ''),
                  nullif(trim(p_reel.raw_content), '')) is null;
$$;

create function private._add_dod(p_reel_id uuid, p_key dod_item_key, p_actor uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into reel_dod_items (reel_id, key, checked_by)
  values (p_reel_id, p_key, p_actor)
  on conflict (reel_id, key) do nothing;
$$;

-- Script approved and validated: dubbing goes to the titular (or reserve),
-- waiting for acceptance; nobody available → unassigned for the admins.
create function private._confirm(p_reel_id uuid, p_actor uuid, p_previous uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  perform private._create_task(p_reel_id, 'dubbing', private._pick_work_candidate(p_reel_id, 'dubbing'),
                               'assigned', p_actor, p_previous);
  perform private._set_state(p_reel_id, 'confermato');
  perform private._drive_reconcile(p_reel_id);
end;
$$;

-------------------------------------------------------------------------------
-- 2. Transitions
-------------------------------------------------------------------------------

-- Validates everything before changing anything, so a refusal leaves no trace
-- except its task_events row.
create function private._transition(
  p_actor uuid, t tasks, r reels, p_op text, p_note text, p_payload jsonb, p_channel text
)
returns text
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_next uuid;
  v_url text;
  v_to text;
  v_prev uuid;
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

    -- R1: a link. With Drive on (R2) the file must be uploaded (S5).
    if t.requires_drive then return 'file_missing'; end if;
    v_url := p_payload ->> 'file_url';
    if v_url is null or v_url !~ '^https://\S+$' then return 'invalid_input'; end if;

    if t.kind = 'dubbing' then
      update reels set audio_drive_url = v_url where id = r.id;
      perform private._close_task(t.id, 'delivered', p_actor, p_channel, p_note,
                                  jsonb_build_object('file_url', v_url));
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
      perform private._close_task(t.id, 'delivered', p_actor, p_channel, p_note,
                                  jsonb_build_object('file_url', v_url));
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

    if t.kind = 'audio_approval' then
      if p_op = 'approve' then
        perform private._close_task(t.id, 'approved', p_actor, p_channel, p_note);
        perform private._add_dod(r.id, 'audio_recorded', p_actor);
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
      perform private._create_task(r.id, 'scheduling', private._pick_work_candidate(r.id, 'scheduling'),
                                   'in_progress', p_actor, t.id);
      perform private._set_state(r.id, 'programmato');
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

create function private.task_action_core(
  p_actor uuid, p_task_id uuid, p_op text, p_note text, p_payload jsonb, p_channel text
)
returns text
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_reel_id uuid;
  r reels%rowtype;
  t tasks%rowtype;
  v_code text;
begin
  select reel_id into v_reel_id from tasks where id = p_task_id;
  if not found or p_actor is null then
    perform private._log(null, null, p_actor, p_op, p_channel,
                         case when p_actor is null then 'not_authorized' else 'task_not_found' end, p_note);
    return case when p_actor is null then 'not_authorized' else 'task_not_found' end;
  end if;
  -- Lock order everywhere: the reel, then the task.
  select * into r from reels where id = v_reel_id for update;
  select * into t from tasks where id = p_task_id for update;
  v_code := private._transition(p_actor, t, r, p_op, nullif(trim(p_note), ''),
                                coalesce(p_payload, '{}'::jsonb), p_channel);
  perform private._log(t.id, r.id, p_actor, p_op, p_channel, v_code, nullif(trim(p_note), ''));
  return v_code;
end;
$$;

-------------------------------------------------------------------------------
-- 3. Admin and flow operations on a reel
-------------------------------------------------------------------------------

-- Kind of person a task kind accepts: workers by external kind (or any
-- internal), approvals, writing and scheduling internals only.
create function private._fits_task(p_user uuid, p_kind task_kind)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select p_user is not null
     and exists (select 1 from profiles p where p.id = p_user and p.deactivated_at is null)
     and case p_kind
       when 'dubbing' then private.role_fits(p_user, 'dubber')
       when 'animation' then private.role_fits(p_user, 'animator')
       when 'validation' then private.role_fits(p_user, 'validator')
       else private.is_internal_uid(p_user)
     end;
$$;

-- Replaces the open task with a new one for p_user (or nobody). Work tasks
-- that need acceptance start assigned, the rest in progress.
create function private._reassign(p_actor uuid, t tasks, p_user uuid, p_note text)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_state reel_state;
  v_new uuid;
begin
  select state into v_state from reels where id = t.reel_id;
  perform private._close_task(t.id, 'cancelled', p_actor, 'admin', p_note);
  v_new := private._create_task(t.reel_id, t.kind, p_user,
    case when t.kind in ('dubbing', 'animation') then 'assigned' else 'in_progress' end::task_status,
    p_actor, t.id);
  perform private._set_state(t.reel_id, v_state);
  perform private._drive_reconcile(t.reel_id);
  return v_new;
end;
$$;

create function private.assign_task(p_actor uuid, p_task_id uuid, p_user uuid)
returns text
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_reel_id uuid;
  t tasks%rowtype;
  v_code text := 'ok';
begin
  select reel_id into v_reel_id from tasks where id = p_task_id;
  if not found then return 'task_not_found'; end if;
  perform 1 from reels where id = v_reel_id for update;
  select * into t from tasks where id = p_task_id for update;

  if not private.is_admin_uid(p_actor) then
    v_code := 'not_authorized';
  elsif not private._is_open(t.status) then
    v_code := 'invalid_state';
  elsif not private._fits_task(p_user, t.kind)
     or (t.kind = 'animation' and p_user is not distinct from
           private._last_assignee(v_reel_id, 'dubbing', array['delivered']::task_status[]))
     or (t.kind = 'dubbing' and p_user is not distinct from
           private._last_assignee(v_reel_id, 'animation', array['delivered']::task_status[])) then
    v_code := 'invalid_assignee';
  end if;

  if v_code = 'ok' then
    perform private._reassign(p_actor, t, p_user, null);
  end if;
  perform private._log(t.id, v_reel_id, p_actor, 'assign', 'app', v_code, null);
  return v_code;
end;
$$;

-- "Avvia stesura": the first n reels of the batch still in idea get a
-- writing task; one message per author instead of one per reel.
create function private.start_writing(p_actor uuid, p_batch_id uuid, p_n integer)
returns text
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_page uuid;
  r record;
  v_task uuid;
  v_author uuid;
  v_started integer := 0;
  v_minute text := to_char(now() at time zone 'UTC', 'YYYYMMDDHH24MI');
begin
  select page_id into v_page from batches where id = p_batch_id;
  if v_page is null then return 'invalid_input'; end if;
  if not (private.is_admin_uid(p_actor)
          or (private.is_internal_uid(p_actor)
              and private.has_raci_role_uid(v_page, 'script_writing', 'responsible', p_actor))) then
    perform private._log(null, null, p_actor, 'start_writing', 'app', 'not_authorized', null);
    return 'not_authorized';
  end if;
  if p_n is null or p_n < 1 or p_n > 100 then return 'invalid_input'; end if;

  v_author := private.first_responsible(v_page, 'script_writing');
  for r in
    select id from reels
     where batch_id = p_batch_id and state = 'idea' and published_at is null
     order by ordinal
     limit p_n
     for update
  loop
    v_task := private._create_task(r.id, 'writing', v_author, 'in_progress', p_actor, null, null);
    perform private._set_state(r.id, 'bozza');
    perform private._log(v_task, r.id, p_actor, 'start_writing', 'app', 'ok', null);
    update tasks set notified_at = now() where id = v_task;
    v_started := v_started + 1;
  end loop;

  if v_started = 0 then return 'ok'; end if;
  perform private._enqueue('notify',
    jsonb_build_object('event', 'assignment', 'batch_id', p_batch_id, 'kind', 'writing',
                       'to', case when v_author is null then 'admins' else 'assignee' end,
                       'assignee_id', v_author),
    'start_writing:' || p_batch_id || ':' || coalesce(v_author::text, 'admins') || ':' || v_minute);
  return 'ok';
end;
$$;

-- Migrated tasks start their SLA now and leave the escalation pause.
create function private.confirm_migrated_tasks(p_actor uuid, p_task_ids uuid[])
returns text
language plpgsql
security definer
set search_path = public, private
as $$
declare
  t tasks%rowtype;
begin
  if not private.is_admin_uid(p_actor) then return 'not_authorized'; end if;
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

-- Batch ↔ Express before programmato; the open task's thresholds follow,
-- from its original start.
create function private.set_reel_track(p_actor uuid, p_reel_id uuid, p_track reel_track)
returns text
language plpgsql
security definer
set search_path = public, private
as $$
declare
  r reels%rowtype;
  t tasks%rowtype;
  v_minutes integer;
begin
  select * into r from reels where id = p_reel_id for update;
  if not found or p_track is null then return 'invalid_input'; end if;
  if not coalesce(private.is_admin_uid(p_actor) or p_actor = private.effective_approver(r.page_id), false) then
    return 'not_authorized';
  end if;
  if r.state >= 'programmato' then return 'invalid_state'; end if;

  update reels set track = p_track where id = r.id;
  select * into t from tasks where reel_id = r.id and private._is_open(status) for update;
  if found then
    v_minutes := private.sla_minutes(r.page_id, p_track, private._sla_step(t.kind, t.status));
    update tasks
       set yellow_at = private.add_sla(t.started_at, v_minutes * 0.75, p_track),
           due_at = private.add_sla(t.started_at, v_minutes, p_track),
           escalate_at = private.add_sla(t.started_at, v_minutes * 1.5, p_track)
     where id = t.id;
  end if;
  perform private._log(t.id, r.id, p_actor, 'set_track:' || p_track, 'app', 'ok', null);
  return 'ok';
end;
$$;

-- An approver away: their open approvals move to whoever is effective now
-- (the delegate, or nobody → unassigned for the admins).
create function private.set_absence(p_actor uuid, p_user uuid, p_until timestamptz)
returns text
language plpgsql
security definer
set search_path = public, private
as $$
declare
  t tasks%rowtype;
begin
  if not private.is_admin_uid(p_actor) then return 'not_authorized'; end if;
  if not private.is_internal_uid(p_user) then return 'invalid_input'; end if;
  update profiles set absent_until = p_until where id = p_user;
  if p_until is null or p_until <= now() then
    return 'ok';
  end if;
  for t in
    select tk.* from tasks tk
     where tk.assignee_id = p_user and private._is_open(tk.status)
       and tk.kind in ('review', 'audio_approval', 'final_approval')
     order by tk.reel_id
  loop
    perform 1 from reels where id = t.reel_id for update;
    perform private._reassign(p_actor, t,
      private.effective_approver((select page_id from reels where id = t.reel_id)), '[assenza]');
  end loop;
  return 'ok';
end;
$$;

create function private.schedule_reel(p_actor uuid, p_reel_id uuid, p_caption text, p_scheduled_at timestamptz)
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
  if not found or p_scheduled_at is null then return 'invalid_input'; end if;
  select * into t from tasks
   where reel_id = r.id and kind = 'scheduling' and private._is_open(status) for update;
  if not found then return 'invalid_state'; end if;
  if not coalesce(t.assignee_id = p_actor or private.is_admin_uid(p_actor), false) then
    perform private._log(t.id, r.id, p_actor, 'schedule', 'app', 'not_authorized', null);
    return 'not_authorized';
  end if;
  update reels set caption = coalesce(p_caption, caption), scheduled_at = p_scheduled_at where id = r.id;
  perform private._close_task(t.id, 'delivered', p_actor, 'app', null);
  perform private._set_state(r.id, 'programmato');
  perform private._log(t.id, r.id, p_actor, 'schedule', 'app', 'ok', null);
  return 'ok';
end;
$$;

-- Published: posted_url and state move together; an open scheduling task
-- is closed by the publication.
create function private.publish_reel(p_actor uuid, p_reel_id uuid, p_posted_url text)
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
  if not found or p_posted_url is null or p_posted_url !~ '^https://\S+$' then return 'invalid_input'; end if;
  if r.state <> 'programmato' then return 'invalid_state'; end if;
  if not coalesce(private.is_admin_uid(p_actor)
          or p_actor = private._last_assignee(r.id, 'scheduling',
                         array['in_progress', 'delivered']::task_status[])
          or (private.is_internal_uid(p_actor) and (
                private.has_raci_role_uid(r.page_id, 'publication', 'responsible', p_actor)
                or private.has_raci_role_uid(r.page_id, 'publication', 'approver', p_actor)
                or private.has_raci_role_uid(r.page_id, 'publication', 'consulted', p_actor))), false) then
    perform private._log(null, r.id, p_actor, 'publish', 'app', 'not_authorized', null);
    return 'not_authorized';
  end if;

  select * into t from tasks
   where reel_id = r.id and kind = 'scheduling' and private._is_open(status) for update;
  if found then
    perform private._close_task(t.id, 'delivered', p_actor, 'app', '[chiuso dalla pubblicazione]');
  end if;
  update reels set posted_url = p_posted_url, state = 'pubblicato' where id = r.id;
  if private.derived_state(r.id) is distinct from 'pubblicato' then
    raise exception 'invalid_state: publication did not derive pubblicato' using errcode = 'P0001';
  end if;
  perform private._log(t.id, r.id, p_actor, 'publish', 'app', 'ok', null);
  return 'ok';
end;
$$;

-------------------------------------------------------------------------------
-- 4. Script lock and text proposals
-------------------------------------------------------------------------------

-- From revisione on the script changes only through an accepted proposal or
-- an admin. SECURITY INVOKER on purpose: current_user is 'authenticated' for
-- API users and the owner inside SECURITY DEFINER functions such as
-- decide_text_proposal, which pass. Values compared, not columns sent.
create function private.reels_script_lock()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.state >= 'revisione'
     and current_user = 'authenticated'
     and (new.hook, new.corpo, new.chiusura, new.cta, new.notes, new.raw_content)
         is distinct from (old.hook, old.corpo, old.chiusura, old.cta, old.notes, old.raw_content)
     and not public.is_admin() then
    raise exception 'script_locked: from revisione the script changes through a proposal'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger trg_reels_script_lock
  before update on reels
  for each row execute function private.reels_script_lock();

-- Anyone working on the reel proposes a word-level change to a block:
-- the holder of an open task (externals too), an internal with a RACI role
-- on the page, or an admin.
create function private.propose_text_change(p_actor uuid, p_reel_id uuid, p_field text, p_text text)
returns text
language plpgsql
security definer
set search_path = public, private
as $$
declare
  r reels%rowtype;
  v_task uuid;
  v_id uuid;
begin
  if p_field not in ('hook', 'corpo', 'chiusura', 'cta') or p_text is null then return 'invalid_input'; end if;
  select * into r from reels where id = p_reel_id for update;
  if not found then return 'invalid_input'; end if;
  select id into v_task from tasks
   where reel_id = r.id and private._is_open(status) and assignee_id = p_actor;
  if not (v_task is not null
          or private.is_admin_uid(p_actor)
          or (private.is_internal_uid(p_actor) and exists (
                select 1 from raci_configs rc
                 where rc.page_id = r.page_id
                   and p_actor = any (rc.responsible || rc.approver || rc.consulted || rc.informed)))) then
    perform private._log(null, r.id, p_actor, 'propose', 'app', 'not_authorized', null);
    return 'not_authorized';
  end if;
  if r.state < 'revisione' or r.state = 'pubblicato' then return 'invalid_state'; end if;

  insert into text_change_proposals (reel_id, task_id, proposed_by, field, original_text, proposed_text, base_rev)
  values (r.id, v_task, p_actor, p_field,
          case p_field when 'hook' then r.hook when 'corpo' then r.corpo
                       when 'chiusura' then r.chiusura else r.cta end,
          p_text, r.script_rev)
  returning id into v_id;
  perform private._enqueue('notify',
    jsonb_build_object('event', 'text_proposal', 'proposal_id', v_id, 'reel_id', r.id, 'to', 'approver'),
    'proposal:' || v_id);
  perform private._log(v_task, r.id, p_actor, 'propose:' || p_field, 'app', 'ok', null);
  return 'ok';
end;
$$;

create function private.decide_text_proposal(p_actor uuid, p_id uuid, p_decision text, p_note text)
returns text
language plpgsql
security definer
set search_path = public, private
as $$
declare
  pr text_change_proposals%rowtype;
  r reels%rowtype;
  v_reel_id uuid;
begin
  if p_decision not in ('accepted', 'rejected') then return 'invalid_input'; end if;
  select reel_id into v_reel_id from text_change_proposals where id = p_id;
  if v_reel_id is null then return 'invalid_input'; end if;
  select * into r from reels where id = v_reel_id for update;
  select * into pr from text_change_proposals where id = p_id for update;
  if not (private.is_admin_uid(p_actor) or exists (
            select 1 from approval_groups g
             where g.id = coalesce(
                     (select pg.approval_group_id from pages pg where pg.id = r.page_id),
                     (select d.id from approval_groups d where d.is_default))
               and p_actor in (g.approver_id, g.delegate_id))) then
    perform private._log(pr.task_id, r.id, p_actor, 'decide_proposal', 'app', 'not_authorized', null);
    return 'not_authorized';
  end if;
  if pr.status <> 'pending' then return 'invalid_state'; end if;
  if p_decision = 'accepted' and r.script_rev <> pr.base_rev then
    perform private._log(pr.task_id, r.id, p_actor, 'decide_proposal', 'app', 'proposal_stale', null);
    return 'proposal_stale';
  end if;

  if p_decision = 'accepted' then
    update reels
       set hook = case when pr.field = 'hook' then pr.proposed_text else hook end,
           corpo = case when pr.field = 'corpo' then pr.proposed_text else corpo end,
           chiusura = case when pr.field = 'chiusura' then pr.proposed_text else chiusura end,
           cta = case when pr.field = 'cta' then pr.proposed_text else cta end
     where id = r.id;
  end if;
  update text_change_proposals
     set status = p_decision, decided_by = p_actor, decided_at = now(),
         decision_note = nullif(trim(p_note), '')
   where id = pr.id;
  perform private._enqueue('notify',
    jsonb_build_object('event', 'text_proposal', 'proposal_id', pr.id, 'reel_id', r.id,
                       'to', 'proposer', 'decision', p_decision),
    'proposal:' || pr.id || ':' || p_decision);
  perform private._log(pr.task_id, r.id, p_actor, 'decide_proposal:' || p_decision, 'app', 'ok', null);
  return 'ok';
end;
$$;

-------------------------------------------------------------------------------
-- 5. Offboarding (completes S1) and reconciliation
-------------------------------------------------------------------------------

-- Deactivates, clears page roles, and hands each open task to the next
-- person (approvals to the effective approver, work to the next candidate,
-- writing/scheduling to RACI) or leaves it unassigned for the admins.
create or replace function private.offboard_collaborator(p_actor uuid, p_user uuid)
returns text
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_profile profiles%rowtype;
  t tasks%rowtype;
begin
  if not private.is_admin_uid(p_actor) then
    return 'not_authorized';
  end if;
  if p_user is null or p_user = p_actor then
    return 'invalid_input';
  end if;
  select * into v_profile from profiles where id = p_user for update;
  if not found then
    return 'invalid_input';
  end if;
  if v_profile.is_admin then
    return 'invalid_state';
  end if;

  if v_profile.deactivated_at is null then
    update profiles set deactivated_at = now() where id = p_user;
  end if;
  update pages set dubber_titular_id = null where dubber_titular_id = p_user;
  update pages set dubber_reserve_id = null where dubber_reserve_id = p_user;
  update pages set animator_titular_id = null where animator_titular_id = p_user;
  update pages set animator_reserve_id = null where animator_reserve_id = p_user;
  update pages set validator_id = null where validator_id = p_user;

  for t in
    select tk.* from tasks tk
     where tk.assignee_id = p_user and private._is_open(tk.status)
     order by tk.reel_id
  loop
    perform 1 from reels where id = t.reel_id for update;
    perform private._reassign(p_actor, t, private._pick_work_candidate(t.reel_id, t.kind), '[offboarding]');
  end loop;
  return 'ok';
end;
$$;

-- Back to the forward path after an uncontract (docs/fase1-plan.md §6): the
-- Fase 0 code may have moved phase/state or published reels while tasks
-- stayed open. Cancels open tasks that no longer match the state, then
-- creates the missing one like the backfill (paused, no message).
create function public.fase1_reconcile_tasks()
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  r reels%rowtype;
  t tasks%rowtype;
  v_expected task_kind[];
  v_kind task_kind;
  v_assignee uuid;
  v_status task_status;
  v_task uuid;
  v_cancelled integer := 0;
  v_created integer := 0;
  v_reels text[] := '{}';
begin
  for r in select * from reels order by id for update loop
    v_expected := case r.state
      when 'bozza' then array['writing']
      when 'revisione' then array['review']
      when 'validazione' then array['validation']
      when 'confermato' then array['dubbing']
      when 'doppiaggio' then array['dubbing', 'audio_approval']
      when 'animazione' then array['animation']
      when 'approvazione_finale' then array['final_approval']
      when 'programmato' then array['scheduling']
      else array[]::text[]
    end::task_kind[];

    for t in select * from tasks where reel_id = r.id and private._is_open(status) for update loop
      if not (t.kind = any (v_expected)) or r.published_at is not null
         or (r.state = 'confermato' and t.accepted_at is not null) then
        perform private._close_task(t.id, 'cancelled', null, 'admin', '[riconciliazione]');
        perform private._log(t.id, r.id, null, 'reconcile', 'admin', 'cancelled', null);
        v_cancelled := v_cancelled + 1;
        v_reels := array_append(v_reels, r.code);
      end if;
    end loop;

    continue when r.published_at is not null
      or exists (select 1 from tasks where reel_id = r.id and private._is_open(status));
    v_kind := case r.state
      when 'bozza' then 'writing'
      when 'revisione' then 'review'
      when 'validazione' then 'validation'
      when 'confermato' then 'dubbing'
      when 'doppiaggio' then 'dubbing'
      when 'animazione' then 'animation'
      when 'approvazione_finale' then 'final_approval'
      when 'programmato' then case when r.scheduled_at is null then 'scheduling' end
    end::task_kind;
    continue when v_kind is null;

    v_assignee := case
      when v_kind in ('review', 'final_approval') then private.effective_approver(r.page_id)
      else coalesce(private.page_titular(r.page_id, v_kind),
                    private.first_responsible(r.page_id, public.state_raci_phase(r.state)))
    end;
    v_status := case when r.state = 'confermato' then 'assigned' else 'in_progress' end;
    v_task := private._create_task(r.id, v_kind, v_assignee, v_status, null, null, null);
    update tasks
       set origin = 'migration', escalation_paused = true, notified_at = now(),
           accepted_at = case when v_status = 'in_progress' and v_kind in ('dubbing', 'animation')
                              then now() end
     where id = v_task;
    perform private._log(v_task, r.id, null, 'reconcile', 'admin', 'created', null);
    v_created := v_created + 1;
    v_reels := array_append(v_reels, r.code);
  end loop;
  return jsonb_build_object('cancelled', v_cancelled, 'created', v_created,
                            'reels', (select coalesce(jsonb_agg(distinct c), '[]') from unnest(v_reels) c));
end;
$$;

-------------------------------------------------------------------------------
-- 6. Public entry points
-------------------------------------------------------------------------------

-- Session callers: the actor is auth.uid().
create function public.task_action(p_task_id uuid, p_op text, p_note text default null, p_payload jsonb default null)
returns text language sql security definer set search_path = public, private as $$
  select private.task_action_core(auth.uid(), p_task_id, p_op, p_note, p_payload, 'app');
$$;

create function public.start_writing(p_batch_id uuid, p_n integer default 10)
returns text language sql security definer set search_path = public, private as $$
  select private.start_writing(auth.uid(), p_batch_id, p_n);
$$;

create function public.assign_task(p_task_id uuid, p_user_id uuid)
returns text language sql security definer set search_path = public, private as $$
  select private.assign_task(auth.uid(), p_task_id, p_user_id);
$$;

create function public.confirm_migrated_tasks(p_task_ids uuid[])
returns text language sql security definer set search_path = public, private as $$
  select private.confirm_migrated_tasks(auth.uid(), p_task_ids);
$$;

create function public.set_reel_track(p_reel_id uuid, p_track reel_track)
returns text language sql security definer set search_path = public, private as $$
  select private.set_reel_track(auth.uid(), p_reel_id, p_track);
$$;

create function public.set_absence(p_user_id uuid, p_until timestamptz)
returns text language sql security definer set search_path = public, private as $$
  select private.set_absence(auth.uid(), p_user_id, p_until);
$$;

create function public.schedule_reel(p_reel_id uuid, p_caption text, p_scheduled_at timestamptz)
returns text language sql security definer set search_path = public, private as $$
  select private.schedule_reel(auth.uid(), p_reel_id, p_caption, p_scheduled_at);
$$;

create function public.publish_reel(p_reel_id uuid, p_posted_url text)
returns text language sql security definer set search_path = public, private as $$
  select private.publish_reel(auth.uid(), p_reel_id, p_posted_url);
$$;

create function public.propose_text_change(p_reel_id uuid, p_field text, p_text text)
returns text language sql security definer set search_path = public, private as $$
  select private.propose_text_change(auth.uid(), p_reel_id, p_field, p_text);
$$;

create function public.decide_text_proposal(p_proposal_id uuid, p_decision text, p_note text default null)
returns text language sql security definer set search_path = public, private as $$
  select private.decide_text_proposal(auth.uid(), p_proposal_id, p_decision, p_note);
$$;

-- Service role (Telegram webhook): explicit actor and channel.
create function public.task_action_as(
  p_actor uuid, p_task_id uuid, p_op text, p_note text default null,
  p_payload jsonb default null, p_channel text default 'telegram'
)
returns text language sql security definer set search_path = public, private as $$
  select case when p_channel in ('app', 'telegram')
    then private.task_action_core(p_actor, p_task_id, p_op, p_note, p_payload, p_channel)
    else 'invalid_input' end;
$$;

revoke execute on function public.task_action(uuid, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.start_writing(uuid, integer) from public, anon, authenticated;
revoke execute on function public.assign_task(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.confirm_migrated_tasks(uuid[]) from public, anon, authenticated;
revoke execute on function public.set_reel_track(uuid, reel_track) from public, anon, authenticated;
revoke execute on function public.set_absence(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.schedule_reel(uuid, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.publish_reel(uuid, text) from public, anon, authenticated;
revoke execute on function public.propose_text_change(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.decide_text_proposal(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.task_action_as(uuid, uuid, text, text, jsonb, text) from public, anon, authenticated;
revoke execute on function public.fase1_reconcile_tasks() from public, anon, authenticated;

grant execute on function public.task_action(uuid, text, text, jsonb) to authenticated;
grant execute on function public.start_writing(uuid, integer) to authenticated;
grant execute on function public.assign_task(uuid, uuid) to authenticated;
grant execute on function public.confirm_migrated_tasks(uuid[]) to authenticated;
grant execute on function public.set_reel_track(uuid, reel_track) to authenticated;
grant execute on function public.set_absence(uuid, timestamptz) to authenticated;
grant execute on function public.schedule_reel(uuid, text, timestamptz) to authenticated;
grant execute on function public.publish_reel(uuid, text) to authenticated;
grant execute on function public.propose_text_change(uuid, text, text) to authenticated;
grant execute on function public.decide_text_proposal(uuid, text, text) to authenticated;
grant execute on function public.task_action_as(uuid, uuid, text, text, jsonb, text) to service_role;
grant execute on function public.fase1_reconcile_tasks() to service_role;

revoke execute on all functions in schema private from public, anon, authenticated;
