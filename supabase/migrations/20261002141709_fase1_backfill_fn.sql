-- Fase 1 — open tasks for the reels in flight at the cutover
-- (docs/fase1-plan.md §6). Defined here, not run: in production the runbook
-- calls it after fase1-prod-config.sql has set titulars and approvers, so
-- the migrated tasks go to the right people.
--
-- One open task per active reel, by state:
--   bozza → writing · validazione → validation · doppiaggio → dubbing ·
--   animazione → animation · approvazione_finale → final_approval ·
--   programmato without scheduled_at → scheduling · idea, pubblicato → none.
-- Assignee: the page titular for the role (validator for validation), else
-- the first active Responsible of the macro-phase in RACI, else nobody
-- (unassigned, for the admin). Final approval goes to the effective approver.
-- Migrated tasks start now, are paused for escalation until the admin
-- confirms them, and send no assignment message (notified_at = now()).
-- DoD items of the steps already passed are added, marked as migration.
-- Idempotent: reels with an open task and existing DoD rows are skipped.

create function private.page_titular(p_page_id uuid, p_kind task_kind)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.id
  from pages pg
  join profiles p on p.id = case p_kind
    when 'validation' then pg.validator_id
    when 'dubbing' then pg.dubber_titular_id
    when 'animation' then pg.animator_titular_id
  end
  where pg.id = p_page_id
    and p.deactivated_at is null;
$$;

create function private.first_responsible(p_page_id uuid, p_phase pipeline_phase)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select u.id
  from raci_configs rc
  cross join lateral unnest(rc.responsible) with ordinality as u(id, n)
  join profiles p on p.id = u.id and p.deactivated_at is null
  where rc.page_id = p_page_id
    and rc.phase = p_phase
  order by u.n
  limit 1;
$$;

create function public.fase1_backfill_open_tasks()
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_now timestamptz := now();
  v_drive boolean := coalesce(
    (select c.value = 'true'::jsonb from app_config c where c.key = 'drive_enabled'), false);
  r record;
  v_kind task_kind;
  v_assignee uuid;
  v_minutes integer;
  v_task uuid;
  v_created integer := 0;
  v_unassigned integer := 0;
  v_dod integer := 0;
begin
  for r in
    select re.id, re.page_id, re.state, re.track, re.scheduled_at
      from reels re
     where re.published_at is null
       and not exists (
         select 1 from tasks t
          where t.reel_id = re.id
            and t.status in ('unassigned', 'assigned', 'in_progress'))
     order by re.id
     for update of re
  loop
    v_kind := case r.state
      when 'bozza' then 'writing'
      when 'validazione' then 'validation'
      when 'doppiaggio' then 'dubbing'
      when 'animazione' then 'animation'
      when 'approvazione_finale' then 'final_approval'
      when 'programmato' then case when r.scheduled_at is null then 'scheduling' end
    end::task_kind;
    continue when v_kind is null;

    v_assignee := case
      when v_kind = 'final_approval' then private.effective_approver(r.page_id)
      else coalesce(
        private.page_titular(r.page_id, v_kind),
        private.first_responsible(r.page_id, public.state_raci_phase(r.state)))
    end;
    v_minutes := private.sla_minutes(r.page_id, r.track, v_kind::text::sla_step);

    insert into tasks (
      reel_id, kind, status, assignee_id, attempt,
      started_at, yellow_at, due_at, escalate_at, accepted_at,
      notified_at, escalation_paused, requires_drive, origin
    ) values (
      r.id, v_kind,
      case when v_assignee is null then 'unassigned' else 'in_progress' end::task_status,
      v_assignee, 1,
      v_now,
      private.add_sla(v_now, v_minutes * 0.75, r.track),
      private.add_sla(v_now, v_minutes, r.track),
      private.add_sla(v_now, v_minutes * 1.5, r.track),
      case when v_assignee is not null then v_now end,
      v_now, true, v_drive, 'migration'
    )
    returning id into v_task;

    insert into task_events (task_id, reel_id, actor_id, op, channel, code)
    values (v_task, r.id, null, 'migrate', 'migration', 'ok');

    v_created := v_created + 1;
    if v_assignee is null then
      v_unassigned := v_unassigned + 1;
    end if;
  end loop;

  -- Steps already passed: dubbing → script_validated; editing → + audio;
  -- final approval (legacy qc) → + editing_done, subtitles.
  insert into reel_dod_items (reel_id, key, checked_by, note)
  select re.id, k.key, null, '[migrazione Fase 1]'
  from reels re
  join (values
    ('script_validated'::dod_item_key, 1),
    ('audio_recorded'::dod_item_key, 2),
    ('editing_done'::dod_item_key, 3),
    ('subtitles'::dod_item_key, 3)
  ) as k(key, level)
    on k.level <= case re.state
      when 'doppiaggio' then 1
      when 'animazione' then 2
      when 'approvazione_finale' then 3
      else 0
    end
  where re.published_at is null
  on conflict (reel_id, key) do nothing;
  get diagnostics v_dod = row_count;

  return jsonb_build_object(
    'tasks_created', v_created,
    'unassigned', v_unassigned,
    'dod_items_added', v_dod);
end;
$$;

revoke execute on function public.fase1_backfill_open_tasks() from public, anon, authenticated;
grant execute on function public.fase1_backfill_open_tasks() to service_role;
revoke execute on all functions in schema private from public, anon, authenticated;
