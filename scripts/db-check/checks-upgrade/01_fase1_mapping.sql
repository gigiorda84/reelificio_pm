-- AC7 on the legacy fixture (seed-legacy.sql), after the Fase 1 migrations.
-- Runs the runbook part first: the approver is configured (as
-- fase1-prod-config.sql does), then the backfill twice (idempotence).

update approval_groups set approver_id = 'a0000000-0000-0000-0000-000000000006' where is_default;

do $$
declare
  v_first jsonb := public.fase1_backfill_open_tasks();
  v_second jsonb := public.fase1_backfill_open_tasks();
begin
  if v_first <> '{"tasks_created": 8, "unassigned": 1, "dod_items_added": 7}'::jsonb then
    raise exception 'FAIL: first backfill returned %', v_first;
  end if;
  if v_second <> '{"tasks_created": 0, "unassigned": 0, "dod_items_added": 0}'::jsonb then
    raise exception 'FAIL: backfill not idempotent: %', v_second;
  end if;
end $$;

do $$
declare
  v_bad text;
begin
  -- Same reels, nothing inserted or deleted.
  if (select count(*) from reels) <> (select count(*) from upgrade_snap.reels)
     or exists (select 1 from upgrade_snap.reels s where not exists (select 1 from reels r where r.id = s.id)) then
    raise exception 'FAIL: reel set changed';
  end if;

  -- State and phase per reel.
  select string_agg(format('%s: %s/%s, want %s/%s', e.code, r.state, r.phase, e.state, e.phase), '; ')
    into v_bad
  from upgrade_snap.expected e join reels r on r.code = e.code
  where r.state::text <> e.state or r.phase::text <> e.phase;
  if v_bad is not null then raise exception 'FAIL: mapping: %', v_bad; end if;

  -- Phase unchanged except the normalised rows (qc, published, published
  -- reels outside publication).
  select string_agg(s.code, ', ') into v_bad
  from upgrade_snap.reels s join reels r on r.id = s.id
  where r.phase::text <> s.phase
    and s.code not in ('LG-2609-06', 'LG-2609-09', 'LG-2609-10');
  if v_bad is not null then raise exception 'FAIL: phase changed for %', v_bad; end if;

  -- published_at, posted_url, phase_entered_at preserved.
  select string_agg(s.code, ', ') into v_bad
  from upgrade_snap.reels s join reels r on r.id = s.id
  where r.published_at is distinct from s.published_at
     or r.posted_url is distinct from s.posted_url
     or r.phase_entered_at is distinct from s.phase_entered_at;
  if v_bad is not null then raise exception 'FAIL: published/posted/entered changed for %', v_bad; end if;

  -- Comments identical.
  if exists (
    select 1 from upgrade_snap.comments s
    left join comments c on c.id = s.id
    where c.id is null
       or md5(concat_ws('|', c.target_type, c.target_id, c.parent_id, c.author_id, c.body, c.mentions,
                        c.created_at, c.updated_at)) <> s.h
  ) or (select count(*) from comments) <> (select count(*) from upgrade_snap.comments) then
    raise exception 'FAIL: comments changed';
  end if;
  if exists (select 1 from comments where internal_only) then
    raise exception 'FAIL: legacy comments became internal-only';
  end if;

  -- Pre-existing DoD rows identical; added rows are the migration's own.
  if exists (
    select 1 from upgrade_snap.dod s
    left join reel_dod_items d on d.reel_id = s.reel_id and d.key::text = s.key
    where d.reel_id is null
       or (d.checked_by, d.checked_at, d.note) is distinct from (s.checked_by, s.checked_at, s.note)
  ) then
    raise exception 'FAIL: pre-existing DoD rows changed';
  end if;
  if (select count(*) from reel_dod_items d
       where not exists (select 1 from upgrade_snap.dod s where s.reel_id = d.reel_id and s.key = d.key::text)
         and (d.note is distinct from '[migrazione Fase 1]' or d.checked_by is not null)) > 0 then
    raise exception 'FAIL: DoD rows added without the migration mark';
  end if;

  -- Tasks: the expected kind and assignee, one open task per reel, none on
  -- idea / pubblicato / scheduled reels; paused, silent, marked as migration.
  select string_agg(format('%s: %s/%s, want %s/%s', e.code, t.kind, t.assignee_id, e.kind, e.assignee), '; ')
    into v_bad
  from upgrade_snap.expected e
  join reels r on r.code = e.code
  left join tasks t on t.reel_id = r.id and t.status in ('unassigned', 'assigned', 'in_progress')
  where t.kind::text is distinct from e.kind or t.assignee_id is distinct from e.assignee;
  if v_bad is not null then raise exception 'FAIL: migrated tasks: %', v_bad; end if;

  if exists (select reel_id from tasks group by reel_id having count(*) > 1) then
    raise exception 'FAIL: more than one task per reel';
  end if;
  if exists (
    select 1 from tasks
     where origin <> 'migration' or not escalation_paused or notified_at is null
        or started_at is null or due_at is null or yellow_at >= due_at or due_at >= escalate_at
        or (status = 'in_progress') <> (assignee_id is not null)
  ) then
    raise exception 'FAIL: migrated task fields';
  end if;
  if exists (select 1 from job_outbox) then
    raise exception 'FAIL: the backfill queued jobs (no messages for migrated tasks)';
  end if;
  if (select count(*) from task_events where op = 'migrate') <> (select count(*) from tasks) then
    raise exception 'FAIL: task_events missing for migrated tasks';
  end if;

  -- The pending request stays pending until the contract migration (S2).
  if (select status from phase_advance_requests) <> 'pending' then
    raise exception 'FAIL: pending request touched by the expand';
  end if;

  -- Profiles: all internal; group chat and duplicate cleared, last link kept.
  if exists (select 1 from profiles where account_type <> 'internal') then
    raise exception 'FAIL: an existing profile is not internal';
  end if;
  if (select telegram_chat_id from profiles where id = 'a0000000-0000-0000-0000-000000000002') is distinct from '111'
     or (select telegram_chat_id from profiles where id = 'a0000000-0000-0000-0000-000000000001') is not null
     or (select telegram_chat_id from profiles where id = 'a0000000-0000-0000-0000-000000000004') is not null then
    raise exception 'FAIL: telegram_chat_id cleanup';
  end if;

  -- Old-default preferences cleared, others kept.
  if (select count(*) from notification_prefs) <> 1
     or not exists (select 1 from notification_prefs where event = 'mention') then
    raise exception 'FAIL: notification_prefs cleanup';
  end if;
end $$;
